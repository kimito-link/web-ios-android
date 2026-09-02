/**
 * architecture-map-public-view.mjs — 内部データから「公開してよい部分集合」だけを切り出す安全境界。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ 何をするか
 *   github/配下全体を解析した内部データ（全リポ・private含む）から、GitHub上で
 *   PUBLICと確認できたリポジトリのうち working tree が clean（未コミット変更なし）で
 *   git ls-files に追跡されたファイルのみを含む「公開してよい部分集合」を切り出す。
 *
 * ■ ★2026-09-02、コンポーネント化で切り出し（/componentizeスキル・council-fable設計）
 *   generate-architecture-map.mjs（当時746行）から移動。★ロジックは1文字も変えていない。
 *   設計書: _docs/DESIGN-architecture-map-componentize-2026-09-02.md
 *
 * ■ ★このファイルは意図的な1関数1ファイル
 *   「安全性境界ロジックは変更頻度が低く、監査可能性が最優先」という判断（会議・Fable設計）
 *   により、他の分割方針（責務のまとまりでグルーピング）の例外として単独ファイルにする。
 *   node:fs / node:child_process をimportしない（I/Oを持たせない）。
 * ───────────────────────────────────────────────────────────────────────────
 */
import { isPublishable } from './architecture-map-visibility.mjs';
import { buildDirectoryRollup } from './architecture-map-aggregate.mjs';

/**
 * ★内部データから公開データを切り出す。allowlist(visibilityMap経由)に無いリポは
 * 名前もパスも一切含めない（存在自体を伏せる。「非公開」と明示するのではなく丸ごと省く）。
 *
 * ★公開Mapのソースはローカル作業ツリーではなく「Git管理下のファイル」に限定する
 * （2026-09-02、実損の指摘を受けて修正）。GitHub visibility=PUBLICは「pushされた内容が
 * 公開されている」ことしか意味しない。untrackedファイル・gitignore対象の一時ファイルは
 * GitHub上では公開されていないため、ローカルfs walkの結果をそのまま公開Mapへ出すと
 * 実際には公開されていない情報まで漏れる。v1では複雑な仕組み（HEADのblobを直接読む等）を
 * 避け、次の2条件だけで安全側に倒す:
 *   1. `git ls-files` に含まれるファイルだけを対象にする
 *   2. working treeがdirty(未コミット変更あり)なリポは丸ごと公開Mapから除外する
 *      （dirtyだと「どのファイルが安全か」の境界がuntracked/変更差分の混在で複雑になるため、
 *      v1では個別ファイル単位の精査はせずリポ単位で除外する）
 * dirty判定が測れなかった(null)リポも安全側に倒し、除外する。
 *
 * @param {{repos:object[]}} internalData
 * @param {Record<string,'PUBLIC'|'PRIVATE'>} visibilityMap
 */
export function buildPublicView(internalData, visibilityMap) {
  let excludedNotPublic = 0;
  let excludedDirtyTrue = 0;
  let excludedDirtyUnknown = 0;
  const publicRepos = [];

  for (const r of internalData.repos) {
    if (!isPublishable(visibilityMap, r.name)) { excludedNotPublic++; continue; }
    // ★除外理由を区別する（2026-09-02指摘: dirty=trueとdirty=null/測定不能は意味が違う）。
    if (r.dirty === true) { excludedDirtyTrue++; continue; }
    if (r.dirty !== false) { excludedDirtyUnknown++; continue; } // ★dirty===null（測れなかった）
    if (!Array.isArray(r.trackedFiles)) { excludedDirtyUnknown++; continue; } // ★tracked一覧が取れなければ同じ「測れなかった」扱い

    const trackedSet = new Set(r.trackedFiles);
    const nodes = r.nodes.filter((n) => trackedSet.has(n.path));
    const edges = r.edges.filter((e) => trackedSet.has(e.from) && trackedSet.has(e.to));
    const directories = buildDirectoryRollup(nodes);

    publicRepos.push({
      name: r.name,
      head: r.head,
      dirty: r.dirty, // 常にfalse（フィルタ済み）だが、スキーマの一貫性のため残す
      fileCount: nodes.length,
      gateCount: nodes.filter((n) => n.isGate).length, // ★事実
      gateCandidateCount: nodes.filter((n) => n.gateCandidate).length, // ★推測（heuristic）
      directories,
      nodes,
      edges
    });
  }

  const publicCandidateCount = publicRepos.length + excludedDirtyTrue + excludedDirtyUnknown; // ★visibility=PUBLICだった総数（dirty判定前）
  return {
    repos: publicRepos,
    excludedCount: internalData.repos.length - publicRepos.length, // 後方互換（非公開理由の総計）
    publicCandidateCount,
    excludedNotPublicCount: excludedNotPublic,
    excludedDirtyTrueCount: excludedDirtyTrue,     // ★working treeに未コミット変更ありで除外
    excludedDirtyUnknownCount: excludedDirtyUnknown // ★dirty判定・tracked一覧のいずれかが測れず除外
  };
}
