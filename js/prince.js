// ==========================================================================
// Prince TV Channel Management & Rendering
// ==========================================================================

const princeMap = new Map();
let princeAllList = [];
let princeFiltered = [];
let princeRenderedCount = 0;
let princeChip = 'all'; // Featured is OFF by default
let countryNamesMap = new Map();

function sortStreamsHttpsFirst(streams) {
  return [...streams].sort((a, b) => {
    const aHttps = /^https:\/\//i.test(a.url) ? 0 : 1;
    const bHttps = /^https:\/\//i.test(b.url) ? 0 : 1;
    return aHttps - bHttps;
  });
}

async function loadPrinceTV() {
  const loader = document.getElementById('princeLoader');
  const statusText = document.getElementById('princeStatusText');
  const modeBadge = document.getElementById('princeModeBadge');
  if (loader) loader.classList.remove('hidden');

  princeMap.clear();
  princeAllList = [];

  // Always prepend curated custom channels
  for (const c of CURATED_CUSTOM_CHANNELS) {
    const normalized = { ...c, streams: sortStreamsHttpsFirst(c.streams) };
    princeMap.set(normalized.id, normalized);
  }

  try {
    if (settings.princeApiUrl) {
      if (modeBadge) {
        modeBadge.textContent = 'Prince API Proxy';
        modeBadge.className = 'px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-medium text-emerald-400';
      }
      await loadPrinceFromCustomApi();
    } else {
      if (modeBadge) {
        modeBadge.textContent = 'Direct Upstream';
        modeBadge.className = 'px-2.5 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-[11px] font-medium text-brand-400';
      }
      await loadPrinceFromDirectWorker();
    }
  } catch (err) {
    console.error('Prince TV load error:', err);
    showToast('Upstream fetch failed — showing curated channels', 'warning');
  } finally {
    princeAllList = Array.from(princeMap.values());
    const countBadge = document.getElementById('badgePrinceCount');
    if (countBadge) countBadge.textContent = princeAllList.length;
    populatePrinceSelects();
    if (loader) loader.classList.add('hidden');
    applyPrinceFilters();
  }
}

async function loadPrinceFromDirectWorker() {
  // Fetch channels.json, streams.json, countries.json in parallel
  const [chRes, stRes, coRes] = await Promise.all([
    fetch(`${WORKER_BASE}/channels.json`),
    fetch(`${WORKER_BASE}/streams.json`),
    fetch(`${WORKER_BASE}/countries.json`).catch(() => null)
  ]);

  if (!chRes.ok || !stRes.ok) throw new Error('Worker fetch failed');

  const [channels, streams, countries] = await Promise.all([
    chRes.json(),
    stRes.json(),
    coRes && coRes.ok ? coRes.json() : []
  ]);

  countryNamesMap.clear();
  if (Array.isArray(countries)) {
    for (const co of countries) {
      if (co.code && co.name) countryNamesMap.set(co.code.toUpperCase(), co.name);
    }
  }

  // Group streams by channel ID
  const streamsByChannel = new Map();
  for (const s of streams) {
    if (!s.channel || !s.url) continue;
    if (!streamsByChannel.has(s.channel)) streamsByChannel.set(s.channel, []);
    streamsByChannel.get(s.channel).push({
      url: s.url,
      title: s.quality || (s.url.startsWith('https://') ? 'HTTPS' : 'HTTP')
    });
  }

  // Join streams onto channels
  for (const ch of channels) {
    const chStreams = streamsByChannel.get(ch.id);
    if (!chStreams || !chStreams.length) continue;
    if (princeMap.has(ch.id)) continue;

    const code = (ch.country || '').toUpperCase();
    princeMap.set(ch.id, {
      id: ch.id,
      name: ch.name || ch.id,
      country: code,
      countryName: countryNamesMap.get(code) || code || 'International',
      categories: Array.isArray(ch.categories) && ch.categories.length ? ch.categories : ['general'],
      logo: ch.logo || '',
      custom: false,
      featured: false,
      streams: sortStreamsHttpsFirst(chStreams)
    });
  }
}

