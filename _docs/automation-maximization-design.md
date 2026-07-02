# 設計書：自動化の最大化（web-ios-android キット）

> 司令塔Claude（Opus 4.8）が、地雷マップ実地調査＋無料LLM会議ハーネス（[COUNCIL-HOWTO.md](../../COUNCIL-HOWTO.md)、design分類・4体動的召集）の素材を統合して作成。
> Fableサブエージェントへの委譲は安全分類器の一時障害（Agent呼び出しが3回連続失敗）で不可となったため、司令塔が直接統合した。次の実装フェーズ（別モデル/別チャット）にそのまま渡せる粒度で書く。
> 作成日: 2026-07-02

---

## 0. 前提として裏取りした事実

- `templates/scripts/lint-pre-submission.mjs`（280行）は既に8チェックのブロッキングlintを持つ。version整合・bundleId整合・プラットフォーム参照混入・contact URL・スクショfail-closed・delete-then-reupload・workflow path filter整合をカバー済み。**iOS UI手動項目（配信地域・App プライバシー「公開」ボタン・contentRightsDeclaration）はカバー対象外**。
- `templates/scripts/setup-new-app.mjs`（114行）は「最後の手動GUI」を**表示するだけ**（step 4）。チェック機構は無い。
- `templates/scripts/release-bump.mjs`のSWキャッシュregexは、地雷マップの記述より実態はやや安全（ファイル無ければwarn skip、prefixはapp.config.json `identity.shortName`から導出済み）。ただし**正規表現が不一致のときも警告止まりで exit 0**＝気づかずにSW版数が上がらないまま出荷されるリスクは実在する。
- `_docs/FIRST-SUBMISSION-blockers.md`はB1〜B8・C1〜C2の症状/原因/直し方を**すでにチェックリスト化**済み（初回提出限定）。ここに書かれた知見を**CIの自動チェックに昇格**させるのが今回の設計の中心。

---

## 1. 全体方針

**最優先＝「手動ゲートの見逃しを構造的にゼロにする」。次点＝「次に壊れる既知の脆さを補強する」。量産効率化は3番目。**

判断基準:
1. **実際に事故を起こした実績があるか**（地雷マップに症状記録があるもの）を最優先する。まだ起きていない仮説上のリスクより優先度を上げる。
2. **API化できるものはAPI化、API化できないものは「検出してブロック」に倒す**。UIをスクレイピングして無理にAPI化しない（§4で理由を述べる）。
3. **fail-closed（分からなければ止める）を一貫させる**。既存コードのfail-closed設計（`capture-*-screenshots.mjs`のcreds欠落時exit 1）は良いパターンなので、今回追加する全チェックもこれに倣う。
4. 会議ハーネスの統括役・批判役が共通して出した結論（＝手動ゲートの構造的排除を最優先、既知の脆さの中でもASC stale値とWebView黒画面を優先）は、地雷マップの実データとも整合するため採用する。

---

## 2. 優先順位付きタスクリスト

### タスク1（最優先）: `lint-pre-submission.mjs` に ASC UI手動項目のRead-Only検証チェックを追加

- **目的**: `_docs/FIRST-SUBMISSION-blockers.md` B7/B8（contentRightsDeclaration・App プライバシー「公開」）と、配信地域設定を、**submit前にAPIで実際の状態を読み取って**検出する。現状は「症状が出てから直す」チェックリストだが、これを「症状が出る前に止める」CIゲートに昇格させる。
- **対象ファイル**:
  - 既存: `templates/scripts/lint-pre-submission.mjs`（CHECK 9〜11として追加）
  - 新規: `templates/scripts/lib/asc-readonly-checks.mjs`（ASC APIをGETのみで叩く共通関数。既存の`asc-set-content-rights.mjs`・`asc-api.mjs`があればそのAPIクライアントを再利用）
