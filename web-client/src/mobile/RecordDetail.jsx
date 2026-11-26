import { Icon } from './Icon.jsx';

export function RecordDetail({ module, card, onClose, onOpenFull, children }) {
  if (!card) return null;
  return (
    <div className="m-sheet-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="m-sheet" role="dialog" aria-modal="true" aria-label={card.title}>
        <span className="m-sheet-grip" />
        <div className="m-sheet-head">
          <div>
            <h2>{card.title}</h2>
            <p>{card.subtitle}</p>
          </div>
          <button type="button" className="m-icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="back" size={18} />
          </button>
        </div>
        <div className="m-sheet-tags">
          {card.badge ? <span className={`m-chip ${card.badge.tone || ''}`}>{card.badge.label}</span> : null}
          {(card.meta || []).filter(Boolean).map((m, i) => <span key={i} className="m-chip plain">{m}</span>)}
        </div>
        {children ? children : (
          <div className="m-facts">
            {(card.facts || []).map((f, i) => (
              <div className="m-fact" key={i}>
                <span>{f.label}</span>
                <strong>{f.value == null || f.value === '' ? '—' : String(f.value)}</strong>
              </div>
            ))}
          </div>
        )}
        {module && module.soon ? (
          <p className="m-note">This module goes live after the next backend release. The record preview is read from the current build.</p>
        ) : null}
        <div className="m-sheet-actions">
          {module && !module.soon ? (
            <button type="button" className="m-btn primary" onClick={onOpenFull}>
              <Icon name="grid" size={16} /> Open full module
            </button>
          ) : null}
          <button type="button" className="m-btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