async function loadPrinceFromCustomApi() {
  const headers = settings.princeApiKey ? { 'x-api-key': settings.princeApiKey } : {};
  const base = settings.princeApiUrl;
  const firstRes = await fetch(`${base}/api/v1/channels?limit=100&page=1&include=streams`, { headers });
  if (!firstRes.ok) throw new Error(`API ${firstRes.status}`);
  const firstData = await firstRes.json();

  const ingest = (items) => {
    for (const ch of items || []) {
      if (!ch.streams || !ch.streams.length) continue;
      const mappedStreams = ch.streams.map((s, idx) => ({
        url: s.url,
        proxyUrl: `${base}/api/v1/stream/${encodeURIComponent(ch.id)}?i=${s.index ?? idx}${settings.princeApiKey ? `&key=${encodeURIComponent(settings.princeApiKey)}` : ''}`,
        title: s.quality || `Stream ${idx + 1}`
      }));
      princeMap.set(ch.id, {
        id: ch.id,
        name: ch.name || ch.id,
        country: (ch.country || '').toUpperCase(),
        countryName: ch.country || 'International',
        categories: Array.isArray(ch.categories) && ch.categories.length ? ch.categories : ['general'],
        logo: ch.logo || '',
        custom: Boolean(ch.custom),
        featured: Boolean(ch.featured),
        streams: sortStreamsHttpsFirst(mappedStreams)
      });
    }
  };

  ingest(firstData.items);

  // Fetch up to 10 pages in background batches so UI renders immediately
  const totalPages = Math.min(firstData.pages || 1, 15);
  for (let p = 2; p <= totalPages; p += 3) {
    const batch = [];
    for (let k = p; k < p + 3 && k <= totalPages; k++) {
      batch.push(
        fetch(`${base}/api/v1/channels?limit=100&page=${k}&include=streams`, { headers })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d && ingest(d.items))
          .catch(() => {})
      );
    }
    await Promise.all(batch);
  }
}

