// ==========================================================================
// Fawa Sports Management & Rendering
// ==========================================================================

const fawaMap = new Map();
let fawaMatches = [];
let fawaNews = [];
let fawaLeagues = [];
let fawaSubTab = 'matches';
let fawaActiveLeague = '';
let fawaLoaded = false;
let workingFawaProxyIndex = 0;

async function fetchHtmlViaCorsCascade(targetUrl) {
  const urlsToTry = [targetUrl];
  if (targetUrl.startsWith('http://www.fawanews.sc')) {
    urlsToTry.push(targetUrl.replace('http://', 'https://'));
  }

  let lastErr = null;
  // Start with the last working proxy
  const orderedProxies = [
    ...CORS_PROXIES.slice(workingFawaProxyIndex),
    ...CORS_PROXIES.slice(0, workingFawaProxyIndex)
  ];

  for (const url of urlsToTry) {
    for (let i = 0; i < orderedProxies.length; i++) {
      const proxy = orderedProxies[i];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const html = await proxy.fetchHtml(url, controller.signal);
        clearTimeout(timer);
        if (html && html.length > 200) {
          workingFawaProxyIndex = CORS_PROXIES.indexOf(proxy);
          return html;
        }
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
      }
    }
  }
  throw lastErr || new Error('All CORS proxies failed');
}

function parseFawaHomepage(html) {
  const chunks = html.split(/<div class="user-item/).slice(1);
  const matches = [];
  const news = [];
  const seen = new Set();

  for (const chunk of chunks) {
    const name = decodeEntities((/<div class="user-item__name">([\s\S]*?)<\/div>/.exec(chunk) || [])[1]);
    const playing = decodeEntities((/<div class="user-item__playing">([\s\S]*?)<\/div>/.exec(chunk) || [])[1]);
    const img = (/<img[^>]+src="([^"]+)"/.exec(chunk) || [])[1] || null;
    const href = (/<a[^>]+href="([^"]+\.html)"/.exec(chunk) || [])[1] || null;
    if (!name || !href) continue;

    const slug = slugOf(href);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);

    const url = `http://www.fawanews.sc/${encodeURIComponent(slug)}.html`;

    if (!playing) {
      news.push({ slug, title: name, image: img, url });
      continue;
    }

    const tm = /^(.*?)\s+(\d{1,2}:\d{2})$/.exec(playing);
    matches.push({
      slug,
      title: name,
      league: tm ? tm[1].trim() : playing,
      time: tm ? tm[2] : null,
      kickoff: kickoffIso(tm ? tm[2] : null),
      image: img,
      url
    });
  }

  matches.sort((a, b) => (a.kickoff || 'z').localeCompare(b.kickoff || 'z'));
  return { matches, news };
}

