import { VIEWER_SETTINGS } from '../scripts/viewer-settings.js';

// Evaluated by Astro/Vite at build time, never inside the drawing loop.
// Exported HTML receives the same generated stylesheet.
export function createViewerStyles(settings = VIEWER_SETTINGS) {
  const { blink, loading } = settings;
  const percent = value => `${Number((value * 100).toFixed(6))}%`;
  const close = percent(blink.closeAt), swap = percent(blink.swapAt), reopen = percent(blink.reopenAt);
  const lid = direction => `0%{transform:translateY(${direction}100%);animation-timing-function:${blink.closeEasing}}${close},${reopen}{transform:translateY(0);animation-timing-function:${blink.openEasing}}100%{transform:translateY(${direction}100%)}`;
  return `:root{--blink-duration:${blink.durationMs}ms;--blink-reduced-duration:${blink.reducedDurationMs}ms;--loader-cycle-duration:${loading.cycleMs}ms;--loader-cycle-delay:${loading.cycleDelayMs}ms}
@media(prefers-reduced-motion:reduce){:root{--blink-duration:var(--blink-reduced-duration);--loader-cycle-duration:${loading.reducedCycleMs}ms}}
@keyframes loading-blink-upper{${lid('-')}}
@keyframes loading-blink-lower{${lid('')}}
@keyframes loading-blink-surface{0%{background-color:#111110}${swap},100%{background-color:transparent}}
@keyframes loading-blink-content{0%{visibility:visible}${swap},100%{visibility:hidden}}`;
}

export const viewerAnimationCSS = createViewerStyles();
