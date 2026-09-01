# diagnostics/ — 汎用コード診断キット

**どんなJS/TSプロジェクトにも使える、依存ゼロの出荷事故ゲート4本＋実行ランナー。**
web-ios-androidキット固有ではなく、`github/`配下のどのリポにも `node diagnostics/run.mjs <対象ディレクトリ>` を
実行するだけで使える。思想は [`../../docs/ai-rules/04_SELF_VERIFICATION.md`](../../docs/ai-rules/04_SELF_VERIFICATION.md) §5「工程ガード」の具体化。

## 使い方

```bash
# 4本まとめて実行（対象ディレクトリを省略するとcwd）
node templates/diagnostics/run.mjs /path/to/other-repo

# 1本だけ実行したいとき
node templates/diagnostics/check-lockfile-sync.mjs /path/to/other-repo
```

gitリポジトリでない・package.jsonが無い等、チェックの前提が対象に存在しない場合は
fail-closedではなく`skip`として扱う（対象外を機械的に確定できないものを赤にしない）。

## 中身

| スクリプト | 検出すること | 対応拡張子/前提 |
| --- | --- | --- |
| `../scripts/check-tracked-imports.mjs`（正本はこちら・コピーしない） | git未追跡ファイルへのimport（`git add`忘れ）。git clone直後(CI/Vercel)の実体を再現 | `.js/.mjs/.ts/.tsx/.jsx` |
| `check-lockfile-sync.mjs` | package.jsonとpackage-lock.jsonの依存不一致（lockfile更新忘れ） | npm(lockfileVersion 2/3、packages形式)。yarn/pnpmはskip |
| `check-secrets-not-tracked.mjs` | `.env`・鍵/証明書ファイル等の秘密情報が誤ってgit追跡されていないか | git管理下のみ |
| `check-large-tracked-files.mjs` | 巨大ファイル（既定5MB超）の誤追跡 | git管理下のみ。閾値は第2引数で変更可 |
| `check-selftest-coverage.mjs` | ★検査自身が「サボると赤くなるか」を確かめているか（メタ検査） | このキット自身を見る |
| `check-symptom-index.mjs` | 症状の言葉から原因の索引を引けるか | `SYMPTOMS.md` 等。無ければskip |
| `check-timing-instrumented.mjs` | 「遅い」と言われる経路に**時間**を測る計器があるか | `.ahk/.js/.mjs/.ts/.cs/.py` |
| `check-heartbeat-present.mjs` | ★製品が「異常なし」を自分で名乗れるか（心拍） | ログを書く製品のみ。書かなければskip |
| `check-instruments-reachable.mjs` | ★計器が**あるのに動かない**形（try に飲まれて一度も記録されない） | ラチェット。実測値を基準に |
| `check-silent-hang-guard.mjs` | ★**コンソールが無いと固まる**書き方（進捗バーの抑止漏れ） | `.ps1/.psm1`。他言語は表で追加 |
| `check-hotkey-scope.mjs` | ★AutoHotkey製常駐アプリで**前面判定(WinActive)の無いホットキー**（他アプリのキーボードを奪う） | `.ahk`。無ければskip |
| `check-shared-parts-used.mjs` | ★共有部品が**あるのに使われず**同名の関数を自前で持つ数 | ラチェット。`--shared-dir` で場所指定 |
| `check-gates-are-wired.mjs` | ★検査を**作った/格上げしたのに誰も呼んでいない**数 | ラチェット。`--dirs` で置き場所指定 |
| `check-docs-match-code.mjs` | 説明した置き場所と、コードが実際に探す場所のズレ | キット自身を見る |

### ★`check-silent-hang-guard` がなぜ要るか（2026-08-26・実損）

ある製品のビルドが **`Compress-Archive` から返ってこなくなった**。
exe のコンパイルまでは成功するのに zip だけができず、
★**エラーも出ず、stderr も空**。数分待っても終わらない。配布作業が止まった。

