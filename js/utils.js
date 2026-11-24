// ==========================================================================
// Utility Functions
// ==========================================================================

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

function escapeAttr(s) {
  return escapeHtml(s);
}

function decodeEntities(s = '') {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugOf(href = '') {
  const raw = href.split('/').pop().split('?')[0];
  let s = raw;
  try { s = decodeURIComponent(raw); } catch {}
  return s.replace(/\.html$/i, '').trim();
}

function kickoffIso(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time || '');
  if (!m) return null;
  const now = Date.now();
  const d = new Date();
  const day = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  let ts = Date.parse(`${day}T${m[1].padStart(2, '0')}:${m[2]}:00+01:00`);
  if (!Number.isFinite(ts)) return null;
  if (ts < now - 4 * 3600_000) ts += 24 * 3600_000;
  return new Date(ts).toISOString();
}

function formatKickoff(iso, rawTime) {
  if (!iso) return { label: rawTime || 'Scheduled', isLive: false };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { label: rawTime || 'Scheduled', isLive: false };
  const diffHrs = (d.getTime() - Date.now()) / 3600_000;
  const isLive = diffHrs <= 0.15 && diffHrs >= -2.5;
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return { label: timeStr, isLive };
}

function copyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch {}
  document.body.removeChild(ta);
}

function showToast(msg, type = 'info') {
  const colors = {
    success: 'bg-emerald-950/95 border-emerald-500/40 text-emerald-200',
    error: 'bg-red-950/95 border-red-500/40 text-red-200',
    warning: 'bg-amber-950/95 border-amber-500/40 text-amber-200',
    info: 'bg-slate-900/95 border-slate-700 text-slate-200'
  };
  const el = document.createElement('div');
  el.className = `px-3.5 py-2.5 rounded-xl border text-xs font-medium shadow-xl pointer-events-auto transition-all duration-200 ${colors[type] || colors.info}`;
  el.textContent = msg;
  const box = document.getElementById('toastContainer');
  if (box) {
    box.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 220);
    }, 3200);
  }
}
