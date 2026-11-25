import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qwwyyvutthpolokmvjuf.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3d3l5dnV0dGhwb2xva212anVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNDIyNDksImV4cCI6MjA4ODcxODI0OX0.eN5k0NMxwcRT4t3tIKn_aBq2z2MdL0OFz5R_Jf64VO0';
const PORT = Number(process.env.PORT || 8080);
const CACHE_TTL = 60_000;

export const app = express();
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PTV-Token, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ---------------- supabase transport ---------------- */

async function sb(pathname, { method = 'GET', token, body, headers = {}, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    method,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token || ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

/* ---------------- session manager ---------------- */

const state = {
  staticToken: process.env.PTV_SESSION_TOKEN || '',
  userToken: '',
  accessToken: '',
  refreshToken: '',
  accessExp: 0,
  mintedToken: '',
  email: process.env.PTV_EMAIL || '',
  password: process.env.PTV_PASSWORD || '',
};

async function signIn() {
  if (!state.email || !state.password) return null;
  const r = await sb('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: state.email, password: state.password },
  });
  if (!r.ok) {
    console.error('[session] sign-in failed:', r.status, JSON.stringify(r.data).slice(0, 300));
    return null;
  }
  state.accessToken = r.data.access_token;
  state.refreshToken = r.data.refresh_token;
  state.accessExp = Date.now() + (r.data.expires_in || 3600) * 1000;
  state.mintedToken = '';
  console.log('[session] signed in as', r.data.user?.email || state.email);
  return state.accessToken;
}

async function ensureAccess() {
  if (state.accessToken && Date.now() < state.accessExp - 60_000) return state.accessToken;
  if (state.refreshToken) {
    const r = await sb('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: { refresh_token: state.refreshToken },
    });
    if (r.ok) {
      state.accessToken = r.data.access_token;
      state.refreshToken = r.data.refresh_token;
      state.accessExp = Date.now() + (r.data.expires_in || 3600) * 1000;
      return state.accessToken;
    }
  }
  return signIn();
}

async function mintSessionToken() {
  if (state.mintedToken) return state.mintedToken;
  const access = await ensureAccess();
  if (!access) return null;

  const token = crypto.randomUUID();
  const uid = (await sb('/auth/v1/user', { token: access })).data?.id;
  const candidates = [
    { user_id: uid, session_token: token },
    { user_id: uid, session_token: token, device_info: 'open-api' },
    { user_id: uid, token },
  ];
  for (const body of candidates) {
    const r = await sb('/rest/v1/active_sessions', {
      method: 'POST', token: access, body, prefer: 'return=representation',
    });
    if (r.ok) {
      state.mintedToken = token;
      console.log('[session] minted active_sessions token');
      return token;
    }
  }
  console.error('[session] could not mint token; relying on access token');
  return null;
}

async function tokenCandidates(explicitToken) {
  const out = [];
  if (explicitToken) out.push(explicitToken);
  if (state.staticToken) out.push(state.staticToken);
  if (state.userToken) out.push(state.userToken);
  const access = await ensureAccess();
  if (access) out.push(access);
  const minted = await mintSessionToken();
  if (minted) out.push(minted);
  return [...new Set(out.filter(Boolean))];
}

function invalidate(token) {
  if (token === state.userToken) state.userToken = '';
  if (token === state.mintedToken) state.mintedToken = '';
}

/* ---------------- catalog ---------------- */

let catalogCache = { at: 0, channels: [] };

async function getCatalog() {
  if (Date.now() - catalogCache.at < CACHE_TTL && catalogCache.channels.length) {
    return catalogCache.channels;
  }
  const r = await sb('/functions/v1/channels-catalog', {
    method: 'POST',
    body: { action: 'list' },
  });
  const channels = r.data?.channels || [];
  if (channels.length) catalogCache = { at: Date.now(), channels };
  return channels;
}

const publicShape = (c) => ({
  id: c.id,
  name: (c.name || '').trim(),
  description: c.description || '',
  logo: c.icon_url || c.image_url || '',
  poster: c.image_url || '',
  category: c.category || '',
  free: !!c.is_free,
  type: c.stream_type === 'mpd' ? 'dash' : 'hls',
});

/* ---------------- stream resolution ---------------- */