- **実装方針**（疑似コード）:
  ```
  // asc-readonly-checks.mjs
  async function checkContentRightsDeclared(appId) {
    const app = await ascGet(`/v1/apps/${appId}`);
    if (!app.attributes.contentRightsDeclaration) {
      return fail('contentRightsDeclaration が未設定。asc-set-content-rights.mjs を実行してください');
    }
  }

  async function checkAppPrivacyPublished(appId) {
    // GET /v1/apps/{id}/appInfos または appDataUsages の publishedState を確認
    const usages = await ascGet(`/v1/apps/${appId}/appDataUsages`);
    if (!usages.some(u => u.attributes.publishedState === 'PUBLISHED')) {
      return fail('App プライバシーが未公開。ASC UI で「アプリのプライバシー」→ 右上「公開」ボタンを押す(保存だけでは不可)');
    }
  }

  async function checkTerritoriesConfigured(appId) {
    // GET /v1/apps/{id}/availableTerritories (または appAvailabilityV2)
    const territories = await ascGet(`/v1/apps/${appId}/availableTerritories`);
    if (territories.length === 0) {
      return warn('配信地域が0件。ASC UI で「価格および配信状況」→「すべての国または地域」を選択(反映まで最大24h)');
    }
  }
  ```
  - `lint-pre-submission.mjs`本体に、CHECK 9〜11として `ASC_APP_ID` が env にあるときだけ有効化（無ければ`skip`、既存のfail-closed設計を踏襲しつつAPI呼び出しが無いローカル実行を壊さない）。
  - `contentRightsDeclaration`と`appDataUsages`はblocking（`fail`）、配信地域は初回のみ関係するため`warn`扱いにして誤検知（2回目以降のリリースで毎回warnが出続ける）を避ける。既に配信地域が設定済みのアプリでは`territories.length > 0`になりok化する。
- **検証方法**:
  - dry_run相当のローカル実行: `ASC_APP_ID=<既存アプリのID> node scripts/lint-pre-submission.mjs` を、既に本番提出済みの既存アプリ（例: malwarecheck.site）に対して実行し、全項目がokになることを確認。
  - 意図的に未公開のプライバシー設定を持つテストアプリ（あれば）で fail が出ることを確認。無ければ、GETレスポンスをモックした単体テストで代替。

---

### タスク2（最優先）: `setup-new-app.mjs` の「最後の手動GUI」を、チェックリスト表示のみから「完了確認つきインタラクティブチェックリスト」に

- **目的**: 新規アプリ立ち上げ時、手動GUIタスク（ASCアプリ枠作成・Play Console新規アプリ作成・配信地域設定・Chrome OAuthクライアント作成)を「表示するだけ」から「終わったかどうかを機械的に確認できる状態」に変える。会議の統括役が出した「Shadow Store Simulation」案（ローカルでチェックリストを完了させてからCIに進む）は、フルシミュレーションまでは過剰実装だが、**「終わったらAPIで実在確認する」までは地雷マップと整合し実装コストも低い**ため、縮小採用する。
- **対象ファイル**:
  - 既存: `templates/scripts/setup-new-app.mjs`（step 4を拡張）
  - 新規: `templates/scripts/verify-manual-setup-done.mjs`（手動GUIタスクの完了をAPIで確認する独立スクリプト。setup-new-app.mjsからも呼べるし、CI起動前に単独実行もできる）
- **実装方針**:
  ```
  // verify-manual-setup-done.mjs
  // app.config.json の stores.ascAppId / stores.playPackageName を読み、
  // 実際にストア側にアプリ枠が存在するかをAPIで確認する。
  const checks = [
    { name: 'ASC app exists', run: () => ascGet(`/v1/apps/${cfg('stores.ascAppId')}`) },
    { name: 'Play Console app exists', run: () => playGet(`/androidpublisher/v3/applications/${cfg('stores.playPackageName')}/edits`) },
    // Chrome は OAuth clientId/secret の疎通確認のみ(初回アイテム作成はAPIで存在確認不可のため`--check`フラグの結果を流用)
  ];
  for (const c of checks) {
    try { await c.run(); ok(c.name); } catch (e) { fail(`${c.name}: ${e.message}`); }
  }
  ```
  - `setup-new-app.mjs` step 4 の末尾に「手動GUIタスクが終わったら `node scripts/verify-manual-setup-done.mjs` を実行して確認」という導線を追加。
- **検証方法**: 実際に新規アプリを1本作る際にこのフローを踏み、`ascAppId`未設定の状態でfailすること、設定後にokになることを確認。

---

### タスク3（高）: `lint-pre-submission.mjs` に「ASC APIのstale値」検出チェックを追加

