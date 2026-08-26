# 実装ハンドオフ: ai-hub統合ダッシュボード（kimito-skill.link/hub/）の実装

> この1枚だけで着手できる。設計の全文は
> [`DESIGN-ai-hub-consolidation-2026-08-26.md`](DESIGN-ai-hub-consolidation-2026-08-26.md)
> （同ディレクトリ）を先に読むこと。

## ★段階Aの完了が前提（2026-08-26追記）

この実装に着手する前に、「全ての能力を抜け漏れなく集約する」調査（同日実施）で判明した
**段階A（ai-hub/index.jsonへの追加登録・重複クラスタの整理）が完了している必要がある**。
理由: 段階Aを飛ばすと、当時のindex.jsonにはLINE bot棚・動画/SNS棚に該当するエントリが
0件で、生成したダッシュボードが公開初日から複数の棚が空のまま世に出てしまう。

段階Aの完了状態（2026-08-26時点）:
- `kb-line-bot-cloudflare-workers`（`templates/line-bot/README.md`）を登録済み
- 動画/SNS自動化（`ouenmovie`）・ローカルLLM実測ログは**登録できる安定資産が現時点で
  存在しないため未登録**（`ouenmovie`はハンドオフ文書のみで恒久的なKB/スクリプトが無い）。
  ダッシュボード生成時、これらの棚は意図的に「まだ整理中」と表示するか、棚自体を出さない
  設計にすること（空の棚をそのまま出さない）
- 重複クラスタ7件のうち3件は実はgit worktreeであり削除対象ではないと判明。ダッシュボードの
  「重複」表示ロジックを作る場合はworktreeを誤検出しないよう注意

## 最重要の前提（誤解しないこと）

**`ai-hub`（`github/ai-hub/`）は一切動かさない・1バイトも変更しない対象がほとんど**。
今回作るのは、web-ios-android側に「ai-hub/index.jsonを読んでURL付きの窓口を生成する」
仕組みを新設するだけ。ai-hub本体への変更は「index.jsonへのエントリ追加」と
「CLAUDE.mdへの1行追記」のみに限定する。

## スコープ（MVP。これ以上広げない）

1. `scripts/generate-hub-dashboard.mjs`（新規、web-ios-androidの`scripts/`直下）
2. `scripts/check-hub-page-freshness.mjs`（新規、鮮度計器）
3. `site/hub/`（生成物。手編集禁止）
4. `site/_headers`（noindex設定）
5. `package.json`への4本のnpm script追記
6. `ai-hub/index.json`への新規エントリ追加（LOCAL_LLM_OFFLOAD_MEASURED.md・新設2スクリプト）
7. CLAUDE.md 3ファイル（`github/CLAUDE.md`・`ai-hub/CLAUDE.md`・`web-ios-android/CLAUDE.md`）への追記
8. **併せて直す既存の実損**: `package.json`の旧ドメイン参照4箇所
   （`instrument:site`・`security:score`・`shindan`・`shindan:update`が
   `https://web-ios-android.vercel.app`のまま。`https://kimito-skill.link`へ更新する）

**`kimitolink-linktree/CLAUDE.md`は無修正。**

## 読む順

1. `_docs/DESIGN-ai-hub-consolidation-2026-08-26.md`（設計全文）
2. `../ai-hub/bin/hub.mjs`（164行。特に`GITHUB_ROOT`自己解決の仕組み、`doctor --json`の出力形式）
3. `../ai-hub/index.json`（既存48エントリのスキーマ・タグ体系を実際に見る）
4. `../ai-hub/CLAUDE.md`（既存の「予約コマンド」節、追記箇所を確認）
5. `site/check-shindan-version/`（「生成物・正本は別」パターンの実例。今回の`site/hub/`が
   模倣する型）
6. `templates/scripts/deploy-cloudflare-pages.mjs`（デプロイの実体。`deploy:site`に鎖で繋ぐ対象）
7. `scripts/verify-numeric-claims-provenance.mjs`（今回のダッシュボードが数値を出す以上、
   出典コメントの規約に従う必要がある。2026-08-26に日付鮮度判定機能も追加済み）

## 着手手順

1. ブランチを切る
2. `scripts/generate-hub-dashboard.mjs`から着手。まず`../ai-hub/index.json`をRead、
   `execFileSync('node', ['../ai-hub/bin/hub.mjs', 'doctor', '--json'], {cwd: <githubルート>})`
   で実行できることを確認してから、タグ→棚のグルーピングロジックを書く
