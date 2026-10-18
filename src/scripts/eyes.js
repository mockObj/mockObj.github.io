/**
 * Selected eye motifs, using the acquired artwork without changing its bytes.
 *
 * Mouthwashing capsule (Wrong Organ / CRITICAL REFLEX):
 * https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2475490/capsule_616x353.jpg
 * Curly, official Mouthwashing screenshot:
 * https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2475490/ss_f707dcc6da5c778d9730949037b06089ba92efa4.1920x1080.jpg
 * Satori, official Th11 portrait mirrored by Touhou Wiki:
 * https://static.wikia.nocookie.net/touhou/images/0/00/Th11Satori.png/revision/latest
 * That CDN supplied WebP bytes; the .webp asset preserves those original bytes.
 * Sheikah uses the exact central glyph paths from Nintendo's official SVG;
 * its original asset and reference page are recorded inside the SVG below.
 */
const ME_EYE_SHEIKAH_SVG = "<svg width=\"400\" height=\"400\" class=\"eye-art eye-art--sheikah\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 400 400\" fill=\"currentColor\" aria-hidden=\"true\" focusable=\"false\">\n  <!--\n    Sheikah Eye: exact central glyph paths extracted from Nintendo's official SVG.\n    Official page:\n    https://www.nintendo.com/us/store/products/the-legend-of-zelda-breath-of-the-wild-switch/\n    Original asset:\n    https://assets.nintendo.com/image/upload/Marketing/68272fb37fa56918996af8bfceddbc4223c2746af7c325b2067f0c62c65ef8c0/pmp_lhsdvby/backgrounds/sheikah-icon-watermark.svg\n    Visual comparison:\n    https://www.nintendo.com/jp/topics/article/dddcf289-99e3-11e7-8cda-063b7ac45a6d\n    Changes: orbital decoration omitted; original 0.08 opacity removed;\n    fill inherits currentColor; glyph rendered as one rigid image; glyph scaled and\n    positioned with the eye center at approximately (200, 200).\n    The geometry itself is the official asset's geometry, not a generic eye.\n  -->\n  <g transform=\"translate(200 200) scale(.35) translate(-577 -538)\">\n    <g class=\"sheikah-crown\">\n      <path d=\"M347.671 279.743C346.481 279.178 344.62 278.361 343.392 277.795C340.418 276.214 336.604 276.451 336.612 283.386C335.338 310.706 336.337 331.587 336.841 343.471C337.123 373.8 336.475 385.608 336.589 415.907C336.589 424.056 339.708 424.927 347.152 419.725C387.841 382.568 400.31 375.633 435.622 360.664C441.037 358.151 444.82 355.898 446.147 355.203C449.35 353.293 448.831 350.429 443.508 346.939C429.513 336.338 420.422 329.831 402.491 316.549C384.042 300.922 367.294 290.68 347.671 279.743Z\"/>\n      <path d=\"M714.141 351.453C742.749 360.778 767.108 376.779 789.188 396.851C799.949 406.634 805.303 405.374 807.766 391.436C810.863 373.938 811.969 358.846 815.82 340.401C819.359 323.484 822.097 304.894 823.134 285.815C825.216 267.431 824.103 266.805 805.463 273.327C800.14 275.191 787.685 281.225 782.949 284.257C757.682 300.41 736.579 313.998 711.655 330.678C707.887 333.199 702.884 338.683 703.517 341.761C704.31 345.633 709.786 350.032 714.133 351.453H714.141Z\"/>\n      <path d=\"M528.957 329.258C562.286 323.461 592.427 324.24 623.322 329.357C626.121 329.823 628.997 330.235 632.101 330.235C636.974 330.235 639.697 329.113 638.202 323.972C637.577 321.819 637.188 319.947 636.448 318.206C629.752 302.618 623.49 288.175 617.846 273.686C609.93 253.378 604.309 235.399 594.791 214.693C589.94 205.673 588.903 203.764 583.389 196.508C578.165 189.367 573.665 189.673 568.692 198.166C564.91 203.634 546.964 237.843 542.548 248.513C527.653 283.554 526.7 281.034 516.968 313.371C512.316 328.838 513.292 331.961 528.965 329.242L528.957 329.258Z\"/>\n    </g>\n    <path class=\"sheikah-lid\" d=\"M607.032 768.597C603.257 741.353 601.022 726.498 599.306 704.12C598.269 690.594 600.763 690.296 609.251 688.562C614.811 687.424 628.28 684.422 633.84 683.277C720.372 665.451 783.33 615.516 828.366 540.759C831.859 535.13 837.114 534.007 840.332 534.985C861.771 542.859 892.255 530.364 902.642 503.304C911.444 481.941 904.725 448.145 884.514 441.424C882.737 440.729 882.691 441.554 882.744 442.883C891.561 493.245 859.689 503.304 828.252 489.197C819.504 485.264 809.81 477.977 804.609 473.815C778.625 452.827 758.826 437.62 729.272 420.787C630.743 367.912 562.377 361.794 473.282 397.194C431.961 413.615 397.214 435.65 369.498 459.242C351.362 474.686 334.507 485.264 325.5 488.731C294.665 502.609 263.144 492.199 272.815 444.059C273.814 440.454 271.549 441.241 271.198 441.424C249.63 452.567 243.048 473.815 251.246 503.495C260.711 529.05 292.087 540.934 316.989 533.702C321.084 532.365 323.685 535.397 329.313 545.288C342.744 568.04 351.812 581.574 365.502 596.658C384.729 619.273 404.078 632.93 423.663 646.364C460.47 671.606 523.847 688.043 546.781 690.189C559.319 691.51 557.207 694.29 556.276 704.822C553.378 736.748 552.73 745.691 551.265 756.995C548.954 774.829 547.605 779.847 546.605 785.376C540.893 816.981 534.243 839.947 526.303 874.202C519.79 902.286 521.529 920.142 523.634 945.98C527.051 980.502 553.096 1006.8 577.654 1006.8C602.212 1006.8 624.771 983.451 631.201 947.653C634.198 930.95 637.798 912.008 630.812 875.707C626.419 853.557 616.481 817.821 607.039 768.604L607.032 768.597ZM550.632 650.748C512.956 640.857 482.556 615.951 470.163 582.338C468.523 577.572 466.823 573.593 465.526 571.424C464.23 568.651 457.144 568.56 457.93 576.854C458.83 586.248 462.758 596.658 463.871 598.912C468.546 608.42 474.022 616.608 483.029 627.362C491.709 637.718 503.728 645.104 522.292 654.704C524.877 656.247 523.1 656.812 521.437 656.515C495.194 651.886 472.047 644.187 454.902 632.739C411.338 605.243 400.325 596.972 376.073 562.625C363.946 547.014 360.308 541.293 356.083 532.655C353.482 525.025 354.001 523.635 360.24 517.739C394.453 486.341 431.084 457.982 480.635 434.985C492.677 429.395 518.021 419.519 528.912 418.931C530.078 418.671 530.658 420.405 529.682 420.993C527.973 422.185 525.647 423.216 523.847 423.941C501.135 433.053 480.871 451.788 469.995 468.24C463.07 478.711 456.832 492.871 454.544 506.947C453.156 517.357 455.184 517.54 457.709 518.969C459.333 519.709 461.171 518.793 461.934 516.731C473.725 475.167 497.688 446.617 529.56 432.205C542.228 426.477 550.175 422.299 573.139 422.299C599.344 422.299 621.469 430.028 640.185 443.165C654.691 453.354 673.834 471.043 689.126 506.848C690.27 509.712 691.322 510.506 692.535 510.422C694.09 510.56 696.691 509.467 696.951 507.298C697.561 502.181 695.715 494.032 691.291 484.004C681.979 465.582 670.288 449.512 655.919 438.468C649.032 433.175 640.658 428.111 628.051 422.612C623.925 420.596 623.292 420.352 621.347 419.443C620.31 419.007 621.217 417.327 622.613 417.617C650.267 422.391 678.952 435.344 709.008 455.989C741.956 478.619 771.723 503.816 803.221 519.786C804.7 520.916 804.449 522.772 800.292 529.929C772.104 580.406 753.007 594.069 722.347 616.959C687.821 639.345 661.669 649.396 630.301 656.278C628.066 657.026 628.081 655.453 629.103 654.857C658.184 641.209 668.976 630.447 676.702 620.457C689.24 603.731 693.396 594.367 696.295 574.593C696.897 570.469 695.029 568.873 692.298 568.56C689.438 568.415 687.371 569.568 686.67 573.074C681.834 601.348 655.988 622.726 641.52 633.052C631.559 640.162 619.867 645.318 615.978 647.105C594.288 657.095 571.499 655.216 550.64 650.74L550.632 650.748Z\"/>\n    <g class=\"sheikah-center\">\n      <path d=\"M657.742 538.926C657.032 491.847 624.123 455.569 576.372 456.019C529.201 456.462 494.736 492.199 494.736 537.826C494.736 583.453 531.482 617.815 576.037 619.258C626.892 620.9 659.633 581.872 657.742 538.926ZM577.349 566.024C558.839 566.032 549.595 556.072 548.733 538.452C548.108 525.674 558.114 511.033 576.578 510.101C594.844 509.185 604.668 522.176 604.622 537.597C604.576 553.468 592.633 566.016 577.341 566.032L577.349 566.024Z\"/>\n    </g>\n    <g class=\"sheikah-iris-details\">\n      <path d=\"M459.287 536.222C453.598 536.184 450.524 540.018 450.471 544.639C450.646 549.13 452.294 552.643 458.883 552.284C464.634 551.566 466.884 548.893 467.128 543.982C467.28 540.889 464.489 536.253 459.287 536.214V536.222Z\"/>\n      <path d=\"M693.541 549.557C698.033 549.962 701.694 547.908 701.694 540.835C702.068 534.962 697.66 531.067 692.855 531.013C688.424 530.96 685.892 535.023 685.64 540.392C685.373 546.036 690.025 549.557 693.534 549.557H693.541Z\"/>\n    </g>\n  </g>\n</svg>";

