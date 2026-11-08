# Google Colab 活用HOWTO（モデル試験場）— 正本

**状態: 2026-11-08 採用（りんく「採用して」）。文書とノートのひな型まで。Colab 上での初回実走は未了。**
Colab を使うときはこの1枚を読む。コピーは作らない。

## 一言で

**Colab 無料版は「新しいモデルを試す実験場」。本番のサーバーにはしない。**
会議の席・常駐の処理・人の手なしで回る仕事には使わない。

## なぜ実験場なのか（Colab 公式 FAQ、2026-11-08 に読んだ文面）

出典: <https://research.google.com/colaboratory/faq.html>

| 事実 | FAQ の文面 | このキットでの意味 |
|---|---|---|
| 最長12時間・放置で切れる | "notebooks can run for at most 12 hours" ／ "Runtimes will time out if you are idle." | 常駐できない。夜間バッチにも向かない |
| 上限は非公開で日々変わる | "dynamic usage limits that sometimes fluctuate" ／ 無料の GPU は "heavily restricted" | 「明日も使える」前提の段取りを組まない |
| GPU の種類は時期で変わる | "The types of GPUs and TPUs that are available in Colab vary over time." | 2026-11 時点の体感は T4 16GB。ノートの最初で `nvidia-smi` を必ず見る |
| 無料版で禁止 | "remote control such as SSH shells, remote desktops" ／ "bypassing the notebook UI to interact primarily via a web UI" ／ "running distributed computing workers" | **ngrok 等で API を外に出して会議の席にする使い方は禁止に当たる**。突然切られてもおかしくない |
| 全プランで禁止 | "web service offerings not related to interactive compute" ／ "connecting to remote proxies" ／ 複数アカウントで上限を回避 | アカウントを増やして枠を広げない |

[`08_NO_HUMAN_HANDS.md`](../ai-rules/08_NO_HUMAN_HANDS.md) の「人の手を使わない」とは相性が悪い（ブラウザでノートを開いて「実行」を押す人が要る）。
だから**人が「試してみたい」と思った時だけ開く道具**と割り切る。

## 使いどころ（向いている）

1. **新しいオープンモデルの味見**: 会議（[`COUNCIL-HOWTO.md`](COUNCIL-HOWTO.md)）に入れる前に、中身の質を見る。
   ひな型 [`templates/colab-lab/model-trial.ipynb`](../../templates/colab-lab/model-trial.ipynb) は、
   tsuioku `scripts/council-trial.mjs` と**同じお題・同じ条件**（max 1600 トークン・temperature 0.6・推論オフ）で答えさせ、
   「空返答」「上限まで使い切った」を同じ物差しで記録する。
2. **量子化の比べっこ**: 同じモデルを 4bit / 8bit で答えさせ、質がどれだけ落ちるかを見る。ローカル Ollama（[`MULTI-BRAIN-HOWTO.md`](MULTI-BRAIN-HOWTO.md) 段4）に入れる前の下見。
3. **Whisper の聞き比べ**: 文字起こしモデルの大きさ・日本語の精度を、手元の短い音声で比べる。
4. **小さな LoRA の試し**: 数百件のデータで学習の形が回るかだけ見る（本番の学習は別の場所で）。

## 向かない（使わない）

- 会議の席・API の代わり（上の禁止事項。途中で切れたら会議が FAILED になる）
- 常駐・定期実行・夜間バッチ（12時間で切れる。人の手なしで再開できない）
- 本番データ・お客様の情報を載せる（ノートを共有すると出力も一緒に渡る）
- 32B 以上のモデル（T4 16GB では 4bit でも入らない。目安は 14B まで）

## 試験の流れ（ひな型の使い方）

1. <https://colab.research.google.com/> を開き「ファイル → ノートブックをアップロード」で `templates/colab-lab/model-trial.ipynb` を選ぶ
   （GitHub から直接なら <https://colab.research.google.com/github/kimito-link/web-ios-android/blob/main/templates/colab-lab/model-trial.ipynb>。main に入った後に有効）
2. 「ランタイム → ランタイムのタイプを変更 → T4 GPU」
3. 2番のセルの `MODEL_ID` を試したいモデルに書き換え、「ランタイム → すべてのセルを実行」
4. 最後に出る表（`empty`・`hit_limit`・`chars`・`peak_mem_gb`）を見る。
   `empty` か `hit_limit` が true なら会議には入れない（2026-10-28 に確かめた「推論で上限を使い切って本文が空」と同じ落とし穴）
5. 良さそうなら、**同じモデルが無料 API（Groq・NVIDIA・Cloudflare・OpenRouter）にあるか**を調べ、
   そちらで `council-trial.mjs --models プロバイダ:モデル` を回す。会議の席に入れるかの判断は COUNCIL-HOWTO の基準のまま。

ノートの中身を直すときは `templates/colab-lab/build_notebook.py` を直して `python build_notebook.py` で作り直す（.ipynb を手で直さない）。

## 鍵（API キー）の扱い

- **ノートのセルに鍵を書かない**。保存すると Google ドライブに残り、共有すると相手に見える。
- 公開モデルは鍵なしで動く。鍵が要る（gated）モデルだけ、左の鍵マーク（Colab のシークレット）に `HF_TOKEN` を入れ、
  ノートは `userdata.get("HF_TOKEN")` で読む。値は表示しない。
- ノートを人に渡すときは「編集 → ノートブックの設定 → コードセルの出力を保存しない」にする（FAQ が勧める方法）。
- 試した結果を GitHub に残すときは、出力された JSON（鍵を含まない）だけを持ち帰る。

## 未確認・次にやること

- [ ] Colab 上でひな型を1回実走し、`Qwen/Qwen3-8B` の数字（読み込み秒・tok/s・メモリ）をここに書く
- [ ] 実走で見つかった直し（ライブラリの版・メモリ不足など）をひな型へ戻す
