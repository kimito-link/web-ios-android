/**
 * tree-view-component.mjs — 「フォルダアイコン＋接続線」ツリー表示の共通CSS。
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
 *   ここに置くのは「複数のNode.js生成スクリプトから再利用するCSS文字列」のみ。
 *   site/assets/css/common.css（静的HTMLページ群が<link>で読む正本）とは別物
 *   ＝ site/hub/配下（noindex付き内部ダッシュボード、別の生成パイプライン）専用。
 *   混ぜるとcommon.cssの「サイト全体の共通スタイル」という定義が曖昧になるため。
 *
 * ■ 使い方
 *   import { TREE_VIEW_CSS } from './lib/tree-view-component.mjs';
 *   `<style>...${TREE_VIEW_CSS}...</style>` のようにテンプレートリテラルへ埋め込む。
 * ───────────────────────────────────────────────────────────────────────────
 */

export const TREE_VIEW_CSS = `
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
