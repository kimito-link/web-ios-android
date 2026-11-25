// 役割: ストアのスクショ(App Store・Google Play)の「見た目の決まり」を1か所にまとめた純関数。
//   ①背景は明るい色 ②見出しは短く(字を減らす) ③文字は背景に対して読める濃さ、を
//   作る側(frame-appstore-screenshots / capture-appstore-screenshots / capture-play-screenshots)と
//   見る側(check-screenshot-style.mjs・lint-pre-submission の CHECK 38)が同じ物差しで使う。
// なぜ要るか: キットの金型は濃い紺・黒の背景が既定で、説明文を何行も載せられた。
//   公開されている A/B テストの1件(2026-11 にりんくが共有した X の投稿)では、濃い背景＋説明文が多い版の転換率 16.66% に対し、
//   明るい色の背景＋短い見出しだけの版が 21.97% だった。★1件の事例であって法則ではない。
//   それでも既定は「明るい・短い」に寄せ、違う見た目にするなら自分のアプリの A/B の結果を書いて選ぶ形にする。
//   りんくの指示(2026-11-25「全体設計にいれて」)。ルール本文: docs/ai-rules/10_STORE_FIELDS.md §4、物差し: 07_GROWTH_METRICS.md
// fs に触らない。読み込みと出力は呼び出し側がする。

export const SCREENSHOT_PLAN_PATH = 'store-assets/screenshot-plan.json';

/** 背景の明るさの下限(WCAG の相対輝度 0〜1)。濃い紺 #1E4E8C は 0.07、明るい青 #42A5F5 は 0.36、黄緑 #8BC34A は 0.45。 */
export const BG_MIN_LUMINANCE = 0.2;
/** 文字と背景のコントラスト比の下限。大きい文字の WCAG 1.4.3 の基準(3:1)。 */
export const TEXT_MIN_CONTRAST = 3;
/** 見出しの上限: 1行の字数と行数。{波括弧}・空白は数えない。 */
export const HEADLINE_MAX_CHARS_PER_LINE = 13;
export const HEADLINE_MAX_LINES = 2;
/** 補足(sub / subtitle)の上限字数。無しが一番よい。 */
export const SUB_MAX_CHARS = 20;

export const DARK_TEXT = '#1A1F2B';
export const LIGHT_TEXT = '#FFFFFF';
const FALLBACK_BRAND = '#4FACFE';

// ---- 色の計算 --------------------------------------------------------------
export function parseHex(hex) {
  const m = String(hex ?? '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

const toHex = ({ r, g, b }) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** a と b を t(0=a, 1=b) で混ぜる。 */
export function mix(a, b, t) {
  const A = parseHex(a);
  const B = parseHex(b);
  if (!A || !B) return null;
  return toHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t });
}

/** WCAG の相対輝度(0=黒, 1=白)。 */
export function luminance(hex) {
  const c = parseHex(hex);
  if (!c) return null;
  const ch = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la == null || lb == null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** 背景の上下2色のうち、文字にとって不利な方とのコントラストで、濃い字と白い字の読みやすい方を選ぶ。 */
export function pickTextColor(bgTop, bgBottom = bgTop) {
  const worst = (fg) => Math.min(contrast(fg, bgTop) ?? 0, contrast(fg, bgBottom) ?? 0);
  return worst(DARK_TEXT) >= worst(LIGHT_TEXT) ? DARK_TEXT : LIGHT_TEXT;
}

/** ブランド色を、背景の上下どちらにも読める濃さになるまで濃く(または明るく)する。強調文字に使う。 */
export function readableAccent(brand, bgTop, bgBottom = bgTop, textColor = pickTextColor(bgTop, bgBottom)) {
  const base = parseHex(brand) ? brand : FALLBACK_BRAND;
  const toward = textColor === DARK_TEXT ? '#000000' : '#FFFFFF';
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = mix(base, toward, t);
    if (Math.min(contrast(c, bgTop), contrast(c, bgBottom)) >= TEXT_MIN_CONTRAST) return c;
  }
  return textColor;
}

// ---- 見た目の決まりを1枚ごとに決める ---------------------------------------
/**
 * plan(screenshot-plan.json の中身)とブランド色から、スロットごとの色を決める。
 * 既定はブランド色を白に寄せた明るい背景・濃い字。plan.framedStyle で上書きでき、framedStyle.slots["2"] で1枚ずつ変えられる。
 *   "framedStyle": { "bgTop": "#FFE082", "bgBottom": "#FFCA28", "slots": { "2": { "bgTop": "#B3E5FC", "bgBottom": "#81D4FA" } } }
 * headlineColor / accentColor / subColor を書かなければ、背景に合わせて読める色を自動で選ぶ。
 */
export function resolveSlotStyle({ plan, brandPrimary, slot } = {}) {
  const brand = parseHex(brandPrimary) ? brandPrimary : FALLBACK_BRAND;
  const fs = plan?.framedStyle && typeof plan.framedStyle === 'object' ? plan.framedStyle : {};
  const per = slot != null && fs.slots && typeof fs.slots === 'object' ? fs.slots[String(slot)] ?? {} : {};
  const pick = (k) => per[k] ?? fs[k];
  const bgTop = pick('bgTop') ?? mix(brand, '#FFFFFF', 0.82);
  const bgBottom = pick('bgBottom') ?? mix(brand, '#FFFFFF', 0.62);
  const headlineColor = pick('headlineColor') ?? pickTextColor(bgTop, bgBottom);
  const accentColor = pick('accentColor') ?? readableAccent(brand, bgTop, bgBottom, headlineColor);
  const subColor = pick('subColor') ?? (headlineColor === DARK_TEXT ? '#4A5263' : 'rgba(255,255,255,0.92)');
  return { bgTop, bgBottom, headlineColor, accentColor, subColor };
}

