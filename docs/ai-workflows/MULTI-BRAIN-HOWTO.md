# 頭脳を増やす運用（マルチ頭脳）— 正本

> **今の到達点: 構築完了・実測済み・運用中（2026-09-14）。** 未確認事項は §10。
> **この1枚が唯一の正本。** コピーは作らない。
> 一言でいうと: **AIの頭脳を「本物のClaude 1つ」から「4つ」に増やし、Claudeの週間上限に縛られずに
> 量の仕事を並列で回す運用**。2026-09-09〜09-14 に OMEN（Windows / RTX 4070 Ti 12GB / RAM 80GB）で構築・実測。
> 賢さの最高到達点は変わらない（本物のClaudeが上限）。増えたのは **数と時間**。
>
> 対になる HOWTO: [`COUNCIL-HOWTO.md`](COUNCIL-HOWTO.md)（考える側＝会議）。本書は **手を動かす側**（実行の頭脳をどこから借りるか）。
> 秘密（APIキー等）は本書に書かない。鍵の所在は §7。

---

## 漫画で読む（りんく版・まずこれだけ見れば要点が分かる）

| 1. 頭脳を4つに増やした話 | 2. Qwen本家の無料枠を手に入れるまでの話 |
|---|---|
| ![4つの頭脳でパワーアップ](img/multi-brain-manga-1-four-brains.jpg) | ![先に無料で試す](img/multi-brain-manga-2-alibaba-free-tier.jpg) |
| 週間上限の警告 → 本物Claude / Qwen / Cloudflare / 自分のPC の4つに分担 → 外からも夜中も働く → 「かしこさは本物が一番。増えたのは数と時間」 | 89万円の機体に憧れる → 先に本家の無料枠（100万トークン・90日） → 登録の国は後から変えられない（最初に日本を選ぶ） → 同じ作業が自分のPC 2分 / Qwen本家 12秒 |

（2026-09-14、ChatGPT で生成。図中の「本物の Claude」のアイコンは生成物の都合で正確ではない。数字は §9 の実測）

---

## 0. まず貼る一言（別チャットに渡すとき）

> 「`web-ios-android/docs/ai-workflows/MULTI-BRAIN-HOWTO.md` を読んで、この運用の前提で進めて。
> 判断が要る仕事は本物のClaude、量の仕事は Qwen本家 / Cloudflare / ローカルに振り分けて。」

---

## 1. 4つの頭脳（使い分けの順番）

| 段 | 頭脳 | 費用 | 同じ作業（指示どおりファイルを1つ作る）の実測 | 使いどころ |
|---|---|---|---|---|
| 1 | **本物の Claude Code** | 契約の週間上限を消費 | — | 真因を探すデバッグ、設計判断、ストア却下対応。**失敗すると高くつく仕事だけ** |
| 2 | **Qwen 本家**（Alibaba Model Studio: `qwen3.8-flash` / `qwen3.8-max`） | 新規登録でモデルごと100万トークン無料・90日。以後は従量（flash は入力 $0.15/100万tok） | **12〜15秒・正答** | ふだんの仕事の主力。Claude Code の頭脳を差し替えて使う（CLAUDE.md・スキル・メモリがそのまま効く） |
| 3 | **Cloudflare Workers AI**（`@cf/qwen/qwen3.8-27b`） | 1日 10,000 ニューロン無料。超えたら止まる（課金されない） | **11秒・正答** | Alibaba の枠を温存したいとき。OpenCode から |
| 4 | **ローカル Ollama**（`qwen3.6:35b-a3b`） | 無料・無制限 | **2分・置き場所を誤る**（生成 20 tok/s） | 夜間バッチ、雑でも翌朝直せる量産。無料枠が切れたときの退路 |

迷ったときの順番: **判断が要る→1 ／ 方針は決まっていて手数が多い→2 ／ 2の枠を節約したい→3 ／ 急がず量だけ→4**。

「Alibaba Model Studio」= Qwen を作っている Alibaba Cloud の AI サービス。OpenAI 互換と Anthropic 互換の両方の口がある。
「OpenCode」= 無料のオープンソース版 Claude Code（好きなモデルを差し替えられる）。「Ollama」= 自分のPCでモデルを動かす土台。

---

## 2. 起動口（OMEN のデスクトップに置いてある）

