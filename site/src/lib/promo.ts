/**
 * The announcement bar's memory. Kept out of the "use client" component because
 * the layout inlines the bootstrap string on the server, and a value exported
 * from a client module reaches the server only as a client reference.
 */

export const PROMO_KEY = "njc.promo";
/** A dismissed bar stays away this long, then may come back once. */
export const PROMO_QUIET_DAYS = 21;

/**
 * Runs in <head>: hides the bar before first paint for a browser that closed it
 * recently, so it never flashes in and never shifts the page. A Premium browser
 * is hidden by html[data-premium] (lib/premium-flag.ts).
 */
export const promoBootstrap = `(function(){try{var d=+localStorage.getItem('${PROMO_KEY}')||0;if(Date.now()-d<${PROMO_QUIET_DAYS}*864e5)document.documentElement.setAttribute('data-promo-off','1')}catch(e){}})()`;
