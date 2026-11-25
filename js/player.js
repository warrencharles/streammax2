// ==========================================================================
// Video & Media Player Engine (HLS.js, MPEG-TS & Shaka Player for DASH/ClearKey)
// ==========================================================================

let hlsInstance = null;
let mpegtsInstance = null;
let shakaInstance = null;
let activePlayerContext = null; // { type: 'prince'|'fawa', id, title, subtitle, streams: [{url, label, proxyUrl, type, drm, token}], index, isEmbed, slug }
let autoFallbackCount = 0;

// Install Shaka polyfills early
if (typeof window !== 'undefined' && window.shaka) {
  try { window.shaka.polyfill.installAll(); } catch {}
}

async function openPrincePlayer(ch) {
  addRecent(ch.id);
  autoFallbackCount = 0;

  activePlayerContext = {
    type: 'prince',
    id: ch.id,
    title: ch.name,
    subtitle: `${ch.countryName || ch.country || 'Global'} • ${(ch.categories || ['General']).join(', ')}`,
    streams: (ch.streams || []).map((s, i) => ({
      url: s.proxyUrl || s.url,
      rawUrl: s.url,
      label: s.title || `Stream ${i + 1}`,
      type: s.type || ch.type || 'hls',
      drm: s.drm || null,
      token: s.token || null,
      headers: s.headers || null
    })),
    index: 0,
    isEmbed: false,
    channel: ch
  };

  setupPlayerModalChrome();

  // If this channel needs dynamic stream resolution from /api/channels/:id/stream
  if (ch.resolveUrl || (!activePlayerContext.streams.length && ch.id)) {
    showPlayerLoading(`Resolving stream for ${ch.name}...`);
    try {
      const resolved = await resolveChannelStream(ch.id);
      activePlayerContext.streams = [{
        url: resolved.url || resolved.proxyUrl,
        rawUrl: resolved.source || resolved.url,
        label: resolved.type === 'dash' ? 'DASH (ClearKey)' : 'HD',
        type: resolved.type || 'hls',
        drm: resolved.drm || null,
        token: resolved.token || null,
        headers: resolved.headers || null
      }];
      renderPlayerStreamPills();
      playContextStream(0);
    } catch (err) {
      showPlayerError(
        'Stream Resolution Failed',
        err.message || 'Could not resolve channel stream. Check if session token is needed.'
      );
    }
    return;
  }

  playContextStream(0);
}

async function resolveChannelStream(channelId) {
  const base = settings.princeApiUrl || '';
  const token = settings.princeSessionToken || '';
  const headers = {};
  if (token) headers['x-ptv-token'] = token;
  if (settings.princeApiKey) headers['x-api-key'] = settings.princeApiKey;

  const res = await fetch(`${base}/api/channels/${encodeURIComponent(channelId)}/stream`, { headers });
  const data = await res.json();
  if (!res.ok) {
    const msg = (data.error || 'Stream unavailable') + (data.hint ? ` — ${data.hint}` : '');
    throw new Error(msg);
  }
  return data;
}

