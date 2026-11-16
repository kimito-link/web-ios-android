# hooks-relay — web-ios-android の hook を、ほかのプロジェクトのセッションにも効かせる（2026-11-16）

## なぜ要るか

- web-ios-android の hook（`guard-external-actions` など）は、このリポの `.claude/settings.json` からは `${CLAUDE_PROJECT_DIR}` で呼べる。
  ほかのプロジェクト（line-bot 等）のセッションからは、hook の場所が分からない。
- そこで `~/.claude/settings.json` に `node "<~/.claude/hooks>/web-ios-android-relay.mjs" <hook名.mjs>` と書き、
  中継（relay）が web-ios-android の checkout を探して、その `.claude/hooks/<hook名.mjs>` を起動する。
- 以前は relay の実体が PC の `~/.claude/hooks/` にだけあり、新しい PC のたびに人の手と記憶に頼っていた。今はこのフォルダが正本。

## 入れ方（新しい PC で1回）

```
node templates/hooks-relay/install.mjs --dry-run   # 何を足すかだけ見る
node templates/hooks-relay/install.mjs             # 入れる（settings.json.bak-hooks-relay を作ってから）
```

- relay を `~/.claude/hooks/web-ios-android-relay.mjs` に置き、隣の `web-ios-android-relay.json` にこの checkout の場所を書く。
- このリポの `.claude/settings.json` に配線されている hook を、relay 経由のコマンドにして `~/.claude/settings.json` に足す。
  同じ hook を既に呼んでいる行（relay 経由でも、クラウドの直接コピーでも）があれば足さない。2回走らせても増えない。`autoMode` など他の設定には触らない。
- hook を増やしたら、もう一度走らせれば足りない分だけ足す。
- ★PC では auto mode が「自分の設定を書き換える操作」として AI の実行を止めることがある（[`../auto-mode/README.md`](../auto-mode/README.md) と同じ）。
  そのときは本人が上の1行を1回だけ走らせる。

## relay の動き（[`web-ios-android-relay.mjs`](web-ios-android-relay.mjs)）

checkout（`package.json` の name が `web-ios-android` で `.claude/hooks/` があるフォルダ）を次の順で探す:

1. 環境変数 `WEB_IOS_ANDROID_DIR`
2. 作業ディレクトリとその祖先。各階層で「そこ自身」と「その下の `web-ios-android`」（兄弟リポの形）
3. install.mjs が書いた `web-ios-android-relay.json` の `root`
4. 各 PC の決まった置き場所（`.claude/hooks/warn-long-running-session.mjs` の `findWebIosAndroidRoot` と同じ並び。片方を変えたらもう片方も）
5. `~/.claude/web-ios-android`（hook 専用の浅い clone）

- stdin・stdout・stderr・終了コードはそのまま通す。止めるかどうかは起動した hook だけが決める。
- 引数はファイル名だけ。パス区切り・`..` は受け付けない。
- checkout が無い・hook が無い・引数が不正のときは、既存の hook 群と同じく fail-open（起動せず exit 0、stderr に1行）。

## テスト

```
npx vitest run templates/hooks-relay/
```

一時ディレクトリを HOME・`~/.claude` に見立てる。本物の `~/.claude` には触らない。