function populatePrinceSelects() {
  const countries = new Map();
  const categories = new Set();

  for (const ch of princeAllList) {
    if (ch.country) countries.set(ch.country, ch.countryName || ch.country);
    for (const cat of ch.categories || []) categories.add(cat.toLowerCase());
  }

  const sortedCountries = [...countries.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const sortedCategories = [...categories].sort();

  for (const id of ['selectCountry', 'selectCountryMobile']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.innerHTML = '<option value="">All Countries</option>';
    for (const [code, name] of sortedCountries) el.add(new Option(name, code));
  }

  for (const id of ['selectCategory', 'selectCategoryMobile']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.innerHTML = '<option value="">All Categories</option>';
    for (const cat of sortedCategories) {
      el.add(new Option(cat.charAt(0).toUpperCase() + cat.slice(1), cat));
    }
  }
}

function applyPrinceFilters() {
  const countryEl = document.getElementById('selectCountry');
  const categoryEl = document.getElementById('selectCategory');
  const sortEl = document.getElementById('selectSort');
  if (!countryEl || !categoryEl || !sortEl) return;

  const country = countryEl.value;
  const category = categoryEl.value;
  const sort = sortEl.value;
  const q = (searchQuery || '').toLowerCase();

  const filterDot = document.getElementById('mobileFilterDot');
  if (filterDot) {
    filterDot.classList.toggle('hidden', !country && !category && sort === 'default');
  }

  let list = princeAllList.filter((ch) => {
    if (country && ch.country !== country) return false;
    if (category && !(ch.categories || []).some((c) => c.toLowerCase() === category)) return false;

    if (princeChip === 'https' && !ch.streams.some((s) => /^https:\/\//i.test(s.proxyUrl || s.url))) return false;
    if (princeChip === 'custom' && !ch.custom) return false;
    if (princeChip === 'featured' && !ch.featured) return false;
    if (princeChip === 'favorites' && !favorites.has(ch.id)) return false;
    if (princeChip === 'recent' && !recents.includes(ch.id)) return false;

    if (q) {
      const hay = `${ch.name} ${ch.countryName || ''} ${(ch.categories || []).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (princeChip === 'recent') {
    list.sort((a, b) => recents.indexOf(a.id) - recents.indexOf(b.id));
  } else if (sort === 'name_asc') {
    list.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === 'name_desc') {
    list.sort((a, b) => b.name.localeCompare(a.name));
  } else if (sort === 'country') {
    list.sort((a, b) => (a.countryName || '').localeCompare(b.countryName || '') || a.name.localeCompare(b.name));
  }

  princeFiltered = list;
  princeRenderedCount = 0;

  const statusText = document.getElementById('princeStatusText');
  if (statusText) {
    statusText.textContent = `Showing ${list.length.toLocaleString()} of ${princeAllList.length.toLocaleString()} channels`;
  }

  const grid = document.getElementById('gridPrince');
  if (grid) grid.innerHTML = '';

  const emptyBox = document.getElementById('princeEmpty');
  if (emptyBox) emptyBox.classList.toggle('hidden', list.length > 0);

  if (list.length > 0) renderPrinceChunk(60);
}

function renderPrinceChunk(size) {
  const grid = document.getElementById('gridPrince');
  if (!grid) return;
  const slice = princeFiltered.slice(princeRenderedCount, princeRenderedCount + size);
  if (!slice.length) return;

  const frag = document.createDocumentFragment();
  for (const ch of slice) {
    const isFav = favorites.has(ch.id);
    const hasHttps = ch.streams.some((s) => /^https:\/\//i.test(s.proxyUrl || s.url));
    const card = document.createElement('div');
    card.setAttribute('data-channel-id', ch.id);
    card.className = 'group bg-[#111827] hover:bg-slate-800/90 border border-slate-800/80 hover:border-brand-500/50 rounded-xl p-3 flex flex-col justify-between gap-2.5 cursor-pointer transition active:scale-[0.98] relative overflow-hidden';

    card.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <div class="w-9 h-9 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center overflow-hidden shrink-0">
          ${ch.logo
            ? `<img src="${escapeAttr(ch.logo)}" alt="" loading="lazy" class="w-full h-full object-contain p-1" onerror="this.style.display='none';this.nextElementSibling.style.display='block';"><i class="fa-solid fa-tv text-brand-400 text-xs hidden"></i>`
            : `<i class="fa-solid fa-tv text-brand-400 text-xs"></i>`}
        </div>
        <button type="button" data-fav-id="${escapeAttr(ch.id)}" class="p-1.5 -m-1 text-slate-500 hover:text-amber-400 transition" title="Favorite">
          <i class="${isFav ? 'fa-solid text-amber-400' : 'fa-regular'} fa-star text-xs"></i>
        </button>
      </div>
      <div class="space-y-1 min-w-0">
        <h3 class="text-xs font-bold text-slate-100 group-hover:text-brand-400 truncate">${escapeHtml(ch.name)}</h3>
        <div class="flex items-center justify-between gap-1 text-[10px] text-slate-400">
          <span class="truncate">${escapeHtml(ch.countryName || ch.country || 'Global')}</span>
          <span class="px-1.5 py-0.5 rounded font-mono text-[9px] shrink-0 ${hasHttps ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}">
            ${hasHttps ? 'HTTPS' : 'HTTP'}
          </span>
        </div>
      </div>
    `;
    frag.appendChild(card);
  }

  grid.appendChild(frag);
  princeRenderedCount += slice.length;
}

function setupInfiniteScroll() {
  const sentinel = document.getElementById('scrollSentinel');
  if (!sentinel) return;

  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && activeTab === 'prince' && princeRenderedCount < princeFiltered.length) {
      const spinner = document.getElementById('sentinelSpinner');
      if (spinner) spinner.classList.remove('hidden');
      requestAnimationFrame(() => {
        renderPrinceChunk(40);
        if (spinner) spinner.classList.add('hidden');
      });
    }
  }, { rootMargin: '250px' });
  observer.observe(sentinel);
}

// ==================== FAVORITES & RECENTS ====================
function toggleFavorite(id) {
  if (favorites.has(id)) {
    favorites.delete(id);
    showToast('Removed from favorites', 'info');
  } else {
    favorites.add(id);
    showToast('Added to favorites', 'success');
  }
  localStorage.setItem('ptv_favorites', JSON.stringify([...favorites]));
  renderChipsBar();
  if (activeTab === 'prince') applyPrinceFilters();
  if (activePlayerContext && activePlayerContext.id === id) updateModalFavIcon();
}

function toggleCurrentFavorite() {
  if (activePlayerContext && activePlayerContext.type === 'prince') {
    toggleFavorite(activePlayerContext.id);
  }
}

function updateModalFavIcon() {
  const isFav = activePlayerContext && favorites.has(activePlayerContext.id);
  const btn = document.getElementById('btnModalFav');
  if (btn) {
    btn.innerHTML = `<i class="${isFav ? 'fa-solid text-amber-400' : 'fa-regular'} fa-star text-xs"></i>`;
  }
}

function addRecent(id) {
  recents = [id, ...recents.filter((x) => x !== id)].slice(0, 40);
  localStorage.setItem('ptv_recents', JSON.stringify(recents));
}

function resetPrinceFilters() {
  clearSearch();
  princeChip = 'all';
  const sc = document.getElementById('selectCountry');
  const scat = document.getElementById('selectCategory');
  const ss = document.getElementById('selectSort');
  const scm = document.getElementById('selectCountryMobile');
  const scat_m = document.getElementById('selectCategoryMobile');
  const ssm = document.getElementById('selectSortMobile');

  if (sc) sc.value = '';
  if (scat) scat.value = '';
  if (ss) ss.value = 'default';
  if (scm) scm.value = '';
  if (scat_m) scat_m.value = '';
  if (ssm) ssm.value = 'default';

  renderChipsBar();
  applyPrinceFilters();
}

function syncMobileFilter(type, val) {
  if (type === 'country') {
    const el = document.getElementById('selectCountry');
    if (el) el.value = val;
  }
  if (type === 'category') {
    const el = document.getElementById('selectCategory');
    if (el) el.value = val;
  }
  if (type === 'sort') {
    const el = document.getElementById('selectSort');
    if (el) el.value = val;
  }
  applyPrinceFilters();
}
