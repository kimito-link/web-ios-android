// 役割: 審査提出の直前に、App Store Connect(ASC)で「これから公開される項目」が、リポの正本と一致しているかを比べる純関数。
// なぜ要るか: 提出スクリプトは前の版の値を引き継ぐ経路があり、改名した版でも旧キーワード・旧名称が
//   そのまま審査へ出る寸前だった(malwarecheck 2026-10-18)。しかも機械は何も止めず、人が手で読み戻して気づいた。
//   「取り消せない1手」(submitted=true)の直前に、意図(リポ)と実態(ASC)を等値で突き合わせて止める。
// 使い方: appstore-submit.mjs の [8] の直前で、ASC から読み戻した値(actual)と、リポ由来の期待値(expected)を渡す。
//   expected に無い項目は比べない(リポに正本が無い任意項目)。値が MISSING の項目は「リポに正本が無い＝空で公開される」ので止める。
// 複製元: malwarecheck.site/scripts/lib/ へ同内容をコピーして使う(配布境界をまたぐため意図的な複製)。

export const MISSING = Symbol('repo-missing');

const normalize = (s) => String(s ?? '').replace(/\r\n/g, '\n').trim();

// Apple の審査メモは 4000 文字上限。超えると 409 で提出全体が落ちるので切る。送る側と比べる側で同じ式を使う。
export function clampReviewNotes(notes) {
  if (typeof notes !== 'string' || notes.length <= 4000) return notes;
  return notes.slice(0, 3988) + '\n[truncated]';
}

// expected: { key: 文字列 | MISSING }。actual: { key: 文字列 }。
// 返り値: 不一致の配列(空なら一致)。kind は 'repo-missing' | 'mismatch'。
export function diffListing(expected, actual) {
  const out = [];
  for (const [key, exp] of Object.entries(expected)) {
    if (exp === MISSING) {
      out.push({ key, kind: 'repo-missing' });
      continue;
    }
    if (normalize(exp) !== normalize(actual?.[key])) {
      out.push({ key, kind: 'mismatch', expected: normalize(exp), actual: normalize(actual?.[key]) });
    }
  }
  return out;
}

// 人が読む1行ずつの説明。値は長いので先頭だけ。
export function describeDiffs(diffs, max = 60) {
  const cut = (s) => (s.length > max ? `${s.slice(0, max)}…(${s.length}字)` : s);
  return diffs.map((d) =>
    d.kind === 'repo-missing'
      ? `  - ${d.key}: リポに正本が無い(空で公開される)`
      : `  - ${d.key}: リポ「${cut(d.expected)}」 / ASC「${cut(d.actual)}」`,
  );
}
