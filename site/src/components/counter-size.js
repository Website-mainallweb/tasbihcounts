/**
 * How big the ring should be, from the room actually left around it.
 *
 * Used twice: by the engine on every resize, and as a script inside the server
 * HTML that runs before the first paint. The ring used to be painted at a CSS
 * guess and resized once the engine booted after hydration, which moved the
 * controls and everything under them (CLS 0.26 on a desktop, 0.11 on a phone).
 *
 * It must stay self-contained: the pre-paint copy is this function's own source
 * text, so nothing outside its body is reachable from it.
 *
 * Returns the size in px, or null when the column cannot be measured yet.
 */
export function stageSize(R) {
  var stage = R.querySelector('#njcStage');
  var col = R.querySelector('.njc-col');
  var surface = R.querySelector('#njcSurface');
  // Mid-resize the grid can report a zero-width column for one frame. Sizing
  // the ring from that leaves a 0px ring and no way back.
  if (!stage || !col || !surface || col.clientWidth < 40) return null;

  var cap = parseFloat(getComputedStyle(R).getPropertyValue('--stage-cap')) || 320;

  function outerH(el) {
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') return 0;
    return el.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
  }

  /* The height of everything in the column except the ring: stats, the name bar,
     the name and hint under the ring, the controls, the modes, any notice. Summed
     from the children rather than read off the column, because in full screen the
     column stretches and its own height would count empty space as controls.
     Side by side (a phone on its side, which CSS decides with display:grid), the
     controls stand beside the ring, so only the ring's own surface counts. */
  var side = getComputedStyle(col).display === 'grid';
  var chrome = 0, modesH = 0;
  for (var i = 0; i < col.children.length; i++) {
    var child = col.children[i];
    if (side && child !== surface) continue;
    if (child === surface) {
      var cs = getComputedStyle(child);
      chrome += (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
        + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0)
        + (parseFloat(cs.rowGap) || 0) * 2;
      for (var j = 0; j < child.children.length; j++) {
        if (child.children[j] !== stage) chrome += outerH(child.children[j]);
      }
    } else {
      var h = outerH(child);
      chrome += h;
      if (child.classList.contains('njc-modes')) modesH = h;
    }
  }

  var immersive = R.classList.contains('immersive');
  var across = side ? surface.clientWidth : col.clientWidth;
  var colTop = immersive
    ? col.getBoundingClientRect().top - R.getBoundingClientRect().top + (R.scrollTop || 0)
    : col.getBoundingClientRect().top + window.scrollY;
  var size;

  if (immersive || side || window.innerWidth >= 768) {
    var room = window.innerHeight - colTop - chrome - 20;
    var ceiling = immersive ? Math.max(cap, 660) : cap;
    size = Math.min(across * 0.88, ceiling, Math.max(room, side ? 150 : immersive ? 180 : 220));
  } else {
    /* A phone. The ring used to take a flat 52% of the window, ignoring the title,
       stats and name bar above it, so on a 375x667 phone the controls fell below
       the fold. Now it gets what is left: everything on one screen whenever a
       ring of 150px fits; on a very short phone the control row still stays on
       screen and only the mode chips follow below. */
    var left = window.innerHeight - colTop - chrome - 12;
    var fit = left >= 150 ? left : Math.max(Math.min(left + modesH, 200), 140);
    size = Math.min(across * 0.88, cap, fit);
  }
  return Math.round(Math.max(size, 120));
}
