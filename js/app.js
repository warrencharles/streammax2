// ==========================================================================
// Main Application Controller & Event Wiring
// ==========================================================================

let activeTab = 'prince'; // 'prince' | 'fawa'
let searchQuery = '';
let clearDataConfirmPending = false;

// ==================== BOOTSTRAP ====================
document.addEventListener('DOMContentLoaded', () => {
  syncSettingsInputs();
  setupDelegatedClicks();
  setupInfiniteScroll();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePlayerModal();
      closeSettingsModal();
    }
  });

  const video = document.getElementById('videoEl');
  if (video) {
    video.addEventListener('volumechange', () => {
      const btn = document.getElementById('btnUnmute');
      if (btn && !video.muted && video.volume > 0) {
        btn.classList.add('hidden');
      }
    });
  }

  renderChipsBar();
  loadPrinceTV();
});

function syncSettingsInputs() {
  const pUrl = document.getElementById('inputPrinceApiUrl');
  const pKey = document.getElementById('inputPrinceApiKey');
  const fUrl = document.getElementById('inputFawaApiUrl');
  const fKey = document.getElementById('inputFawaApiKey');

  if (pUrl) pUrl.value = settings.princeApiUrl;
  if (pKey) pKey.value = settings.princeApiKey;
  if (fUrl) fUrl.value = settings.fawaApiUrl;
  if (fKey) fKey.value = settings.fawaApiKey;
}

// ==================== DELEGATED GRID CLICKS ====================
function setupDelegatedClicks() {
  const gridPrince = document.getElementById('gridPrince');
  if (gridPrince) {
    gridPrince.addEventListener('click', (e) => {
      const favBtn = e.target.closest('[data-fav-id]');
      if (favBtn) {
        e.stopPropagation();
        toggleFavorite(favBtn.getAttribute('data-fav-id'));
        return;
      }
      const card = e.target.closest('[data-channel-id]');
      if (card) {
        const ch = princeMap.get(card.getAttribute('data-channel-id'));
        if (ch) openPrincePlayer(ch);
      }
    });
  }

  const gridFawa = document.getElementById('gridFawaMatches');
  if (gridFawa) {
    gridFawa.addEventListener('click', (e) => {
      const card = e.target.closest('[data-match-slug]');
      if (card) {
        const match = fawaMap.get(card.getAttribute('data-match-slug'));
        if (match) openFawaPlayer(match);
      }
    });
  }
}

// ==================== TAB SWITCHING ====================
function switchTab(tab) {
  activeTab = tab;
  const isPrince = tab === 'prince';

  const tabPrince = document.getElementById('tabBtnPrince');
  const tabFawa = document.getElementById('tabBtnFawa');
  if (tabPrince) {
    tabPrince.className = isPrince
      ? 'px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center gap-1.5 bg-brand-500 text-white shadow'
      : 'px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center gap-1.5 text-slate-400 hover:text-white';
  }
  if (tabFawa) {
    tabFawa.className = !isPrince
      ? 'px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center gap-1.5 bg-fawa-600 text-white shadow'
      : 'px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center gap-1.5 text-slate-400 hover:text-white';
  }

  const secPrince = document.getElementById('sectionPrince');
  const secFawa = document.getElementById('sectionFawa');
  if (secPrince) secPrince.classList.toggle('hidden', !isPrince);
  if (secFawa) secFawa.classList.toggle('hidden', isPrince);

  const desktopFilters = document.getElementById('princeDesktopFilters');
  if (desktopFilters) {
    desktopFilters.classList.toggle('hidden', !isPrince);
    if (isPrince) desktopFilters.classList.add('sm:flex');
    else desktopFilters.classList.remove('sm:flex');
  }

  const fawaSub = document.getElementById('fawaSubTabs');
  if (fawaSub) {
    fawaSub.classList.toggle('hidden', isPrince);
    if (!isPrince) fawaSub.classList.add('flex');
    else fawaSub.classList.remove('flex');
  }

  const btnMobileFilters = document.getElementById('btnMobileFilters');
  if (btnMobileFilters) btnMobileFilters.classList.toggle('hidden', !isPrince);

  const mobileDrawer = document.getElementById('mobileDrawer');
  if (!isPrince && mobileDrawer) mobileDrawer.classList.add('hidden');

  renderChipsBar();

  if (!isPrince && !fawaLoaded) {
    loadFawaSports(false);
  }
}

function refreshActiveTab(force) {
  const icon = document.getElementById('iconRefresh');
  if (icon) icon.classList.add('animate-spin');
  const done = () => {
    if (icon) setTimeout(() => icon.classList.remove('animate-spin'), 400);
  };
  if (activeTab === 'prince') loadPrinceTV().finally(done);
  else loadFawaSports(force).finally(done);
}