// ---- 文字数 ----------------------------------------------------------------
const visibleChars = (s) => Array.from(String(s ?? '').replace(/[{}]/g, '').replace(/\s+/g, '')).length;

export function headlineProblems(headline, label) {
  const out = [];
  if (!headline) return out;
  const lines = String(headline).split(/\n|\\n/);
  if (lines.length > HEADLINE_MAX_LINES) out.push(`${label}: 見出しが ${lines.length} 行(${HEADLINE_MAX_LINES} 行まで)`);
  lines.forEach((ln, i) => {
    const n = visibleChars(ln);
    if (n > HEADLINE_MAX_CHARS_PER_LINE) out.push(`${label}: 見出し${lines.length > 1 ? `${i + 1}行目` : ''}が ${n} 字(1行 ${HEADLINE_MAX_CHARS_PER_LINE} 字まで)「${ln}」`);
  });
  return out;
}

export function subProblems(sub, label) {
  const n = visibleChars(sub);
  return n > SUB_MAX_CHARS ? [`${label}: 補足が ${n} 字(${SUB_MAX_CHARS} 字まで。無しが一番よい)「${sub}」`] : [];
}

function colorProblems(style, label) {
  const out = [];
  for (const k of ['bgTop', 'bgBottom']) {
    const v = style[k];
    const L = luminance(v);
    if (L == null) out.push(`${label}: ${k} が色として読めない「${v}」(#RRGGBB で書く)`);
    else if (L < BG_MIN_LUMINANCE) out.push(`${label}: 背景 ${k} ${v} が暗い(明るさ ${L.toFixed(2)}、${BG_MIN_LUMINANCE} 以上)`);
  }
  for (const k of ['headlineColor', 'accentColor']) {
    if (!parseHex(style[k])) continue; // rgba 等は計らない
    const c = Math.min(contrast(style[k], style.bgTop) ?? 99, contrast(style[k], style.bgBottom) ?? 99);
    if (c < TEXT_MIN_CONTRAST) out.push(`${label}: ${k} ${style[k]} が背景に対して薄い(コントラスト ${c.toFixed(1)}、${TEXT_MIN_CONTRAST} 以上)`);
  }
  return out;
}

const slotKeys = (plan) => {
  const keys = new Set();
  if (plan?.framedCaptions && typeof plan.framedCaptions === 'object') for (const k of Object.keys(plan.framedCaptions)) keys.add(String(k));
  if (plan?.framedStyle?.slots && typeof plan.framedStyle.slots === 'object') for (const k of Object.keys(plan.framedStyle.slots)) keys.add(String(k));
  for (const p of [...(plan?.publicPages ?? []), ...(plan?.authTabs ?? [])]) if (p?.slot != null) keys.add(String(p.slot));
  return [...keys];
};

/**
 * スクショ計画を点検する(CHECK 38)。
 * - plan が無い → skip(スクショを作らないリポ)
 * - 暗い背景・薄い文字・長い見出し → fail
 *   ただし framedStyle.abTestEvidence に「このアプリで測った A/B の結果(URL か 数字と日付)」があれば warn に下げる
 *   (1件の事例より自分のアプリの実測が勝つ。07_GROWTH_METRICS §5「正直に測る」)。
 */
export function checkScreenshotStyle({ plan, planError, brandPrimary } = {}) {
  const name = 'screenshot-style';
  const guideline = 'CVR';
  if (planError) return { name, guideline, status: 'fail', detail: `${SCREENSHOT_PLAN_PATH} が JSON として読めない: ${planError}`, problems: [] };
  if (!plan) return { name, guideline, status: 'skip', detail: `${SCREENSHOT_PLAN_PATH} が無い(スクショを作らないリポ)`, problems: [] };

  const problems = [];
  const captions = plan.framedCaptions && typeof plan.framedCaptions === 'object' ? plan.framedCaptions : {};
  for (const [slot, c] of Object.entries(captions)) {
    problems.push(...headlineProblems(c?.headline, `framedCaptions[${slot}]`), ...subProblems(c?.sub, `framedCaptions[${slot}]`));
  }
  for (const [key, list] of [['publicPages', plan.publicPages], ['authTabs', plan.authTabs]]) {
    for (const p of Array.isArray(list) ? list : []) {
      const label = `${key}[slot ${p?.slot}]`;
      problems.push(...headlineProblems(p?.title, label), ...subProblems(p?.subtitle, label));
    }
  }
  const keys = slotKeys(plan);
  for (const slot of keys.length ? keys : [null]) {
    problems.push(...colorProblems(resolveSlotStyle({ plan, brandPrimary, slot }), slot == null ? '色' : `色[slot ${slot}]`));
  }
  const unique = [...new Set(problems)];
  if (!unique.length) {
    return { name, guideline, status: 'ok', detail: `明るい背景・短い見出し(${keys.length} 枚分)`, problems: [] };
  }
  const evidence = String(plan.framedStyle?.abTestEvidence ?? '').trim();
  const head = `ストアのスクショは「明るい背景・短い見出し」が既定(docs/ai-rules/10_STORE_FIELDS.md §4)。${unique.length} 件: `;
  if (evidence) {
    return { name, guideline, status: 'warn', detail: `${head}${unique.join(' / ')}(A/B の記録あり: ${evidence})`, problems: unique };
  }
  return { name, guideline, status: 'fail', detail: `${head}${unique.join(' / ')}`, problems: unique };
}
