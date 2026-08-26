# 設計: kimito-skill.link を「全作業の玄関」に、ai-hub を「エンジン」にする統合設計

> 設計 = Fable（claude-fable-5サブエージェント） / 素材集め = 無料会議ハーネス（5体召集・4体有効回答） /
> 裏取り = 司令塔（Claude、実ファイル・実コマンド実行で確認済み） / 日付 = 2026-08-26 /
> council-fableスキルの3段構え手順2の産物

## この設計に至った経緯

ユーザー（りんく）が「あちこちのセッションでやったことを、ここ（web-ios-android）に集約したい」
と述べ、対話の中で「web-ios-androidという名前・フォルダのまま、中身を全作業の集約先に作り変える」
ことを希望した。

調査したところ、`github/ai-hub/`という**既に実装済み・稼働中**の薄い統合レイヤーが存在していた
（`node ai-hub/bin/hub.mjs doctor`実行で実際にドリフト検知・未インデックス資産50本を列挙する
動作を確認済み）。ユーザーは「ai-hubはURLが無いという認識なので、存在自体忘れていた」と述べ、
これが今回の設計の核心的な制約になった——**技術的な優劣ではなく、URLを持ちブラウザで日常的に
開く習慣があるかどうかが、実際に使われ続けるかを左右する**。

無料会議ハーネス（5体召集・4体有効回答）にかけたところ、統括役は「ai-hubをweb-ios-android配下へ
移動」を提案したが、批判役は「npm依存・git submoduleとして参照しているプロジェクトがあり、移動は
破壊的変更になる」と反論した。司令塔が実際に`github/`配下の全`package.json`と`.gitmodules`を
検査したところ、**この懸念は事実として存在しなかった**（ai-hub自身以外にnpm依存なし、
submoduleなし。実参照は`github/CLAUDE.md`と`kimitolink-linktree/CLAUDE.md`の2ファイルの
素朴なパス参照のみ）。この裏取り結果をFableに渡し、深い設計を依頼した。

## 確定した事実（実ファイル・実コマンドで裏取り済み）

- `ai-hub/bin/hub.mjs`は自分の設置場所から`../`をたどって`GITHUB_ROOT`を導出している
  （`AIHUB_DIR = resolve(__dirname, '..')` → `GITHUB_ROOT = resolve(AIHUB_DIR, '..')`）。
  index.json の48エントリ全パスが`github/`相対で書かれており、**移動すると全パス解決が壊れる**
- `github/`配下の全`package.json`を検査した結果、ai-hub自身以外にnpm依存として参照している
  プロジェクトはゼロ、`.gitmodules`によるsubmodule参照もゼロ
- 実参照は`github/CLAUDE.md`（横断入口としての案内）と`kimitolink-linktree/CLAUDE.md`
  （絶対パス参照）の2ファイルのみ
- `web-ios-android/package.json`の35本のnpm scriptは全てリポルート相対パスで動作しており、
  `templates/`参照が22箇所ある
- **`package.json`に旧ドメイン（`web-ios-android.vercel.app`）参照が4箇所残っている**
  （`instrument:site`・`security:score`・`shindan`・`shindan:update`）。先の`site/`内160箇所の
  置換では見落としていた既存の実損——計器が偽の緑を測り続ける状態

## 設計の核心判断（Q1: 移動しない）

**ai-hubは正本のまま1バイトも動かさず、web-ios-androidが「URL付きの窓口」を被せる。**

判断根拠:
1. `hub.mjs`のパス自己解決が壊れる（上記）
2. index.jsonが指す資産は15リポ以上に横断しており、1製品リポの配下に入れると「正本1つ」の
   意味が濁る
3. ユーザーの真の課題は「場所」ではなく「URLが無い＝視界に入らない」。移動はこの課題を解かない
4. 動かさなければ、参照している2ファイルすら無修正で済む

「web-ios-androidの中身を全作業の集約先に作り変える」という希望は、**`site/`（＝
kimito-skill.link）のレベルで実現する**。リポのフォルダ構造ではなく、URLの下に全作業が
集約される。

---

# A. 理想の体験フロー

朝、`https://kimito-skill.link/hub/`を開くと:
1. 作業ジャンルの棚（アプリ提出／LINE bot／動画・SNS／横断計器）が、ai-hub/index.jsonのタグで
   自動グルーピングされて並ぶ
2. 最後の`doctor`実行結果と、**この地図が何日前のものかという鮮度スタンプ**が表示される。
   古ければ画面自体が警告し、直すコマンドが表示される
3. 各エントリにコピペ可能なコマンドが付き、「見た→Claude Codeに貼る」が1動作で繋がる

AI側の入口は従来どおり`github/CLAUDE.md` → `ai-hub/CLAUDE.md` → `hub.mjs find/doctor`。
**人間はURLを見て、AIはCLIを叩く。両者が同じindex.jsonを見ている**（見え方が2つ、正本は1つ）。

---

# B. 統合アーキ

## 最終レイアウト（動くものは動かさない）

