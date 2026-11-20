export function parseRoute(hash = (typeof window !== 'undefined' ? window.location.hash : '')) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  if (!/^m(\/|$)/.test(raw)) return { module: 'home', child: '', record: '' };
  const parts = raw.split('/');
  let record = '';
  try { record = decodeURIComponent(parts[3] || ''); } catch (_) { record = parts[3] || ''; }
  return { module: parts[1] || 'home', child: parts[2] || '', record };
}

export function go(module, child = '', record = '') {
  if (typeof window === 'undefined') return;
  const parts = ['m', module || 'home'];
  if (child) parts.push(String(child));
  if (record) parts.push(encodeURIComponent(String(record)));
  window.location.hash = parts.join('/');
}

export function nativeAvailable() {
  return typeof window !== 'undefined' && Boolean(window.FieldOpsNative);
}

export function nativeCall(method, arg) {
  const bridge = typeof window !== 'undefined' ? window.FieldOpsNative : null;
  if (!bridge || typeof bridge[method] !== 'function') return false;
  try {
    if (arg === undefined) bridge[method]();
    else bridge[method](String(arg));
    return true;
  } catch (_) {
    return false;
  }
}

export function initials(name) {
  const parts = String(name || '?').replace(/[._-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function timeAgo(value) {
  if (!value) return '';
  const t = new Date(String(value).replace(' ', 'T')).getTime();
  if (!isFinite(t)) return '';
  const diff = Math.max(0, Date.now() - t);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function humanDuration(ms) {
  const mins = Math.max(0, Math.floor(Number(ms || 0) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function dayLabel(value) {
  if (!value) return '—';
  const d = new Date(String(value).replace(' ', 'T'));
  if (isNaN(d.getTime())) return String(value).slice(0, 16);
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function isSoonError(err) {
  const msg = String((err && (err.message || err)) || '');
  return /\b404\b|not found|unknown action/i.test(msg);
}
