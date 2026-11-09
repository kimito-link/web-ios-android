# AIへの指示書（このテンプレの使い方）

> 👤 人間が最初に読むのは [`START-HERE.md`](START-HERE.md)（小学生〜90歳でもわかる超やさしい版）。
> 🤖 AI（あなた）はこの CLAUDE.md を読んでから作業する。

## このキットは何か（一言定義）

**AI開発の総合ルール（正本）と、ストア申請自動化のひな型を束ねた「横断開発基盤」。**
①アプリ提出自動化キット（本項以下、このファイルの主題）と、
②kimito-skill.linkの玄関＝`../ai-hub`横断知見ダッシュボードへの窓口、の2役を持つ。
**①だけを見て「ストア申請ツール」と思わないこと**（2026-09-01: 実際にAIが繰り返しai-hubを
見落とし、既存の共通実装を重複実装した事故を受けて、この節を最上部に移動した）。

## ★核: 質問する前にこの手順を必ず通す（2026-09-24確立、詳細はファイル後半）

このCLAUDE.mdは一時1000行超あり、最重要ルールが中盤に埋没して守られない事故が
繰り返された（詳細: [`_docs/DESIGN-claude-md-decay-2026-09-24.md`](_docs/DESIGN-claude-md-decay-2026-09-24.md)）。
そこでこの1ブロックだけを冒頭に置く。**「AskUserQuestion等で選択肢を出す」「確認して
ください、で応答を終える」の前に、必ずこの順で自問する**（4項目はいずれも
[`docs/claude-md/09-ai-guidelines.md`](docs/claude-md/09-ai-guidelines.md)「AIへのお願い（守ること）」の同名ルールが詳細・実損エピソード付きで解説している。
そちらを読んでいれば読み直さなくてよい——ここは行動フローの要約のみ）:

1. **調べる**: `Grep`/`Glob`/`WebFetch`/`WebSearch`/`Agent`。詳細4項目・実損は
   [`09-ai-guidelines.md`](docs/claude-md/09-ai-guidelines.md)「あらゆる調査を尽くす」参照。
2. **裏取りする**: 見つけた答え・出した結論を実地で確認する（実行・再現・ログ確認）。
   「コードを読んで筋が通る」で止めない。「編集した」「コミットした」を
   「本番に反映された」と混同しない。
3. **MCPは実操作まで確認する**: この操作を代行できる公式MCPがあるなら、
   「MCPが接続されている」で満足せず、その具体的な書き込み・変更操作を実際に
   1回叩いて通るか確認してから使う。通らない場合のみ次の手段（ブラウザ操作等）へ進む。
4. **それでも埋まらない事実だけを聞く**: 1〜3を尽くしても埋まらないのは、
   事実として存在しない情報（ユーザーだけが知る事業判断、未記入の設定値、
   複数の正しい選択肢のうち好みの問題）だけ。それ以外は自分で決めて実行してから報告する。

★**このファイルの「必読の核」は、冒頭から `core:end` マーカーまで**（約380行。2026-11-10実測381行）。hook が全文Read判定をするのもそこまで。
マーカーより下（AIのお願い・ドメイン接続・確認ルール等）は、その作業に入るときに該当の節だけ読む。

★★**外向き・取り消せない操作（push・PRマージ・workflow実行・secret設定・デプロイ）の前は、
`guard-external-actions` hook が止める**（2026-10-06）。CLAUDE.md を現在の内容のまま全文Readしたか／
`.agent/coord.md` に触れたか／マージ対象PRのチェックが緑か、を事実だけで確かめる。警告ではなく**拒否**
（理由は「正本への自動到達経路」節の末尾）。拒否されたら、迂回せず、言われた手順を踏む。

★auto mode等の権限分類器に操作を拒否されたときも、この4項目（特に1・3）を
再度通してから人間に判断を委ねる。「拒否された→即座に人間に振る」は3の飛ばしに当たる
（2026-09-24、このキット自身のセッションが実際に踏んだ）。

★★**人間に手作業（ダッシュボード操作等）を依頼するときは、必ず直接開けるURLを出す**
（2026-09-26確立）。「Cloudflareダッシュボード → マイプロフィール → APIトークン」
のようなメニュー階層の説明だけで済ませない。人間側は毎回メニューを目で探す手間が
発生し、「手間がすごい」という指摘を受けた。`https://dash.cloudflare.com/profile/api-tokens`
のように、**クリックすれば目的のページへ直接飛べるURLを併記する**。パス階層の説明は
補足として残してよいが、URLを省略してはいけない。GitHub・Vercel・Google Cloud等
どのサービスでも同じ——「開いてください」と言うなら、開くべき場所のURLを添える。

★★★**人の手を使わない設計（2026-10-28 本人指示「全体設計として人間の手は使わない設計で」）**。人に押す・貼る・読む・
Enter・スクショを頼む前に、①もう保管されていないか ②公式API/CLI/MCPで書き込みまで通るか（実際に叩く）③一度だけの許可で
以後AIが回せるか ④AIが自分で見て読んで続けられるか（黒い画面は状態ファイルに書かせて読む）⑤自分で直る形にできるか、を順に試す。
それでも残るもの（本番の鍵の発行・課金・OKの一言）だけを「**年1回以下・1タップ・画面だけで次が分かる**」に縮めて渡す。
安全の決まり（鍵をAIが作らない・普段のChromeに繋がない・push/マージはOK後）はゆるめない。正本・棚卸し・スクリプトの決まり:
[`docs/ai-rules/08_NO_HUMAN_HANDS.md`](docs/ai-rules/08_NO_HUMAN_HANDS.md)。