function parseFawaStreams(html) {
  const vars = {};
  for (const m of html.matchAll(/(?:var|let|const)\s+(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g)) {
    vars[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  }

  const TERM = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[A-Za-z_$][\w$]*/g;
  const unquote = (p) => (/^["'`]/.test(p) ? p.slice(1, -1) : p);
  const out = new Set();

  for (const arr of html.matchAll(/(?:VVVV|var\s+VVVV)\s*=\s*\[([\s\S]*?)\]/g)) {
    for (const term of arr[1].split(',')) {
      const parts = term.trim().match(TERM) || [];
      const url = parts.map((p) => (/^["'`]/.test(p) ? unquote(p) : vars[p] ?? '')).join('');
      if (/^https?:\/\//i.test(url)) out.add(url);
    }
  }

  for (const m of html.matchAll(/https?:\/\/[^\s"'`<>\\]+\.(?:m3u8|mp4)(?:\?[^\s"'`<>\\]*)?/gi)) {
    out.add(m[0]);
  }

  return [...out];
}

function renderFawaBanner() {
  const banner = document.getElementById('fawaModeBanner');
  if (!banner) return;

  if (settings.fawaApiUrl) {
    banner.className = 'rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs';
    banner.innerHTML = `
      <div class="flex items-center gap-2 text-emerald-300">
        <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
        <span class="font-semibold">Fawa API Proxy Mode</span>
        <span class="text-emerald-400/80 hidden sm:inline">(${escapeHtml(settings.fawaApiUrl)})</span>
      </div>
      <a href="${escapeAttr(settings.fawaApiUrl)}/api/v1/playlist.m3u" target="_blank" class="text-emerald-300 hover:text-white underline font-medium">
        M3U Playlist
      </a>
    `;
  } else {
    banner.className = 'rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs';
    banner.innerHTML = `
      <div class="flex items-center gap-2 text-amber-300">
        <i class="fa-solid fa-bolt text-amber-400"></i>
        <span><strong>Direct Browser Mode</strong> — Schedule loads directly; connect <code class="font-mono">fawanews-api</code> in Settings for proxied playback.</span>
      </div>
      <button type="button" onclick="openSettingsModal()" class="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-semibold shrink-0">
        Connect API
      </button>
    `;
  }
}

async function loadFawaSports(forceRefresh = false) {
  renderFawaBanner();
  const loader = document.getElementById('fawaLoader');
  const errorBox = document.getElementById('fawaErrorBox');
  const gridM = document.getElementById('gridFawaMatches');
  const gridN = document.getElementById('gridFawaNews');

  if (loader) loader.classList.remove('hidden');
  if (errorBox) errorBox.classList.add('hidden');
  if (gridM) gridM.innerHTML = '';
  if (gridN) gridN.innerHTML = '';

  try {
    if (settings.fawaApiUrl) {
      // Mode A: Connected to fawanews-api
      const headers = settings.fawaApiKey ? { 'x-api-key': settings.fawaApiKey } : {};
      const q = forceRefresh ? '&refresh=true' : '';
      const [mRes, nRes] = await Promise.all([
        fetch(`${settings.fawaApiUrl}/api/v1/matches?limit=200${q}`, { headers }),
        fetch(`${settings.fawaApiUrl}/api/v1/news`, { headers }).catch(() => null)
      ]);
      if (!mRes.ok) throw new Error(`Fawa API responded HTTP ${mRes.status}`);
      const mData = await mRes.json();
      const nData = nRes && nRes.ok ? await nRes.json() : { items: [] };
      fawaMatches = mData.items || [];
      fawaNews = nData.items || [];
    } else {
      // Mode B: Direct Browser Fallback via CORS Proxy Cascade
      const loaderText = document.getElementById('fawaLoaderText');
      if (loaderText) loaderText.textContent = 'Fetching fawanews.sc via CORS proxy...';
      const html = await fetchHtmlViaCorsCascade('http://www.fawanews.sc/');
      const parsed = parseFawaHomepage(html);
      fawaMatches = parsed.matches;
      fawaNews = parsed.news;
    }

    fawaMap.clear();
    const leagueCounts = new Map();
    for (const m of fawaMatches) {
      fawaMap.set(m.slug, m);
      if (m.league) leagueCounts.set(m.league, (leagueCounts.get(m.league) || 0) + 1);
    }
    fawaLeagues = [...leagueCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    fawaLoaded = true;
    const badge = document.getElementById('badgeFawaCount');
    if (badge) badge.textContent = fawaMatches.length;
    renderChipsBar();
    renderFawaContent();
  } catch (err) {
    console.error('Fawa load error:', err);
    const errMsg = document.getElementById('fawaErrorMsg');
    if (errMsg) {
      errMsg.textContent = settings.fawaApiUrl
        ? `Could not reach ${settings.fawaApiUrl} (${err.message}). Check if the server is running and uses HTTPS if this page is on HTTPS.`
        : `Direct browser fetch failed (${err.message}). Public CORS proxies may be rate-limited — try retrying or connect your own fawanews-api in Settings.`;
    }
    if (errorBox) errorBox.classList.remove('hidden');
  } finally {
    if (loader) loader.classList.add('hidden');
  }
}

function setFawaSubTab(sub) {
  fawaSubTab = sub;
  const btnM = document.getElementById('btnFawaMatches');
  const btnN = document.getElementById('btnFawaNews');

  if (btnM) {
    btnM.className = sub === 'matches'
      ? 'px-3 py-1 rounded-lg font-semibold bg-slate-800 text-white'
      : 'px-3 py-1 rounded-lg font-semibold text-slate-400 hover:text-white';
  }
  if (btnN) {
    btnN.className = sub === 'news'
      ? 'px-3 py-1 rounded-lg font-semibold bg-slate-800 text-white'
      : 'px-3 py-1 rounded-lg font-semibold text-slate-400 hover:text-white';
  }
  renderFawaContent();
}

function renderFawaContent() {
  const gridM = document.getElementById('gridFawaMatches');
  const gridN = document.getElementById('gridFawaNews');
  if (!gridM || !gridN) return;
  const q = (searchQuery || '').toLowerCase();

  if (fawaSubTab === 'matches') {
    gridM.classList.remove('hidden');
    gridN.classList.add('hidden');

    const list = fawaMatches.filter((m) => {
      if (fawaActiveLeague && m.league !== fawaActiveLeague) return false;
      if (q && !`${m.title} ${m.league}`.toLowerCase().includes(q)) return false;
      return true;
    });

    if (!list.length) {
      gridM.innerHTML = `<div class="col-span-full py-12 text-center text-xs text-slate-500">No matches found.</div>`;
      return;
    }

    const frag = document.createDocumentFragment();
    for (const m of list) {
      const ko = formatKickoff(m.kickoff, m.time);
      const card = document.createElement('div');
      card.setAttribute('data-match-slug', m.slug);
      card.className = 'group bg-[#111827] hover:bg-slate-800/90 border border-slate-800/80 hover:border-fawa-500/50 rounded-xl p-3.5 flex flex-col justify-between gap-3 cursor-pointer transition active:scale-[0.98]';

      card.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          <span class="px-2 py-0.5 rounded-md bg-fawa-500/10 border border-fawa-500/20 text-fawa-400 text-[10px] font-bold uppercase truncate">
            ${escapeHtml(m.league || 'Sports')}
          </span>
          ${ko.isLive
            ? `<span class="px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-[10px] font-bold flex items-center gap-1 shrink-0"><span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-live"></span>LIVE</span>`
            : `<span class="text-[11px] text-slate-400 font-mono shrink-0">${escapeHtml(ko.label)}</span>`}
        </div>
        <h3 class="text-xs sm:text-sm font-bold text-slate-100 group-hover:text-fawa-400 leading-snug line-clamp-2">${escapeHtml(m.title)}</h3>
        <div class="pt-2 border-t border-slate-800/70 flex items-center justify-between text-[11px] text-fawa-400 font-semibold">
          <span><i class="fa-solid fa-play mr-1.5 text-[10px]"></i>Watch Match</span>
          <i class="fa-solid fa-chevron-right text-[10px] group-hover:translate-x-0.5 transition-transform"></i>
        </div>
      `;
      frag.appendChild(card);
    }
    gridM.innerHTML = '';
    gridM.appendChild(frag);
  } else {
    gridM.classList.add('hidden');
    gridN.classList.remove('hidden');

    const list = fawaNews.filter((n) => !q || n.title.toLowerCase().includes(q));
    if (!list.length) {
      gridN.innerHTML = `<div class="col-span-full py-12 text-center text-xs text-slate-500">No news headlines found.</div>`;
      return;
    }
    gridN.innerHTML = list.map((n) => `
      <a href="${escapeAttr(n.url)}" target="_blank" rel="noopener"
        class="bg-[#111827] hover:bg-slate-800/90 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between gap-3 transition">
        <div class="space-y-1.5">
          <span class="text-[10px] font-bold uppercase text-fawa-400">Fawa News</span>
          <h3 class="text-xs sm:text-sm font-bold text-white leading-snug">${escapeHtml(n.title)}</h3>
        </div>
        <span class="text-[11px] text-slate-400 flex items-center gap-1">Open article <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i></span>
      </a>
    `).join('');
  }
}
