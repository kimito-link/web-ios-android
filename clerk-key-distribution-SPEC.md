# Clerk共通鍵の複数サービス配布 — 実装仕様書（Fable設計・司令塔裏取り済み）

## 状態: 設計完了・実装未着手（実装は指示があってから着手する。今回はここまで）

- 設計＝Fable（`model:"fable"`サブエージェント） / 裏取り＝司令塔（本セッション）
- 日付: 2026-09-28
- 3段構えワークフロー（council-fable系）の手順3（実装引き継ぎ）に相当する成果物
- 地図（手順1〜2の素材・既存資産調査）: [`clerk-key-distribution-MAP.md`](clerk-key-distribution-MAP.md)（同ディレクトリ、実在確認済み）

## お題（再掲）

kimito.link共通アカウント（Clerk方式A・インスタンス共有）の鍵を、姉妹サービス
（Vercel×2・静的1・Render1=Voice）へ配るたびに人間が手作業でコピペしている。
「1コマンドで全サービスに配る」仕組みを作る。

## CANONICAL CHECK判定（地図で確定済み、再掲）

**KEEP_SEPARATE**（新規実装）+ 一部**ESTABLISH_REHOME**（切り出し）。
- `templates/scripts/bootstrap-secrets.mjs`: GitHub Secrets専用、Clerk鍵を扱わない → 責務が違う
- `templates/scripts/setup-clerk-x-oauth.mjs`: Vercelのみ、Renderが無い → 配布範囲が狭い
- どちらも「複数ホスティング先へ横断的に配る」責務を持たない
- ただし**土台は再利用**する（車輪の再発明をしない）: ブランドプリセット解決ロジック・
  鍵ディレクトリ運用・3値exit規約・selftest型

---

## A. アーキテクチャ

新規ファイル構成:

```
templates/scripts/distribute-clerk-keys.mjs         # 新規CLI本体（エントリポイント）
templates/scripts/lib/brand-preset.mjs               # 新規: setup-clerk-x-oauth.mjs 73-126行目の
                                                      # ブランドプリセット解決ロジックを切り出し
                                                      # (ESTABLISH_REHOME)。setup-clerk-x-oauth.mjs
                                                      # 側もこのモジュールをimportするよう改修し、
                                                      # ロジックが2箇所に分岐しないようにする
templates/scripts/lib/clerk-key-distribution-core.mjs # 新規: 配布計画の組み立て・検証結果判定など
                                                      # の純関数群（副作用なし、テスト容易性のため分離）
templates/scripts/lib/clerk-key-distribution-core.test.mjs # 上記の単体テスト
templates/scripts/lib/hosting-env-adapters.mjs        # 新規: vercel/render/static の3アダプタ。
                                                      # 各アダプタは{ probe(), write(key,value), verify() }
                                                      # の共通インターフェースを実装する
```

### 責務分担

- `distribute-clerk-keys.mjs`: CLI引数パース→`brand-preset.mjs`でプリセット解決→
  `siblingServices`（後述Bで拡張）を読み→対象ごとに`hosting-env-adapters.mjs`のアダプタを選択→
  `clerk-key-distribution-core.mjs`の純関数で計画を組み立て→実行→
  `instrument-core.mjs`の3値exitで終了コードを決める
- `brand-preset.mjs`: 既存`setup-clerk-x-oauth.mjs`からの切り出し。方式A判定
  （`shareInstanceAcrossApps`）・共有鍵env名解決（`sharedPubKeyEnv`/`sharedSecretKeyEnv`）を提供。
  **既存の`setup-clerk-x-oauth.mjs`もこのモジュールを呼ぶよう改修**し、ロジックの二重実装を残さない
- `hosting-env-adapters.mjs`:
  - `vercelAdapter`: Vercel公式MCPの`edit_project_env`/`filter_project_envs`相当の操作を、
    CLIから呼べる形にラップ（下記C節で経路を確定）
  - `renderAdapter`: Render公式MCP `update_environment_variables`（実在確認済み。
    `serviceId`+`envVars`配列+`replace`オプション、既定merge）を叩く
  - `staticAdapter`: 配布対象外（公開鍵のみ）。`probe()`は「ビルド時埋め込みのため配布不要」を
    返し、`write()`は何もしない no-op。理由は下記C節に明記

## B. データモデル: `app.config.schema.json` の `siblingServices` 拡張案

現状（実在確認済み、173-190行目）: `name`/`tagline`/`url`/`sharedAccount`/`appUrl`/`iconUrl`/`hubKey`
のみで、**ホスティング先の情報が無い**。以下を追加する:

