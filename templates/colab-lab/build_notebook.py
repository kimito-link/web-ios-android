# ノートブック(model-trial.ipynb)を作り直すための小さな道具。中身を直すときはここを直して `python build_notebook.py` を実行する。
import json, pathlib

def md(s): return {"cell_type": "markdown", "metadata": {}, "source": s.strip("\n").splitlines(keepends=True)}
def code(s): return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": s.strip("\n").splitlines(keepends=True)}

cells = [
md("""
# モデル試験場（Colab 無料版 T4 用）

正本: web-ios-android `docs/ai-workflows/COLAB-HOWTO.md`。

やること: オープンモデルを 4bit で動かし、会議の試験（tsuioku `scripts/council-trial.mjs`）と**同じお題・同じ条件**で1回答えさせて、
速さ・本文の長さ・空返答かどうか・使ったメモリを記録する。

使い方: 上のメニュー「ランタイム → ランタイムのタイプを変更 → T4 GPU」にしてから、「ランタイム → すべてのセルを実行」。
**鍵（API キー）はこのノートに書かない。** 公開モデルは鍵なしで動く。鍵が要るモデルだけ、左の鍵マーク（シークレット）に `HF_TOKEN` を入れる。
"""),
md("## 1. GPU が付いているか確かめる"),
code("""
!nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv
"""),
md("## 2. 試すモデルを決める（ここだけ書き換える）"),
code("""
# T4(16GB) で 4bit なら目安 14B まで。32B 以上はメモリ不足で落ちる。
MODEL_ID = "Qwen/Qwen3-8B"
LOAD_4BIT = True
MAX_NEW_TOKENS = 1600   # 会議の本番条件と同じ
TEMPERATURE = 0.6       # 会議の本番条件と同じ
"""),
md("## 3. 道具を入れて、モデルを読み込む（初回は数分かかる）"),
code("""
!pip -q install -U transformers accelerate bitsandbytes
import os, time, json, torch
from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig

token = None
try:
    from google.colab import userdata
    token = userdata.get("HF_TOKEN")   # 左の鍵マークに入れた値。無ければ None のまま
except Exception:
    pass

quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_compute_dtype=torch.float16, bnb_4bit_quant_type="nf4") if LOAD_4BIT else None
t0 = time.time()
tok = AutoTokenizer.from_pretrained(MODEL_ID, token=token)
model = AutoModelForCausalLM.from_pretrained(MODEL_ID, quantization_config=quant, device_map="auto", torch_dtype=torch.float16, token=token)
load_sec = round(time.time() - t0, 1)
print("読み込み秒:", load_sec, " 使用メモリGB:", round(torch.cuda.memory_allocated() / 1e9, 2))
"""),
md("## 4. 会議と同じお題で1回答えさせる"),
code("""
SYSTEM = "あなたは開発会議のメンバーです。日本語で、結論→理由→懸念の順に、具体的に答えてください。"
PROMPT = "\\n".join([
    "お題: 個人開発のWebアプリで、AI機能(有料API)の無料枠を「ログインした人に1日5回」にする案があります。",
    "(1) この案の一番の弱点を1つ挙げてください。",
    "(2) 弱点をふさぐ具体策を2つ、実装の手順つきで出してください。",
    "(3) あなたの案が間違っている可能性があるとしたら、どこですか。",
    "400〜800字で。",
])
messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": PROMPT}]
try:   # 推論(thinking)を持つモデルは切る。会議でも推論オフで使うため
    text = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
except TypeError:
    text = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
inputs = tok(text, return_tensors="pt").to(model.device)

torch.cuda.reset_peak_memory_stats()
t0 = time.time()
with torch.no_grad():
    out = model.generate(**inputs, max_new_tokens=MAX_NEW_TOKENS, do_sample=True, temperature=TEMPERATURE)
sec = time.time() - t0
new_ids = out[0][inputs["input_ids"].shape[1]:]
answer = tok.decode(new_ids, skip_special_tokens=True).strip()
print(answer)
"""),
md("## 5. 結果をまとめる（この表を会議の試験結果と並べて見る）"),
code("""
import re
body = re.sub(r"<think>.*?</think>", "", answer, flags=re.S).strip()
result = {
    "model": MODEL_ID, "load_4bit": LOAD_4BIT, "gpu": torch.cuda.get_device_name(0),
    "load_sec": load_sec, "gen_sec": round(sec, 1),
    "new_tokens": int(new_ids.shape[0]), "tok_per_sec": round(new_ids.shape[0] / sec, 1),
    "chars": len(body), "empty": len(body) < 50,
    "hit_limit": int(new_ids.shape[0]) >= MAX_NEW_TOKENS,   # True なら上限まで使い切った＝途中切れの疑い
    "peak_mem_gb": round(torch.cuda.max_memory_allocated() / 1e9, 2),
    "date": time.strftime("%Y-%m-%d"),
}
print(json.dumps(result, ensure_ascii=False, indent=2))
fname = "colab-trial-" + MODEL_ID.replace("/", "_") + ".json"
with open(fname, "w", encoding="utf-8") as f:
    json.dump({**result, "answer": body}, f, ensure_ascii=False, indent=2)
print("保存:", fname, "（左のフォルダマークから下ろせる。セッションが切れると消える）")
"""),
md("""
## 6. 見かた

- `empty` が true、または `hit_limit` が true → 会議には入れない（本番の 1600 トークンで本文が出ないモデル）。
- `tok_per_sec` は T4 の数字。本番で使うのは Groq・Cloudflare など**外のAPI**なので、速さは参考まで。ここで見るのは**中身の質**。
- 良さそうなら、同じモデルが無料のAPI（Groq・NVIDIA・Cloudflare・OpenRouter）にあるかを調べ、そちらで `council-trial.mjs --models` を回す。
  Colab をそのまま会議の席にはしない（理由は COLAB-HOWTO.md）。
"""),
]

nb = {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"provenance": [], "gpuType": "T4"},
      "kernelspec": {"name": "python3", "display_name": "Python 3"}, "language_info": {"name": "python"}},
      "nbformat": 4, "nbformat_minor": 0}
pathlib.Path(__file__).with_name("model-trial.ipynb").write_text(json.dumps(nb, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
