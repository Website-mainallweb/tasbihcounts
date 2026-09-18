/**
 * The last Premium status this browser saw, cached so ads stay off for a buyer
 * even while Supabase is unreachable (ARCHITECTURE M9).
 *
 * It hides ads and authorises nothing else. Sync, restore and anything that
 * costs money check the database on the server every time (SECURITY §3). A
 * visitor who sets this by hand has done what an ad blocker already does.
 *
 * The inline script in app/layout.tsx reads the same key before AdSense loads;
 * keep the two in step.
 */

export const PREMIUM_FLAG_KEY = "njc.premium";
/** Set once per browser session after the header has asked the server (B01). */
export const PREMIUM_CHECKED_KEY = "njc.premium-checked";
const EVENT = "njc:premium";

export function readPremiumFlag(): boolean {
  try {
    const raw = localStorage.getItem(PREMIUM_FLAG_KEY);
    return raw ? JSON.parse(raw)?.active === true : false;
  } catch {
    return false;
  }
}

export function writePremiumFlag(active: boolean): void {
  try {
    if (active) localStorage.setItem(PREMIUM_FLAG_KEY, JSON.stringify({ active: true, at: Date.now() }));
    else localStorage.removeItem(PREMIUM_FLAG_KEY);
    if (active) document.documentElement.dataset.premium = "1";
    else delete document.documentElement.dataset.premium;
  } catch {
    // Storage refused (private mode, blocked site data). Ads simply stay on.
  }
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {}
}

/** For useSyncExternalStore: this tab's writes and other tabs' alike. */
export function subscribePremiumFlag(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Runs in <head> before the AdSense loader: pauses every ad request, auto ads
 * included, and marks the page so ad slots fold away. pauseAdRequests is
 * AdSense's own switch for exactly this.
 */
export const premiumBootstrap = `(function(){try{var p=JSON.parse(localStorage.getItem('${PREMIUM_FLAG_KEY}')||'null');if(p&&p.active===true){(window.adsbygoogle=window.adsbygoogle||[]).pauseAdRequests=1;document.documentElement.setAttribute('data-premium','1')}}catch(e){}})()`;

/**
 * The ads kill switch, in <head> (docs/ADMIN.md §3.8).
 *
 * `pauseAdRequests` is AdSense's own switch, and it is the only thing that stops
 * Auto Ads — which do not go through AdSlot at all and were still injecting a
 * unit into a page whose ads were supposedly off. The layout also omits the
 * loader entirely when the switch is off; this covers the page that was cached
 * while ads were still on.
 */
export const adsOffBootstrap = `(function(){try{(window.adsbygoogle=window.adsbygoogle||[]).pauseAdRequests=1;document.documentElement.setAttribute('data-ads','off')}catch(e){}})()`;
