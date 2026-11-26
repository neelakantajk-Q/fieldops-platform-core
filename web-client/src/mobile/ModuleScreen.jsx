import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon.jsx';
import { go, isSoonError, dayLabel } from './util.js';
import { filterRows } from './tree.js';
import { RecordDetail } from './RecordDetail.jsx';
import { JobDetail } from '../components/JobDetail.jsx';

export function ComingSoon({ title = 'Coming online soon', message }) {
  return (
    <div className="m-soon-card">
      <span className="m-soon-ico"><Icon name="clock" size={22} /></span>
      <h3>{title}</h3>
      <p>{message || 'This module is built and will switch on after the next backend release. Job cards, attendance, vehicles, team and reports are live now.'}</p>
      <button type="button" className="m-btn ghost" onClick={() => go('home')}>
        <Icon name="home" size={16} /> Back to home
      </button>
    </div>
  );
}

export function ModuleScreen({ module, route, session }) {
  const child = route.child || (module.children && module.children[0] ? module.children[0].id : 'all');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(!module.soon);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (module.soon) { setRows([]); setLoading(false); setError(null); return undefined; }
    let live = true;
    setLoading(true);
    setError(null);
    Promise.resolve()
      .then(() => module.load({ child, session }))
      .then((data) => { if (live) { setRows(Array.isArray(data) ? data : []); setLoading(false); } })
      .catch((err) => { if (live) { setError(err); setLoading(false); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module.id, child, nonce]);

  const cards = useMemo(() => {
    const filtered = filterRows(module, child, rows);
    const q = search.trim().toLowerCase();
    const mapped = filtered.map((row) => ({ row, card: module.card(row) }));
    if (!q) return mapped;
    return mapped.filter(({ card }) => `${card.title} ${card.subtitle} ${(card.meta || []).join(' ')}`.toLowerCase().includes(q));
  }, [module, child, rows, search]);

  const detail = route.record
    ? cards.find(({ card }) => String(card.id) === String(route.record)) || null
    : null;

  const soon = module.soon || (error && isSoonError(error));

  function closeDetail() {
    try { window.history.back(); } catch (_) { go(module.id, child); }
  }

  return (
    <div className="m-page">
      <header className="m-page-head">
        <button type="button" className="m-icon-btn" onClick={() => go('home')} aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <div className="m-page-title">
          <h1>{module.label}</h1>
          <span>{module.soon ? 'Backend release pending' : loading ? 'Loading…' : `${cards.length} records`}</span>
        </div>
        {!module.soon ? (
          <button type="button" className="m-icon-btn" onClick={() => setNonce((n) => n + 1)} aria-label="Refresh">
            <Icon name="refresh" size={18} />
          </button>
        ) : null}
      </header>

      {!module.screen && module.children && module.children.length > 1 ? (
        <div className="m-chips">
          {module.children.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`m-chip-btn ${child === c.id ? 'active' : ''}`}
              onClick={() => go(module.id, c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}

      {!module.soon ? (
        <label className="m-search compact">
          <Icon name="search" size={17} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${module.label.toLowerCase()}`} />
          {search ? <button type="button" className="m-search-clear" onClick={() => setSearch('')} aria-label="Clear">×</button> : null}
        </label>
      ) : null}

      <div className="m-scroll list">
        {soon ? (
          <ComingSoon
            title={`${module.label} is not live yet`}
            message="The screens and drill-downs are ready. Connect the latest backend migration and hook release to turn this module on."
          />
        ) : loading ? (
          <div className="m-cards">
            {[0, 1, 2, 3].map((i) => <div key={i} className="m-skel m-row-card" />)}
          </div>
        ) : error ? (
          <div className="m-error">
            <Icon name="alert" size={20} />
            <div>
              <strong>Could not load {module.label.toLowerCase()}</strong>
              <p>{error.message || 'Request failed.'}</p>
            </div>
            <button type="button" className="m-btn ghost" onClick={() => setNonce((n) => n + 1)}>Retry</button>
          </div>
        ) : cards.length ? (
          <div className="m-cards">
            {cards.map(({ card, row }, i) => (
              <button
                key={`${card.id}-${i}`}
                type="button"
                className="m-row-card"
                onClick={() => go(module.id, child, card.id)}
              >
                <span className="m-row-main">
                  <span className="m-row-title">{card.title}</span>
                  <span className="m-row-sub">{card.subtitle || dayLabel(row.created) || '—'}</span>
                  <span className="m-row-meta">
                    {card.badge ? <span className={`m-chip ${card.badge.tone || ''}`}>{card.badge.label}</span> : null}
                    {(card.meta || []).filter(Boolean).slice(0, 2).map((m, j) => <span key={j} className="m-chip plain">{m}</span>)}
                  </span>
                </span>
                <span className="m-row-end">
                  <Icon name="chevron" size={18} />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="m-empty">No records in this section{search ? ` for “${search}”` : ''}.</div>
        )}
      </div>

      {detail ? (
        <RecordDetail
          module={module}
          card={detail.card}
          onClose={closeDetail}
          onOpenFull={() => go('view', module.id)}
        />
      ) : null}
    </div>
  );
}