3. ai-hubが見つからない場合はexit 1で止まることを確認（fail-closed）
4. `--selftest`を実装（毒: index.jsonが無い/壊れている場合の挙動、doctor実行失敗時の挙動）
5. `scripts/check-hub-page-freshness.mjs`を実装（毒: 生成時刻が14日超のフィクスチャで赤くなるか）
6. `site/_headers`を作成
7. package.jsonに4本のnpm script追記＋旧ドメイン4箇所を新ドメインへ更新
8. `ai-hub/index.json`に新規3エントリ追加（LOCAL_LLM_OFFLOAD_MEASURED.md・生成器・鮮度計器自身）
9. `node ../ai-hub/bin/hub.mjs doctor`を実行し、新規スクリプトが「未インデックス資産」警告に
   引っかからなくなったことを確認
10. `npm run hub:page`を実行し`site/hub/`が生成されることを確認
11. `npm run claims:provenance`を実行し、生成ページの数値主張に出典コメントが機械的に
    焼き込まれているか（緑になるか）確認
12. `npm run links:external`（もしくは`node templates/scripts/verify-external-links.mjs site`）
    で新規ページのリンク切れが無いことを確認
13. CLAUDE.md 3ファイルに追記
14. **Cloudflare Accessの`/hub/*`への設定はGUI操作のため自動化不可。ユーザーに手順を提示し、
    実際に設定してもらうこと**（設定完了まではnoindexのみで実質公開状態である旨も伝える）
15. `npm run deploy:site`でデプロイし、実際にブラウザで`https://kimito-skill.link/hub/`を
    開いて確認

## 機械的な完了判定

- `node scripts/generate-hub-dashboard.mjs --selftest` → exit 0
- `node scripts/check-hub-page-freshness.mjs --selftest` → exit 0
- `node ../ai-hub/bin/hub.mjs doctor` → 新規スクリプトが未インデックス警告に出ない
- `npm run hub:page` → `site/hub/index.html`と`site/hub/hub-data.json`が生成される
- `npm run claims:provenance` → exit 0（出典コメント漏れなし）
- `node templates/scripts/verify-external-links.mjs site` → drift無し
- ブラウザで`https://kimito-skill.link/hub/`を開き、作業ジャンルの棚・鮮度スタンプが
  正しく表示されることを確認

### ★リスク対応の完了判定（機械的チェックが緑でも、これを飛ばして「完了」と報告しないこと）

- [x] `site/_headers`に`/hub/*`への`X-Robots-Tag: noindex`が実際に反映されていることを
      2026-08-26、本番デプロイ後に`curl -I https://kimito-skill.link/hub/`で確認済み
      （レスポンスヘッダに`x-robots-tag: noindex, nofollow`を確認）
- [x] 生成された`site/hub/index.html`（実際のHTML）を目視し、KB本文・エラー実文言・
      triggersが出力されていない（パスと件数のみ）ことを2026-08-26に確認済み
- [ ] **Cloudflare Accessを`/hub/*`に設定するようユーザーに依頼する**（GUI操作、自動化不可。
      2026-08-26時点で未依頼。依頼済み・未設定の間はnoindexのみで実質公開状態であることを
      ユーザーに明示すること）
- [ ] 上記Access設定が完了したかをユーザーに確認する（未確認のまま作業完了報告をしない）

## 地雷（詳細は設計書G項）

- **最重要**: kimito-skill.linkは公開LP。`/hub/*`はnoindexだけでは不十分——**Cloudflare Access
  設定をユーザーに依頼すること**を忘れない。生成器はKB本文・エラー実文言・triggersを出力しない
  仕様にする（パスと件数のみ）
- `hub.mjs`は自分の設置場所からパスを自己解決しているため、**importしてはいけない**
  （child_processで叩くだけ）
- 生成ページは既存のリンク検査・claims検査・レスポンシブ検査の走査対象に入る。実装後は
  必ずこれらの検証を再実行する
- 生成物（`site/hub/`）の先頭コメントに「手編集禁止・正本はai-hub/index.json」を焼き込む
- 新規スクリプトは作成と同時に`ai-hub/index.json`へ登録し、`doctor`の未インデックス警告から
  漏れないようにする（harvestの掟）

## この設計を作った経緯（参考。実装には不要）

無料の会議ハーネス（5体召集）で素材集め→批判役が指摘した「npm依存/submodule破壊」懸念を
司令塔が実際に`github/`配下の全package.jsonを検査して「事実として存在しない」と裏取り→
その裏取り結果をFable(claude-fable-5)サブエージェントに渡して設計を委譲、という
`council-fable`スキルの3段構えで作られた。
