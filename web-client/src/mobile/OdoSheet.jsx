import { useState } from 'react';
import { Icon } from './Icon.jsx';

/**
 * Odometer prompt shown before the plate-OCR camera. The numeric keypad is
 * the primary input so the reading can be typed without leaving the app.
 */
export function OdoSheet({ open, onClose, onConfirm }) {
  const [value, setValue] = useState('');

  if (!open) return null;

  const press = (d) => setValue((v) => (v.length >= 8 ? v : v + d));
  const back = () => setValue((v) => v.slice(0, -1));
  const clear = () => setValue('');

  function confirm() {
    if (!value) return;
    onConfirm(value);
    setValue('');
  }

  return (
    <div
      className="m-sheet-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="m-sheet" role="dialog" aria-modal="true" aria-label="Odometer reading">
        <span className="m-sheet-grip" />
        <div className="m-sheet-head">
          <div>
            <h2>Odometer reading</h2>
            <p>Enter the kilometres, then capture the number plate to start the job.</p>
          </div>
          <button type="button" className="m-icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="back" size={18} />
          </button>
        </div>

        <div className="m-odo-display">
          <span>{value || '0'}</span>
          <small>km</small>
        </div>

        <div className="m-keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} type="button" className="m-key" onClick={() => press(d)}>
              {d}
            </button>
          ))}
          <button type="button" className="m-key muted" onClick={clear} aria-label="Clear">
            C
          </button>
          <button type="button" className="m-key" onClick={() => press('0')}>
            0
          </button>
          <button type="button" className="m-key muted" onClick={back} aria-label="Backspace">
            <Icon name="back" size={18} />
          </button>
        </div>

        <button type="button" className="m-btn primary block" onClick={confirm} disabled={!value}>
          <Icon name="scan" size={16} /> Start job · capture plate
        </button>
        <p className="m-hint">The reading is attached to the job card before the plate photo.</p>
      </div>
    </div>
  );
}
