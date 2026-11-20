import { useState } from 'react';
import { Icon } from './Icon.jsx';
import { go } from './util.js';
import { ComingSoon } from './ModuleScreen.jsx';

export function ScreenFrame({ module, session, checkedIn, count, onAuthChange }) {
  const [nonce, setNonce] = useState(0);
  if (!module.screen || module.soon) {
    return (
      <div className="m-page">
        <header className="m-page-head">
          <button type="button" className="m-icon-btn" onClick={() => go('home')} aria-label="Back">
            <Icon name="back" size={20} />
          </button>
          <div className="m-page-title"><h1>{module.label}</h1><span>Module</span></div>
        </header>
        <div className="m-scroll">
          <ComingSoon title={`${module.label} is not live yet`} />
        </div>
      </div>
    );
  }
  const Page = module.screen;
  return (
    <div className="m-page">
      <header className="m-page-head">
        <button type="button" className="m-icon-btn" onClick={() => go('home')} aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <div className="m-page-title"><h1>{module.label}</h1><span>Full workspace</span></div>
        <button type="button" className="m-icon-btn" onClick={() => setNonce((n) => n + 1)} aria-label="Refresh">
          <Icon name="refresh" size={18} />
        </button>
      </header>
      <div className="m-scroll screen">
        <div className="m-screen-body" key={nonce}>
          <Page
            session={session}
            checkedIn={checkedIn}
            count={count}
            onNavigate={(id) => go('view', id)}
            onSession={() => { /* session updates flow through the shell */ }}
            onAuthChange={onAuthChange}
          />
        </div>
      </div>
    </div>
  );
}