async function openFawaPlayer(match) {
  autoFallbackCount = 0;
  activePlayerContext = {
    type: 'fawa',
    slug: match.slug,
    title: match.title,
    subtitle: match.league || 'Fawa Sports',
    streams: [],
    index: 0,
    isEmbed: false
  };

  setupPlayerModalChrome();
  showPlayerLoading('Extracting match streams...');

  try {
    if (settings.fawaApiUrl) {
      const headers = settings.fawaApiKey ? { 'x-api-key': settings.fawaApiKey } : {};
      const res = await fetch(`${settings.fawaApiUrl}/api/v1/matches/${encodeURIComponent(match.slug)}/streams`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      activePlayerContext.streams = (data.streams || []).map((s, i) => ({
        url: s.proxyUrl || s.url,
        rawUrl: s.url,
        label: s.label || `CH ${i + 1}`,
        type: 'hls'
      }));
    } else {
      const html = await fetchHtmlViaCorsCascade(match.url);
      const urls = parseFawaStreams(html);
      activePlayerContext.streams = urls.map((u, i) => ({
        url: u,
        rawUrl: u,
        label: `CH ${i + 1}`,
        type: 'hls'
      }));
    }

    if (!activePlayerContext.streams.length) {
      throw new Error('No playable stream links were found on this match page yet.');
    }

    renderPlayerStreamPills();
    playContextStream(0);
  } catch (err) {
    showPlayerError(
      'Could Not Extract Streams',
      err.message || 'No streams available for this match yet.'
    );
  }
}

function setupPlayerModalChrome() {
  const ctx = activePlayerContext;
  document.getElementById('playerTitle').textContent = ctx.title;
  document.getElementById('playerSubtitle').textContent = ctx.subtitle;

  const icon = document.getElementById('playerHeaderIcon');
  icon.className = ctx.type === 'fawa'
    ? 'w-8 h-8 rounded-lg bg-fawa-500/20 text-fawa-400 flex items-center justify-center shrink-0'
    : 'w-8 h-8 rounded-lg bg-brand-500/20 text-brand-400 flex items-center justify-center shrink-0';
  icon.innerHTML = ctx.type === 'fawa'
    ? '<i class="fa-solid fa-futbol text-xs"></i>'
    : '<i class="fa-solid fa-tv text-xs"></i>';

  // Embed button only when Fawa API URL is configured
  const btnEmbed = document.getElementById('btnEmbedToggle');
  btnEmbed.classList.toggle('hidden', !(ctx.type === 'fawa' && settings.fawaApiUrl));
  btnEmbed.querySelector('span').textContent = 'Embed Player';

  // Favorite button only for Prince TV
  const btnFav = document.getElementById('btnModalFav');
  btnFav.classList.toggle('hidden', ctx.type !== 'prince');
  if (ctx.type === 'prince') updateModalFavIcon();

  renderPlayerStreamPills();
  document.getElementById('playerModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function renderPlayerStreamPills() {
  const ctx = activePlayerContext;
  const wrap = document.getElementById('streamPillsWrap');
  const container = document.getElementById('streamPills');
  container.innerHTML = '';

  if (!ctx || ctx.streams.length <= 1) {
    wrap.classList.add('hidden');
    return;
  }

  wrap.classList.remove('hidden');
  ctx.streams.forEach((s, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const active = i === ctx.index;
    btn.className = `px-3 py-1 rounded-lg text-xs font-semibold transition ${
      active ? 'bg-brand-500 text-white shadow' : 'bg-slate-800 text-slate-300 hover:text-white'
    }`;
    btn.textContent = s.label;
    btn.onclick = () => {
      autoFallbackCount = 0;
      playContextStream(i);
    };
    container.appendChild(btn);
  });
}

function teardownMedia() {
  if (hlsInstance) {
    try { hlsInstance.destroy(); } catch {}
    hlsInstance = null;
  }
  if (mpegtsInstance) {
    try { mpegtsInstance.destroy(); } catch {}
    mpegtsInstance = null;
  }
  if (shakaInstance) {
    try { shakaInstance.destroy(); } catch {}
    shakaInstance = null;
  }
  const video = document.getElementById('videoEl');
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  const iframe = document.getElementById('iframeEl');
  if (iframe) {
    iframe.src = 'about:blank';
  }
}

async function playContextStream(index) {
  const ctx = activePlayerContext;
  if (!ctx || !ctx.streams[index]) return;
  ctx.index = index;
  renderPlayerStreamPills();

  if (ctx.isEmbed && ctx.type === 'fawa' && settings.fawaApiUrl) {
    loadFawaEmbed(ctx.slug, index);
    return;
  }

  const stream = ctx.streams[index];
  const url = stream.url;
  teardownMedia();

  const video = document.getElementById('videoEl');
  const iframe = document.getElementById('iframeEl');
  video.classList.remove('hidden');
  iframe.classList.add('hidden');
  document.getElementById('playerError').classList.add('hidden');
  document.getElementById('tapToPlayOverlay').classList.add('hidden');
  showPlayerLoading(`Connecting to ${stream.label}...`);

  const isDash = stream.type === 'dash' || /\.mpd(\?|$)/i.test(url);
  const isTsFlv = !isDash && /\.(ts|flv)(\?|$)/i.test(url);
  const isHls = !isDash && !isTsFlv;

  document.getElementById('playerStreamStatus').textContent = `Playing ${stream.label} (${index + 1}/${ctx.streams.length})`;
  document.getElementById('playerProtocolBadge').textContent = isDash ? 'DASH' : (/^https:\/\//i.test(url) ? 'HTTPS' : 'HTTP');

  // Mixed Content early detection
  if (window.location.protocol === 'https:' && /^http:\/\//i.test(url) && !url.includes('/api/proxy')) {
    handleStreamFailure('mixed_content', 'Browser blocked this HTTP stream on an HTTPS page (Mixed Content). Connect your proxy in Settings.');
    return;
  }

  // Always start muted + playsInline so autoplay is never blocked
  video.muted = true;
  video.playsInline = true;
  document.getElementById('btnUnmute').classList.remove('hidden');

  // ==================== DASH PLAYBACK (Shaka Player) ====================
  if (isDash) {
    if (window.shaka && shaka.Player.isBrowserSupported()) {
      try {
        shaka.polyfill.installAll();
        shakaInstance = new shaka.Player(video);

        const shakaConfig = {
          manifest: {
            dash: { ignoreMinBufferTime: true }
          },
          streaming: {
            bufferingGoal: 2,
            rebufferingGoal: 1,
            bufferBehind: 10,
            jumpLargeGaps: true,
            retryParameters: { maxAttempts: 5, baseDelay: 200, backoffFactor: 2, timeout: 15000 }
          }
        };

        // ClearKey DRM configuration
        if (stream.drm) {
          shakaConfig.drm = { clearKeys: stream.drm };
        }

        shakaInstance.configure(shakaConfig);

        // Optional token injection
        if (stream.token) {
          shakaInstance.getNetworkingEngine().registerRequestFilter((type, req) => {
            if (req.uris && req.uris.length) {
              try {
                const u = new URL(req.uris[0]);
                if (!u.searchParams.has('token')) {
                  u.searchParams.set('token', stream.token);
                  req.uris[0] = u.href;
                }
              } catch {}
            }
          });
        }

        shakaInstance.addEventListener('error', (event) => {
          console.error('Shaka player error:', event.detail);
          const code = event.detail?.code;
          if (code === 6001 || code === 6002) {
            handleStreamFailure('drm_error', 'DRM ClearKey rejected. Check session token.');
          } else {
            handleStreamFailure('dash_error', event.detail?.message || 'DASH stream playback error');
          }
        });

        await shakaInstance.load(url);
        hidePlayerLoading();
        attemptPlay(video);
      } catch (err) {
        handleStreamFailure('dash_load_failed', err.message || 'Shaka failed to load DASH stream');
      }
    } else {
      handleStreamFailure('unsupported', 'This browser does not support MPEG-DASH / MediaSource.');
    }
  }
  // ==================== HLS PLAYBACK (Hls.js) ====================
  else if (isHls && window.Hls && Hls.isSupported()) {
    hlsInstance = new Hls({
      lowLatencyMode: true,
      enableWorker: true,
      manifestLoadingTimeOut: 12000,
      levelLoadingTimeOut: 12000,
      xhrSetup: (xhr) => {
        if (stream.headers) {
          for (const [k, v] of Object.entries(stream.headers)) {
            try { xhr.setRequestHeader(k, v); } catch {}
          }
        }
      }
    });
    hlsInstance.loadSource(url);
    hlsInstance.attachMedia(video);

    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      hidePlayerLoading();
      attemptPlay(video);
    });

    hlsInstance.on(Hls.Events.ERROR, (_ev, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hlsInstance.recoverMediaError();
        return;
      }
      const code = data.response ? data.response.code : 0;
      if (code === 403) handleStreamFailure('cors_403', 'Upstream CDN rejected the request (HTTP 403 / Referer required).');
      else if (code === 404) handleStreamFailure('offline', 'Stream playlist returned HTTP 404 (Offline).');
      else handleStreamFailure('cors_or_network', 'Network or CORS error while loading HLS stream.');
    });
  } else if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    video.onloadedmetadata = () => {
      hidePlayerLoading();
      attemptPlay(video);
    };
    video.onerror = () => handleStreamFailure('offline', 'Native HLS playback failed.');
  } 
  // ==================== MPEG-TS / FLV PLAYBACK ====================
  else if (isTsFlv && window.mpegts && mpegts.isSupported()) {
    mpegtsInstance = mpegts.createPlayer({ type: url.includes('.flv') ? 'flv' : 'mpegts', isLive: true, url });
    mpegtsInstance.attachMediaElement(video);
    mpegtsInstance.load();
    hidePlayerLoading();
    attemptPlay(video);
    mpegtsInstance.on(mpegts.Events.ERROR, () => handleStreamFailure('offline', 'MPEG-TS stream failed to load.'));
  } else {
    video.src = url;
    video.oncanplay = () => {
      hidePlayerLoading();
      attemptPlay(video);
    };
    video.onerror = () => handleStreamFailure('offline', 'Direct media playback failed.');
  }
}