async function resolveStream(channelId, explicitToken) {
  const attempts = [];
  const candidates = await tokenCandidates(explicitToken);
  
  for (const token of candidates) {
    const r = await sb('/functions/v1/get-stream-credentials', {
      method: 'POST',
      token,
      body: { channelId },
    });
    if (r.ok) {
      return {
        ok: true,
        payload: r.data,
        via: token === explicitToken ? 'request' : token === state.staticToken ? 'static' : 'session'
      };
    }
    attempts.push(r.status);
    if (r.status === 401 || r.status === 403) {
      invalidate(token);
      continue;
    }
    return { ok: false, status: r.status, payload: r.data, attempts };
  }
  return {
    ok: false,
    status: 401,
    payload: { error: 'No usable credentials. Provide a Prince TV session token or configure login.' },
    attempts
  };
}

function normaliseStream(payload) {
  const p = payload || {};
  const url = p.url || p.stream_url || p.streamUrl || p.hls || p.mpd || p.manifest || p.src || '';
  const headers = p.headers || p.request_headers || {};

  // Normalise ClearKey DRM to { [keyIdHex]: keyHex } for Shaka Player
  let drm = null;
  const rawDrm = p.clearKeys || p.clear_keys || p.drm || p.clearkey || p.clear_key;
  if (rawDrm) {
    if (typeof rawDrm === 'object' && !Array.isArray(rawDrm)) {
      if (rawDrm.key_id && rawDrm.key) {
        drm = { [rawDrm.key_id.trim()]: rawDrm.key.trim() };
      } else if (rawDrm.keyId && rawDrm.key) {
        drm = { [rawDrm.keyId.trim()]: rawDrm.key.trim() };
      } else if (rawDrm.keys && typeof rawDrm.keys === 'object') {
        drm = rawDrm.keys;
      } else {
        drm = rawDrm;
      }
    } else if (typeof rawDrm === 'string' && rawDrm.includes(':')) {
      const [kid, k] = rawDrm.split(':');
      drm = { [kid.trim()]: k.trim() };
    }
  } else if ((p.key_id || p.keyId) && p.key) {
    const kid = (p.key_id || p.keyId).trim();
    drm = { [kid]: p.key.trim() };
  }

  const token = p.globalToken || p.token || null;
  return { url, headers, drm, token, raw: p };
}

/* ---------------- routes ---------------- */

app.get('/api/health', async (req, res) => {
  const tokens = await tokenCandidates();
  res.json({
    ok: true,
    credentials: tokens.length,
    modes: {
      staticToken: !!state.staticToken,
      login: !!(state.email && state.password),
      pasted: !!state.userToken,
    },
  });
});

app.post('/api/session/token', (req, res) => {
  const token = (req.body?.token || req.query.token || '').trim();
  if (!token) return res.status(400).json({ error: 'token required' });
  state.userToken = token;
  state.mintedToken = '';
  res.json({ ok: true, message: 'Session token stored' });
});

app.get('/api/categories', async (req, res) => {
  const channels = await getCatalog();
  const counts = new Map();
  for (const c of channels) counts.set(c.category, (counts.get(c.category) || 0) + 1);
  res.json({
    categories: [...counts].map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  });
});

app.get('/api/channels', async (req, res) => {
  let channels = await getCatalog();
  const { category, search, free } = req.query;
  if (category) {
    const want = String(category).toLowerCase();
    channels = channels.filter((c) => (c.category || '').toLowerCase() === want);
  }
  if (search) {
    const q = String(search).toLowerCase();
    channels = channels.filter((c) =>
      (c.name || '').toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q));
  }
  if (free === '1' || free === 'true') channels = channels.filter((c) => c.is_free);
  res.json({ total: channels.length, channels: channels.map(publicShape) });
});

app.get('/api/channels/:id', async (req, res) => {
  const channels = await getCatalog();
  const found = channels.find((c) => c.id === req.params.id);
  if (!found) return res.status(404).json({ error: 'Channel not found' });
  res.json(publicShape(found));
});

