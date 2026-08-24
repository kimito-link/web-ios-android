# LPと機能ページの同期ルール（AIが読む1枚）

> 目的: 機能ページ・診断・AI指示を更新したとき、一般向けLPから説明が消えないようにする。
> 2026-08-24にLPを「一般向けの短い入口」へ再構成したため、旧LPの番号付きSTEP指定は廃止。

## 1. 役割を混ぜない

- `site/index.html`: 一般の人が「何ができるか・自分は何をするか」を判断するページ。
- `site/ai-guide/index.html`: AIが読む順番・実行手順・安全境界・完了条件。
- `site/llms.txt`: AIが最短で読み取る機械向け概要。
- `site/features/health-check/index.html`: 診断・計器・進化・安全確認の詳しい説明。
- `site/check-shindan-version/`: 現在の実測結果と更新情報。
- `site/assets/data/ai-instructions.json`: 各機能をAIに実装させる指示文の正本。

## 2. 診断系機能の対応表

| 機能 | 一般向けLP | AI向け | 詳細・実測 |
|---|---|---|---|
| 診断・引き継ぎ・進化 | 「詳しい機能」の動作確認カード | `ai-guide/` と `llms.txt` | `features/health-check/` |
| 各アプリの進捗ページ | 「キットの更新・動作状況」 | 完了報告の確認URL | `check-shindan-version/` |
| malwarecheck.site満点チェック | `#security-title` の100点パネル | `npm run security:score` を完了条件に記載 | `features/health-check/#security-score` と診断ページの安全確認 |
| 起動画面（スプラッシュ）検査 | 「詳しい機能」の動作確認カード | `npm run splash:check` と実機目視を完了条件に記載 | `features/health-check/#splash-check` |

## 3. 更新時に同時確認するファイル

診断機能を変更したら、次を同じ変更単位で確認する。

1. `site/index.html` — 一般語で1〜3文の要約があるか。
2. `site/ai-guide/index.html` — 実行順・失敗時の扱い・完了条件があるか。
3. `site/llms.txt` — AI向けの短い規則があるか。
4. `site/features/health-check/index.html` — 制約と直し方を含む詳しい説明があるか。
5. `site/assets/data/ai-instructions.json` — コピーして使えるAI指示が最新か。
6. `templates/scripts/generate-shindan-version.mjs` — 実測結果が診断ページとLP要約へ出るか。
7. `site/sitemap/sitemap-manifest.json` — 詳細ページへの導線が実在するか。

## 4. セキュリティ満点の表示条件

「100点確認済み」と表示してよいのは、次の両方を同じ公開URLで実測した場合だけ。

- 内部先取りチェックが100点。
- `malwarecheck.site` 本体の公開診断が100点。

`--local-only`、自己テスト、スクリプトの存在確認だけでは「本体100点」と表示しない。
外部診断へ送るのは公開URLだけ。100点は外部から見える簡易診断の満点であり、安全性や感染の有無の保証ではない。

## 5. 検証

- `node scripts/verify-internal-links.mjs`
- `node scripts/verify-claims-coverage.mjs`
- `node templates/scripts/verify-security-score.mjs --selftest`
- `npm run splash:selftest`
- 公開後に `npm run security:score`
- `npm run shindan` で診断ページとLP要約を再生成

未計測・外部サービス停止・認証不足は、緑や完了へ丸めない。