```jsonc
// siblingServices[].hosting （新規プロパティ、任意）
"hosting": {
  "type": "object",
  "description": "この姉妹サービスへClerk等の共有鍵を配布する先。省略時はdistribute-clerk-keys.mjsの配布対象外",
  "additionalProperties": false,
  "required": ["provider"],
  "properties": {
    "provider": { "type": "string", "enum": ["vercel", "render", "static"] },
    "vercelProjectId": { "type": ["string", "null"], "description": "provider=vercelのとき必須。Vercel Project ID" },
    "renderServiceId": { "type": ["string", "null"], "description": "provider=renderのとき必須。Render Service ID (srv-で始まる)" },
    "environment": { "type": "string", "enum": ["production", "preview", "development"], "default": "production" }
  }
}

// siblingServices[].sharedKeys （新規プロパティ、任意）
"sharedKeys": {
  "type": "array",
  "description": "この姉妹サービスへ配布するenv名と、配布後の検証契約",
  "items": {
    "type": "object",
    "required": ["envName", "sourceKeyRef"],
    "additionalProperties": false,
    "properties": {
      "envName": { "type": "string", "description": "配布先での環境変数名(例: KIMITO_CLERK_SECRET_KEY)" },
      "sourceKeyRef": { "type": "string", "description": "brand-preset.mjsが解決するキー参照名(例: sharedSecretKeyEnv)。実値はここに書かない" },
      "verify": {
        "type": "object",
        "description": "配布できたかを確認する公開エンドポイント契約(第2層検証、D節参照)",
        "additionalProperties": false,
        "properties": {
          "endpoint": { "type": "string", "format": "uri", "description": "例: https://voice.kimito.link/api/config" },
          "jsonPath": { "type": "string", "description": "例: $.clerkPublishableKeyPrefix" },
          "expectedPrefix": { "type": "string", "description": "例: pk_live_Y2xlcmsua2ltaXRv (先頭一致で照合。実値の下1桁まで晒さない)" }
        }
      }
    }
  }
}
```

★実値は`app.config.json`にもスキーマにも一切書かない（依頼の制約1・地図の「やっては
いけないこと」と一致）。`sourceKeyRef`は「どのキーを配るか」の参照名でしかない。

## C. 配布フロー: 経路の確定

| 配布先 | 経路 | 理由 |
|---|---|---|
| Render | Render公式MCP `update_environment_variables` | 地図で実在・接続確認済み。書き込みAPIだが、MCP呼び出しの引数に値が乗る点は下記の秘密値の扱いで対処 |
| Vercel | REST API直叩き（`POST/PATCH /v10/projects/{id}/env`）をNode `fetch`で呼ぶ。Vercel CLI(`vercel env add`)は不採用 | CLIは`setup-clerk-x-oauth.mjs`の既存実装がシェル文字列展開経由（`echo "${val}" | vercel env add`）で特殊文字を含む値に弱い。REST直叩きなら`fetch`のJSONボディで値を渡せて壊れない。MCP経由の`create_project_env`/`edit_project_env`も候補だが、CLIツールとして`--apply`無しでは何も書き込まない設計にするため、**Vercelトークンをこのスクリプト自身の環境変数として受け取りfetchで叩く**構成に統一し、Node単体で完結させる（実行環境にMCP接続が無くても動く） |
| 静的(exosome) | 対象外（no-op） | 公開鍵のみでビルド時埋め込みのため、実行時のenv配布という枠組みに乗らない。地図の未確定点3はこの整理で確定させる |

### 秘密値の扱い（CLAUDE.mdとの整合、地図の論点5）

- **鍵の実値**（`CLERK_SECRET_KEY`等）は、このCLIの引数として直接渡さない。
  `~/.claude/CLAUDE.md`「クリップボード経由」節の手順（クリップボード→Bash環境変数）で
  `.secrets-local/`配下のファイルに一時保存するか、プロセス環境変数として渡す
  （`bootstrap-secrets.mjs`の鍵ディレクトリ運用を踏襲、地図で確認済み）
- Render MCP `update_environment_variables`を呼ぶ場合、値そのものがツール呼び出しの引数として
  トランスクリプトに残る（CLAUDE.md「★★『認証トークン』と『投入する秘密値』は別物」節と同型）。
  **このCLIをNode単体スクリプトとして実行し、MCP経由ではなくRender REST APIを`fetch`で
  直接叩く**構成にすることで、値がAIセッションのトランスクリプトに乗ることを避ける
  （Render REST APIのエンドポイントは`PUT https://api.render.com/v1/services/{serviceId}/env-vars`。
  実装時に公式ドキュメントで最終確認する）
- 出力（stdout/stderr）には鍵の値を一切出さない（`bootstrap-secrets.mjs`の設計を踏襲、
  `set?`/`OK`/`FAIL`のラベルのみ表示）

## D. 検証フロー（「配れたか」を機械で確かめる、依頼の制約4）

