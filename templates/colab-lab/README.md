# colab-lab — Colab で新しいモデルを試すひな型

使い方・使ってはいけない場面・鍵の扱いの正本は [`docs/ai-workflows/COLAB-HOWTO.md`](../../docs/ai-workflows/COLAB-HOWTO.md)。

| ファイル | 役目 |
|---|---|
| `model-trial.ipynb` | Colab に上げて「すべてのセルを実行」するだけのノート。会議の試験と同じお題で答えさせ、空返答・途中切れ・メモリを記録する |
| `build_notebook.py` | 上のノートを作り直す道具。ノートを直すときはこちらを直して `python build_notebook.py` |