★★**Chrome拡張は、AIが自分で読み込んで確かめる。人に「再読み込みして開き直して」と頼まない**（2026-10-25確立）。
拡張を変えたら `npm run verify:extension`（共通の [`templates/extension-verify/`](templates/extension-verify/README.md)）を
自分で走らせ、全画面・全差し込み先の合否と証拠を添えて報告する。詳細は [`docs/claude-md/11-verification-rules.md`](docs/claude-md/11-verification-rules.md) の同名小節。

### 知見の地図（「web-ios-androidを開けば全部の所在が分かる」の実体、2026-09-07追記）

github/配下に散らばっていたルール文書・ノウハウ・手順を、公開可否で仕分けてここに集約している。
「これはどこにある？」と思ったら、まずこの表で行き先を確認する。

| 種類 | 正本の場所 | 公開可否 |
|---|---|---|
| 非交渉ルール・判断の軸 | このファイル（`CLAUDE.md` の核）。4基準・5類型の本文は [`docs/claude-md/09-ai-guidelines.md`](docs/claude-md/09-ai-guidelines.md) | 公開 |
| 規則本文 | [`docs/ai-rules/`](docs/ai-rules/) | 公開 |
| 進め方HOWTO（council-fable / wayfinder-to-spec / **マルチ頭脳**＝本物Claude・Qwen本家・Cloudflare・ローカルの4段で週間上限に縛られない運用、2026-09-14 ／ **デザイン名前の翻訳**＝曖昧な見た目依頼を定着したデザイン用語に翻訳し3方向を出す・[`DESIGN-NAMING-PROMPT.md`](docs/ai-workflows/DESIGN-NAMING-PROMPT.md)） | [`docs/ai-workflows/`](docs/ai-workflows/)（[`MULTI-BRAIN-HOWTO.md`](docs/ai-workflows/MULTI-BRAIN-HOWTO.md)） | 公開 |
| 金型・出荷ゲート | [`templates/`](templates/) | 公開 |
| ロゴ運用ルール | [`docs/brand/LOGO-RULES.md`](docs/brand/LOGO-RULES.md) | 公開 |
| 発信ルーティン（集客→教育→影響力・SNS/LINE） | [`docs/DISTRIBUTION-ROUTINE.md`](docs/DISTRIBUTION-ROUTINE.md)（数字は `../best-trust/docs/distribution/LOG.md`=非公開） | 公開 |
| 事故と教訓（実証知見） | [`site/learnings/`](site/learnings/index.html) | 公開 |
| ★同じ画面を別の面にも出すときの掟（鏡写し） | [`_docs/DESIGN-ui-mirror-to-another-surface.md`](_docs/DESIGN-ui-mirror-to-another-surface.md) | 公開 |
| 自己改善ループ（症状→ローカルAIの提案→人間が承認→いつもの出荷手順。全プログラム共通・設計のみ） | [`_docs/DESIGN-self-improvement-loop-2026-10-18.md`](_docs/DESIGN-self-improvement-loop-2026-10-18.md) | 公開 |
| 横断資産カタログ・個別プロジェクトの固有知見 | `../ai-hub/`（URL窓口は非公開ダッシュボード `/hub/`） | 非公開 |
| 会議ログ・改修履歴 | `../ai-hub/history/` | 非公開 |

## 正本への自動到達経路（2026-09-16確立、伝播漏れの根本修正）

**個々のプロジェクトへ`@`インポート付きCLAUDE.mdを個別に作る必要はない。**
`github/CLAUDE.md`の冒頭に置いた`@web-ios-android/CLAUDE.md`という1行だけが正本経路。

きっかけ: `github/`配下の約30プロジェクトへ、このファイルの内容を届けるために
「各プロジェクトのルートへ`@../web-ios-android/CLAUDE.md`付きCLAUDE.mdを個別に手作業で
作る」という方式を一時採用したが、新規プロジェクト追加・調査漏れのたびに伝播が途切れる
事故が繰り返された（前回「14件対応完了」と報告した直後、別の11プロジェクトで未対応が
発覚。「相対パスで1つ参照すればよいと言ったばかりなのに、また個別対応が必要になっている」
という指摘で発覚）。

