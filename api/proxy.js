// ==========================================================================
// Vercel Serverless HTTPS Stream Proxy (Zero Dependencies)
// Resolves Mixed Content (http:// on https://) and CORS for HLS/DASH/TS streams
// ==========================================================================

const PRIVATE_HOST_REGEX = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|::1|\[::1\]|172\.(1[6-9]|2\d|3[01])\.)/i;

function isAllowedUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (PRIVATE_HOST_REGEX.test(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type');
}

function rewriteHlsPlaylist(body, finalUrl, refParam) {
  const base = new URL(finalUrl);
  const refSuffix = refParam ? `&ref=${encodeURIComponent(refParam)}` : '';

  return body.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    // Rewrite URI="..." attributes inside tags like #EXT-X-KEY or #EXT-X-MEDIA
    if (trimmed.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_, uri) => {
        try {
          const abs = new URL(uri, base).href;
          return `URI="/api/proxy?url=${encodeURIComponent(abs)}${refSuffix}"`;
        } catch {
          return `URI="${uri}"`;
        }
      });
    }

    // Rewrite media segment or sub-playlist URL lines
    try {
      const abs = new URL(trimmed, base).href;
      return `/api/proxy?url=${encodeURIComponent(abs)}${refSuffix}`;
    } catch {
      return line;
    }
  }).join('\n');
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const targetUrl = (req.query && (req.query.url || req.query.u)) || '';
  const refParam = (req.query && req.query.ref) || '';

  if (!targetUrl || !isAllowedUrl(targetUrl)) {
    return res.status(400).json({ error: 'Valid public http/https url parameter is required' });
  }

  const fetchHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: '*/*'
  };

  if (req.headers.range) {
    fetchHeaders.Range = req.headers.range;
  }

  if (refParam && isAllowedUrl(refParam)) {
    fetchHeaders.Referer = refParam;
    try {
      fetchHeaders.Origin = new URL(refParam).origin;
    } catch {}
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: fetchHeaders,
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).send(`Upstream returned HTTP ${upstream.status}`);
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const finalUrl = upstream.url || targetUrl;

    if (req.method === 'HEAD') {
      res.setHeader('Content-Type', contentType);
      return res.status(upstream.status).end();
    }

    const looksLikeHls = /mpegurl|m3u8/i.test(contentType) || /\.m3u8(\?|$)/i.test(finalUrl);
    const looksLikeDash = /dash\+xml/i.test(contentType) || /\.mpd(\?|$)/i.test(finalUrl);

    if (looksLikeHls) {
      const text = await upstream.text();
      if (text.trimStart().startsWith('#EXTM3U')) {
        const rewritten = rewriteHlsPlaylist(text, finalUrl, refParam);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        return res.status(200).send(rewritten);
      }
      res.setHeader('Content-Type', contentType);
      return res.status(200).send(text);
    }

    if (looksLikeDash) {
      let xml = await upstream.text();
      const basePath = finalUrl.substring(0, finalUrl.lastIndexOf('/') + 1);
      if (!/<BaseURL>/i.test(xml)) {
        xml = xml.replace(/(<MPD[^>]*>)/i, `$1\n  <BaseURL>${basePath}</BaseURL>`);
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(200).send(xml);
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache');
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);

    return res.status(upstream.status).send(buffer);
  } catch (err) {
    clearTimeout(timeout);
    const isAbort = err && err.name === 'AbortError';
    return res.status(isAbort ? 504 : 502).send(isAbort ? 'Upstream stream timeout' : `Proxy error: ${err.message}`);
  }
};
