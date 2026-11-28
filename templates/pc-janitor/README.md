# pc-janitor — Cドライブを AI の作業の残りで一杯にしない

## なぜ要るか（2026-11-28 実測）

会社PC（besttrust）の C ドライブは、11/18 に 98GB まで空けたのに、10日で 8.6GB まで減った。
増えたのは、AI のセッションが作って消さない作業用コピーだった。

| 増えた所 | 大きさ | 中身 |
|---|---|---|
| `github\_worktrees\<リポ>\<作業名>` | 55GB | git worktree。1つずつ node_modules を持つ（約240件） |
| `C:\tmp` | 47GB | 検証用の clone・worktree（約220件） |
| `%TEMP%` | 14GB | Playwright のプロフィール、比較の出力、インストーラ |

一度手で消しても、作る側（AI のセッション）は毎日作り続けるので、また一杯になる。
だから「消す」を手作業でなく毎日の自動の仕事にする。

## 何を消すか（失うものが無いものだけ）

`disk-janitor.ps1` は、作業用コピーを次の4つが全部そろったときだけ消す。

1. `git status` がきれい（書きかけ・新しいファイルが無い）
2. そこにあるコミットが全部どこかのリモートにある（`rev-list --not --remotes` が 0）
3. stash が無い（clone のとき）
4. 3日以上さわっていない

ひとつでも欠けたら残して、理由をレポートに書く。git でない `C:\tmp` のフォルダは消さずに報告だけする。
node_modules がジャンクション（本体へのリンク）のときは、中身をたどらずにリンクだけ外す（2026-10-05 に本体が消えた事故の再発防止）。
ほかに、2日より古い `%TEMP%` と npm・pnpm のキャッシュ（取り直せる）を片づける。

## 使い方（AI が走らせる）

```powershell
pwsh -NoProfile -File templates/pc-janitor/disk-janitor.ps1          # 試運転（消さずに一覧だけ）
pwsh -NoProfile -File templates/pc-janitor/disk-janitor.ps1 -Apply   # 消す
pwsh -NoProfile -File templates/pc-janitor/register-disk-janitor.ps1 # 毎日 4:30 の自動実行を登録
```

結果は `%USERPROFILE%\claude-ops\disk-janitor.last.json`。片づけた後も C の空きが 40GB を切っていたら、画面に警告が出る。

## 消さないもの（判断が要る）

- WSL（Ubuntu 10.7GB・Kali 17.8GB の `ext4.vhdx`）: 中身はりんくのもの。11/18 に「Kali は残す」と決めている。
- Ollama のモデル（約25GB）: 会議・機密用に使っている。
- 書きかけ・未送信のある作業コピー: レポートに残るので、持ち主の作業が済んだら次の日に自動で消える。