// ==================== CHIPS BAR ====================
function renderChipsBar() {
  const bar = document.getElementById('chipsBar');
  if (!bar) return;
  bar.innerHTML = '';

  if (activeTab === 'prince') {
    const chips = [
      { id: 'all', label: 'All', icon: 'fa-tv' },
      { id: 'https', label: 'HTTPS Ready', icon: 'fa-lock' },
      { id: 'custom', label: 'Custom', icon: 'fa-bolt' },
      { id: 'featured', label: 'Featured', icon: 'fa-fire' },
      { id: 'favorites', label: `Favorites (${favorites.size})`, icon: 'fa-star' },
      { id: 'recent', label: 'Recent', icon: 'fa-clock-rotate-left' }
    ];
    for (const c of chips) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const active = princeChip === c.id;
      btn.className = `px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 shrink-0 transition ${
        active ? 'bg-brand-500 text-white shadow' : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
      }`;
      btn.innerHTML = `<i class="fa-solid ${c.icon} text-[10px]"></i><span>${c.label}</span>`;
      btn.onclick = () => {
        princeChip = c.id;
        renderChipsBar();
        applyPrinceFilters();
      };
      bar.appendChild(btn);
    }
  } else {
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = `px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition ${
      !fawaActiveLeague ? 'bg-fawa-600 text-white shadow' : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
    }`;
    allBtn.textContent = `All Leagues (${fawaMatches.length})`;
    allBtn.onclick = () => {
      fawaActiveLeague = '';
      renderChipsBar();
      renderFawaContent();
    };
    bar.appendChild(allBtn);

    for (const l of fawaLeagues) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const active = fawaActiveLeague === l.name;
      btn.className = `px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition ${
        active ? 'bg-fawa-600 text-white shadow' : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
      }`;
      btn.textContent = `${l.name} (${l.count})`;
      btn.onclick = () => {
        fawaActiveLeague = l.name;
        renderChipsBar();
        renderFawaContent();
      };
      bar.appendChild(btn);
    }
  }
}

// ==================== SEARCH, FILTERS & SETTINGS ====================
function onSearchInput(val) {
  searchQuery = val.trim();
  const clearBtn = document.getElementById('btnClearSearch');
  if (clearBtn) clearBtn.classList.toggle('hidden', !searchQuery);

  if (activeTab === 'prince') applyPrinceFilters();
  else renderFawaContent();
}

function clearSearch() {
  const input = document.getElementById('searchInput');
  if (input) input.value = '';
  onSearchInput('');
}

function toggleMobileDrawer() {
  const drawer = document.getElementById('mobileDrawer');
  if (drawer) drawer.classList.toggle('hidden');
}

function openSettingsModal() {
  syncSettingsInputs();
  clearDataConfirmPending = false;
  const btnClear = document.getElementById('btnClearData');
  if (btnClear) btnClear.textContent = 'Clear Data';
  const modal = document.getElementById('settingsModal');
  if (modal) modal.classList.remove('hidden');
}

function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) modal.classList.add('hidden');
}

function saveSettings() {
  const pUrl = document.getElementById('inputPrinceApiUrl');
  const pKey = document.getElementById('inputPrinceApiKey');
  const fUrl = document.getElementById('inputFawaApiUrl');
  const fKey = document.getElementById('inputFawaApiKey');

  settings.princeApiUrl = pUrl ? pUrl.value.trim().replace(/\/+$/, '') : '';
  settings.princeApiKey = pKey ? pKey.value.trim() : '';
  settings.fawaApiUrl = fUrl ? fUrl.value.trim().replace(/\/+$/, '') : '';
  settings.fawaApiKey = fKey ? fKey.value.trim() : '';

  localStorage.setItem('ptv_prince_api_url', settings.princeApiUrl);
  localStorage.setItem('ptv_prince_api_key', settings.princeApiKey);
  localStorage.setItem('ptv_fawa_api_url', settings.fawaApiUrl);
  localStorage.setItem('ptv_fawa_api_key', settings.fawaApiKey);

  closeSettingsModal();
  showToast('Settings saved', 'success');

  fawaLoaded = false;
  loadPrinceTV();
  if (activeTab === 'fawa') loadFawaSports(true);
}

async function testFawaConnection() {
  const fUrl = document.getElementById('inputFawaApiUrl');
  const fKey = document.getElementById('inputFawaApiKey');
  const url = fUrl ? fUrl.value.trim().replace(/\/+$/, '') : '';
  const key = fKey ? fKey.value.trim() : '';

  if (!url) {
    showToast('Enter a FawaNews API URL first', 'warning');
    return;
  }
  try {
    const res = await fetch(`${url}/api/v1/health`, { headers: key ? { 'x-api-key': key } : {} });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    showToast(`Fawa API Connected (uptime ${data.uptimeSec ?? 0}s)`, 'success');
  } catch (err) {
    showToast(`Connection failed: ${err.message}`, 'error');
  }
}

function handleClearData() {
  const btn = document.getElementById('btnClearData');
  if (!clearDataConfirmPending) {
    clearDataConfirmPending = true;
    if (btn) btn.textContent = 'Click Again to Confirm';
    return;
  }
  localStorage.clear();
  favorites.clear();
  recents = [];
  settings.princeApiUrl = '';
  settings.princeApiKey = '';
  settings.fawaApiUrl = '';
  settings.fawaApiKey = '';
  closeSettingsModal();
  showToast('Local data cleared', 'info');
  fawaLoaded = false;
  loadPrinceTV();
  if (activeTab === 'fawa') loadFawaSports(true);
}
