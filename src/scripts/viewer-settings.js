// Viewer tuning lives here. Times are milliseconds; fractions range from 0 to 1.
// Astro and standalone exports generate their CSS from these same settings.
export const VIEWER_SETTINGS = Object.freeze({
  blink: Object.freeze({
    durationMs: 420,
    reducedDurationMs: 270,
    closeAt: 9 / 28,
    swapAt: 10 / 28,
    reopenAt: 11 / 28,
    closeEasing: 'cubic-bezier(.35,0,.8,.45)',
    openEasing: 'cubic-bezier(.12,.6,.35,1)',
  }),
  glance: Object.freeze({
    centerMs: 120,
    holdMs: 48,
    returnMs: 120,
  }),
  idle: Object.freeze({
    startDelayMs: 60000,
    checkIntervalMs: 10000,
    meanIntervalMs: 30000,
    blinkProbability: .5,
    edgeBand: .16,
  }),
  attraction: Object.freeze({
    clipTravel: .24,
    maximumPixels: 32,
    influenceRadius: .62,
    nearStrength: .78,
    distanceLimit: .32,
    nearResponseMs: 105,
    farResponseMs: 85,
  }),
  pan: Object.freeze({
    decayMs: 325,
    sampleMs: 100,
    hintDelayMs: 1400,
  }),
  geometry: Object.freeze({
    // 四角の大きさと隙間を独立して調整。1 = 現在、1.2 = 20%大きく。
    sizeScale: 1,
    gapXScale: 1,
    gapYScale: 1,
    // 画面幅から基準サイズを算出する列数・切り替え幅（CSS px）。
    columns: Object.freeze({ mobile: 4.2, tablet: 6.4, desktop: 9.4 }),
    breakpoints: Object.freeze({ tablet: 600, desktop: 1000 }),
    minCellSize: 80,
    maxCellSize: 180,
    artFraction: .66,
    depthRange: 18,
    textureScale: 1.5,
  }),
  loading: Object.freeze({
    cycleMs: 4000,
    reducedCycleMs: 6000,
    cycleDelayMs: 100,
    cachedThresholdMs: 160,
    closeMs: 1000,
    minimumFinishMs: 180,
    finishScale: 1.15,
    finishOffsetMs: 60,
    finishPauseMs: 80,
    removalPaddingMs: 170,
  }),
});

export const GLANCE_DURATION_MS = VIEWER_SETTINGS.glance.centerMs
  + VIEWER_SETTINGS.glance.holdMs + VIEWER_SETTINGS.glance.returnMs;