const ME_EYE_EMBEDDED_IMAGES = (() => {
  try {
    const raw = typeof document === 'undefined'
      ? '{}'
      : document.getElementById('me-preset-images')?.textContent || '{}';
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
})();

function meEyeResolveImage(id, file) {
  const embedded = ME_EYE_EMBEDDED_IMAGES[id];
  if (typeof embedded === 'string' && /^data:image\//i.test(embedded)) return embedded;
  return new URL('assets/' + file.replace(/^\.\//, ''), new URL(document.documentElement.dataset.meRoot || '/content/me/', window.location.href)).href;
}

// Explicit white ink also works when this SVG is decoded as an Image or texture.
const ME_EYE_SHEIKAH_IMAGE = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  ME_EYE_SHEIKAH_SVG.replace('fill="currentColor"', 'fill="#ffffff" color="#ffffff"')
);

const ME_EYE_PRESETS = [
  {
    id: 'mouthwashing',
    title: 'Mouthwashing',
    width: 616,
    height: 353,
    eye: { x: 306 / 616, y: 124 / 353, r: 46 / 353 },
    sourceUrl: 'https://store.steampowered.com/app/2475490/Mouthwashing/',
    credit: 'Mouthwashing / Wrong Organ / CRITICAL REFLEX — official Steam key art',
    image: meEyeResolveImage('mouthwashing', './mouthwashing-official-capsule.jpg'),
    symbol: false,
  },
  {
    id: 'curly',
    title: 'Curly / Mouthwashing',
    width: 1920,
    height: 1080,
    eye: { x: 1635 / 1920, y: 211 / 1080, r: 43 / 1080 },
    sourceUrl: 'https://store.steampowered.com/app/2475490/Mouthwashing/',
    credit: 'Mouthwashing / Wrong Organ / CRITICAL REFLEX — official gameplay screenshot',
    image: meEyeResolveImage('curly', './mouthwashing-curly-official.jpg'),
    symbol: false,
  },
  {
    id: 'satori',
    title: '古明地さとり — 第三の目',
    width: 256,
    height: 512,
    eye: { x: 138 / 256, y: 159 / 512, r: 14 / 256 },
    sourceUrl: 'https://touhou.fandom.com/wiki/Satori_Komeiji',
    credit: '東方地霊殿 / ZUN / 上海アリス幻樂団 — official portrait mirrored by Touhou Wiki',
    image: meEyeResolveImage('satori', './satori-th11-official.webp'),
    symbol: false,
  },
  {
    id: 'sheikah',
    title: 'シーカーの目',
    width: 400,
    height: 400,
    eye: { x: .5, y: .5, r: .13 },
    sourceUrl: 'https://www.nintendo.com/us/store/products/the-legend-of-zelda-breath-of-the-wild-switch/',
    credit: 'The Legend of Zelda: Breath of the Wild / Nintendo — official Sheikah Eye glyph',
    image: ME_EYE_SHEIKAH_IMAGE,
    symbol: true,
  },
];

const ME_EYE_PRESET_BY_ID = new Map(ME_EYE_PRESETS.map(preset => [preset.id, preset]));
let ME_EYE_MARKUP_SERIAL = 0;

export const eyePresets = ME_EYE_PRESETS;

export function getEyePreset(kind) {
  return ME_EYE_PRESET_BY_ID.get(kind) || ME_EYE_PRESET_BY_ID.get('sheikah');
}

function meEyeEscapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Editor and DOM fallback artwork, with the marked eye at (200, 200).
 * The photo crop has side = radiusInSourcePixels / .26, leaving context around
 * the eye. Only the SVG display is cropped/faded; the source file is unchanged.
 * The inverted argument describes the tile palette; Sheikah inherits currentColor.
 */
export function eyeMarkup(kind, inverted = false) {
  const preset = getEyePreset(kind);
  const polarity = inverted ? 'true' : 'false';
  if (preset.symbol) {
    return ME_EYE_SHEIKAH_SVG.replace('<svg ', '<svg data-inverted="' + polarity + '" ');
  }

  const radius = preset.eye.r * Math.min(preset.width, preset.height);
  const cropSide = radius / .26;
  const scale = 400 / cropSide;
  const imageX = 200 - preset.eye.x * preset.width * scale;
  const imageY = 200 - preset.eye.y * preset.height * scale;
  const imageWidth = preset.width * scale;
  const imageHeight = preset.height * scale;
  const imageHref = meEyeEscapeAttribute(preset.image);
  const suffix = ++ME_EYE_MARKUP_SERIAL;
  const gradientId = 'me-eye-feather-' + suffix;
  const maskId = 'me-eye-mask-' + suffix;

  return '<svg xmlns="http://www.w3.org/2000/svg" class="eye-art eye-art--' + preset.id
    + '" viewBox="0 0 400 400" width="400" height="400" overflow="hidden" aria-hidden="true" focusable="false" data-inverted="' + polarity + '">'
    + '<defs><radialGradient id="' + gradientId + '" gradientUnits="userSpaceOnUse" cx="200" cy="200" r="192">'
    + '<stop offset=".52" stop-color="#fff" stop-opacity="1"/>'
    + '<stop offset=".85" stop-color="#fff" stop-opacity=".65"/>'
    + '<stop offset="1" stop-color="#fff" stop-opacity="0"/>'
    + '</radialGradient><mask id="' + maskId + '" maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="400" style="mask-type:alpha">'
    + '<rect width="400" height="400" fill="url(#' + gradientId + ')"/></mask></defs>'
    + '<g mask="url(#' + maskId + ')"><image href="' + imageHref
    + '" x="' + imageX + '" y="' + imageY + '" width="' + imageWidth + '" height="' + imageHeight
    + '" preserveAspectRatio="none"/></g></svg>';
}