function attemptPlay(video) {
  const p = video.play();
  if (p && typeof p.catch === 'function') {
    p.catch(() => {
      document.getElementById('tapToPlayOverlay').classList.remove('hidden');
    });
  }
}

function manualPlayVideo() {
  const video = document.getElementById('videoEl');
  document.getElementById('tapToPlayOverlay').classList.add('hidden');
  video.play().catch(() => {});
}

function unmuteVideo() {
  const video = document.getElementById('videoEl');
  video.muted = false;
  video.volume = 1;
  document.getElementById('btnUnmute').classList.add('hidden');
}

function handleStreamFailure(reason, detail) {
  const ctx = activePlayerContext;
  if (!ctx) return;

  // Automatic fallback to next stream if available
  if (ctx.index + 1 < ctx.streams.length && autoFallbackCount < 3) {
    autoFallbackCount++;
    showToast(`Stream ${ctx.index + 1} failed — trying ${ctx.streams[ctx.index + 1].label}...`, 'info');
    playContextStream(ctx.index + 1);
    return;
  }

  teardownMedia();
  let title = 'Stream Playback Failed';
  let msg = detail;

  if (ctx.type === 'fawa' && !settings.fawaApiUrl) {
    title = 'Fawa CDN Requires Backend Proxy';
    msg = 'FawaNews stream servers block direct browser playback (Referer/Origin/Mixed Content). Connect your fawanews-api URL in Settings or copy the stream URL to play in VLC.';
  } else if (reason === 'mixed_content') {
    title = 'Blocked: HTTP Stream on HTTPS Page';
    msg = 'Browsers block insecure http:// streams on https:// pages. Try an HTTPS Ready channel, connect your HTTPS API proxy, or copy the URL for VLC.';
  } else if (reason === 'drm_error' || detail?.includes('No usable credentials') || detail?.includes('sessionToken')) {
    title = 'Session Token Required for Premium Stream';
    msg = 'This channel (such as Azam Sports) requires a Prince TV session token. Go to Settings and paste your session token from princetv.online.';
  }

  showPlayerError(title, msg);
}

