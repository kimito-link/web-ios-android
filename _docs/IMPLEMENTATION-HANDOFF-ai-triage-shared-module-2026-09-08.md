# 実装ハンドオフ: henshin-hisho / gmail-secretary-extension 共通ロジック抽出

- 設計: 司令塔。日付: 2026-09-08
- この1枚だけで着手できる粒度。実装は行っていない（次チャット/別モデルの仕事）

## A. 読む順

1. 本ファイル
2. `_docs/DESIGN-ai-triage-shared-module-2026-09-08.md`（設計全文）
3. `henshin-hisho/backend/src/triage.js`・`draft-gen.js`（抽出元1）
4. `gmail-secretary-extension/sw/features/gmail-inbox/triage.js`・`draft-gen.js`（抽出元2）
5. `ai-hub/bin/rollout-workflow.mjs`（配布ツール、`--repo`オプションの使い方を確認）
6. `_docs/instruments/check-drift.mjs`の`PAIRS`定義部分

## B. スコープ（MVP）

1. `web-ios-android/templates/shared/ai-triage/json-repair.mjs`を新設
2. `web-ios-android/templates/shared/ai-triage/draft-tone.mjs`を新設
3. `rollout-workflow.mjs`で両リポジトリへ配布（PRの形、mainへ自動マージしない）
4. 両リポジトリの`triage.js`・`draft-gen.js`から重複関数を削除し`import`に置き換え
5. `check-drift.mjs`の`PAIRS`に4組登録

**やらないこと**: `risk-gate.js`は触らない（別物と確定済み）。CIでの自動同期化は次段。

## C. 着手手順

### C-1. `json-repair.mjs`の作成

`henshin-hisho/backend/src/triage.js`から以下をそのまま抽出する（gmail拡張側と
ロジックが完全一致することを確認済み、命名は henshin-hisho 側に統一する）:

```js
// templates/shared/ai-triage/json-repair.mjs
// AI応答のJSONが途中で切れた場合に修復する、外部依存ゼロの純粋関数群。
// henshin-hisho/backend/src/triage.js と gmail-secretary-extension の
// sw/features/gmail-inbox/triage.js に別々にコピーされ、コピー後に片方だけ
// バグ修正・機能追加が入って乖離が進んでいた（2026-09-08発見）。共通化の対象。

export function scanJsonFragment(text) { /* 元のtriage.js 38-59行目をそのまま */ }
export function closeOpenJsonStructures(text) { /* 元の61-68行目 */ }
export function canParseJson(text) { /* 元の70-77行目 */ }
export function repairCandidate(fragment) { /* 元の79-92行目 */ }
export function repairTruncatedJson(fragment) { /* 元の94-105行目 */ }
export function extractTriageJson(value) { /* 元の107-135行目 */ }
export function isRescueNeeded(triage = {}) { /* 元の196-200行目 */ }
```

（実際のコード全文は`_docs/DESIGN-ai-triage-shared-module-2026-09-08.md`に
`scanJsonFragment`の実例あり。他の関数は`henshin-hisho/backend/src/triage.js`を
直接読んで転記する。gmail拡張側の`canParseJson`は同リポでは`tryParseJson`という
命名だが、ロジックは同一なので、統一名`canParseJson`をexportする）

### C-2. `draft-tone.mjs`の作成

```js
// templates/shared/ai-triage/draft-tone.mjs
// 返信下書き生成のトーン定義。henshin-hishoとgmail-secretary-extensionで
// 完全一致する定義が別々にコピーされていた（2026-09-08発見）。

export const DRAFT_TONE_INSTRUCTIONS = Object.freeze({
  polite: '丁寧に',
  firm: 'はっきり強めに、ただし攻撃的にしない',
  calm: '冷静に感情を抑えて',
  casual: 'いつもの砕けた調子で'
});

export function pickTone(value) {
  return Object.prototype.hasOwnProperty.call(DRAFT_TONE_INSTRUCTIONS, value) ? value : 'polite';
}
```

### C-3. 配布