| ファイル | 中身 |
|---|---|
| `claude-qwen.cmd` | **本命**。Claude Code の接続先を Alibaba の Anthropic 互換 API に向ける（`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`）。`MODEL` 行を `qwen3.8-max` に変えると上位モデル |
| `claude-local.cmd` | 同じ仕組みで Ollama（`http://127.0.0.1:11434`）に向ける |
| `opencode-qwen.cmd` / `opencode-cf.cmd` / `opencode-local.cmd` | OpenCode を各頭脳で起動 |
| Open WebUI `https://chat.kimito-link.com` | スマホ／外出先用のチャット画面。モデル一覧に `ali.*`（Alibaba）`cf.*`（Cloudflare）ローカルが並ぶ。Cloudflare Tunnel 経由、Cloudflare Access のメール認証付き |

**PowerShell で起動するとき**: `& "C:\...\claude-qwen.cmd"` のように **先頭に `&`** を付ける。引用符付きパスをそのまま打つと
「文字列を表示しただけ」で何も起きない（2026-09-14 に実際に踏んだ）。

---

## 3. 新しいPCに同じ環境を作る手順（レッツノート / OptiPlex 用）

作業員役の頭脳はクラウドなので **GPU も Ollama も不要**。

1. Claude Code と（任意で）OpenCode を入れる（`npm i -g opencode-ai`）
2. **ユーザー環境変数**に鍵を入れる（ファイル・リポには書かない）
   - `DASHSCOPE_API_KEY` … Alibaba Model Studio の API キー
   - `CF_WORKERS_AI_TOKEN` … Cloudflare API トークン（権限は「Workers AI: 読み取り」だけ）
3. OMEN のデスクトップの `*.cmd` をコピーして使う（接続先 URL は cmd の中に書いてある）
4. OpenCode は `~/.config/opencode/opencode.jsonc` に provider を書く。`apiKey` は `"{env:DASHSCOPE_API_KEY}"` の形で環境変数参照にする

### Alibaba Model Studio の登録で踏んだ地雷
- **登録時の国/地域は後から変更できない**（公式仕様）。日本の電話番号で認証するには **最初に「日本」を選ぶ**。
  シンガポールのまま作ると電話番号が +65 固定で詰む → 別メールで作り直し（企業認証を通せば他国番号も可だが割に合わない）
- Model Studio は **シンガポールリージョン**（`ap-southeast-1`）で有効化する。アカウントの国が日本でも問題ない
- **支払い情報の登録はスキップできる**（無料枠内なら不要）。「登録を完了」の画面を無視して Model Studio のコンソール URL を直接開けばよい
- API キーは **作成直後の1回しか表示されない**
- OpenAI 互換 / Anthropic 互換の **ワークスペース専用 URL** が API Key 画面に出る。それを使う（汎用の `dashscope-intl` でも可）
- 既定は「考える」モードでトークンを多く消費する。バッチでは `enable_thinking: false`（OpenAI 互換）にする

---

## 4. 3台の役割

| 機体 | 役割 | 理由 |
|---|---|---|
| OMEN（GPU あり） | 司令塔。本物の Claude はここだけ。Ollama / Open WebUI / トンネルを常駐 | 唯一 GPU がある |
| レッツノート | 第2の作業員 兼 持ち出し端末。**Grok Build を2つ目の SuperGrok アカウントで**常駐させると Claude とも1つ目とも別枠 | 頭脳はクラウドなので非力でよい |
| OptiPlex 5040（1階・GPU なし・Win10 Pro・32GB） | 操作される側の作業員。RustDesk を入れるだけで参加 | 画面を占有されても困らない。壊れても被害が閉じる |

会議ハーネス（[`COUNCIL-HOWTO.md`](COUNCIL-HOWTO.md)）には GPU 無し機を参加させない。本書の作業員役とは別物。

---

## 5. 夜間バッチ（実例）

`ouenmovie/bin/gen-post-kit.py` + `bin/nightly-post-kit.cmd`（タスクスケジューラ `OuenNightlyPostKit`、毎日 03:00）。
台本から媒体別の投稿文の下書き `POST.draft.md` を2案ずつ作る。頭脳は `POSTKIT_API` / `POSTKIT_MODEL` 環境変数で切替
（Alibaba `qwen3.8-flash`: 1案16秒、ローカル 35B-A3B: 1案30〜80秒）。無料枠が切れたら cmd の2行を消すとローカルに戻る。
説明書: `ouenmovie/bin/README-post-kit.md`（**claude-qwen で書かせた成果物**。3分10秒・Claude の上限消費ゼロ・事実誤り0件）。

---

## 6. 常駐と自動起動で踏んだ地雷（Windows）

