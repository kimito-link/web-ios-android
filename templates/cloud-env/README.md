# cloud-env — クラウドのセッションに全体の hook を配線する

claude.ai のクラウドのスレッド・司令塔は `/home/user` から始まり、リポの `.claude/settings.json` を読まない。
そのため全体の決まり（人に確認を求めない・頼まれていない削除を止める・Fable の手作業を止める・残り枠の知らせ）は、
クラウド環境の setup script で `~/.claude/settings.json` に入れる。

- 環境「デフォルト」の setup script は次の1行だけにする（hook を足すときはこのフォルダの `setup.sh` を PR で直す。環境の編集は要らない）:

```bash
curl -fsSL https://raw.githubusercontent.com/kimito-link/web-ios-android/main/templates/cloud-env/setup.sh | bash || true
```

- 何度走らせても同じ結果になる。取れなかったファイルの hook は配線しない（セッションの起動は止めない）。
- `setup.test.mjs` が、取りに行くファイルがリポに実在するかを確かめる。
- 経緯: 2026-11-27、残り枠の知らせ `inject-ai-budget-mode` がクラウドで一度も動いていなかった（docs/ai-workflows/MULTI-BRAIN-HOWTO.md §1g）。