- **目的**: 会議の批判役（groq/qwen3-32b）と統括役が共通して「次に壊れる可能性が高い」と指摘し、地雷マップにも実際の再発事例（v1.0.6 demoAccountName）がある箇所。`appstore-submit.mjs`が送るreviewer notes / demoAccountName / demoAccountPassword が、**env の現在値とASC側の現在値で食い違っていないか**をsubmit前に検出する。
- **対象ファイル**: `templates/scripts/lint-pre-submission.mjs`（CHECK 12として追加）、`templates/scripts/appstore-submit.mjs`（既存の`pick()`優先順位ロジックを読み取り専用で呼べる形に小さく切り出す）
- **実装方針**:
  ```
  // CHECK 12: ASC 側の現在の reviewDetails と env の値を比較
  const ascDetails = await ascGet(`/v1/appStoreVersions/${versionId}/appStoreReviewDetail`);
  const envDemoUser = process.env.IOS_REVIEW_DEMO_USERNAME;
  if (ascDetails.attributes.demoAccountName !== envDemoUser) {
    warn('asc-stale-value', `ASC側のdemoAccountNameが env と不一致。次回submitでenv値が上書きされるが、
      今の食い違いが「なぜ却下対応してもズレているのか」の手がかりになる。確認: ASC=${ascDetails.attributes.demoAccountName} env=${envDemoUser}`);
  }
  ```
  - blockingにはしない（envが優先されて上書きされる設計は既にあるため、これは「事前に気づけるようにする」warn）。
- **検証方法**: envの値を意図的にASC側と違う値にして実行し、warnが出ることを確認。

---

### タスク4（高）: Capacitor WebView黒画面対策の自動検証を release workflow に統合

- **目的**: 会議の批判役・統括役が共通して次点リスクに挙げ、`_docs/CAPACITOR-GOLDEN-RULES.md`が既に原則を持っている。原則があるだけでは事故を防げないため、**lintで機械的に検証**する。
- **対象ファイル**: `templates/scripts/lint-pre-submission.mjs`（CHECK 13として追加）、参照元 `_docs/CAPACITOR-GOLDEN-RULES.md`
- **実装方針**:
  ```
  // CHECK 13: capacitor.config.json の server.url が cleartext(http)でないか、
  // ATS例外(NSAllowsArbitraryLoads)が不用意に有効化されていないかを静的チェック
  const capConfig = readJson('capacitor.config.json');
  if (capConfig?.server?.url?.startsWith('http://')) {
    fail('capacitor-server-cleartext', 'ATS', 'capacitor.config.json server.url が http:// (cleartext)。ATS でブロックされ黒画面の原因になる');
  }
  const iosInfoPlist = readFile('ios/App/App/Info.plist');
  if (iosInfoPlist?.includes('NSAllowsArbitraryLoads') && iosInfoPlist.includes('<true/>')) {
    warn('ats-arbitrary-loads', 'ATS', 'NSAllowsArbitraryLoads=true。審査で指摘される可能性、必要な例外ドメインだけ許可する設定に絞ることを推奨');
  }
  ```
  - 「合成ネットワーク遅延を注入するChaos Monkey」（会議発散役の案）は**採用しない**。理由は§5参照。静的チェックに留める方がCI時間・複雑性のバランスが良い。
- **検証方法**: `server.url`をhttpに書き換えたテスト用configでfailすることを確認。

---

### タスク5（中）: `release-bump.mjs` のSWキャッシュ不一致を warn から fail 相当の可視化に強化

- **目的**: 地雷マップで指摘された「regexが不一致でも警告止まりで気づかれない」問題。完全なマニフェスト方式への置き換え（会議発散役の案D）は影響範囲が広く今回はコスト対効果が合わないため見送るが、**気づけるようにする**改善だけ先に入れる。
- **対象ファイル**: `templates/scripts/release-bump.mjs`（122-125行目のwarnブロック）
- **実装方針**:
  - warnメッセージの露出を強化するだけでなく、`release-bump.mjs`の終了コードに集計を反映：SW警告が出た場合は`process.exitCode = 0`のままだが、`release-history/<version>.json`の雛形に`sw_cache_bump_skipped: true`のフィールドを追加し、`lint-pre-submission.mjs`側でこのフィールドを見て「直近のbumpでSW警告が出ていないか」をCHECK 14として拾う。
  - これにより「bump時は警告が埋もれても、submit前のlintで拾われる」の2段構えになる。
- **検証方法**: sw.jsのCACHE_NAMEパターンを意図的に崩し、`release-bump.mjs`実行後に`release-history/<version>.json`の`sw_cache_bump_skipped`がtrueになること、続く`lint-pre-submission.mjs`がそれを検出することを確認。

---

### タスク6（中）: `app.config.json` の継承構造（ベース＋デルタ）は**今回は見送り、代わりにplaceholder検出の強化のみ行う**