| 症状（実文言） | 原因 | 直し方 |
|---|---|---|
| 再起動後に Open WebUI が落ちている。ログに `PermissionError: [Errno 13] Permission denied: 'C:\\Windows\\System32\\.webui_secret_key'` | スタートアップ起動だと作業フォルダが System32 | launcher の先頭で `cd /d %LOCALAPPDATA%\open-webui` |
| 再起動後に Ollama が居ない | Ollama に自動起動の登録が無い（Run キーもショートカットも無し） | Startup フォルダに `ollama app.exe` を起動する `.vbs` を置く |
| Bash から `Start-Process` で起動した常駐が数秒で死ぬ | コマンド終了時に子プロセスも巻き添え | `schtasks /Run`（ONCE タスク）か Startup フォルダ経由で起動 |
| `schtasks /SC ONLOGON` が「アクセスが拒否されました」 | 非管理者では ONLOGON 不可 | Startup フォルダの `.vbs` で代替（ONCE / DAILY は通る） |
| Git Bash で `schtasks /Create` が「無効な引数」 | `/Create` がパスに変換される | `MSYS_NO_PATHCONV=1` |
| `opencode run` を Bash ツールから呼ぶと10分固まる | stdin の EOF 待ち | `< /dev/null` を付ける |
| Open WebUI に `OPENAI_API_BASE_URLS` 等の env を入れても効かない | `openai.*` は PersistentConfig。DB の値が優先 | `data/webui.db` の `config` テーブル（key/value）を直接更新して再起動 |
| Ollama を `OLLAMA_HOST=0.0.0.0` で LAN 公開したら、同じPCのスクリプトが `WinError 10049` | クライアント側が 0.0.0.0 を接続先にしてしまう | 接続先は 127.0.0.1 に読み替える |
| 古い Ollama（0.32.x）で `qwen3.8` が引けない（`412: requires a newer version of Ollama`） | モデルが新しすぎる | Ollama の自動更新が `updates_v2/` に落としたインストーラを `/VERYSILENT` で適用 |
| RDP で遠隔操作した作業員機の画面が、切断後に真っ黒 | RDP は切断時にロックする | RustDesk / Chrome リモートデスクトップ（実画面をそのまま映す方式）＋ダミープラグ |

---

## 7. 秘密の扱い

- API キー・トークンは **ユーザー環境変数だけ**。cmd / jsonc は `{env:...}` や `%VAR%` で参照する
- 設定ファイルに平文で鍵が残っているのを見つけたら（例: `.grok/config.toml` の GitHub PAT）、**その場で失効・再発行**を依頼する
- 会話ログに鍵が出たら、それも失効対象
- 鍵の受け渡しは `~/.claude/CLAUDE.md` の「クリップボード経由」の手順（チャットに貼らない）

---

## 8. ハードを買う判断（89万円の機体）

Mac Studio M5 Max 128GB（約89万円）や Ryzen AI Max+ 395 128GB ミニPC（約59万円、2026-09 時点）は、Flash-Next 級を手元で回すための機体。
**Alibaba の無料枠（90日）で同じモデルを使い切ってから決める。** 100万トークンで足りなければ買う価値がある、足りるなら不要。
GPU 単体の増設（RTX 3090 中古 13〜18万円 + 電源交換）は、価格が半年で倍になっており勧めない。

---

## 9. 実測メモ（2026-09-14、出典: このセッションの実行ログ）

- 同じ作業（指示どおりファイルを1つ作る）: ローカル 35B-A3B 2分・置き場所を誤る ／ Cloudflare 27B 11秒・正答 ／ Alibaba `qwen3.8-flash` OpenCode 15秒・正答（作成後に自分で読み直して確認）／ Claude Code 12秒・正答
- Claude Code + `qwen3.8-flash` に「スクリプトを読んで非エンジニア向け説明書を書け」: 3分10秒。時刻など事実は実行ログで裏取りして書いた。誤りなし
- 27B 密モデルはこの PC（VRAM 12GB）では 3 tok/s で対話不可。35B-A3B（MoE）は 20 tok/s、プロンプト処理 236 tok/s（コールド）

---

## 10. 未確認事項・次にやること

- [ ] Open WebUI のモデル一覧に `ali.*` / `cf.*` が実際に表示されるか（ログインが要るため AI 側から未確認。本人がスマホで確認）
- [ ] レッツノートへの展開（RustDesk / Grok Build 2つ目アカウント）
- [ ] OptiPlex への RustDesk 導入
- [ ] Alibaba 無料枠の残量を週1で見る（Model Studio → Usage & Billing）。期限 2026-12 中旬
- [ ] 本書の運用を1か月回して、89万円の機体の要否を判断