最初は「1.5MB の圧縮だから重いのだろう」と考えた。★**これが誤り。**

| 入力 | 既定のまま | 進捗バーを抑止 |
|---|---|---|
| 1KB のファイル1つ | ★**返ってこない** | ★**402 ms** |
| 1.5MB の exe | （同上） | ★**669 ms** |

★**1KB でも固まる。** サイズは無関係だった。
真因は**進捗バーの描画**で、コンソールを持たない環境
（AIのツール実行・CI・出力のリダイレクト下）で待ち続けていた。
`$ProgressPreference = 'SilentlyContinue'` の**1行**で解決した。

**★この型が怖い理由**：失敗が「エラー」ではなく**無言の停止**として現れる。

- 例外が出ない ⟹ try/catch では捕まらない
- 終了コードも返らない ⟹ 「赤か緑か」で見ている検査に映らない
- ★**「重いから遅い」と誤診しやすく、内訳を測るまで永久に見つからない**

**★毒で校正済み**：実際に固まっていた修正前の `build.ps1` を食わせると、
★**赤くなり原因の2箇所（`Compress-Archive` / `Invoke-WebRequest`）を名指し**した。
修正後は緑。自己検査6本（`--selftest`）には、
「コメントの中の抑止を有効と数える」偽の緑も固定してある。

### ★`check-hotkey-scope` がなぜ要るか（2026-09-01・実損。soushin-suggest.linkから移植）

AutoHotkey製の常駐ツールで、オーナーが作業中に**「スペースキーを打っても変換されない」**
状態になった。★製品を `Stop-Process` した瞬間に直った＝製品が原因。同じ日に2回起きた。

真因は1行だった：

```ahk
#HotIf IsLauncherAlive() && !IvIsOpen()      ← ★WinActive が無い
Space::IvShowHovered()
```

`IsLauncherAlive()` は「生きているか」であって「前面にいるか」ではない。ウィンドウが前面
でなくても真になり続けるので、★メモ帳でもブラウザでも `Space` がこのホットキーへ吸われた。
他の4本（数字キー・Enter・`^+f`）は全部 `WinActive` を条件に持っていて無事だった。
**1本だけ仲間外れ**だったのを、誰も気づけなかった。

★この検査は綴りでも件数でもなく**条件式の形**を見る。`WinActive` を消せばその場で赤になる。
マウス専用ホットキーは対象外（押した場所が対象を決めるので前面判定が無くても安全）。
`; hotkey-scope-exempt: 理由` を直前行に書けば例外にできる（理由を書かせることで
「なんとなくの例外」を作らせない）。

**★AutoHotkey前提の検査であり、強制しない**：対象に `.ahk` が1件も無ければ `skip`
（`check-heartbeat-present` の「ログを書かない製品には心拍を求めない」と同じ設計）。

**★毒で校正済み**：実損時のコード（`WinActive`無し）を食わせると赤くなり、真犯人の
`Space`を行番号つきで名指しした。修正後のコードは緑。selftest 11ケースには、
「Hotkey関数形式（`Hotkey "Enter", Foo`）の見落とし」「`::`を含む普通の式の誤読
（`ComCall(...)`等）」という、移植元で実際に踏んだ2つの穴も固定してある。

### ★`check-heartbeat-present` がなぜ要るか（2026-08-24・実損）

ある製品で、**製品を起動する重い検査76本（1回22分）**を回していた。
実測すると、**そのスイートが見つけた製品の不具合は0件**だった。
同じ期間の実際の不具合5件は、**オーナーの報告3件**と
**★製品自身が吐いた診断ログ2件**から見つかっていた。

⟹ 重い検査を減らして「製品自身の記録」へ寄せたくなる。**ただし穴が1つある。**

症状が出たときだけ書くログでは、
**「何も起きなかった」と「計器そのものが動いていなかった」が同じ見た目**になる。
実際その製品には「起動時の例外は `OnError` を経由せず、
仕込んだ記録は**一度も呼ばれなかった**」という一次記録がある。

