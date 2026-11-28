import { Component, useState } from 'react';
import { Icon } from './Icon.jsx';
import { go } from './util.js';
import { ComingSoon } from './ModuleScreen.jsx';

class ScreenErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error('ScreenFrame render error', err, info); }
  render() {
    const { module } = this.props;
    const { err } = this.state;
    if (err) {
      return (
        <div className="m-page">
          <header className="m-page-head">
            <button type="button" className="m-icon-btn" onClick={() => go('home')} aria-label="Back">
              <Icon name="back" size={20} />
            </button>
            <div className="m-page-title">
              <h1>{module?.label || 'Module'}</h1>
              <span>Something went wrong</span>
            </div>
          </header>
          <div className="m-scroll">
            <div className="m-error">
              <div>
                <strong>Module failed to load</strong>
                <p>{String(err && err.message ? err.message : err)}</p>
              </div>
              <button type="button" className="m-btn ghost" onClick={() => go('home')}>Back home</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

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
          <ScreenErrorBoundary module={module}>
            <Page
              session={session}
              checkedIn={checkedIn}
              count={count}
              onNavigate={(id) => go('view', id)}
              onSession={() => { /* session updates flow through the shell */ }}
              onAuthChange={onAuthChange}
            />
          </ScreenErrorBoundary>
        </div>
      </div>
    </div>
  );
}
