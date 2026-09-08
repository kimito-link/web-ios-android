/**
 * matrix-table-component.mjs — 複数プロジェクトを行に並べる「マトリクス表」の共有CSS。
 *
 * ★このファイルが要る理由（基準⑥の適用）: generate-hub-dashboard.mjs の .kit-matrix と
 * 同じ表現（sticky列・状態別セル色・スコア列）を generate-revenue-dashboard.mjs でも使う。
 * 2箇所目を手で書かず、tree-view-component.mjs と同じ型でCSSを切り出す。
 *
 * 使い方: import { MATRIX_TABLE_CSS } from './lib/matrix-table-component.mjs';
 *   `<style>...${MATRIX_TABLE_CSS}...</style>` へ埋め込む。
 */

const MATRIX_TABLE_CSS = `
  .matrix-section { margin-bottom: 1.5rem; }
  .matrix-meta { color: #666; font-size: 0.85rem; }
  .matrix-legend .cell { display: inline-block; padding: 0.1rem 0.5rem; margin-right: 0.4rem;
    border-radius: 3px; font-size: 0.82rem; }
  .matrix-scroll { overflow-x: auto; max-height: 70vh; overflow-y: auto;
    border: 1px solid #ddd; border-radius: 6px; }
  .kit-matrix { border-collapse: separate; border-spacing: 0; font-size: 0.82rem;
    width: max-content; min-width: 100%; }
  .kit-matrix th, .kit-matrix td { padding: 0.3rem 0.5rem; border-bottom: 1px solid #eee;
    text-align: center; white-space: nowrap; }
  .kit-matrix thead th { position: sticky; top: 0; background: #fff; z-index: 2;
    border-bottom: 2px solid #ddd; font-weight: 600; }
  .kit-matrix .proj-col { position: sticky; left: 0; background: #fff; z-index: 1;
    text-align: left; }
  .kit-matrix thead .proj-col { z-index: 3; }
  .kit-matrix td[data-state="ok"]      { background: #e8f5e9; color: #1b5e20; }
  .kit-matrix td[data-state="missing"] { background: #ffebee; color: #b00; }
  .kit-matrix td[data-state="na"]      { background: #f4f4f4; color: #888; }
  .kit-matrix td[data-state="unknown"] { background: #fff8e1; color: #8a6d00; }
  .kit-matrix td[data-overridden="true"] { outline: 1px dashed #999; outline-offset: -2px; }
  .kit-matrix tfoot td, .kit-matrix tfoot th { border-top: 2px solid #ddd; color: #555;
    position: sticky; bottom: 0; background: #fff; }
  .kit-matrix .score-col { font-weight: 600; text-align: right; }
  .score-bar { width: 48px; height: 5px; background: #eee; border-radius: 3px; margin: 0.2rem 0 0 auto; overflow: hidden; }
  .score-bar-fill { height: 100%; background: #43a047; }
  .row-note-inline { font-style: italic; color: #888; font-size: 0.75rem; font-weight: normal; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
`;

export { MATRIX_TABLE_CSS };