★**根本原因はClaude Codeの仕様誤解だった**: Claude Codeは「作業ディレクトリと**その祖先
ディレクトリすべて**のCLAUDE.mdを自動で読み込む」設計（[Claude Code Memory公式ドキュメント](https://code.claude.com/docs/en/memory)）。
つまり`github/line-bot`でセッションを開けば、`github/line-bot/CLAUDE.md`だけでなく
祖先の`github/CLAUDE.md`も自動的に読まれる。`github/CLAUDE.md`にimport構文
（`@web-ios-android/CLAUDE.md`）さえ置けば、配下の**既存・新規を問わず全プロジェクト**に
自動伝播する——個別配布は最初から不要だった。

**今後の運用**:
- 新しいプロジェクトを`github/`配下に作っても、web-ios-androidの正本を読むための
  追加作業は不要（`github/CLAUDE.md`が自動的にカバーする）
- 「web-ios-androidのルールが伝わらない」という事象が今後発生したら、まず
  `github/CLAUDE.md`の`@web-ios-android/CLAUDE.md`インポート行が消えていないか、
  初回承認ダイアログを断って以後インポートが無効になっていないかを疑う
- 既存の個々のプロジェクトに残っている`@../web-ios-android/CLAUDE.md`（`kimito-link`等
  約20件）は重複だが実害はないため、削除の必要はない（プロジェクト固有の注意点も
  併記されているものが多く、無理に触らない）

★★**この修正が効かない既知のケース: 「既に開いたまま動いているセッション」（2026-09-16追記）**。
Claude Codeは指示書（CLAUDE.md）をセッション開始時に読み込む設計であり、稼働中に
祖先ディレクトリのCLAUDE.mdが後から書き換わっても、既に開いているセッションへは
自動的に反映されない（起動時点のスナップショットのまま動き続ける）。実例:
「Mistral AI実装と会議ハーネス設計」セッションが`github/CLAUDE.md`への今回のimport追記
（2026-09-16 11:42）より前から開いたまま動いており、Cloudflareトークンの権限問題
（[`docs/claude-md/10-domain-and-cloudflare.md`](docs/claude-md/10-domain-and-cloudflare.md)「★★Cloudflareのトークンは『用途ごとに権限が独立している』」、既に
CLAUDE.mdに解決策が書いてある地雷）を自力で再発見していた。ユーザーが手動で
「`C:\...\web-ios-android` みてください」と教えて初めて参照できた。
★**対処**: 長時間開いたままのセッションで「web-ios-androidに書いてあるはずのことが
参照されていない」と感じたら、まず新しいセッションかどうかを疑う。対処は2通り:
1. **そのセッションに直接「`web-ios-android/CLAUDE.md`を読んで」と指示する**
   （最も簡単。`Read`ツールでいつでも最新の内容を読める。効かないのはあくまで
   セッション開始時の`@`インポート自動展開だけで、明示的なReadは別物）
2. セッションを再起動する（以後も自動インポートで継続的に最新が読まれる状態にしたい場合）
「稼働中セッションには遡って効かない」＝「再起動するしかない」ではないことに注意する。

★この稼働中セッション検知は hook 化済み（[`.claude/hooks/warn-long-running-session.mjs`](.claude/hooks/warn-long-running-session.mjs)・
`UserPromptSubmit`・非ブロッキング）。判定2軸: (1) セッション開始が12時間超、(2) セッション開始時刻 <
正本（`.claude/hooks/`・CLAUDE.md）の最終更新時刻（配線が古いまま起動した短命セッションも捕捉）。
実装経緯・26日連続稼働/soushin の実損・`birthtime` が信頼できない件の詳細:
[`_docs/DESIGN-claude-md-decay-2026-09-24.md`](_docs/DESIGN-claude-md-decay-2026-09-24.md)。

★★★★★**非ブロッキングの警告は、読まれなければ「形だけ」になる——外向きの操作の前は拒否に格上げした
（2026-10-06）**。本人の指摘「CLAUDE.md が形だけで機能していない気がします」を、そのセッション自身の
記録で実測した。上の「経過時間・正本更新」の警告は、13日続いたセッションで**毎ターン出ていたのに、
一度も CLAUDE.md を読み直す行動に繋がらなかった**。同じセッションは、①`.agent/coord.md` の
write_lock（Main-Write Pause）を取らずに3リポの main へ PR をマージし、②Gate1 の diff-check が赤の
まま（保護パスに触れたため）マージし、③ワークフローの実行を「未実行」と誤報告した（出力が空だったのを
未実行と読んだ。実際は起動していた）。①②は「CLAUDE.md に書いてある手順」を、③は「裏取り」を、
読んでいながら飛ばした——**文章と警告だけでは、外へ出す直前の1手を止められない**。
- 対処: `.claude/hooks/guard-external-actions.mjs`（PreToolUse(Bash)・**拒否**）。Bash の中の
  `git push` / `gh pr merge` / `gh workflow run|enable` / `gh secret set` / `gh release` / `gh api -X 変更系` /
  `vercel --prod` / `wrangler deploy` / `npm publish` の前で、(1) cwd のリポの CLAUDE.md を**現在の内容のまま
  全文 Read した形跡**、(2) `.agent/coord.md` に**触れた形跡**、(3) `gh pr merge` ではマージ対象PRの**チェックに
  失敗が無いこと**、を事実だけで確かめ、欠けていれば拒否する。判定部品は `.claude/hooks/lib/transcript-reads.mjs`
  に1つだけ置き、`require-claude-md-read.mjs`（Edit/Write 前）と共有する（複製しない）。
- ★チェックが赤のPRをどうしても通すなら、**ユーザーがチャットで明示承認した後に限り**、コマンドへ
  `GATE_BYPASS_APPROVED_BY_USER="<承認の中身>"` を付ける。無断で付けるのは虚偽申告で、ここを機械が見張る手段は無い
  （付けた事実がコマンド履歴に残る＝後から検査できる、までが限界）。
- ★判定しないこと: 読んだ内容に**従ったか**／引用符に隠した操作（`bash -c "..."`）／MCP・Agent 経由の外向き操作。
  「全文Read」は「見た」までの証拠で、読んでも破る可能性は残る。だから他の hook・Gate は別に残す。
- ★サブエージェント（Agent で起動した子）からの外向き操作は**常に拒否**する（2026-10-07）。公式仕様で `transcript_path` は
  親セッションの会話ログを指し、子の Read・coord 参照はそこに残らない（`agent_id` があれば子の呼び出し）ため、
  子が CLAUDE.md を全文 Read しても通らない。子は commit までで止め、push・マージ・デプロイは**親が差分とチェックを
  確かめてから代行**する。拒否メッセージもこの理由を言う（以前は「Read してください」と誤誘導していた）。
- 配線: このリポのセッションは `.claude/settings.json`、他プロジェクトのセッションは
  `~/.claude/settings.json`（`web-ios-android-relay.mjs guard-external-actions.mjs`）。後者は PC ローカルで
  git に載らないので、**新しい PC では手で足す**（設計: 本節。確認は `node .claude/hooks/guard-external-actions.test.mjs` 相当の
  `npx vitest run .claude/hooks/guard-external-actions.test.mjs`）。

## セッション開始時の必須アクション（この順で・作業に入る前に）

0. **最初の応答の冒頭で「正本を読み込み済みです」と自己申告する**（2026-09-16確立）。
   `github/CLAUDE.md`の`@web-ios-android/CLAUDE.md`インポート経由で、この正本は
   セッション開始時に自動でコンテキストに入っているはずだが、それをユーザーが
   確認する手段が無く、「web-ios-androidを読んで」と毎回言わせてしまっていた
   （実損: 複数の稼働中セッションで、CLAUDE.mdに解決策がある地雷を自力で再発見
   していた実例が繰り返し見つかった）。★このファイルの内容（非交渉ルール・4基準・
   このキットが何かの一言説明のいずれか）を、実際に**要約して**最初の発言に含める
   （「読み込み済みです」と定型文だけ書いて中身を示さないのは自己申告に過ぎず、
   本当に読めている証拠にならない——基準③「完膚なきまでの裏取り」と同じ考え方）。
   これにより、ユーザーは最初の1発言を見るだけで正本が届いているか判断できる。
   届いていない（要約できない）場合は、正直にその旨を報告し、
   `web-ios-android/CLAUDE.md`を明示的にReadしてから作業を始める。
1. `Read ../CLAUDE.md`（横断の入口。正本1つ・コピー散らさないの原則を再確認）
2. `Read ../ai-hub/CLAUDE.md`（正本ポインタの所在。find/doctor/harvestコマンドを確認）
3. 何かを新規実装する前は必ず
   `node ../ai-hub/bin/hub.mjs find --tag <関連タグ>` または `--sig "<関連キーワード>"`
   を実行し、**同じものが既に他プロジェクトに無いか確認する**（`docs/ai-rules/01_CORE_RULES.md`
   「同機能の重複実装をしない」の実行手段はこれ）。ヒット0は正常（fail-closedでexit 1が返るだけ）。
4. 非自明な地雷を踏んで解決したら、終わる前に`ai-hub`のharvestの掟に従って書き戻す
   （`ai-hub/CLAUDE.md`「harvestの掟」節）。**「良い場所に書いてある」だけでは次のAIは読みに来ない**。
   書き戻すところまでが作業の完了。
5. **本物のClaudeは「考える・判断する・検品する」だけ。手を動かす仕事は他の頭脳へ投げる**（2026-09-15
   本人指示で確定）。ファイル作成・定型修正・調査・文章量産・テスト追加は、自分でやらずに
   `python docs/ai-workflows/tools/dispatch.py --brain <grok|qwen|oc|cf|local> --cwd <dir> "<やること>"`
   で投げ、返ってきたログの要点だけ読んで検品する。頭脳の使い分けと財布（Claude週間上限／SuperGrok／
   Alibaba無料枠／Cloudflare無料枠／ローカル）は正本 [`docs/ai-workflows/MULTI-BRAIN-HOWTO.md`](docs/ai-workflows/MULTI-BRAIN-HOWTO.md) §1b。
   スクリーンショットは文章の何倍も上限を消費するので、画面の内容は本人に文字で貼ってもらう。
   ★**「難しい判断＋実装＋テストまで一貫でやる重い仕事」は Google Antigravity（本人が有料契約済み・Claude Opus 5.5/Sonnet 5.5・Gemini 4 Argon）へ回す**
   （2026-09-16確定、2026-10-21更新）。Antigravity の Opus 5.5 は司令塔と同じ頭脳で、Claude の週間上限とは別の Google 側の枠で動く。
   ★Antigravity は CLAUDE.md を読まない（読むのは AGENTS.md）・Turbo は権限無制限で push も止まらない。橋渡しはリポ直下の
   [`AGENTS.md`](AGENTS.md)、拒否リスト・モデル別の役割分担・引き継ぎの流れは正本 [`ANTIGRAVITY-HOWTO.md`](docs/ai-workflows/ANTIGRAVITY-HOWTO.md)。
   予備の頭脳は AWS Kiro Free（カード不要・Sonnet 4.5・薄い）→ Ollama×Claude Code（構築済み・機密用）の順。
   ★★**Grok BuildとAntigravityの使い分け**: 今は「人手が要るか」が主軸で **Grok Build を優先**し、Antigravity は
   正本 [`MULTI-BRAIN-HOWTO.md`](docs/ai-workflows/MULTI-BRAIN-HOWTO.md) §1c の条件（Grok 2回失敗／30分超の設計判断を伴う作業／
   対話的作業／司令塔が自分の上限で重い実装をしそうなとき）に当たるときだけ、理由とモデルを添えて本人に提案する（本人が手で投げる）。
   `agy -p`（headless）を PC で確かめたら `dispatch.py --brain agy` で司令塔が自動で投げる運用へ移る（同 HOWTO「段階2」）。

## 実装着手前の非交渉ルール（NON-NEGOTIABLE、2026-09-02追記）

Deep Research（大企業向けマイクロサービス基盤の調査）を検討した際、Backstage・Pact Broker・
OTel/SLO運用のような新しい基盤は**このキットの規模には過剰**と判断し不採用にした。だが1点だけ、
「AIが調べずに新しく作る→重複する→片方だけ直す→ドリフトする→別の場所が壊れる」という事故を
防ぐ**行動順序の明文化**は、新しい仕組みを増やさずに**既存の仕組みを正しい順番で使わせるだけ**
なので採用する。実装（コードを書く・ファイルを変更する）を始める前に、必ずこの順で確認する:

1. **既存実装を検索する** — `Grep`/`Glob`で対象領域の既存コードを探す
   ★**否定形で答える前ほど検索を飛ばしやすい**（2026-09-14、line-bot-e8の同日5件の実損から確立）。
   「できません」「ありません」「〜が必要です」と言いかけた瞬間こそ、この1番を踏んでいるか
   自問する。実例: 「LINEアカウント作成は代行できません」→未検索のまま2回連続で回答→
   3度目にユーザーから「web-ios-android見れば仕組み化しているはず」と言われて初めて
   検索し、`ai-shain-worker`配下に`open-line-form.mjs`（reCAPTCHA部分だけ人に渡す設計。
   [`docs/ai-rules/05_HANDING_SCREEN_TO_HUMAN.md`](docs/ai-rules/05_HANDING_SCREEN_TO_HUMAN.md)
   の出典元）が既にあると判明。他4件も同日同型（プライバシーポリシー公開・OAuth設定・
   開発者登録・API仕様、いずれも「一般論の手順を先に語り、実環境を見ていない」）。
   ★**新しく作るときは検索するのに、「無理だ」と判断するときだけ検索を省略する**という
   非対称性が本質。否定的な結論を出す前は、肯定的な結論を出す前と同じ強度で検索する。
   ★この1番は `.claude/hooks/check-write-preceded-by-search.mjs`（`PreToolUse(Write|Edit)`・非ブロッキング）が機械検知する
   （新規関数定義らしきパターンを書く前の直近15ツールに Grep/Glob が無ければ警告）。実装経緯（soushin の自己不整合実損）・
   機械化できない部分の明示: [`_docs/DESIGN-claude-md-decay-2026-09-24.md`](_docs/DESIGN-claude-md-decay-2026-09-24.md)。
2. **`ai-hub`で共通部品を確認する** — `node ../ai-hub/bin/hub.mjs find --tag <関連タグ>` / `--sig "<キーワード>"`（「セッション開始時の必須アクション」3番目と同じコマンド。実装着手の直前にもう一度確認する）
2.5. **CANONICAL CHECKを通す** — 既存候補が見つかったら「それを信じてよいか」を判定する
   （同じ責務か・同じ意味か・置き場所は適切か・依存方向は逆転していないか）。判定結果は
   REUSE / ESTABLISH_REHOME / CONTRACT / SYNC / KEEP_SEPARATE / LOCAL の6種類のいずれかで、
   詳細な定義・判定基準は正本 [`_docs/DESIGN-canonical-boundary-rules.md`](_docs/DESIGN-canonical-boundary-rules.md)
   を参照する（本文をここへコピーしない）。新規source fileを含む変更は、判定結果を
   `record-decision-receipt.mjs` で記録すること（`templates/scripts/check-decision-receipt.mjs`
   が記録の有無を機械検査する）
3. **同等機能があれば新規実装しない** — 見つかったら再利用・薄い拡張に倒す。「速いから」で複製しない
4. **PAIRS / drift対象を確認する** — 正本とコピーの関係にあるファイルを変更するとき、
   [`_docs/instruments/check-drift.mjs`](_docs/instruments/check-drift.mjs) の `PAIRS` に登録済みか見る。
   未登録の新規コピーを作るなら、そこにも追記する
5. **変更による影響範囲を確認してから編集する** — 呼び出し元・配布先（`templates/`配下は複数プロジェクトへ配られる前提）を把握してから触る
   ★★**「設計書が指す対象ファイル」を鵜呑みにせず、実際のルーティングから到達可能か確認する**
   （2026-09-29実損、`kimito-Link-Voice`）。`index.html`（旧「声優マッチング」時代のダッシュボード）
   を設計書どおりに全面実装・本番デプロイしたが、`server.js`の実ルーティングは`/`に`lp/index.html`
   を配信しており、`index.html`はどこからもリンクされていない未使用ファイルだった。設計書
   （`../kimito-Link-Voice/docs/DESIGN-clerk-migration-2026-09-26.md`）自体が、事業ピボット（`../kimito-Link-Voice/docs/BILLING-DESIGN.md`）
   を踏まえず旧`index.html`を前提に書かれた古い設計書だった。「ファイルが存在する」ことと
   「そのファイルが実際に配信されている」ことは別の命題——複数のHTML/エントリファイルが
   存在するプロジェクトで大きな変更に着手する前は、`server.js`等（各言語のアプリ起動ファイル）のルーティング定義を
   grepするか、本番/ローカルの該当パスへ実際にアクセスして確認する。この1番目の「既存実装を
   検索する」を「対象ファイルが到達可能か」にまで広げたもの。
   ★機械化: 「HTMLファイルへの大規模書き換え直前に、ルーティング定義の検索(Grepで`app.get`等)
   または本番/ローカルへの実アクセス(WebFetch/curl)を行った形跡があるか」という客観的事実は
   検出できるが、「設計書の前提が本当に正しいか」という意味判断はできない。
   `.claude/hooks/check-target-file-reachability.mjs`（`check-write-preceded-by-search.mjs`と
   同じtranscript走査・非ブロッキング・fail-open型）で実装済み、`settings.json`に配線済み。
6. **共通化すべきロジックをプロジェクト固有コードへコピーしない** — ただし**配布境界をまたぐ場合は例外**（`templates/scripts/`は配布先に存在しないファイルをimportできない。この場合は「意図的な複製」と明記し、`PAIRS`または同等のコメントで同期対象と分かるようにする。2026-09-02の証明3点台帳実装で実際に踏んだ判断）
7. **既存設計を回避するための一時的な近似実装を作らない** — 手を抜いた代替は基準④「最高品質」違反
8. **Gateを無効化・迂回して成功扱いにしない** — `--no-verify`等でチェックを飛ばさない
9. **変更後は対象Gateをすべて実行する** — 該当する `templates/scripts/run-instruments.mjs`（またはプロジェクト固有の検査群）を実行し、[`templates/diagnostics/check-gates-are-wired.mjs`](templates/diagnostics/check-gates-are-wired.mjs) で配線漏れも確認する
10. **Gate失敗時は対症療法ではなく根本原因を修正する** — 症状を消すのではなく、なぜ起きたかまで遡る（下の「判断の軸」2「100年メンテナンスのいらない設計」そのもの）

迷ったら、**「新しく作る」より先に「既に存在しないか」を調査する**。

この10項目は新しい基盤ではなく、既にあるものを正しい順で使わせる入口にすぎない:
`ai-hub`＝既存資産カタログ／`PAIRS`＝同期契約／各`check-*.mjs`＝警察／`run-instruments.mjs`等のGate＝裁判所／
[証明3点台帳](_docs/instruments/README.md)（`instrument-proof.mjs`・2026-09-02実装）＝判決記録、という役割分担で読むと分かりやすい。

## 並列セッション協調プロトコル（Main-Write Pause、2026-09-07確立）

複数のClaude Codeセッション（このキットに限らず`github/`配下の全プロジェクト共通）が
同じリポジトリで同時に動くことは、もはや例外ではなく実態である
（グローバルルール「同時1セッション」の鉄則は2026-09-07に撤回済み。複数セッション運用を
正式に許容する。PC負荷は別問題として`~/.claude/CLAUDE.md`「PCが重い」節の健康チェックで扱う）。

★このプロトコルの要点: **速さより先に「止める場所」を用意する**。止める場所が無いと、
エージェントは衝突するまで走ってしまう。[`docs/claude-md/05-repo-roles.md`](docs/claude-md/05-repo-roles.md) の`ListAgents`+`SendMessage`方式は
「CLAUDE.mdという1ファイルへの越境書き戻し」という狭い場面には十分だが、
リポジトリ全体・全ファイルを対象にした一般ルールとしては以下を使う。

### 共有資源（ここだけ直列にする）

次の操作はcritical section。同時に行ってはいけない。

- `main` / `canonical` への commit
- `origin/main` への push
- 共有設定・本番ledger・共通スキーマ・ロックファイル自体の更新
- 他セッションの作業ブランチへの rebase / merge
- 他セッションが保持しているHEADを動かす操作

ファイル編集そのものは、担当範囲が被らなければ並列でよい。衝突するのは「正本を動かす操作」だけ。

### 協調ファイル: `.agent/coord.md`

対象リポジトリ直下の `.agent/coord.md` **だけ**を見て判断する。推測しない（チャット履歴や
「たぶん空いている」は使わない——基準③「完膚なきまでの裏取り」と同じ考え方）。
存在しなければ作成する。テンプレートは
[`templates/.agent/coord.md.example`](templates/.agent/coord.md.example) を参照
（**git管理下に置くが、write_lock状態やsessions一覧は頻繁に変わるため、
実運用中の`.agent/coord.md`自体はコミット対象にしない** — `.gitignore`に追記して
差分ノイズを避ける。ファイルの存在と最新状態だけが意味を持つ）。

**セッションID**: 自分のIDを最初に決めてcoordに書く（例: `cc-web-ios-android-13`）。
同じIDを二セッションで使わない。

**開始時の義務**: どの作業を始める前にも、この順で動く。
1. `.agent/coord.md` を読む（存在しなければテンプレートから作成する）
2. 自分のsession行を追加または更新する
3. `write_lock.state` を見る
   ★`updated`も一緒に見る（2026-09-14追記）。`updated`が明らかに古い（直近の
   セッション活動間隔より古い）のにFREEと書かれている場合、単に更新が止まっている
   だけの可能性がある。その場合はFREEをそのまま信用せず、直近のコミット履歴等で
   他セッションの活動有無を確認してから進める方が安全（fail-closed）。
4. 自分が触るファイルが他セッションの`files`と重ならないか見る
5. 重なる、または main-write が必要なら、先にロックを取りにいく

coordを読まずにcommit / push / main更新をしてはいけない。

### Main-Write Pauseの取り方

自分がcanonical write（commit / push / main更新）をする必要があるとき:
1. `write_lock.state`がFREEなら自分をholderにしてPAUSEDにする
2. 他セッションへ`PAUSE_REQUEST`を書く
3. 他セッションが共有資源へのwrite/commit/pushを止めた証拠がcoordに出るまで、自分も正本を動かさない
4. 自分のcritical sectionだけを実行する
5. 終わったら必ず解除する

他セッションが既にPAUSEDなら、勝手に奪わない。messagesに待ち理由を書き、
自分の作業のうち正本を動かさない部分だけ続ける。正本が必要なら待つ。

**止められた側**（`PAUSE_REQUEST`を見たら、進行中でも次を行う）:
1. 未commitの共有資源変更を捨てるか、自分の専用ブランチへ退避する
2. main / canonicalへのwrite・commit・pushを止める
3. coordに`PAUSED`を書く
4. 自分のローカル専用作業は続けてよい。ただし正本には触らない

**解除**: ロック保持者だけが解除できる。解除条件は、自分のcritical sectionが終わっている・
canonical HEADが意図したshaになっている・remoteと一致しているか一致していない理由を明記している・
他セッションのブランチ/作業状態を書き換えていないこと。解除し忘れたままセッションを終えては
いけない。中断するなら`resume_after`と`reason`を残し、holderを明示したまま次に引き継ぐ。

### ファイル衝突

同じファイルを二人で編集しない。先にcoordの`files`を宣言した側が優先。後から来た側は
そのファイルを読んでもよいがWrite/Editしない。どうしても必要なら`PAUSE_REQUEST`を出し、
相手の区間が終わるのを待つ。worktreeを使っている場合でも、canonical mainと共有ファイルは
別空間ではない——ロック対象はリポジトリ正本。

### やってはいけないこと

- ロックを取らずに`git commit` / `git push` / `git merge main` / `git rebase`
- 「短いから大丈夫」でcritical sectionを黙って通す
- 相手の作業ブランチを勝手にfast-forward / resetする
- 停止解除を口頭や通常チャットだけに書く（必ずcoordに残す）
- 自分がholderなのに、終わってもPAUSEDのまま放置する
- 完了報告で「全部終わり」と言うが、次セッションが再開できない
- ★★**`git reset --hard` の前に必ず `git status --short` で巻き込む未コミット変更が無いか目視する**
  （1件でもあれば使わない）。1コミットだけ戻すなら `HEAD~n` 相対で指定（離れたSHAを漠然と指定しない）。
  `main` を origin に揃えるだけなら `reset --hard` でなく `git stash`→`git pull --ff-only`→（必要なら）`git stash pop`。
  実損の詳細・なぜcoord/機械検査で防げないか: [`_docs/git-safety-knowledge-base.md`](_docs/git-safety-knowledge-base.md)
  （2026-09-28 kimitolink-linktree の巻き込み削除事故）。

### 作業分担の原則

並列にしてよいもの: 別ディレクトリの実装／テスト追加（対象実装ファイルを書き換えない場合）／
調査・ログ読み・ドキュメント草案／自分のfeature branch上のローカルcommit（push しない・main を
動かさない）。

直列にするもの: main更新／共有API・スキーマ・マイグレーション／依存関係のbump／
リリース・タグ・本番設定。

迷ったら直列。並列は「止める場所が空いているとき」だけ使う。

## 判断の軸

詳細・実損エピソードは [`docs/claude-md/09-ai-guidelines.md`](docs/claude-md/09-ai-guidelines.md) 参照。判断が割れたらこの順で決めて実行する:
1. **事業指標の最大化**: 北極星「LTV÷CPA」（＋回収期間）とガードレール（[`docs/ai-rules/07_GROWTH_METRICS.md`](docs/ai-rules/07_GROWTH_METRICS.md)）。
2. **100年メンテナンスのいらない設計**: 対症療法を選ばず根本原因を直す（[`docs/ai-rules/01_CORE_RULES.md`](docs/ai-rules/01_CORE_RULES.md) §2-1）。
3. **選択肢を出して止まらない**: 2軸で自ら決めて実行→事後報告。判定基準自体を選択肢にしない。質問は理由タグ必須。
4. **あらゆる調査と完膚なきまでの裏取り**: 質問・報告前に検索・公式仕様・実機/本番反映・出典紐付けを尽くす。
5. **秘密の扱い**: 公式MCPの実操作確認を優先。新しい秘密値は引数に載せずクリップボード経由で扱い、発行と保管済み取り出しを混同しない。

<!-- core:end — ここまでが「必ず読む核」。これより下は、必要になった節だけ読めばよい。
     hook(.claude/hooks/)が「CLAUDE.md を現在の内容のまま読んだか」を判定するのは、この行までの行だけ(2026-10-19)。
     核の行数には上限がある(templates/diagnostics/check-claude-md-budget.mjs)。核に足すときは、上限を超えないよう
     実損エピソードを site/learnings/ か _docs/ へ移し、規範と検査の入口だけを残す。 -->

## 必要なときに読む節

別のプロジェクトで作業中でも、下のパスは `web-ios-android/` からの相対です。

| 節 | 読むとき | ファイル |
|---|---|---|
| 正本への自動到達経路（★★この修正が効かない既知のケース: 稼働中セッション） | 長時間セッション・hook拒否への対処を確認するとき | このファイル（核「正本への自動到達経路」節） |
| **デスクトップ／ノートPC・複数AI共通の開発継続ルール（2026-09-16確立）**<br><small>大前提：新しい共有機構は作らない ／ 何を共有し、何を共有しないか ／ 引き継ぎ形式: プロジェクト直下の `handoff.md` ／ 再調査・再テストを避ける（両PC・全AI共通の作法） ／ AI-agnostic（頭脳が変わっても止まらない） ／ 実装時の注意（このキット自身が踏まないための先出し）</small> | PC・AI間の作業引き継ぎ（`handoff.md`）を行うとき | [`docs/claude-md/01-handoff.md`](docs/claude-md/01-handoff.md) |
| **AI特有の認知の癖と対処（2026-09-07追記）**<br><small>★新しいルールを書いたら、その場で機械検査化を検討する（2026-09-14追記）</small> | ルール追記時（新しいルールを書いたら、その場で機械検査化を検討する） | [`docs/claude-md/02-cognitive-biases.md`](docs/claude-md/02-cognitive-biases.md) |
| **設計書・引き継ぎ文書は「AIも人間も理解しやすく」書く（2026-09-08追記）** | 設計書・実装ハンドオフ・マップ文書を書くとき | [`docs/claude-md/03-doc-writing.md`](docs/claude-md/03-doc-writing.md) |
| **★有料APIを使う機能は「使われるほど黒字」の式を先に書く（2026-10-19確立）** | 有料APIを使う機能を企画・実装・監査するとき | [`docs/claude-md/04-paid-api-cost.md`](docs/claude-md/04-paid-api-cost.md) |
| **このリポの2つの役割（2026-08-26追記）**<br><small>★別プロジェクトからこの心臓部（CLAUDE.md）に知見を書き戻すときの作法（2026-09-01追記）</small> | 他プロジェクトからCLAUDE.mdへ知見を書き戻すとき | [`docs/claude-md/05-repo-roles.md`](docs/claude-md/05-repo-roles.md) |
| **このテンプレは何をするものか** | このテンプレの全体像を確認するとき | [`docs/claude-md/06-template-overview.md`](docs/claude-md/06-template-overview.md) |
| **AIへの依頼の受け方** | 「〇〇というアプリを作って」と依頼を受けたとき | [`docs/claude-md/07-request-handling.md`](docs/claude-md/07-request-handling.md) |
| **自動化の実体はキット同梱（`templates/` から使う）** | `templates/` のスクリプト・CI・計器・KBを探すとき | [`docs/claude-md/08-bundled-automation.md`](docs/claude-md/08-bundled-automation.md) |
| **AIへのお願い（守ること）**<br><small>商品としてのインパクト基準（2026-09-28追加） ／ 「選択肢を出して止まらない」＝「選択肢を提示だけして返事を待つ」ではない ／ 「人間に確認してください」で止まる前に、あらゆる調査を尽くす ／ 裏取りも同じ強度で徹底する ／ トークン発行・秘密の投入が絡む場面は、使える公式MCPがあれば必ずそちらを優先する ／ 事業指標の最大化（CVR・LTV・CPA効率ほか、2026-10-22拡張） ／ 100年メンテナンスのいらない設計＝根本解決</small> | 実装・調査・質問判断（選択肢を出して止まらない／あらゆる調査を尽くす／完膚なきまでの裏取り／4つの基準） | [`docs/claude-md/09-ai-guidelines.md`](docs/claude-md/09-ai-guidelines.md) |
| **★Webの独自ドメイン接続は1コマンド（2026-09-04 追記・characterlive から書き戻し）**<br><small>★1回だけやること（以後ずっと自動） ／ ★ネームサーバーは Cloudflare のまま変えない ／ 覚えておく値（毎回調べ直さない） ／ ★★Cloudflareのトークンは「用途ごとに権限が独立している」（2026-09-05 line-bot から書き戻し） ／ ★★トークンは「手元に持ってこない」で済むことが多い（2026-09-05） ／ ★★★秘密は「発行」と「取り出し」を混同しない（2026-09-08 line-botから書き戻し） ／ ★同時に踏んだ罠（`vercel.json` はコメント不可）</small> | 独自ドメイン接続・Cloudflare権限・秘密の取り出しを扱うとき | [`docs/claude-md/10-domain-and-cloudflare.md`](docs/claude-md/10-domain-and-cloudflare.md) |
| **確認と不具合対応の共通ルール（2026-09-07追記）**<br><small>最優先方針 ／ 確認環境の優先順（固定） ／ 禁止すること ／ 証拠の置き場所 ／ ★Chrome拡張は「AIが読み込んで自分で確かめる」（2026-10-25確立・全拡張リポ共通） ／ ★★AIは人の普段の Chrome に繋がない（「リモートデバッグを許可しますか？」を出さない、2026-10-26確立・全ツール共通） ／ ★「観測系そのものが壊れている」可能性を先に疑う（2026-09-11追記）</small> | UI/実機/エミュレータ/Chrome拡張の動作確認・不具合対応を行うとき | [`docs/claude-md/11-verification-rules.md`](docs/claude-md/11-verification-rules.md) |
| **★社外の人に渡すページは、自社ドメインの https に置く（2026-09-08 追記・best-price から書き戻し）** | 社外・取引先に渡すページを作るとき | [`docs/claude-md/12-external-sharing.md`](docs/claude-md/12-external-sharing.md) |
| **⚠️ 公開でハマりやすいポイント（実体験ベース）** | ストア公開・審査提出前の注意点を確認するとき | [`docs/claude-md/13-release-pitfalls.md`](docs/claude-md/13-release-pitfalls.md) |
| **フォルダ構成（現状）** | フォルダ構成やLP同期（`site/LP-SYNC.md`）を確認するとき | [`docs/claude-md/14-folder-structure.md`](docs/claude-md/14-folder-structure.md) |
