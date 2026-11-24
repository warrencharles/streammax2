// ==========================================================================
// Constants & Configuration
// ==========================================================================

const WORKER_BASE = 'https://hostifytv.tcroneb-script.workers.dev';

// CORS proxy cascade for Fawa Direct Browser Fallback
const CORS_PROXIES = [
  {
    name: 'allorigins',
    fetchHtml: async (targetUrl, signal) => {
      const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || !data.contents) throw new Error('Empty response');
      return data.contents;
    }
  },
  {
    name: 'corsproxy',
    fetchHtml: async (targetUrl, signal) => {
      const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(targetUrl)}`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    }
  },
  {
    name: 'codetabs',
    fetchHtml: async (targetUrl, signal) => {
      const res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    }
  }
];

// Curated custom channels prepended to Prince TV
const CURATED_CUSTOM_CHANNELS = [
  {
    id: 'custom-tv-imaan', name: 'TV Imaan', country: 'TZ', countryName: 'Tanzania',
    categories: ['religious'], custom: true, featured: true,
    streams: [{ url: 'https://live.tvimaan.com/hls/live.m3u8', title: 'HD' }]
  },
  {
    id: 'custom-zbc2', name: 'ZBC 2', country: 'TZ', countryName: 'Tanzania',
    categories: ['entertainment'], custom: true, featured: false,
    streams: [{ url: 'https://zbc2.stream/live.m3u8', title: 'SD' }]
  },
  {
    id: 'custom-bbc-news', name: 'BBC News', country: 'GB', countryName: 'United Kingdom',
    categories: ['news'], custom: true, featured: true,
    streams: [{ url: 'https://vs-hls-push-ww-live.akamaized.net/x=4/i=urn:bbc:pips:service:bbc_news_channel_hd/t=3840/v=pv14/b=5070000/main.m3u8', title: 'HD' }]
  },
  {
    id: 'custom-al-jazeera', name: 'Al Jazeera English', country: 'QA', countryName: 'Qatar',
    categories: ['news'], custom: true, featured: true,
    streams: [{ url: 'https://live-hls-web-aje.getaj.net/AJE/03.m3u8', title: 'HD' }]
  },
  {
    id: 'custom-france24', name: 'France 24 English', country: 'FR', countryName: 'France',
    categories: ['news'], custom: true, featured: false,
    streams: [{ url: 'https://static.france24.com/live/F24_EN_LO_HLS/live_tv.m3u8', title: 'HD' }]
  },
  {
    id: 'custom-dw', name: 'DW English', country: 'DE', countryName: 'Germany',
    categories: ['news'], custom: true, featured: false,
    streams: [{ url: 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8', title: 'HD' }]
  },
  {
    id: 'custom-azam-sports-1', name: 'Azam Sports 1 HD', country: 'TZ', countryName: 'Tanzania',
    categories: ['sports'], custom: true, featured: true,
    streams: [{ url: 'https://azam1.stream/live.m3u8', title: 'HD' }]
  },
  {
    id: 'custom-azam-sports-2', name: 'Azam Sports 2 HD', country: 'TZ', countryName: 'Tanzania',
    categories: ['sports'], custom: true, featured: false,
    streams: [{ url: 'https://azam2.stream/live.m3u8', title: 'HD' }]
  },
  {
    id: 'custom-azam-sports-3', name: 'Azam Sports 3 HD', country: 'TZ', countryName: 'Tanzania',
    categories: ['sports'], custom: true, featured: false,
    streams: [{ url: 'https://azam3.stream/live.m3u8', title: 'HD' }]
  },
  {
    id: 'custom-azam-sports-4', name: 'Azam Sports 4 HD', country: 'TZ', countryName: 'Tanzania',
    categories: ['sports'], custom: true, featured: false,
    streams: [{ url: 'https://azam4.stream/live.m3u8', title: 'HD' }]
  },
  {
    id: 'custom-sinema-zetu', name: 'Sinema Zetu', country: 'TZ', countryName: 'Tanzania',
    categories: ['movies'], custom: true, featured: false,
    streams: [{ url: 'https://sinemazetu.stream/live.m3u8', title: 'HD' }]
  },
  {
    id: 'custom-euronews', name: 'Euronews English', country: 'FR', countryName: 'France',
    categories: ['news'], custom: true, featured: false,
    streams: [{ url: 'https://euronews-euronews-world-1-us.samsung.wurl.tv/manifest/playlist.m3u8', title: 'HD' }]
  }
];

// Persisted settings (NEVER default to localhost)
const settings = {
  princeApiUrl: (localStorage.getItem('ptv_prince_api_url') || '').trim().replace(/\/+$/, ''),
  princeApiKey: (localStorage.getItem('ptv_prince_api_key') || '').trim(),
  fawaApiUrl: (localStorage.getItem('ptv_fawa_api_url') || '').trim().replace(/\/+$/, ''),
  fawaApiKey: (localStorage.getItem('ptv_fawa_api_key') || '').trim()
};

const favorites = new Set(JSON.parse(localStorage.getItem('ptv_favorites') || '[]'));
let recents = JSON.parse(localStorage.getItem('ptv_recents') || '[]');
