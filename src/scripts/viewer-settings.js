// 共通設定。時間はms、長さはCSS px、倍率は1が等倍、確率・割合は0〜1。
// Astroと単体HTMLは、この設定から同じCSSとアニメーションを生成します。
export const VIEWER_SETTINGS = Object.freeze({
  // 黒い幕が上下から閉じて開く動き。全体の画面切替と個別の目で共通。
  blink: Object.freeze({
    durationMs: 420, // 閉じ始めから開き終わるまでの時間。
    reducedDurationMs: 270, // OSで「動きを減らす」が有効なときの画面切替時間。
    closeAt: 9 / 28, // 全時間に対して、完全に閉じる時点の割合。
    swapAt: 10 / 28, // 完全に閉じた状態で画像を交換する時点。closeAt〜reopenAtに収める。
    reopenAt: 11 / 28, // 幕が再び開き始める時点の割合。
    closeEasing: 'cubic-bezier(.35,0,.8,.45)', // 閉じる動きの加減速。
    openEasing: 'cubic-bezier(.12,.6,.35,1)', // 開く動きの加減速。
  }),
  // A：視線を画像中心へ動かし、元の注視点へ戻す動き。
  glance: Object.freeze({
    centerMs: 2500, // 中央へ向かう時間。長いほどゆっくり動く。
    holdMs: 1000, // 中央を見たまま止まる時間。
    returnMs: 400, // 元の注視点へ戻る時間。
  }),
  // 自動演出の抽選。画面全体で1回ずつ抽選し、目の数では頻度を増やさない。
  idle: Object.freeze({
    allowWithReducedMotion: true, // OSの「動きを減らす」が有効でも自動演出を再生する。falseなら自動演出を停止。
    startDelayMs: 5000, // アクセス直後に自動演出を起こさない時間。
    checkIntervalMs: 3000, // 抽選する間隔。短くすると抽選の粒度が細かくなる。
    meanIntervalMs: 9000, // A/B合計の平均発生間隔の目安。1回の当選確率はcheckIntervalMs÷この値。
    blinkProbability: .5, // 当選後にBのまばたきを選ぶ確率。0でAのみ、1でBのみ。
    protectedCenterCount: 9, // 抽選から除外する、画面中央に近い目の枚数。表示中の残りの目はすべて対象。
  }),
  // 通常の視線追従。画像だけを動かし、四角の枠は固定する。
  attraction: Object.freeze({
    clipTravel: .24, // 枠の一辺に対する最大移動量の割合。
    maximumPixels: 32, // 視線による移動量の上限。clipTravelとの小さい方を使う。
    influenceRadius: .62, // 近距離・遠距離の反応を分ける距離。画面の短辺に対する割合。
    nearStrength: .78, // 注視点に近い目の移動の強さ。遠い目は徐々に1へ近づく。
    distanceLimit: .32, // 注視点までの距離に対する移動量の上限。近づいた際の行き過ぎを防ぐ。
    nearResponseMs: 105, // 近い目の追従の時定数。大きいほどゆっくり追従する。
    farResponseMs: 85, // 遠い目の追従の時定数。
  }),
  // ドラッグ・スクロールの慣性。
  pan: Object.freeze({
    decayMs: 325, // 慣性が減衰する時定数。大きいほど長く滑る。
    sampleMs: 100, // 指を離す速度を求める際に参照する直近の移動時間。
    hintDelayMs: 1400, // 操作してから操作ヒントを隠すまでの時間。
  }),
  geometry: Object.freeze({
    sizeScale: 1, // 四角の大きさ。1.2で20%大きくする。隙間の幅は変えない。
    gapXScale: 1, // 横の隙間の倍率。0.5で半分、0で隙間なし。
    gapYScale: 1, // 縦の隙間の倍率。大きさ・横の隙間とは独立。
    columns: Object.freeze({
      mobile: 4.2, // 狭い画面でサイズを算出する基準列数。大きいほど目が小さくなる。
      tablet: 6.4, // 中間の画面幅での基準列数。
      desktop: 9.4, // 広い画面での基準列数。
    }),
    breakpoints: Object.freeze({
      tablet: 600, // この幅以上で中間の基準列数へ切り替える。
      desktop: 1000, // この幅以上で広い画面の基準列数へ切り替える。
    }),
    minCellSize: 80, // 倍率をかける前の基準セルの最小サイズ。
    maxCellSize: 180, // 倍率をかける前の基準セルの最大サイズ。
    artFraction: .66, // 基準セルに対する四角の一辺の割合。編集プレビュー・描画・当たり判定で共通。
    depthRange: 18, // 奥行きのばらつきの全幅。0で全て同じ平面、18なら前後約9px。
    textureScale: 1.5, // 枠の外まで用意する画像の余白倍率。視線移動時の画像の端切れを防ぐ。
  }),
  // 読み込み中の小さい両目と、読み込み完了時の動き。
  loading: Object.freeze({
    cycleMs: 4000, // 読み込み待ちの開閉ループ1周の時間。
    reducedCycleMs: 6000, // 「動きを減らす」が有効なときのループ時間。
    cycleDelayMs: 100, // 開閉ループを開始するまでの待ち時間。
    cachedThresholdMs: 160, // この時間内に準備できた場合、小さい目を閉じ切る待ちを省く。
    closeMs: 1000, // 完了時に小さい目を全開から閉じる場合の基準時間。
    minimumFinishMs: 180, // 既に閉じかけていても確保する、完了時の最短閉じ時間。
    finishScale: 1.15, // 閉じる残り距離から求めた時間に掛ける倍率。
    finishOffsetMs: 60, // 完了時の閉じ時間へ加える余裕。
    finishPauseMs: 80, // 小さい目を閉じた後、画面全体のまばたきまで置く間。
    removalPaddingMs: 170, // animationendが届かない場合の、画面除去タイマーの余裕。
  }),
});

export const GLANCE_DURATION_MS = VIEWER_SETTINGS.glance.centerMs
  + VIEWER_SETTINGS.glance.holdMs + VIEWER_SETTINGS.glance.returnMs;