```
github/
  ai-hub/                        ← 【不動】エンジン。index.json＝資産の唯一の正本
    bin/hub.mjs                  ← 【不動】find / doctor
    index.json                   ← 【追記のみ】LOCAL_LLM系KB等のエントリ追加
    CLAUDE.md                    ← 【追記1行】人間向け窓口はkimito-skill.link/hub/
  web-ios-android/               ← 【名前・既存構造そのまま】玄関＋アプリ提出キット
    scripts/
      generate-hub-dashboard.mjs ← 【新設】../ai-hub/index.json + doctor --json → site/hub/ 生成
      check-hub-page-freshness.mjs ← 【新設】生成物の鮮度計器（14日超で警告・--selftest付き）
    site/
      hub/                       ← 【新設・生成物】index.html + hub-data.json（正本ではない）
      _headers                   ← 【新設】/hub/* に X-Robots-Tag: noindex
    templates/ _docs/ ほか        ← 【一切触らない】アプリ提出キット・計器11件はそのまま
  CLAUDE.md                      ← 【追記2行】役割分担の明文化
```

**「正本を分けない」との整合**: `site/hub/hub-data.json`はビルド成果物であり第2の正本ではない。
既にこのリポが実践している型（`site/check-shindan-version/`）と同じパターン。生成物には
`generatedFrom: "ai-hub/index.json"`と生成時刻を焼き込み、手編集禁止をヘッダコメントに明記する。

---

# C. 具体機構（実装手順・この順で）

1. **`scripts/generate-hub-dashboard.mjs`を新設**（`templates/`ではなく`scripts/` —
   配布物ではなくこのリポ固有のため）:
   - `../ai-hub/index.json`をRead、`node ../ai-hub/bin/hub.mjs doctor --json`をchild_processで
     実行（cwdは`github/`、日本語パスは引用符、PowerShellを経由しない — 純Node）
   - タグ→棚のマッピング（`ios/android/store-review`→アプリ提出、`line`→LINE bot、
     `gate/verify`→計器、他→横断知見）でエントリをグルーピングし、`site/hub/index.html`と
     `site/hub/hub-data.json`を出力
   - ai-hubが見つからない場合は**exit 1で止める**（fail-closed。黙って空ページを作らない）
   - 既存規約に沿い`--selftest`を実装
2. **`scripts/check-hub-page-freshness.mjs`を新設**: `site/hub/hub-data.json`の生成時刻が
   14日超ならexit 2（警告）＋直すコマンドを表示。`--selftest`付き
3. **package.jsonに追記**:
   ```json
   "hub:page": "node scripts/generate-hub-dashboard.mjs",
   "hub:page:selftest": "node scripts/generate-hub-dashboard.mjs --selftest",
   "check:hub-freshness": "node scripts/check-hub-page-freshness.mjs",
   "deploy:site": "npm run hub:page && npm run shindan:update && node templates/scripts/deploy-cloudflare-pages.mjs --dir site"
   ```
   デプロイのたびにダッシュボードが必ず再生成される配線
4. **`site/_headers`を新設**: `/hub/*`に`X-Robots-Tag: noindex`（G-1参照）
5. **`site/index.html`のヘッダnavに`/hub/`へのリンクを1本追加**
6. **ai-hub/index.jsonに追記**（移動ではなく登録）: `LOCAL_LLM_OFFLOAD_MEASURED.md`
   （tags: `local-llm,ollama,offload`）、および新設2スクリプトを先回りで登録し、doctorが
   緑になるまで締める
7. **CLAUDE.md 3ファイルに追記**:
   - `github/CLAUDE.md`: 「人間の入口はhttps://kimito-skill.link/hub/」
   - `ai-hub/CLAUDE.md`: 窓口URL1行＋予約コマンドに`ask`
   - `web-ios-android/CLAUDE.md`: 「このリポは①アプリ提出キット②kimito-skill.linkの玄関の2役。
     横断知見の正本は../ai-hub」
8. `npm run hub:page && npm run claims:provenance && npm run deploy:site` →
   ブラウザで実際に開いて確認

`kimitolink-linktree/CLAUDE.md`は**無修正**（ai-hubが動かないので絶対パス参照は生きたまま）。

---

# D.「忘れない」ための仕掛け（2つだけ選んだ）

1. **デプロイ結合＋LP導線**（新しい習慣ゼロ）: `deploy:site`に`hub:page`を鎖で繋いだので、
   サイトを触るたびにダッシュボードが勝手に最新化される。今日一日「ブラウザでkimito-skill.linkを
   何度も開いた」という**既にある習慣**の上に乗る
2. **鮮度計器**（ページ自身が古さを自己申告する）: `check:hub-freshness`を既存の計器ファミリに
   加え、ダッシュボード自体にも「この地図は◯日前」と表示。「URLはあるが中身が化石」という
   第二の忘却を殺す

**捨てた仕掛け**: セッション開始時のブラウザ自動オープン（毎回開くのは邪魔になり無効化される
運命）／GitHub Actions日次ダイジェスト（doctorはローカルの`github/`全体が同一ディスクにある
ことを前提とし、Actionsランナーには姉妹リポが無く、嘘の緑を吐くか全リポpushの重装備になる）。