二層構造:

1. **第1層＝登録確認**: 配布直後に各プロバイダのGET系API
   （Vercel: `GET /v10/projects/{id}/env`、Render: `list`系）を叩き、
   対象envが存在し値が空でないことを確認する。**「登録した」の裏取り**（性善説の登録簿依存を防ぐ）
2. **第2層＝効果確認**: `sharedKeys[].verify`契約に従い、対象サービスの公開エンドポイント
   （例: Voiceの`GET /api/config`）を実際に叩き、返ってきた公開鍵のプレフィックスが
   期待値と一致するか確認する。**環境変数の変更が実行中プロセスに反映されているか**
   （再デプロイが要るかどうかの地図の未確定点4に対応。反映されていなければ
   「登録は成功したが反映待ち」という3値目のINCONCLUSIVEとして扱う）

3値exit（`templates/scripts/lib/instrument-core.mjs`、地図で実読了済み）に準拠:
- 第1層・第2層とも成功 → PASS(0)
- 登録失敗 → FAIL(1)
- 登録成功だが第2層が反映待ち（再デプロイ要 or デプロイ直後で伝播中）→ INCONCLUSIVE(2)
  （`normalizeProbeResult`が証拠不十分なpassを自動降格する既存規約をそのまま使う）

### `--selftest`（毒テスト、依頼の制約6）

`runSelfTest(cases)`（`instrument-core.mjs`）に以下の毒ケースを与える:
1. 存在しない`vercelProjectId`を渡す → FAILになるか
2. 存在しない`renderServiceId`を渡す → FAILになるか
3. `sourceKeyRef`が`brand-preset.mjs`に存在しないキー名 → FAILになるか
4. `--apply`無し（ドライラン）で実際に書き込みAPIが呼ばれていないか（モックで検証）
5. Render APIがタイムアウトを返す → `withRetryOnTimeout`経由でINCONCLUSIVEになり、
   FAILにならないか
6. `verify.expectedPrefix`が一致しない → INCONCLUSIVE（またはFAIL、実装時に判断）になるか
7. 環境変数名の衝突（同じ`envName`が2つの`sharedKeys`エントリに重複）→ 設定エラーとして
   早期にFAILするか
8. `app.config.json`の`siblingServices`が空配列 → 「配布対象0件」を正常終了(PASS)として
   扱うか、それとも設定不備としてFAILにするかは実装時に決める（`<要確認>`）

## E. CLIインターフェース

```bash
node templates/scripts/distribute-clerk-keys.mjs [options]

--apply           # 既定はドライラン。実書き込みにはこれが必須
--redeploy        # 配布後、対象サービスの再デプロイをトリガーする(Vercel: create_deployment
                  #   相当のAPI、Render: 既存Render MCPのtrigger_deploy相当)。地図の未確定点4
                  #   (再デプロイが要るか)への対処。既定offなのは、意図しない再デプロイによる
                  #   ダウンタイムを避けるため
--wait <seconds>  # --redeploy指定時、デプロイ完了をポーリングで待つ秒数の上限(既定300)
--only <name>     # siblingServices[].nameでフィルタ。特定サービスだけ配布したいとき
--source <path>   # 鍵の実値を読む一時ファイルのパス(.secrets-local/配下想定)。省略時は
                  #   プロセス環境変数(CLAUDE.md「クリップボード経由」節の型)から読む
--json            # 結果をJSON構造で出力(CI/他スクリプトからの呼び出し用)
--selftest        # 上記D節の毒テストを実行し、期待通りの3値exitになるか検証する
```

## F. 捨てた案

1. **MCP経由で値を直接書き込む案**（Render公式MCP `update_environment_variables`を
   そのままAIセッションから呼ぶ）→ 値がトランスクリプトに残るため不採用（C節参照）
2. **Vercel CLI (`vercel env add`) を使う案** → 既存`setup-clerk-x-oauth.mjs`のシェル経由実装が
   特殊文字を含む値で壊れるリスクを引き継ぐため不採用。REST直叩きに統一
3. **`bootstrap-secrets.mjs`を拡張してClerk鍵も扱わせる案** → 責務が違う
   （GitHub Secrets専用 vs 複数ホスティング先への配布）ため、拡張ではなく兄弟実装とした
4. **`siblingServices`とは別に新しい設定ファイルを作る案** → 姉妹サービス情報の
   SSOTは既に`siblingServices`なので、そこへの拡張が筋。新設定ファイルは分散管理を招く
5. **静的サイト(exosome)も配布対象に含める案** → 公開鍵のみでビルド時埋め込みのため対象外
   （C節で確定）
