# 17. 自動デバッグ：本番を自動で歩き回り、見つけて・記録して・再現して・直ったかまで機械が確かめる

> 2026-11-27 りんく: 龍が如くスタジオの「全自動バグ取りシステム」（CEDEC 2020、[ファミ通の記事](https://www.famitsu.com/news/202009/11205564.html)）を見て「活用されてないような」。
> 部品: [`templates/auto-debug/`](../../templates/auto-debug/)。見張り: [`.github/workflows/auto-debug-watch.yml`](../../.github/workflows/auto-debug-watch.yml)（毎晩 3:00 JST）。

## 1. なぜ要るか

このキットの検査（lint CHECK・hook・`check-*.mjs`）は「書いたコードを読む」「決めた手順を通す」ものだけだった。
本番を**勝手に歩いて**壊れた所を拾い、**証拠と再現手順つきで起票**し、**直ったら同じ手順で確かめる**輪が無かった。
人が「開いてみたら壊れていた」で気づく不具合（JS の例外・500・真っ白・リンク切れ）は、人が見る前に機械が見つけるべきもの。

## 2. 記事の工程と、このキットでの対応

| 記事の工程 | このキット | 部品 |
|---|---|---|
| 夜、空いた機械でテストを回す | 毎晩 3:00 JST に GitHub Actions（公開リポなので無料）で回す | `auto-debug-watch.yml` |
| 操作を記録して自動テストにする（どこでもリプレイ） | 歩いた手順をそのまま JSON に残す。種で歩き方が決まるので同じ種＝同じ道 | `explore.mjs`・`lib.mjs` `rng` |
| ランダムに寄り道して探す | まだ行っていない所を8割優先して、リンク・ボタンを押して回る | `lib.mjs` `pickTarget` |
| 異常を自動で見つける | JS の例外・500番台・真っ白・20秒固まる・サイト内404・コンソール error・通信切れ | `explore.mjs` `walk` |
| 見つけたら自動で再現を確かめる | その場で同じ手順をもう一度たどり、出たら「自動再現済み」 | `explore.mjs` |
| ログ・画像・再現データつきで自動起票 | Issue 本文に中身・場所・再現手順 JSON、証拠は Actions の成果物（14日） | `report.mjs` |
| 人のバグと自動の報告を分ける | ラベル「エラー報告(自動)」 | `report.mjs` |
| 重複数で優先度・種類で重要度 | 同じ指紋の合計回数で P1(10回)/P2(3回)/P3、種類で重要度:高/中/低 | `lib.mjs` `priorityOf` `SEVERITY` |
| 修正後、同じ手順で自動確認／再発なら差し戻し | 閉じた Issue の手順を毎晩たどり直し、出なければ「直ったのを自動確認」、出たら開け直す | `lib.mjs` `planActions` |
| もう出なくなったら自動で確認済み | 14日出なければ自動で閉じる | `lib.mjs` `QUIET_DAYS_TO_CLOSE` |

★記事で「人の手」だった直す作業は、この Issue に `ai-task` が付くので AI が拾う（再現手順があるので再現待ちが要らない）。

## 3. 守ること

1. **本番を壊さない**: 同じサイトへの書き込み（POST・PUT・PATCH・DELETE）は届けずに空の成功を返す。文字は打たない。
   削除・購入・送信・ログアウトなどの文言（`lib.mjs` `DENY_WORDS`）は押さない。外のサイトへは出ない。
2. **見る範囲は一覧1つ**: `templates/scripts/lib/app-links.json` の `web`（導線の見張りと同じ一覧）。新しいサービスを出したら1行足すだけで、毎晩歩かれる。
   歩かせたくないサービスだけ `"autoDebug": false` を書く。
3. **見つけた不具合を直したら**、その Issue を PR で閉じる。閉じたあとは機械が毎晩たどり直すので、「直ったか見てください」と人に頼まない。
4. **誤報が出たら検知の側を直す**（その Issue を手で閉じるだけにしない）。`lib.mjs` の判定を直し、`lib.test.mjs` に毒の例を足す。

## 4. この仕組みが判定しないこと

- ログインが要る画面の中（入口までしか歩かない）。LINE Bot は [`12_LINE_SIMULATION.md`](12_LINE_SIMULATION.md)、拡張は `npm run verify:extension`。
- 見た目の崩れ・文言の誤り・遅さの点数（週1の `scheduled-quality-check.yml` の Lighthouse）。
- 1回だけで再現しない不具合の原因（「自動再現しなかった」と書いて起票する。重複が増えれば優先度が上がる）。

## 5. 手元で回す

```
node templates/auto-debug/explore.mjs --url https://example.com/ --steps 20 --out auto-debug-out
node templates/auto-debug/explore.mjs --replay auto-debug-out/<指紋>.replay.json   # 0=出ない 1=再現
npm run auto-debug:selftest
```