---

# E. ローカルLLMの接続点（フックのみ・今日は作らない）

1. **知見の登録**（C-6で実施）: `LOCAL_LLM_OFFLOAD_MEASURED.md`をindex.jsonにkb登録。これで
   「ローカルLLMで何ができるか」が`hub.mjs find --tag local-llm`で引ける
2. **予約コマンド`hub.mjs ask`の規約だけ書く**（ai-hub/CLAUDE.mdの既存「予約コマンド」節に
   1行追加）: 将来像は「findの結果パスを文脈としてローカルLLMに渡して要約・回答させる」。
   **hubはOllamaを直接常駐させない**（既存設計のVRAMスワッシング原則を継承）
3. ダッシュボードの「ローカルLLM」棚は、このkbエントリへのリンクを表示するだけ。チャットUIは
   作らない（静的Cloudflare Pagesにバックエンドは無く、今回のスコープ外）

---

# F. 捨てた案と理由

1. **統括役案: `packages/ai-hub-core/`への移動＋`apps/app-store-submit/`への再構成** — 却下。
   (a) hub.mjsのGITHUB_ROOT自己解決が壊れる。(b) web-ios-androidの再構成はpackage.jsonの
   35 npm script・templates/参照22箇所・配布先9リポからのパス前提・今日監査したばかりの
   計器11件を全部道連れにする。**今日動いたものを明日壊す再構成に、ユーザー価値が1つも無い**
2. **批判役の「npm依存・git submoduleが壊れる」懸念** — **司令塔が実地検証済みで、この事象は
   このコードベースに存在しない**。この誤った懸念を根拠にsymlink／npm workspace／互換shimを
   積むのは過剰設計であり、全て不採用
3. **シンボリックリンク／npm link案** — Windowsのsymlinkは管理者権限/開発者モード依存。
   かつ動かさない以上リンク自体が不要
4. **GitHub Actions定期ダイジェスト** — doctorの前提（ローカル横断ディスク）と衝突。虚偽の緑を
   量産する装置になる
5. **ローカルLLMチャットUI付きライブダッシュボード** — 前半（動かさず窓口を被せる）だけ採用し、
   ビルド時静的生成に格下げ。index.jsonがローカルディスクにある以上ランタイム読み込みは
   そもそも不可能で、公開APIにするのは情報露出を広げるだけ
6. **ai-hubの廃止・作り直し** — doctorは今日も未インデックス資産50本を列挙して価値を出している。
   164行・依存ゼロの動く道具を捨てる理由が無い

---

# G. 地雷と回避策

1. **★最重要: kimito-skill.linkは公開LPである。内部ダッシュボードを同居させると内部リポ名・
   スクリプトパス・ドリフト状況がインターネットに公開される**。回避:
   (a) `site/_headers`で`/hub/*`に`X-Robots-Tag: noindex`＋sitemap.xmlに載せない
   (b) 本丸は**Cloudflare Accessを`/hub/*`に手動設定**（無料枠で可・GUI操作のため自動化不可。
   ユーザーへの手順提示が必要）。Access設定までの間は(a)のみで公開される前提で、生成器は
   **パスと件数だけを出し、KB本文・エラー実文言・triggersは出さない**仕様にする
2. **`npm run claims:provenance`が新ページを撃つ**: ダッシュボードは数値だらけ（警告◯件等）。
   回避: 生成器が各数値の直近に出典コメントを機械的に焼き込む。実装後に必ず
   `claims:provenance`を実行して緑を確認
3. **hub.mjsは動かせない**: 生成器側からは「hub.mjsをimportしない・child_processで叩くだけ」
   を守る
4. **`verify-internal-links`/サイト系計器の巻き込み**: `site/hub/index.html`は既存の
   リンク検査・レスポンシブ検査の走査対象に入る。実装後`links:external`系も回す
5. **既存ドリフトの発見（今日のドメイン移行の取り残し）**: package.jsonの`instrument:site`／
   `security:score`／`shindan`／`shindan:update`が旧`https://web-ios-android.vercel.app`のまま
   （実ファイルで確認済み・4箇所）。本移行と同時に`https://kimito-skill.link`へ更新すべき
   （さもないと計器が旧URLを測り続ける偽緑）
6. **OneDrive同期ロック**: 生成は一時ファイル→renameの原子的書き込みにするか、少なくとも
   失敗時に部分書き込みを残さない
7. **doctorが新スクリプトを警告してくる**: `check-hub-page-freshness.mjs`はdoctorの
   未インデックス資産スキャンに引っかかる。C-6のとおり作成と同時にindex.jsonへ登録して
   doctor緑で締める
8. **生成物の手編集事故**: `site/hub/`はコミットされるため、後続セッションが直接編集しかねない。
   生成HTMLの先頭コメントに「生成物・手編集禁止・正本はai-hub/index.json・再生成は
   npm run hub:page」を焼き込む