6. **手作業のダッシュボード操作に戻す案** → 依頼の出発点そのものであり不採用
7. **1つの汎用アダプタで全プロバイダを抽象化しすぎる案** → Vercel/Render/staticは
   API形状が大きく異なり、過剰な抽象化は「抜け漏れなく完璧に」基準に反して
   プロバイダ固有の挙動を握りつぶすリスクがある。3アダプタを緩く共通インターフェースで
   束ねるに留めた（過剰設計を避ける）
8. **通知だけして書き込みは常に人間に確認を求める案** → CLAUDE.md「選択肢を出して
   止まらない」の趣旨に反する。`--apply`という明示フラグで意思表示させる既存パターン
   （`bootstrap-secrets.mjs`）を踏襲し、確認ダイアログは挟まない
9. **再デプロイを既定onにする案** → 意図しないダウンタイムのリスクがあるため既定offとし、
   `--redeploy`で明示選択させる

## G. 未決定事項（実装AIが調べて埋める `<要確認>` 項目）

1. Render REST APIの環境変数更新エンドポイントの正式仕様（パス・認証ヘッダ形式）を
   実装時に公式ドキュメントで最終確認する（地図では公式MCPの存在のみ確認済み、
   REST直叩きの詳細仕様は未確認）
2. Vercel REST API `POST/PATCH /v10/projects/{id}/env`のレスポンス形式・
   エラーコード体系を実装時に公式ドキュメントで確認する
3. D節「8. `siblingServices`が空配列のときの扱い」（PASS or FAIL）
4. `--redeploy`のポーリング間隔・タイムアウト時の3値exitの扱い

## H. 実装ハンドオフ（着手手順）

1. ブランチを切る（例: `feat/clerk-key-distribution`）
2. `templates/scripts/lib/brand-preset.mjs`を新規作成し、`setup-clerk-x-oauth.mjs`
   73-126行目のロジックを移植。**移植元は削除し、`setup-clerk-x-oauth.mjs`側から
   `brand-preset.mjs`をimportするよう改修**（二重実装を残さない、ESTABLISH_REHOME）
3. `templates/scripts/lib/clerk-key-distribution-core.mjs`を純関数群として実装
   （副作用なし。配布計画の組み立て・3値判定ロジック）＋同名`.test.mjs`
4. `templates/scripts/lib/hosting-env-adapters.mjs`を実装（vercel/render/staticの3アダプタ）。
   上記G節1・2の`<要確認>`をここで解決してから実装する
5. `templates/scripts/distribute-clerk-keys.mjs`を実装（CLI本体、E節のインターフェース）
6. `app.config.schema.json`にB節のスキーマ差分を追加。
   `templates/scripts/verify-app-config-schema.mjs`（既存の検査、CLAUDE.md記載）で
   スキーマ自体の妥当性を確認する
7. `--selftest`を実装し、D節の8ケースが期待通りの3値exitになることを確認する
8. 実際に1つの姉妹サービス（Voice=Render想定）に対して`--apply`なしのドライランを実行し、
   出力が計画通りか目視確認する（実配布は本番影響があるため、ユーザーの明示的な実行許可を得てから）
9. `templates/README.md`のマッピング表に本ツールを追記する
10. CLAUDE.mdの「知見は書き戻す」節に従い、実装で踏んだ非自明な地雷があれば
    このSPEC.mdまたは`_docs/KNOWLEDGE-CARRYOVER-RULES.md`経由で該当KBに追記する
11. `npm run diagnostics`相当のGate一式を実行し、配線漏れが無いか確認する

### 機械的な完了判定

- [ ] `distribute-clerk-keys.mjs --selftest` が全ケースPASSする
- [ ] `distribute-clerk-keys.mjs --only Voice`（ドライラン）が計画を正しく出力する
- [ ] `app.config.schema.json`が`verify-app-config-schema.mjs`を通る
- [ ] `setup-clerk-x-oauth.mjs`が`brand-preset.mjs`import後も既存動作を壊していない
      （既存のテスト・手動確認手順があれば実行）
- [ ] 鍵の値がスクリプトの標準出力・ログのどこにも出ていない（grepで確認）

---

## 参照ファイル一覧（実在確認済み、地図より転記）

- `templates/scripts/bootstrap-secrets.mjs`（GitHub Secrets運用の型）
- `templates/scripts/setup-clerk-x-oauth.mjs`（ブランドプリセット解決ロジックの移植元）
- `templates/auth/brands/kimito-link.json` / `templates/auth/brand-preset.schema.json`
- `app.config.schema.json`（`siblingServices`173-190行目、`ownership`125-137行目）
- `templates/scripts/lib/instrument-core.mjs`（3値exit規約）
- `_docs/DESIGN-canonical-boundary-rules.md`（CANONICAL CHECK正本）
- [`clerk-key-distribution-MAP.md`](clerk-key-distribution-MAP.md)（本仕様書の前段階、地図）
