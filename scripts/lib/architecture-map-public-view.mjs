/**
 * architecture-map-public-view.mjs — 内部データから「公開してよい部分集合」だけを切り出す安全境界。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ 何をするか
 *   github/配下全体を解析した内部データ（全リポ・private含む）から、GitHub上で
 *   PUBLICと確認できたリポジトリのうち、HEADコミット時点でGit管理下にある
 *   （＝push済みなら実際にGitHub上で公開されている）ファイルのみを含む
 *   「公開してよい部分集合」を切り出す。
 *
 * ■ ★2026-09-02、コンポーネント化で切り出し（/componentizeスキル・council-fable設計）
 *   generate-architecture-map.mjs（当時746行）から移動。
 *
 * ■ ★2026-09-02、dirty恒常除外問題の根治（ユーザー指摘「100年後楽できる設計」）
 *   以前は working tree が dirty（未コミット変更あり）なリポを丸ごと除外していた。
 *   これは「dirtyだと安全な境界が引けない」という理由だったが、実際には常に開発中の
 *   リポはほぼ恒久的にdirtyであり、結果として公開データがほぼ空になる副作用があった。
 *   trackedFilesの取得元をgit ls-tree HEAD（HEADコミット時点の確定した安全な一覧、
 *   未コミット変更を一切含まない）に切り替えたことで、dirtyかどうかに関わらず
 *   「最後にpushしたコミットの内容だけ」を正確に切り出せるようになったため、
 *   dirtyによる丸ごと除外は撤廃した。
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
 * ★公開Mapのソースはローカル作業ツリーではなく「HEADコミット時点でGit管理下にある
 * ファイル」に限定する（2026-09-02、実損の指摘を受けて修正。同日、dirty恒常除外問題を
 * 根治するためtrackedFilesの取得元をgit ls-tree HEADへ変更）。GitHub visibility=PUBLICは
 * 「pushされた内容が公開されている」ことしか意味しない。untrackedファイル・
 * gitignore対象の一時ファイル・未コミットの変更内容はGitHub上では公開されていないため、
 * ローカルfs walkの結果をそのまま公開Mapへ出すと実際には公開されていない情報まで漏れる。
 * trackedFiles（git ls-tree HEAD由来、HEADコミット時点の確定した一覧）に含まれる
 * ファイルだけを対象にすることで、dirty(未コミット変更あり)なリポでも安全に
 * 「最後にpushしたコミットの内容だけ」を切り出せる。dirtyかどうかによる丸ごと除外は
 * しない（以前はしていたが、開発中リポが恒久的に公開されない副作用があったため撤廃）。
 * trackedFiles自体が測れなかった(null)リポのみ、安全側に倒して除外する。
 *
 * @param {{repos:object[]}} internalData
 * @param {Record<string,'PUBLIC'|'PRIVATE'>} visibilityMap
 */
export function buildPublicView(internalData, visibilityMap) {
  let excludedNotPublic = 0;
  let excludedTrackedFilesUnknown = 0;
  const publicRepos = [];

  for (const r of internalData.repos) {
    if (!isPublishable(visibilityMap, r.name)) { excludedNotPublic++; continue; }
    // ★trackedFilesが測れなかった(git管理外・git ls-tree失敗等)リポのみ安全側に倒し除外する。
    // dirty(未コミット変更あり)かどうかは、trackedFilesがHEADコミット時点の一覧である
    // 以上、公開可否の判断材料にしない（2026-09-02、恒常除外問題の根治）。
    if (!Array.isArray(r.trackedFiles)) { excludedTrackedFilesUnknown++; continue; }

    const trackedSet = new Set(r.trackedFiles);
    const nodes = r.nodes.filter((n) => trackedSet.has(n.path));
    const edges = r.edges.filter((e) => trackedSet.has(e.from) && trackedSet.has(e.to));
    const directories = buildDirectoryRollup(nodes);

    publicRepos.push({
      name: r.name,
      head: r.head,
      dirty: r.dirty, // ★参考情報として残す（trueでも公開対象になり得る。HEADコミット時点のみ表示している旨はUI側で明示）
      fileCount: nodes.length,
      gateCount: nodes.filter((n) => n.isGate).length, // ★事実
      gateCandidateCount: nodes.filter((n) => n.gateCandidate).length, // ★推測（heuristic）
      directories,
      nodes,
      edges
    });
  }

  const publicCandidateCount = publicRepos.length + excludedTrackedFilesUnknown; // ★visibility=PUBLICだった総数
  return {
    repos: publicRepos,
    excludedCount: internalData.repos.length - publicRepos.length, // 後方互換（非公開理由の総計）
    publicCandidateCount,
    excludedNotPublicCount: excludedNotPublic,
    excludedTrackedFilesUnknownCount: excludedTrackedFilesUnknown // ★HEADコミット時点の一覧が測れず除外
  };
}
