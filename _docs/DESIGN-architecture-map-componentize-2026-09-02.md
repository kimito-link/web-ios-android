# DESIGN: generate-architecture-map.mjs / generate-hub-dashboard.mjs のコンポーネント化

> 設計 = Fable（`/council-fable`手順2、model:"fable"サブエージェント） / 裏取り = 司令塔（Claude）
> 日付: 2026-09-02
> 3段構えワークフロー（会議→Fable設計→実装引き継ぎ）の手順2の産物

## 経緯

同日の作業セッション内で、`generate-architecture-map.mjs`と`generate-hub-dashboard.mjs`に
完全に同一の`findRepoRoot()`関数を重複実装してしまう実損があった（CLAUDE.md基準⑥に記録済み）。
`/componentize`スキルの手順に従い、挙動を変えずに構造整理する。会議（4/5体成功）で素材を集め、
Fableに設計を委譲した。

## 司令塔による技術検証（会議の批判役の主張を覆した箇所）

会議の批判役（groq/gpt-oss-120b）は「`buildTree`を外部ファイルへ切り出すと`toString()`埋め込みが
失敗するリスクが高く危険」と主張したが、これは技術的に誤りと判断した。`Function.prototype.toString()`
は関数のソースコード文字列を返すだけで、その関数がどのファイルに定義されているかとは無関係。
制約は「関数の中身が外部参照を持たないこと」であり「ファイルの場所」ではない。
（実例: 既に`tree-view-component.mjs`から`TREE_VIEW_CSS`という文字列定数をimportして埋め込む
実装が動いており、embedding方式として同型）

## B. 統合アーキ

### 最終ファイル構成

| ファイル | 状態 | 責務（1行） |
|---|---|---|
| `scripts/lib/repo-root.mjs` | 新規 | `.git`を遡ってリポジトリルートを返す |
| `scripts/lib/architecture-map-aggregate.mjs` | 新規 | github/配下全リポを解析し内部データ（internal-map-data）を組み立てる |
| `scripts/lib/architecture-map-public-view.mjs` | 新規 | 内部データ×visibility×dirty×git-trackedから公開可能な部分集合を切り出す（安全境界・純関数・I/Oなし） |
| `scripts/lib/tree-view-component.mjs` | 既存→追記 | ツリー表示CSS + クライアント埋め込み用の`buildTree`関数（import文を一切持たない葉） |
| `scripts/lib/architecture-map-core.mjs` | 既存・無変更 | fs/gitからの機械的スキャン |
| `scripts/lib/architecture-map-visibility.mjs` | 既存・無変更 | GitHub visibility取得・キャッシュ・`isPublishable` |
| `scripts/generate-architecture-map.mjs` | 縮小（746→約465行） | CLI入口・引数処理・ファイル書き出し・`renderHtml`・selftest |
| `scripts/generate-hub-dashboard.mjs` | 最小変更（10行） | `findRepoRoot`定義を削除しimportに置換。他は現状維持 |

### 依存関係（循環なし）

```
generate-architecture-map.mjs
  → lib/repo-root.mjs
  → lib/architecture-map-aggregate.mjs   → lib/architecture-map-core.mjs → lib/hub-kit-matrix.mjs
  → lib/architecture-map-public-view.mjs → lib/architecture-map-visibility.mjs
                                         → lib/architecture-map-aggregate.mjs (buildDirectoryRollupのみ)
  → lib/architecture-map-visibility.mjs  (main/selftest)
  → lib/architecture-map-core.mjs        (selftestのclassifyGateのみ)
  → lib/tree-view-component.mjs          (TREE_VIEW_CSS, buildTree・依存ゼロの葉)

generate-hub-dashboard.mjs
  → lib/repo-root.mjs
  → lib/hub-kit-matrix.mjs (既存)
  → lib/tree-view-component.mjs (既存・TREE_VIEW_CSSのみ)
```

`tree-view-component.mjs`は何も import しない（不変条件）。

## 必答論点への判断

1. **データ収集ロジック群は1ファイル**（`architecture-map-aggregate.mjs`）。`loadPairs`/`loadAiHubPaths`
   は`buildArchitectureMap`以外から呼ばれず、変更理由が1つしかない群。批判役の「2ファイル分割」案は
   行数基準のみで根拠が弱く不採用
2. **`buildTree`は外部化する**。司令塔の技術検証により批判役の懸念は誤りと判明
3. **`generate-hub-dashboard.mjs`は`findRepoRoot`重複解消のみ**。`renderMatrixHtml`→`renderMatrixTree`
   は責務の重なりではなく入れ子構造であり、追加分割は不要

## C. 具体機構（詳細は実装ハンドオフ参照）

各ファイルへの移動内容・関数シグネチャ・import文の変化は
[`_docs/IMPLEMENTATION-HANDOFF-architecture-map-componentize-2026-09-02.md`](IMPLEMENTATION-HANDOFF-architecture-map-componentize-2026-09-02.md)
に実装着手できる粒度で記載。

## F. 捨てた案と理由

| 案 | 理由 |
|---|---|
| データ収集群を loader/aggregate の2ファイルへ分割 | 変更理由・呼び出し元とも1つ。行数以外の根拠なし |
| `buildPublicView`を`architecture-map-visibility.mjs`に合流 | visibility.mjsはgh実行・キャッシュ書き込みというI/Oを持つ。安全境界の純関数と同居させると監査上の単純さを失う |
| `buildPublicView`を`architecture-map-aggregate.mjs`に同居 | 「解析対象（全リポ）」と「公開対象」の分離という元コードのv1思想への違反 |
| `buildTree`を単独ファイルに | 1関数1ファイルの増殖。CSS同居の「埋め込み用ファイル」という括りを維持する方が良い |
| `buildTree`を本体に残す（批判役案） | 技術的根拠が誤り |
| `findGithubRoot`統合ヘルパーの新設 | 1行の重複を消すためにAPIを1つ増やす。両スクリプトで起点ディレクトリの由来が違う |
| hub-dashboardのレンダリング関数群を別ファイルへ | 利用者1つ。escapeHtml共有先が必要になり分散が増える |
| selftestを各libファイル内へ移設 | 挙動は同じだがnpm scriptの位置が変わり検証コストが上がる。今回は移動に集中 |

## G. 地雷（詳細は実装ハンドオフ参照）

- `export function buildTree`と書かず平文宣言+末尾`export {}`にする（`toString()`の仕様依存を避ける）
- 改行コード（CRLF/LF）が変わるとHTML埋め込み部分のバイトが変わる
- `buildPublicView`は1文字も触らない（`git diff --color-moved`でmoved表示になることを確認）
- `templates/`側の同名`findRepoRoot`（配布物・PAIRSの正本）は絶対に巻き込まない
- 新規ファイルの`git add`忘れ（`check-tracked-imports.mjs`で検出可能）
