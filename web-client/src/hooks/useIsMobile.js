import { useEffect, useState } from 'react';

const MOBILE_QUERY = '(max-width: 820px)';

function detect() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia && window.matchMedia(MOBILE_QUERY).matches) return true;
  } catch (_) { /* ignore */ }
  return /FieldOpsApp/i.test(String(navigator.userAgent || ''));
}

export function useIsMobile() {
  const [mobile, setMobile] = useState(detect);
  useEffect(() => {
    let mq;
    const update = () => setMobile(detect());
    try {
      mq = window.matchMedia(MOBILE_QUERY);
      if (mq.addEventListener) mq.addEventListener('change', update);
      else if (mq.addListener) mq.addListener(update);
    } catch (_) { /* ignore */ }
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      try {
        if (mq && mq.removeEventListener) mq.removeEventListener('change', update);
        else if (mq && mq.removeListener) mq.removeListener(update);
      } catch (_) { /* ignore */ }
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  return mobile;
}