★だから**心拍（症状が無くても定期的に1行書く）が要る**。
最後の心拍から「いつ動かなくなったか」が分かって初めて、沈黙を正常と区別できる。

**★この検査自身が偽の緑を3回出した**（実装中に実測で判明）。
自己検査に3つとも固定してある:

| 偽の緑 | 何を心拍と誤認したか |
|---|---|
| 同じファイルに在るだけ | `SetTimer` と `FileAppend` が別々の用途で同居していた |
| ★1回きりの実行 | `SetTimer(f, -5000)` は**負の周期＝1回だけ**。繰り返さない |
| 関数の外の記録 | 固定長で切ったせいで、別の関数の `FileAppend` を拾っていた |

## 設計方針

- **依存ゼロ**：すべてNode標準API（`node:fs`/`node:child_process`/`node:path`/`node:url`）のみ。対象リポに何もインストールしない。
- **正本を増やさない**：`check-tracked-imports.mjs`は`../scripts/`の既存実装をそのまま呼ぶ。diagnostics/にはコピーを作らない。
- **fail-closed、ただし前提が無ければskip**：「gitリポジトリでない」「package.jsonが無い」等はエラーでなく`skip`（対象外の確定）。実際に検査した上で問題ありなら`exit 1`。
- **純ロジックとI/Oの分離**：各スクリプトは`export function`で単体テスト可能な純粋関数を持ち、`isMain`判定時のみファイルシステム/gitに触れる（`check-tracked-imports.mjs`と同じ流儀）。

## 個別ページ

紹介ページ: [`../../site/features/health-check/`](../../site/features/health-check/index.html)（「🔍 出荷する前に、コードそのものを検査する『診断キット』」節。★2026-08-22に独立ページ`site/features/diagnostics/`から統合済み。旧パスへのリンクは張らないこと）。

---

## diagnostics.json（対象リポが置く案内板・任意）

キットは既定の置き場所を探しますが、**対象リポが自分で宣言**すればそれを優先します。
JS以外の製品や、置き場所の流儀が違うリポはこれで参加できます。

対象リポのルートに置きます:

```json
{
  "symptoms": "_docs/SYMPTOMS.md",
  "index": "../ai-hub/index.json",
  "checks": "scripts",
  "checkPattern": "^check-.*\.(mjs|js|ps1)$"
}
```

| キー | 意味 |
|---|---|
| `symptoms` | 症状IDが書いてあるファイル。**拡張子は問わない**（`.md` の見出し `## SS-01 …` も拾う） |
| `index` | 原因の索引（`triggers` を持つ JSON） |
| `checks` | ゲートが置いてあるディレクトリ |
| `checkPattern` | **どれがゲートか**の正規表現 |

### ★なぜ「決め打ちを増やす」ではなく宣言にしたか

言語や置き場所の流儀は変わり続けます。キット側にファイル名を足し続ける設計は、
**足し忘れた側が黙って skip になる**（一番危ない壊れ方）ので必ず腐ります。

★**場所を知っているのは対象リポ**なので、対象リポに宣言させます。
これなら**キットを一度も更新しなくても、新しい言語のリポが自分で参加できます。**

### ★`checkPattern` が要る理由（実例）

対象を `.ps1` まで広げた途端、あるリポの `verify-*.ps1` が **70本まとめて「欠落」**に数えられました。
しかしそれらは**製品を起動して測るプローブ**で、校正は毒フィクスチャで行います。
`--selftest` を要求すると★**通すためだけの空のselftest**を書かせることになり、このキットの掟に反します。

⟹ ★**種類が違うものを同じ物差しで測らない。** どれがゲートかは対象リポが決めます。

### ★壊れていても診断は止まりません

`diagnostics.json` が不正なJSONでも、**無視して既定の探索に戻る**だけです。
★これは案内板であって関門ではありません。案内板が汚れていることを理由に診断を落とすと、
いつか必ず「JSONの書き間違いで全リポの診断が止まる日」が来ます。
