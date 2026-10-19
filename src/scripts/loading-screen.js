import { VIEWER_SETTINGS } from './viewer-settings.js';

// The public viewer, standalone export and local preview use this controller.
export function createLoadingScreen(screen, { onDismiss = () => {}, onStateChange = (_state) => {} } = {}) {
  const settings = VIEWER_SETTINGS.loading;
  const startedAt = performance.now();
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const timers = new Set();
  let ready = false;
  let disposed = false;
  let phase = 'loading';
  let frame = 0;

  function state(value) {
    phase = value;
    if (screen) screen.dataset.state = value;
    onStateChange(value);
  }
  function later(callback, delay) {
    const timer = setTimeout(() => { timers.delete(timer); if (!disposed) callback(); }, delay);
    timers.add(timer);
  }
  function dispose() {
    disposed = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    cancelAnimationFrame(frame);
    screen?.removeEventListener('animationend', blinkEnded);
  }
  function remove() {
    screen?.remove();
    state('done');
    dispose();
  }
  function blinkEnded(event) {
    if (event.target === screen && event.animationName === 'loading-blink-surface') remove();
  }
  function dismiss() {
    if (disposed || phase === 'blinking') return;
    onDismiss();
    if (!screen) { remove(); return; }
    state('blinking');
    screen.classList.add('is-leaving');
    screen.addEventListener('animationend', blinkEnded);
    // Follow the configured CSS duration, including values expressed in seconds.
    const duration = getComputedStyle(screen).animationDuration;
    later(remove, parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000) + settings.removalPaddingMs);
  }
  function finish() {
    if (disposed || ready) return;
    ready = true;
    if (!screen) { dismiss(); return; }
    screen.dataset.ready = 'true';
    const eyes = screen.querySelector('.loader');
    if (!eyes) { dismiss(); return; }
    // Cached loads need no ceremonial blink or extra second of waiting.
    if (performance.now() - startedAt < settings.cachedThresholdMs) {
      dismiss();
      return;
    }
    state('closing');
    const eye = eyes.querySelector('.loader__eye');
    const transform = getComputedStyle(eye, '::after').transform;
    const closed = Math.min(1, Math.max(0, transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42 / 16));
    const motionScale = motion.matches ? settings.reducedCycleMs / settings.cycleMs : 1;
    const duration = Math.max(settings.minimumFinishMs, (1 - closed) * settings.closeMs * motionScale * settings.finishScale + settings.finishOffsetMs);
    eyes.style.setProperty('--lid-duration', '0ms');
    eyes.style.setProperty('--lid-transform', transform);
    eyes.style.setProperty('--lid-clip', getComputedStyle(eye, '::before').clipPath);
    eyes.classList.remove('loader--auto');
    getComputedStyle(eye, '::after').transform;
    frame = requestAnimationFrame(() => {
      eyes.style.setProperty('--lid-duration', `${duration}ms`);
      eyes.style.setProperty('--lid-transform', 'translateY(16px)');
      eyes.style.setProperty('--lid-clip', 'inset(19px 0 0)');
      later(dismiss, duration + settings.finishPauseMs);
    });
  }
  state('loading');
  return { finish, dismiss, dispose };
}
