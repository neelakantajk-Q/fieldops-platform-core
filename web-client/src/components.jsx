import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { VoiceRecorder, useVoiceTranscribe, voiceSupported } from './lib/voice.js';

/* ----------------------------- Toasts ----------------------------- */
const ToastCtx = createContext({ push: () => {} });
export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setItems((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toast-stack">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ----------------------------- Layout ----------------------------- */
export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-head">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p className="muted small">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className = '', pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title ? <h3>{title}</h3> : null}
            {subtitle ? <p className="muted small">{subtitle}</p> : null}
          </div>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </div>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone = '', icon }) {
  return (
    <div className={`stat ${tone}`}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {icon ? <span className="stat-icon" aria-hidden="true">{icon}</span> : null}
      </div>
      <strong className="stat-value">{value}</strong>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  );
}

export function SegTabs({ tabs, active, onChange, ariaLabel }) {
  return (
    <div className="seg-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          className={`seg-tab ${active === t.id ? 'active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Donut({ segments = [], size = 148, stroke = 14, label, sub, ariaLabel }) {
  const total = segments.reduce((sum, s) => sum + (Number(s.value) || 0), 0);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="donut"
        role="img"
        aria-label={ariaLabel || 'Distribution'}
      >
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#eef2f7" strokeWidth={stroke} />
        {total > 0
          ? segments.map((s, i) => {
              const value = Number(s.value) || 0;
              const dash = (value / total) * circumference;
              const circle = (
                <circle
                  key={i}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={s.color || '#a6ce39'}
                  strokeWidth={stroke}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              );
              offset += dash;
              return circle;
            })
          : null}
        <text x="50%" y="48%" textAnchor="middle" className="donut-value">{label ?? total}</text>
        {sub ? <text x="50%" y="62%" textAnchor="middle" className="donut-sub">{sub}</text> : null}
      </svg>
      <ul className="legend">
        {segments.map((s, i) => (
          <li key={i}>
            <span className="legend-dot" style={{ background: s.color || '#a6ce39' }} />
            <span className="legend-name">{s.label}</span>
            <b>{s.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Spinner({ label }) {
  return (
    <div className="spinner-wrap">
      <span className="spinner" />
      {label ? <span className="muted small">{label}</span> : null}
    </div>
  );
}

export function Empty({ children = 'Nothing to show yet.' }) {
  return <div className="empty">{children}</div>;
}

export function Btn({ children, variant = 'primary', size = '', type = 'button', ...rest }) {
  return (
    <button type={type} className={`btn ${variant} ${size}`} {...rest}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      {label ? <span className="field-label">{label}</span> : null}
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Modal({ open, title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Table({ columns, rows, empty = 'No records.', rowKey }) {
  if (!rows || rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey ? rowKey(row, i) : i}>
              {columns.map((c) => (
                <td key={c.key}>{c.render ? c.render(row, i) : row[c.key] ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.id} className={`tab ${active === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count ? <span className="tab-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function formatWhen(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(loader)
      .then((data) => live && setState({ loading: false, data, error: null }))
      .catch((error) => live && setState({ loading: false, data: null, error }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

/* ----------------------------- Voice input ----------------------------- */

export function VoiceButton({ onResult, disabled = false, "aria-label": ariaLabel = "Voice input", title, compact = false }) {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef(null);
  const { transcribe, busy } = useVoiceTranscribe();

  const toggle = async () => {
    if (disabled) return;
    if (!recording) {
      try {
        recorderRef.current = new VoiceRecorder();
        await recorderRef.current.start();
        setRecording(true);
      } catch (err) {
        recorderRef.current = null;
      }
    } else {
      setRecording(false);
      try {
        const audio = await recorderRef.current.stop();
        recorderRef.current = null;
        if (audio && audio.bytes > 0) {
          const res = await transcribe(audio);
          if (res && res.text) onResult(res.text);
        }
      } catch (err) { /* transcription error surfaced by hook */ }
    }
  };

  const label = title || ariaLabel;
  const cls = "voice-btn " + (compact ? "voice-btn--compact" : "") +
    (recording ? " recording" : "") + (busy ? " busy" : "");

  return (
    <button
      type="button"
      className={cls}
      disabled={disabled}
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      <span className="voice-icon">{recording ? "■" : "🎤"}</span>
      {recording ? <span className="voice-status">Listening…</span> : null}
      {busy ? <span className="voice-busy">…</span> : null}
    </button>
  );
}

export function VoiceTextInput({ label, hint, value, onChange, language = "auto", mode = "dictate", insert = "append", disabled, ...props }) {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef(null);
  const { transcribe, busy } = useVoiceTranscribe({ language, mode });

  const applyText = (text) => {
    const next = insert === "replace" ? text : ((value || "") + (value ? " " : "") + text);
    onChange({ target: { value: next } });
  };

  const toggle = async () => {
    if (disabled) return;
    if (!recording) {
      try {
        recorderRef.current = new VoiceRecorder();
        await recorderRef.current.start();
        setRecording(true);
      } catch (err) { recorderRef.current = null; }
    } else {
      setRecording(false);
      try {
        const audio = await recorderRef.current.stop();
        recorderRef.current = null;
        if (audio && audio.bytes > 0) {
          const res = await transcribe(audio);
          if (res && res.text) applyText(res.text);
        }
      } catch (err) {}
    }
  };

  return (
    <Field label={label} hint={hint}>
      <input value={value || ""} onChange={onChange} disabled={disabled} {...props} />
      {!disabled && voiceSupported() ? (
        <VoiceButton onResult={applyText} disabled={recording || busy} compact title={label} />
      ) : null}
    </Field>
  );
}

export function VoiceTextarea({ label, hint, value, onChange, language = "auto", mode = "dictate", insert = "append", disabled, rows = 2, ...props }) {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef(null);
  const { transcribe, busy } = useVoiceTranscribe({ language, mode });

  const applyText = (text) => {
    const next = insert === "replace" ? text : ((value || "") + (value ? "\n" : "") + text);
    onChange({ target: { value: next } });
  };

  const toggle = async () => {
    if (disabled) return;
    if (!recording) {
      try {
        recorderRef.current = new VoiceRecorder();
        await recorderRef.current.start();
        setRecording(true);
      } catch (err) { recorderRef.current = null; }
    } else {
      setRecording(false);
      try {
        const audio = await recorderRef.current.stop();
        recorderRef.current = null;
        if (audio && audio.bytes > 0) {
          const res = await transcribe(audio);
          if (res && res.text) applyText(res.text);
        }
      } catch (err) {}
    }
  };

  return (
    <Field label={label} hint={hint}>
      <textarea value={value || ""} onChange={onChange} rows={rows} disabled={disabled} {...props} />
      {!disabled && voiceSupported() ? (
        <VoiceButton onResult={applyText} disabled={recording || busy} compact title={label} />
      ) : null}
    </Field>
  );
}

export function SmartFillButton({ schema, onFields, language = "auto", disabled }) {
  const [busy, setBusy] = useState(false);
  const recorderRef = useRef(null);
  const { transcribe } = useVoiceTranscribe({ language, mode: "smartfill" });

  const toggle = async () => {
    if (disabled) return;
    setBusy(true);
    try {
      if (!recorderRef.current) recorderRef.current = new VoiceRecorder();
      if (!recorderRef.current._started) {
        await recorderRef.current.start();
        recorderRef.current._started = true;
        return;
      }
      const audio = await recorderRef.current.stop();
      recorderRef.current._started = false;
      recorderRef.current = null;
      if (audio && audio.bytes > 0) {
        const res = await transcribe(audio);
        if (res && res.fields) onFields(res.fields);
      }
    } catch (err) {
      setBusy(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className={`voice-btn voice-btn--smartfill ${busy ? "busy" : ""}`} disabled={disabled} onClick={toggle} aria-label="Speak to fill form" title="Speak to fill form">
      <span className="voice-icon">🗣️</span>
      {busy ? <span className="voice-busy">…</span> : <span className="voice-status">Speak to fill</span>}
    </button>
  );
}