function toggleFawaEmbedMode(forceEmbed) {
  const ctx = activePlayerContext;
  if (!ctx || ctx.type !== 'fawa' || !settings.fawaApiUrl) return;
  ctx.isEmbed = typeof forceEmbed === 'boolean' ? forceEmbed : !ctx.isEmbed;

  const btn = document.getElementById('btnEmbedToggle');
  btn.querySelector('span').textContent = ctx.isEmbed ? 'HLS Player' : 'Embed Player';

  if (ctx.isEmbed) loadFawaEmbed(ctx.slug, ctx.index);
  else playContextStream(ctx.index);
}

function loadFawaEmbed(slug, index) {
  teardownMedia();
  hidePlayerLoading();
  document.getElementById('playerError').classList.add('hidden');
  document.getElementById('btnUnmute').classList.add('hidden');
  document.getElementById('tapToPlayOverlay').classList.add('hidden');

  const video = document.getElementById('videoEl');
  const iframe = document.getElementById('iframeEl');
  video.classList.add('hidden');
  iframe.classList.remove('hidden');
  iframe.src = `${settings.fawaApiUrl}/embed/${encodeURIComponent(slug)}?i=${index}`;
  document.getElementById('playerStreamStatus').textContent = `Embed Player (CH ${index + 1})`;
  document.getElementById('playerProtocolBadge').textContent = 'EMBED';
}

function showPlayerLoading(msg) {
  document.getElementById('playerLoadingMsg').textContent = msg;
  document.getElementById('playerLoading').classList.remove('hidden');
}

function hidePlayerLoading() {
  document.getElementById('playerLoading').classList.add('hidden');
}

function showPlayerError(title, desc) {
  hidePlayerLoading();
  document.getElementById('btnUnmute').classList.add('hidden');
  document.getElementById('tapToPlayOverlay').classList.add('hidden');
  document.getElementById('playerErrorTitle').textContent = title;
  document.getElementById('playerErrorDesc').textContent = desc;

  const ctx = activePlayerContext;
  const hasNext = ctx && ctx.index + 1 < ctx.streams.length;
  document.getElementById('btnErrNextStream').classList.toggle('hidden', !hasNext);
  document.getElementById('btnErrEmbed').classList.toggle('hidden', !(ctx && ctx.type === 'fawa' && settings.fawaApiUrl));
  document.getElementById('btnErrSettings').classList.toggle('hidden', !(ctx && (ctx.type === 'fawa' && !settings.fawaApiUrl || desc.includes('session token'))));

  document.getElementById('playerError').classList.remove('hidden');
}

function retryCurrentStream() {
  if (!activePlayerContext) return;
  autoFallbackCount = 0;
  playContextStream(activePlayerContext.index);
}

function tryNextStreamManual() {
  if (!activePlayerContext) return;
  const next = (activePlayerContext.index + 1) % activePlayerContext.streams.length;
  playContextStream(next);
}

function closePlayerModal() {
  teardownMedia();
  document.getElementById('playerModal').classList.add('hidden');
  document.body.style.overflow = '';
  activePlayerContext = null;
}

function copyCurrentStreamUrl() {
  if (!activePlayerContext || !activePlayerContext.streams.length) {
    showToast('No stream URL available', 'warning');
    return;
  }
  const s = activePlayerContext.streams[activePlayerContext.index];
  const text = s.url || s.rawUrl;
  copyText(text);
  showToast('Stream URL copied for VLC', 'success');
}