app.get('/api/channels/:id/stream', async (req, res) => {
  const channels = await getCatalog();
  const channel = channels.find((c) => c.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  // Accept token from header or query param if passed
  const requestToken = req.headers['x-ptv-token'] || req.query.token || '';
  const result = await resolveStream(channel.id, requestToken);
  
  if (!result.ok) {
    return res.status(result.status === 401 ? 401 : 502).json({
      error: result.payload?.error || 'Stream unavailable',
      detail: result.payload,
      hint: result.status === 401
        ? 'Set PTV_SESSION_TOKEN in environment, or paste sessionToken in Settings'
        : undefined,
      channel: publicShape(channel),
    });
  }

  const { url, headers, drm, token } = normaliseStream(result.payload);
  if (!url) return res.status(502).json({ error: 'Resolver returned no URL', raw: result.payload });

  const wantsRedirect = req.query.redirect === '1' || req.query.redirect === 'true';
  if (wantsRedirect && !Object.keys(headers).length) return res.redirect(302, url);

  const upstreamReferer = headers.Referer || headers.referer || 'https://princetv.online/';
  const host = req.get('host') || `localhost:${PORT}`;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  
  const proxied = `${proto}://${host}/api/proxy?u=${encodeURIComponent(url)}&ref=${encodeURIComponent(upstreamReferer)}`;

  // For DASH streams or streams with required headers, default to proxied URL to avoid CORS/Referer blocks
  const streamType = channel.stream_type === 'mpd' ? 'dash' : 'hls';
  const shouldProxy = req.query.raw !== '1' && (streamType === 'dash' || Object.keys(headers).length > 0);

  res.json({
    channel: publicShape(channel),
    type: streamType,
    url: shouldProxy ? proxied : url,
    source: url,
    proxyUrl: proxied,
    headers,
    drm,
    token,
    playable: `${proto}://${host}/player.html?id=${channel.id}`,
    via: result.via,
  });
});

app.get('/api/proxy', async (req, res) => {
  const target = req.query.u;
  if (!target) return res.status(400).send('u required');
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: '*/*'
  };
  
  const ref = req.query.ref || 'https://princetv.online/';
  headers.Referer = ref;
  try {
    headers.Origin = new URL(ref).origin;
  } catch {}

  let r;
  try {
    r = await fetch(target, { headers });
  } catch (err) {
    return res.status(502).send('Upstream fetch error: ' + err.message);
  }

  if (!r.ok) return res.status(r.status).send(await r.text());

  const type = r.headers.get('content-type') || '';
  res.setHeader('Content-Type', type);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  const host = req.get('host') || `localhost:${PORT}`;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';

  // Rewrite HLS manifest URIs so child playlists/segments also pass through proxy with proper Referer
  if (/mpegurl|m3u8/i.test(type) || /\.m3u8(\?|$)/i.test(target)) {
    const body = await r.text();
    const base = new URL(target);
    const rewritten = body.split('\n').map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) {
        return t.replace(/URI="([^"]+)"/g, (_, u) =>
          `URI="${proto}://${host}/api/proxy?u=${encodeURIComponent(new URL(u, base).href)}&ref=${encodeURIComponent(ref)}"`);
      }
      return `${proto}://${host}/api/proxy?u=${encodeURIComponent(new URL(t, base).href)}&ref=${encodeURIComponent(ref)}`;
    }).join('\n');
    return res.send(rewritten);
  }

  // Rewrite DASH MPD manifest: ensure BaseURL exists so relative segments resolve correctly
  if (/dash\+xml|xml/i.test(type) || /\.mpd(\?|$)/i.test(target)) {
    let body = await r.text();
    const targetUrl = new URL(target);
    const basePath = targetUrl.href.substring(0, targetUrl.href.lastIndexOf('/') + 1);
    
    // Inject BaseURL if missing so Shaka Player resolves relative segment URLs against the original CDN
    if (!/<BaseURL>/i.test(body)) {
      body = body.replace(/(<MPD[^>]*>)/i, `$1\n  <BaseURL>${basePath}</BaseURL>`);
    }
    return res.send(body);
  }

  const buf = Buffer.from(await r.arrayBuffer());
  res.send(buf);
});

app.get('/api/playlist.m3u', async (req, res) => {
  const channels = (await getCatalog()).filter((c) => c.stream_type !== 'mpd');
  const host = req.get('host') || `localhost:${PORT}`;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const base = `${proto}://${host}`;
  const lines = ['#EXTM3U', `#PLAYLIST:Prince TV (${channels.length} channels)`];
  for (const c of channels) {
    lines.push(`#EXTINF:-1 tvg-id="${c.id}" tvg-logo="${c.icon_url || c.image_url || ''}" group-title="${c.category || 'General'}",${(c.name || '').trim()}`);
    lines.push(`${base}/api/channels/${c.id}/stream?redirect=1`);
  }
  res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="princetv.m3u"');
  res.send(lines.join('\n'));
});

// Serve public directory
app.use(express.static(path.join(__dirname, 'public')));
app.get('/player', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Prince TV open API on :${PORT}`);
    console.log('  GET  /api/channels              full catalog');
    console.log('  GET  /api/channels/:id/stream   resolve a playable URL');
    console.log('  GET  /api/playlist.m3u          M3U for VLC/IPTV apps');
    if (!state.staticToken && !state.email) {
      console.log('  ! no credentials configured - set PTV_SESSION_TOKEN or POST to /api/session/token');
    }
  });
}
