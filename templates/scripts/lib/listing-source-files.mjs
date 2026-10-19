// 役割: 審査提出で ASC に送る掲載文の「正本ファイル」がリポに揃っているかを調べる純関数(lint-pre-submission の CHECK 34)。
// なぜ要るか: 提出スクリプトは掲載文を store-assets/appstore/*.txt から読む。ファイルが無い項目は、前の版の値の持ち越しか、
//   空のまま公開になる(2026-10-18 に旧キーワードが残った事故)。提出の直前(IPAアップロード後)に止まるのは遅いので、
//   IPA を作る前に「正本ファイルがあるか」を見て止める。
// 使い方: lint が files(ファイル名→内容 または undefined)を渡す。fs に触らない。
// ★見るのは「ある・空でない」まで。文面の良し悪し・最新かは意味判断で、人が決める。

export const REQUIRED_LISTING_FILES = Object.freeze([
  ['description-ja.txt', '説明文'],
  ['keywords-ja.txt', 'キーワード'],
  ['subtitle-ja.txt', 'サブタイトル'],
]);

// files: { 'description-ja.txt': string|undefined, ... }。iosTargeted: iOS に出すアプリか(ascAppId があるか)。
export function checkListingSourceFiles({ files = {}, iosTargeted = true } = {}) {
  const name = 'listing-source-files';
  if (!iosTargeted) return { status: 'skip', name, detail: 'iOS に出すアプリではない(ascAppId が無い)' };
  const missing = REQUIRED_LISTING_FILES.filter(([f]) => !String(files[f] ?? '').trim()).map(([f, label]) => `${f}(${label})`);
  if (missing.length) {
    return {
      status: 'fail',
      name,
      guideline: '2.3',
      detail: `store-assets/appstore/ に掲載文の正本が無い・空: ${missing.join(', ')}。無いと前の版の値を引き継ぐか空で公開される。書いてから提出する`,
    };
  }
  const keywords = String(files['keywords-ja.txt']).trim();
  if (keywords.length > 100) {
    return { status: 'fail', name, guideline: '2.3', detail: `keywords-ja.txt が ${keywords.length} 文字で、Apple の上限 100 文字を超えている` };
  }
  return { status: 'ok', name, detail: `説明文・キーワード(${keywords.length}字)・サブタイトルの正本がある` };
}
