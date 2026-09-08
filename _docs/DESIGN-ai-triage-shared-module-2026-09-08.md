# 設計: henshin-hisho / gmail-secretary-extension の共通ロジック抽出

**状態: 設計完了・実装未着手。** 次のセッションがこのファイルを読み、
`IMPLEMENTATION-HANDOFF-ai-triage-shared-module-2026-09-08.md`（同じ`_docs/`配下、
着手手順を1枚にまとめた引き継ぎ書）を見ながら実装する。

- 設計: 司令塔（実ファイル全文を読んで裏取り済み。Fable委譲は規模に対して過剰と判断し直接設計）
- 日付: 2026-09-08
- きっかけ: ユーザーの「実態は、コピペで連携されなかったりしたんですよね」という指摘。
  実際に`henshin-hisho/backend/src/`と`gmail-secretary-extension/sw/features/gmail-inbox/`の
  `triage.js`・`draft-gen.js`を読み比べ、コピペ由来の重複を確認した
- 保存先の相互参照: 本ファイル（設計）→
  `IMPLEMENTATION-HANDOFF-ai-triage-shared-module-2026-09-08.md`（着手手順）→
  `MAP-github-root-cleanup-2026-09-08.md`のカテゴリJ（この作業がどの経緯で
  始まったかの全体地図）、の順に読むと文脈がつながる

## 用語（この文書だけで通じる略称の説明）

- **PAIRS**: このキットの`check-drift.mjs`が持つ「正本ファイルとそのコピー先」の
  対応表。1箇所を直したらもう1箇所も直す必要がある、という関係を機械が覚えておく仕組み
- **fail-closed**: 「分からない・確認できない」ときに「大丈夫」側へ倒さず、
  「要確認」「未実行」側へ倒す設計方針。今回で言えば「共通化してよいか判断できない
  コードは共通化しない」という判断がこれにあたる
- **rollout-workflow.mjs**: 1つのファイルを、複数のGitHubリポジトリへ
  「ブランチを切ってPRを作る」形で配布する既存のNode.jsスクリプト
  （`ai-hub/bin/`配下）。今回はこれを使い回す

## 事実（実測済み）

### triage.js の重複度

`scanJsonFragment`・`closeOpenJsonStructures`・`repairCandidate`・`repairTruncatedJson`
（henshin-hisho）/ 対応する同名関数（gmail拡張、一部命名違い: `canParseJson`↔`tryParseJson`）
は、フォーマット（改行・インデント位置）だけが違い、**ロジックは完全に一致**。

以下はhenshin-hisho側の実装（`henshin-hisho/backend/src/triage.js`）:

```js
function scanJsonFragment(text) {
  let inString = false;
  let escaped = false;
  const stack = [];
  const commas = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' && stack[stack.length - 1] === '{') stack.pop();
    else if (ch === ']' && stack[stack.length - 1] === '[') stack.pop();
    else if (ch === ',') commas.push(i);
  }
  return { inString, stack, commas };
}
```

gmail拡張側（`gmail-secretary-extension/sw/features/gmail-inbox/triage.js`）は同一ロジックを
改行を増やした書式で持つ。`extractTriageJson`・`isRescueNeeded`も同様に完全一致。

**片方だけ進化した証拠**（実測）:
- gmail拡張側だけ: `GMAIL_TRIAGE_RESCUE_MODEL`のモデル定数外出し、
  `enforceDailyLimitOrThrow`（日次利用制限）、`trackCost`（コスト計測）、
  Gemma系モデルの空白ループ対策コメント（`docs/GMAIL-TRIAGE-BUG-DESIGN.md`参照）
- henshin-hisho側だけ: `keywordRiskOverlay`（正規表現による高リスク語句検出）、
  `normalizeTriageResult`の`accountPolicy`連携

### draft-gen.js の重複度

`DRAFT_TONE_INSTRUCTIONS`（henshin-hisho）と`GMAIL_DRAFT_TONE_INSTRUCTIONS`（gmail拡張）は
**定義内容が完全一致**（polite/firm/calm/casual、日本語の指示文まで同一）:

```js
const DRAFT_TONE_INSTRUCTIONS = Object.freeze({
  polite: '丁寧に',
  firm: 'はっきり強めに、ただし攻撃的にしない',
  calm: '冷静に感情を抑えて',
  casual: 'いつもの砕けた調子で'
});
```

`pickTone`関数も両者ロジック一致。一方、プロンプト構築本体（`buildDraftPrompt`／
`buildGmailDraftPrompt`）は、henshin-hisho側が`accountPolicy`（値引き上限・最低受注額・
業種テンプレート等の会社ポリシー）を組み込む拡張を持ち、密結合しているため
**共通化の対象外**。

### risk-gate.js は別物（共通化しない）

henshin-hisho側は送信ゲート（`riskConfirmed`/`confirmSend`、LINE送信も対象）。
gmail拡張側（popup配下）はDOM挿入ゲート（`requiresInsertConfirmation`/`canInsertDraft`/
`gateWarnings`）。関数シグネチャ・責務ともに異なるため共通化対象から除外する。