- **目的**: 会議発散役の「config継承構造」案は筋が良いが、既存の`setup-new-app.mjs`の`REQUIRED`配列と`PLACEHOLDER`検出ロジックが既に「未設定値を落とす」役割を十分果たしている。継承構造を今から導入すると、既存の全アプリ（コピー済みの成果物リポ）に影響する破壊的変更になる。**投資対効果が低いため今回は見送る**。
- **代替の小さい改善**: `setup-new-app.mjs`の`REQUIRED`配列に、地雷マップで実際に問題になった項目（`contact.phoneE164`の実在確認は形式チェックのみ可能、実在確認はできない旨をコメントで明記）を追加し、B6（電話番号プレースホルダ）を新規アプリ立ち上げ時点で検出できるようにする。
- **対象ファイル**: `templates/scripts/setup-new-app.mjs`（REQUIRED配列に`contact.phoneE164`を追加）
- **実装方針**: 既存の`isPlaceholder()`関数をそのまま利用。`+81 90 0000 0000`のような明らかなダミーパターン（`0000`の連続）を`PLACEHOLDER`正規表現に追加。
- **検証方法**: `+81 90 0000 0000`を設定した状態で`setup-new-app.mjs`がfailすることを確認。

---

### タスク7（低）: Playwright依存追加漏れ（B5）の検出を`setup-new-app.mjs`に追加

- **目的**: 地雷マップB5（`@playwright/test`が依存に無い）は、dry_runで検出できるとはいえ「新規アプリで毎回踏む」パターン。setup時点で検出すれば1サイクル分早く気づける。
- **対象ファイル**: `templates/scripts/setup-new-app.mjs`
- **実装方針**:
  ```
  const pkg = readJson('package.json');
  const hasPlaywright = pkg?.devDependencies?.['@playwright/test'] || pkg?.dependencies?.['@playwright/test'];
  if (!hasPlaywright && fs.existsSync('scripts/capture-appstore-screenshots.mjs')) {
    warn('@playwright/test が package.json に無い。`pnpm add -w -D @playwright/test` を実行してください(B5)');
  }
  ```
- **検証方法**: `@playwright/test`を除いた`package.json`でwarnが出ることを確認。

---

## 3. 意図的に自動化しない境界線

会議ハーネス（統括役・批判役）と地雷マップの両方が一致して示した境界線を、そのまま設計方針として採用する。

1. **ストアの最終審査提出ボタン相当の意思決定は自動化しない**（iOS配信地域の実際の選択、Android「審査に送信」ボタン、Chromeの初回アイテム作成）。
   - 理由: これらはAPIが提供されていないだけでなく、**提出した瞬間に課金・審査リソース消費・アカウントレピュテーションに影響する不可逆操作**。UIスクレイピングで無理に自動化すると、ストア側のUI変更で予告なく壊れるか、意図しない内容で誤送信するリスクの方が「手動の手間」より大きい。
2. **ASC UIでの「App プライバシー公開」ボタンは、検出はするが自動クリックしない**。
   - 理由: プライバシー公開は法的な意味を持つ宣言行為。内容の正確性を人間が最終確認すべき領域であり、CIが機械的に「公開」を押すと、誤った内容を確認なしに公開する事故につながる。タスク1のRead-Onlyチェックで「公開されているかどうかの検出」までに留める。
3. **Play Consoleのアプリのコンテンツ11項目は自動入力しない**。
   - 理由: 年齢制限・コンテンツレーティングに関わる質問群で、アプリの実態に応じた正確な自己申告が必要。誤った自動入力はGoogleのポリシー違反として扱われるリスクがある。
4. **デモアカウントの2FA設定は絶対に無効化しない**（会議発散役の「Guardian Account」案は明確に不採用、理由は§4）。
5. **審査回答文（却下対応の説明文）の自動生成・自動送信はしない**。地雷マップのstale値問題はデータの整合性チェックに留め、文面自体は人間が確認してから送る運用を変えない。

---

## 4. 不採用にした提案とその理由

会議ハーネスの発散役（groq/qwen3.6-27b）が出した案のうち、以下は明確に不採用とする。