```bash
node ai-hub/bin/rollout-workflow.mjs \
  web-ios-android/templates/shared/ai-triage/json-repair.mjs \
  backend/src/shared/json-repair.mjs \
  --repo kimito-link/henshin-hisho --apply

node ai-hub/bin/rollout-workflow.mjs \
  web-ios-android/templates/shared/ai-triage/json-repair.mjs \
  sw/features/gmail-inbox/shared/json-repair.mjs \
  --repo kimito-link/gmail-secretary-extension --apply
```

（`draft-tone.mjs`も同様に2回。★配置先パスは実装時に各リポジトリの既存構成
= `henshin-hisho/backend/src/`直下がフラットな構成であること、
`gmail-secretary-extension/sw/features/gmail-inbox/`配下の慣習、を確認してから
決めること。上記パスは設計時点の推測であり断定しない）

★`gmail-secretary-extension`は現時点でGitHubリモートURLが空欄（台帳未確認、
本セッションで新規登録した際も`url: ""`のまま）。実装前に実際のGitHub URL・
リポジトリの公開状態を`gh repo view`等で確認すること。

### C-4. 呼び出し元の書き換え

`henshin-hisho/backend/src/triage.js`: 抽出した7関数の定義を削除し、
```js
import {
  scanJsonFragment, closeOpenJsonStructures, canParseJson,
  repairCandidate, repairTruncatedJson, extractTriageJson, isRescueNeeded
} from './shared/json-repair.mjs';
```
に置き換える。`extractTriageJson`・`isRescueNeeded`はexportされたまま使われ続ける
（他ファイルからimportされている可能性があるため、削除ではなく再exportも検討）。

gmail拡張側・`draft-gen.js`側も同様のパターンで書き換える。

### C-5. ドリフト検知の配線

`check-drift.mjs`の`PAIRS`（配列またはオブジェクト、実装時に既存の書式を確認）に:
```js
{
  source: 'web-ios-android/templates/shared/ai-triage/json-repair.mjs',
  copies: [
    '../henshin-hisho/backend/src/shared/json-repair.mjs',
    '../gmail-secretary-extension/sw/features/gmail-inbox/shared/json-repair.mjs'
  ]
}
```
（`draft-tone.mjs`も同様に1組追加。計2組、C-3で配置先パスが変わった場合はここも合わせる）

## D. 動作確認

1. 両リポジトリで既存のテスト（あれば）を実行し、triage/draft-gen機能が壊れていないこと
2. `henshin-hisho`側で実際にメールをtriageし、JSON修復が正しく動くケース
   （わざと途中で切れたJSONを与える等）をテストする
3. `check-drift.mjs`を実行し、新規登録した2組のPAIRSが正しく検知されること
   （わざと片方だけ書き換えてドリフト検知が働くか確認するのが望ましい）

## E. 機械的な完了判定

- [ ] `templates/shared/ai-triage/json-repair.mjs`・`draft-tone.mjs`が存在し、
      外部依存（import）がゼロであること
- [ ] 両リポジトリへのPRが作成され、既存の重複コードが共有モジュールへの
      importに置き換わっていること（マージは各リポジトリの持ち主が判断）
- [ ] `check-drift.mjs`のPAIRSに2組登録され、`npm run diagnostics`で検知されること
- [ ] `risk-gate.js`には一切手を加えていないこと

## F. 地雷

1. `callLLM`のシグネチャ差異（henshin-hisho vs gmail拡張）は今回の共通化範囲に
   影響しない（純粋関数のみ抽出のため）が、C-4の書き換え時に誤って`callLLM`呼び出し
   部分まで共通化しようとしないこと
2. `normalizeText`は共通化しない（各リポジトリの既存実装をそのまま使う）
3. `gmail-secretary-extension`のGitHubリモートURLが未確認のまま。実装前に必ず確認
4. `rollout-workflow.mjs`は配置先に既にファイルがあるとスキップする既定動作。
   再配布時は`--update`フラグが必要

## G. 関連ファイル（実在確認済み・司令塔が実測）

- `henshin-hisho/backend/src/triage.js`・`draft-gen.js`
- `gmail-secretary-extension/sw/features/gmail-inbox/triage.js`・`draft-gen.js`
- `ai-hub/bin/rollout-workflow.mjs`
- `web-ios-android/_docs/instruments/check-drift.mjs`
- `_docs/DESIGN-ai-triage-shared-module-2026-09-08.md`