### リポジトリ間の共有機構は存在しない

両リポジトリともpackage.jsonにworkspaces設定なし、外部ライブラリ依存ゼロ。
npm private registry・git submodule・monorepoいずれも未整備。

## 設計方針（案A: templates配下に共有ソース＋同期配布）

新しいリポジトリ・新しい常駐サービスは作らない。既存の`ai-hub/bin/rollout-workflow.mjs`
（GitHub Contents API + PRs APIで1ファイルを複数リポジトリへ配布する既存ツール）を、
`--repo`オプションでの個別呼び出しにより転用する。

### 共通化する範囲（確定）

| 抽出先ファイル | 内容 | 元の場所 |
|---|---|---|
| `templates/shared/ai-triage/json-repair.mjs` | `scanJsonFragment`・`closeOpenJsonStructures`・`canParseJson`・`repairCandidate`・`repairTruncatedJson`・`extractTriageJson`・`isRescueNeeded` | 両`triage.js`から抽出 |
| `templates/shared/ai-triage/draft-tone.mjs` | `DRAFT_TONE_INSTRUCTIONS`定数・`pickTone`関数 | 両`draft-gen.js`から抽出 |

**共通化しない範囲**（各リポジトリに残す）:
- `triage.js`の`keywordRiskOverlay`・`normalizeTriageResult`・`buildTriagePrompt`・
  `triageInboxItem`（ドメイン固有ロジック、`callLLM`呼び出し）
- `draft-gen.js`の`buildDraftPrompt`・`buildGmailDraftPrompt`・`generateDraftBody`・
  `generateGmailDraftBody`（accountPolicy・課金/利用量制限等の非対称ロジックを含む）
- `risk-gate.js`（両方とも、別物のため）

### 配置・契約

`templates/shared/ai-triage/*.mjs`は**外部依存ゼロの純粋関数のみ**を置く契約とする
（henshin-hisho=Cloudflare Workers、gmail-secretary-extension=Chrome拡張serviceworker、
という異なる実行環境の両方から`import`で問題なく読み込めるようにするため）。

### 配布方法

1. 初回: `templates/shared/ai-triage/json-repair.mjs`・`draft-tone.mjs`を作成
2. `ai-hub/bin/rollout-workflow.mjs`を`--repo`オプションで2回呼び出し、
   `henshin-hisho`・`gmail-secretary-extension`それぞれへPRの形で配布
   （配置先パスは各リポジトリの慣習に合わせる。例:
   `henshin-hisho/backend/src/shared/json-repair.mjs`、
   `gmail-secretary-extension/sw/features/gmail-inbox/shared/json-repair.mjs`）
3. 両リポジトリ側で、既存の`triage.js`・`draft-gen.js`から重複関数を削除し、
   `import`文に置き換えるPRを別途作成（このPRは各リポジトリのメンテナが内容を見て
   マージする。mainへの自動マージはしない）
4. 運用: まず手動同期（`rollout-workflow.mjs`を都度実行）から始める。将来的に
   同期頻度が高くなれば、CIフック化を検討する（今回はスコープ外）

### ドリフト検知の配線

`web-ios-android/_docs/instruments/check-drift.mjs`の`PAIRS`に、共有元
（`templates/shared/ai-triage/json-repair.mjs`・`draft-tone.mjs`）と配布先2箇所×2ファイル
（計4組）を登録する。これにより、今後どちらかのリポジトリで独自に手を加えて
ドリフトが生じても`npm run diagnostics`で検知できる。

## 捨てた案

- **案B（外部リポジトリからビルド時fetch）**: 新規リポジトリを増やすことになり、
  「新しい基盤を増やさない」という非交渉ルールに抵触するため不採用
- **案C（共通化せずPAIRS登録のみ）**: ユーザーが「共通モジュール化の設計まで進めてほしい」と
  明示的に選択したため不採用（ただし案Aが何らかの理由で実装困難と判明した場合の
  フォールバックとして記録しておく）
- **risk-gate.jsの共通化**: 実測の結果、送信ゲートとDOM挿入ゲートという別責務と判明したため
  最初から対象外とした

## 地雷（実装時に気をつけること）

1. **`callLLM`シグネチャの違いに注意**: henshin-hisho側は`{userPrompt, mode, maxTokensOverride, temperatureOverride}`、gmail拡張側はこれに`settings`/`testMode`/`isFreeTier`/`traceContext`が加わる。共通化対象の関数は`callLLM`を直接呼ばない（純粋関数のみ）ため影響なし
2. **`normalizeText`の実装元が違う**: henshin-hisho側は`./schema.js`から、gmail拡張側は
   `./types.js`から。共通モジュール側では`normalizeText`を含めない（各リポジトリの
   既存実装をそのまま使う）
3. **配置先パスは各リポジトリの既存ディレクトリ構成を壊さない**よう、実装時に
   両リポジトリの現状を確認してから決める
4. **`rollout-workflow.mjs`は「配置先に既にファイルがあればスキップ」が既定動作**。
   初回配布後の更新には`--update`フラグが必要（README・スクリプト内コメント参照）
