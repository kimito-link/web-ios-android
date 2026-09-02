/**
 * tree-view-component.mjs — 「フォルダアイコン＋接続線」ツリー表示コンポーネント。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ なぜこのファイルが要るか（実損の記録）
 *   2026-09-02、Architecture Map（generate-architecture-map.mjs）と
 *   hubダッシュボード（generate-hub-dashboard.mjs）の両方に「フォルダツリー＋
 *   事実/推測チップ」のUIを追加した際、★同じCSSを2箇所へ手でコピーし、
 *   微妙にズレた（.repoラッパーの有無、white-space:nowrapの有無等）。
 *
 *   これはCLAUDE.md基準⑤「共有部品はこのプロジェクトだけで閉じない」・
 *   「実装着手前の非交渉ルール」6番目「共通化すべきロジックをプロジェクト
 *   固有コードへコピーしない」に、まさにこのキット自身の実装作業で反した例。
 *   ユーザー指摘（2026-09-02）「これがないからおかしくなる」を受けて切り出した。
 *
 * ■ 車輪の再発明にしない境界
 *   ここに置くのは「複数のNode.js生成スクリプトから再利用するCSS文字列」と
 *   「クライアントサイドJSへ埋め込む自己完結関数」のみ。
 *   site/assets/css/common.css（静的HTMLページ群が<link>で読む正本）とは別物
 *   ＝ site/hub/配下（noindex付き内部ダッシュボード、別の生成パイプライン）専用。
 *   混ぜるとcommon.cssの「サイト全体の共通スタイル」という定義が曖昧になるため。
 *
 * ■ ★このファイルは何もimportしない（不変条件）
 *   buildTreeはクライアントサイドJSへ`${buildTree.toString()}`として文字列埋め込み
 *   される。関数の中身がモジュールスコープの外部参照（import・他関数・変数）を
 *   一瞬でも持った瞬間、埋め込み先でReferenceErrorになる。このファイル自体が
 *   importを持たない葉であることで、この制約を構造的に守る。
 *
 * ■ 使い方
 *   import { TREE_VIEW_CSS, buildTree } from './lib/tree-view-component.mjs';
 *   `<style>...${TREE_VIEW_CSS}...</style>` のようにテンプレートリテラルへ埋め込む。
 *   `${buildTree.toString()}` でクライアントサイドJSへ関数定義ごと埋め込む。
 * ───────────────────────────────────────────────────────────────────────────
 */

const TREE_VIEW_CSS = `
  :root { color-scheme: light; }
  .tree { font-size: 0.9rem; }
  .tree ul { list-style: none; margin: 0; padding-left: 1.15rem; }
  .tree > ul { padding-left: 0; }
  .tree li { position: relative; padding-left: 0.9rem; line-height: 1.9; white-space: nowrap; }
  .tree li::before {
    content: ''; position: absolute; left: 0; top: 0; bottom: 0;
    border-left: 1px solid #c7c7c7;
  }
  .tree li:last-child::before { bottom: auto; height: 0.95em; }
  .tree li::after {
    content: ''; position: absolute; left: 0; top: 0.95em; width: 0.7rem;
    border-top: 1px solid #c7c7c7;
  }
  .tree summary { list-style: none; cursor: pointer; font-weight: 700; display: inline; }
  .tree summary::-webkit-details-marker { display: none; }
  .tree summary::marker { content: ''; }
  .tree .fold::before { content: '📁'; margin-right: 0.3rem; }
  .tree details[open] > summary .fold::before { content: '📂'; }
  .tree .file-row { cursor: pointer; }
  .tree .file-row:hover, .tree summary:hover { background: #f3f6fb; border-radius: 3px; }
  .tree .dircount { color: #888; font-weight: normal; font-size: 0.78rem; margin-left: 0.35rem; }

  /* --- 事実/推測チップ: 実線塗り=事実、破線白抜き=推測（isGate/gateCandidate等と同じ思想） --- */
  .chip { display: inline-block; font-size: 0.7rem; padding: 0.02rem 0.4rem; margin-left: 0.3rem;
    border-radius: 3px; border-width: 1.5px; border-style: solid; vertical-align: middle; }
  .chip.fact { border-style: solid; }
  .chip.guess { border-style: dashed; background: transparent !important; }

  @media (max-width: 600px) {
    .tree ul { padding-left: 0.85rem; }
  }
`;

/**
 * ★フラットなファイルパス配列から、ネストしたディレクトリツリーを組み立てる（純関数）。
 *
 * ★2026-09-02、Fable設計により追加。「コードの図がぱっとわからない」というフィードバックを
 * 受け、progressive disclosure（1階層ずつクリックで掘る）から、フォルダアイコン＋接続線の
 * 視覚的なツリー表示へ作り替える際の中核ロジック。
 *
 * ★これは「表示用データ整形」であり、新しい解析ロジックではない。既存の真偽値
 * （isGate/gateCandidate/pairs/aiHubRegistered）を判定・変更・推測することは一切せず、
 * パスを`/`で分割してネストし、既存フラグを合計するだけ（buildDirectoryRollupと同種の集計）。
 *
 * ★repo.directoriesではなくrepo.nodesから組む。directoriesは「ファイルを直接含む
 * ディレクトリ」しか持たず、中間ディレクトリ（例: app/apiにファイルが無くapp/api/lookupにだけ
 * ある場合のapi）が欠落する（実データで確認済み）。
 *
 * ★この関数はモジュールスコープの外部参照を一切持たない自己完結関数にする。
 * クライアントサイドJSへ`${buildTree.toString()}`として文字列埋め込みするため
 * （変数・import・他関数の参照があると埋め込み先でReferenceErrorになる）。
 *
 * @param {Array<{path:string, name:string, isGate:boolean, gateCandidate:boolean, pairs:object|null, aiHubRegistered:boolean|null}>} nodes
 * @returns {object} ルートディレクトリノード
 */
function buildTree(nodes) {
  function emptyAgg() { return { files: 0, gate: 0, gateCandidate: 0, pairs: 0, aiHub: 0 }; }
  function newDir(name, path) {
    return { kind: 'dir', name, path, dirs: new Map(), files: [], agg: emptyAgg() };
  }
  const root = newDir('', '');

  for (const n of (Array.isArray(nodes) ? nodes : [])) {
    const parts = String(n.path || '').split('/').filter(Boolean);
    if (parts.length === 0) continue;
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!cur.dirs.has(seg)) {
        cur.dirs.set(seg, newDir(seg, cur.path ? cur.path + '/' + seg : seg));
      }
      cur = cur.dirs.get(seg);
    }
    cur.files.push(n);
  }

  function aggregate(dir) {
    for (const f of dir.files) {
      dir.agg.files++;
      if (f.isGate) dir.agg.gate++;
      if (f.gateCandidate) dir.agg.gateCandidate++;
      if (f.pairs) dir.agg.pairs++;
      if (f.aiHubRegistered === true) dir.agg.aiHub++;
    }
    for (const child of dir.dirs.values()) {
      aggregate(child);
      dir.agg.files += child.agg.files;
      dir.agg.gate += child.agg.gate;
      dir.agg.gateCandidate += child.agg.gateCandidate;
      dir.agg.pairs += child.agg.pairs;
      dir.agg.aiHub += child.agg.aiHub;
    }
  }
  aggregate(root);

  function sortRec(dir) {
    dir.files.sort((a, b) => a.name.localeCompare(b.name));
    dir.dirs = new Map([...dir.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    for (const child of dir.dirs.values()) sortRec(child);
  }
  sortRec(root);

  return root;
}

export { TREE_VIEW_CSS, buildTree };