| 提案 | 不採用理由 |
|---|---|
| **UIスクレイパー/コントローラー**（Playwright/PuppeteerでASC/Play Console/CWSのUIを直接クリック操作し、手動ゲートを"擬似自動化"する） | ストアの利用規約でUI自動操作が禁止/制限されている可能性が高く、アカウント停止リスクが実害として大きい。セッションが切れる・UI改修で壊れるなど保守コストも高い。地雷マップにある通り、ストアAPIの正規サポート範囲内で自動化するのが安全な境界線。 |
| **Guardian Account パターン**（CI専用に2FAを無効化したストアアカウントをHSM等に保管） | 2FA無効化はセキュリティのベストプラクティスに明確に反する。アカウント乗っ取りリスクとその際の被害（ストア掲載の改ざん・停止）が、自動化で得られる時間短縮に見合わない。不採用。 |
| **非公式APIへの直接HTTPパッチ**（ドキュメント化されていないエンドポイントを叩いて手動ゲートを回避する） | 地雷マップのASC APIのstale値問題自体が「公式API使用時ですら同期がズレる」ことを示している。非公式APIは変更告知なく壊れる前提で使うべきでなく、正規のAPIまたはUIに倒すのが正しい。不採用。 |
| **合成ネットワーク遅延注入によるWebView"Chaos Monkey"** | 発想自体はレジリエンステストとして妥当だが、このキットの規模（GitHub Actions上の単発リリースCI）に対して実装・保守コストが見合わない。タスク4の静的チェック（server.url/ATS設定の検証）で実質的に同じ事故クラスを防げるため、動的な障害注入は過剰実装と判断し見送る。 |
| **BrowserStack/Sauce Labsへのスクショ撮影全面移行** | 有料サービスへの依存を新たに追加することになり、「無料枠優先」というこのキット全体の思想（会議ハーネス自体が無料枠主体である点と整合）に反する。2FA対応が必要になったときの個別対応（デモアカウント側で2FAを使わない設定にする）の方が低コスト。 |
| **GitHub App化してOAuthクライアントを自動プロビジョニング** | Google Cloud ConsoleのOAuthクライアント作成はGoogle側にプログラム的な作成APIが無い（少なくとも一般公開されていない）。実現性が低く、地雷マップにある「デスクトップアプリ型を選ぶ」という手順を代替する土台が無い。不採用（実現性の問題）。 |
| **app.config.json のベース＋デルタ継承構造への全面移行** | 提案自体は筋が良いが、既存の全成果物リポへの影響が大きい破壊的変更。今回のスコープでは投資対効果が低いため見送り（タスク6で代替案を提示）。将来的に量産数が増えたら再検討候補として残す。 |
| **自然言語→LLMによるapp.config.json全自動生成＋ストアメタデータ自動生成** | ストアメタデータ（説明文・キーワード）はASO（ストア最適化）やポリシー適合の観点で人間のレビューが必要な領域。生成の補助（ドラフト作成）自体は有用だが、「人間はPRレビューのみ」という提案は境界線の後退にあたるため、今回のタスクリストには含めない。 |

---

## 5. リスクと軽減策

| リスク | 軽減策 |
|---|---|
| タスク1・2・3で追加するASC/Play API呼び出しが増えることで、API呼び出し回数制限やレスポンス遅延がlint実行時間を延ばす | 全て`skip`可能な設計にする（envのAppIDが無ければ即skip）。ローカル開発時の高速フィードバックを妨げないよう、GETのみでキャッシュ可能なものは`--cache`オプションで直近結果を再利用できるようにする(将来課題、今回は必須にしない)。 |
| Read-Onlyチェックの「fail」が多すぎて開発者が慣れてしまい、無視するようになる（アラート疲れ） | blockingにするのは「実際に事故実績があるもの」（contentRightsDeclaration・App プライバシー公開・cleartext server.url）に絞り、それ以外はwarnに留める（タスク1・4で明示した通り）。 |
| ASC/Play APIの認証情報（トークン）をlint実行時にローカル環境やCI以外の場所でも要求することになり、Secrets露出面が広がる | Read-Onlyチェックは既存のsubmitスクリプトが使っているのと同じ認証情報・同じスコープを再利用する。新しい種類のクレデンシャルは増やさない。ローカル実行時は`.secrets-local/`からの読み込みに統一し、`bootstrap-secrets.mjs`の既存運用に乗せる。 |
| タスク3（ASC stale値検出）が誤検知を頻発させ、正当な差分（今回のリリースで意図的にreviewer notesを変えた）まで警告してしまう | blockingにせずwarnに留める設計を維持。将来、誤検知が実際に多いと分かった場合のみ、直近のgit diffでenv側の値が変更されているかを見て「意図的な変更」かどうかを判定するロジックを追加検討する。 |
| 会議ハーネスの素材に混じっていた低品質/危険な提案が、今後別の担当者によって再提案される可能性 | 本設計書の§4に不採用理由を明記して残す。次に同じお題で会議を回すときも、このセクションを地雷マップとして参照できるようにする。 |

