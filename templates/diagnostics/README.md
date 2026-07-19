# diagnostics/ — 汎用コード診断キット

**どんなJS/TSプロジェクトにも使える、依存ゼロの出荷事故ゲート4本＋実行ランナー。**
web-ios-androidキット固有ではなく、`github/`配下のどのリポにも `node diagnostics/run.mjs <対象ディレクトリ>` を
実行するだけで使える。思想は [`../../docs/ai-rules/04_SELF_VERIFICATION.md`](../../docs/ai-rules/04_SELF_VERIFICATION.md) §5「工程ガード」の具体化。

## 使い方

```bash
# 4本まとめて実行（対象ディレクトリを省略するとcwd）
node templates/diagnostics/run.mjs /path/to/other-repo

# 1本だけ実行したいとき
node templates/diagnostics/check-lockfile-sync.mjs /path/to/other-repo
```

gitリポジトリでない・package.jsonが無い等、チェックの前提が対象に存在しない場合は
fail-closedではなく`skip`として扱う（対象外を機械的に確定できないものを赤にしない）。

## 中身

| スクリプト | 検出すること | 対応拡張子/前提 |
| --- | --- | --- |
| `../scripts/check-tracked-imports.mjs`（正本はこちら・コピーしない） | git未追跡ファイルへのimport（`git add`忘れ）。git clone直後(CI/Vercel)の実体を再現 | `.js/.mjs/.ts/.tsx/.jsx` |
| `check-lockfile-sync.mjs` | package.jsonとpackage-lock.jsonの依存不一致（lockfile更新忘れ） | npm(lockfileVersion 2/3、packages形式)。yarn/pnpmはskip |
| `check-secrets-not-tracked.mjs` | `.env`・鍵/証明書ファイル等の秘密情報が誤ってgit追跡されていないか | git管理下のみ |
| `check-large-tracked-files.mjs` | 巨大ファイル（既定5MB超）の誤追跡 | git管理下のみ。閾値は第2引数で変更可 |

## 設計方針

- **依存ゼロ**：すべてNode標準API（`node:fs`/`node:child_process`/`node:path`/`node:url`）のみ。対象リポに何もインストールしない。
- **正本を増やさない**：`check-tracked-imports.mjs`は`../scripts/`の既存実装をそのまま呼ぶ。diagnostics/にはコピーを作らない。
- **fail-closed、ただし前提が無ければskip**：「gitリポジトリでない」「package.jsonが無い」等はエラーでなく`skip`（対象外の確定）。実際に検査した上で問題ありなら`exit 1`。
- **純ロジックとI/Oの分離**：各スクリプトは`export function`で単体テスト可能な純粋関数を持ち、`isMain`判定時のみファイルシステム/gitに触れる（`check-tracked-imports.mjs`と同じ流儀）。

## 個別ページ

紹介ページ: [`../../site/features/diagnostics/`](../../site/features/diagnostics/index.html)（サイト内で「診断キット」の仕組みを説明する独立ページ）。
