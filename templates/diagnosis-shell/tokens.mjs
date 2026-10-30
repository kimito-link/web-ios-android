// 診断結果シェルの文字色と背景色、および WCAG のコントラスト比。
// なぜ要るか: 結果の点数と状態が、小さい文字でも 4.5:1 以上で読める色だけを使う。
// 状態は色だけでは伝えない。色の対はここが正本で、CSS は同じ16進を使う。

/** @type {ReadonlyArray<{name:string, fg:string, bg:string, min:number}>} */
export const COLOR_PAIRS = Object.freeze([
  { name: 'text', fg: '#1c1917', bg: '#fffdf8', min: 4.5 },
  { name: 'muted', fg: '#44403c', bg: '#fffdf8', min: 4.5 },
  { name: 'score', fg: '#102033', bg: '#fffdf8', min: 4.5 },
  { name: 'good', fg: '#14532d', bg: '#dcfce7', min: 4.5 },
  { name: 'warn', fg: '#78350f', bg: '#fef3c7', min: 4.5 },
  { name: 'bad', fg: '#7f1d1d', bg: '#fee2e2', min: 4.5 },
  { name: 'pending', fg: '#1c1917', bg: '#f5f5f4', min: 4.5 },
  { name: 'on-button', fg: '#fffdf8', bg: '#1c1917', min: 4.5 },
  { name: 'link', fg: '#1e3a8a', bg: '#fffdf8', min: 4.5 },
]);

function channel(value) {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** @param {string} hex #rrggbb */
export function relativeLuminance(hex) {
  const n = Number.parseInt(String(hex).slice(1), 16);
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** @param {string} fg @param {string} bg */
export function contrastRatio(fg, bg) {
  const lighter = Math.max(relativeLuminance(fg), relativeLuminance(bg));
  const darker = Math.min(relativeLuminance(fg), relativeLuminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}