---

## 6. 実装順序の推奨（着手ガイド）

1. タスク1（ASC UI手動項目のRead-Only検証）→ 最も実績のある事故（B7/B8）を防ぐため最優先。
2. タスク4（Capacitor WebView黒画面の静的チェック）→ 実装コストが低く、既存のGOLDEN-RULESドキュメントをコード化するだけ。
3. タスク7（Playwright依存漏れ検出）→ 実装コストが最も低い（数行）。
4. タスク2（setup-new-appの完了確認）→ タスク1のAPIクライアントを再利用できるため、1の後だと楽。
5. タスク3（ASC stale値検出）・タスク5（SWキャッシュ警告の可視化強化）→ 中優先度、時間があるときに。
6. タスク6（placeholder検出強化）→ 低コストなのでいつ着手してもよいが、優先度は最低。

---

*この設計書は次の実装フェーズにそのまま渡せる。実装担当モデルは、まず対象スクリプトを読み、既存の`ok`/`fail`/`warn`/`skip`パターンと`readJson`/`readFile`ヘルパーを再利用してタスクを実装すること。新規ロジックのために独自のログ関数やJSON読み込みを再発明しない。*

---

## 7. 実装結果（2026-07-02 完了）

全7タスクを実装済み。設計時の想定と実装で変わった点を正直に記録する（次に触る人のため）。

### CHECK 番号の実マッピング（`lint-pre-submission.mjs`）
設計では「CHECK 9〜14」と仮置きしたが、実装は既存 CHECK 1〜8 の後に以下を追加した:
- **CHECK 9** = Capacitor 黒画面/ATS 静的チェック（タスク4）
- **CHECK 10〜13** = ASC Read-Only（タスク1: contentRights / App プライバシー公開 / 配信地域、＋タスク3: reviewer デモ値 stale）
- **CHECK 14** = SW キャッシュ bump スキップ検出（タスク5）
- タスク7（Playwright B5）は lint ではなく `setup-new-app.mjs` に実装（capture スクリプトがある時だけ warn）。
- タスク6（電話ダミー）も `setup-new-app.mjs`。タスク2は独立スクリプト `verify-manual-setup-done.mjs`。

### 設計から変えた実装判断
1. **App ID は新 env（`ASC_APP_ID`）を作らず、`identity.bundleId` から `findApp` で解決**。他の全 ASC スクリプトと統一。設計の擬似コードにあった `ascGet('/v1/apps/{id}')` 直叩きはやめ、既存 `makeAscClient`/`findApp` を再利用。
2. **配信地域のエンドポイント**: 設計の `/v1/apps/{id}/availableTerritories` は **deprecated**（fastlane #21968）。正: `/v1/apps/{id}/appAvailabilityV2` → `/v2/appAvailabilities/{id}/territoryAvailabilities`。
3. **App プライバシー公開（B8）は JWT では読めないのが正常**（`appstore-submit.mjs` の `ensurePrivacy` を精読して確定）。dataUsage 系は iris API + web セッション cookie 専用。よって CHECK 11 は「読めない=warn（未公開扱いにしない）」に倒す。エンドポイントも submit と同一の `${base}/apps/{id}/dataUsagePublishState`（単数・3ホスト base プローブ）に合わせた。
4. **B7/B8 は submit 時に自動修復される**（`ensureContentRights`/`ensurePrivacy`/`ensureCategory`）。lint の役割は「最後の砦」ではなく **早期警告**。この位置づけを実装コメントに明記。
5. **fail の精緻化** = 「findings は止める / availability は止めない」。API 到達不能・404・想定外形状は false fail を出さず warn。ローカルのネット断で提出全体を止めない。
6. **Capacitor は真実の源 `capacitor.config.ts`** をテキスト走査（`.json` fallback）。`{{...}}` プレースホルダは skip（GOLDEN-RULES 原則2）。設計の擬似コードは `.json` 前提だった。
7. **タスク5 は2段構え**: `release-bump.mjs` が `release-history/<v>.json` に `sw_cache_bump_skipped` を記録 → lint CHECK 14 が拾う。
8. **タスク6 の電話ダミー検出は電話フィールド専用**（`isDummyPhone`）にして、`isPlaceholder` に `/0{4,}/` を足して全フィールドに誤爆させることを回避。
