> CLAUDE.md から移した節です。この中の backtick のパスはリポジトリ直下からの相対です。

## ★Webの独自ドメイン接続は1コマンド（2026-09-04 追記・characterlive から書き戻し）

**Cloudflare のドメインを Vercel に向ける作業を自動化した。管理画面を人が開かない。**

> 発端（ユーザーの言葉）:**「なんか毎回トークン発行する作業があるの大変　おわりにできない？」**
> 実際 `characterlive.link` の公開時、**A レコード 1 本**を足すためだけに人の手が要り、そこで止まった。

```bash
node ../ai-hub/bin/domain-connect.mjs <domain>          # A/CNAME を設定
node ../ai-hub/bin/domain-connect.mjs <domain> --check   # 今の状態を見るだけ
```
実体: `github/ai-hub/bin/domain-connect.mjs`（横断ツールなので正本は ai-hub 側）

### ★1回だけやること（以後ずっと自動）
**https://dash.cloudflare.com/profile/api-tokens** を直接開く → **トークンを作成**
→ テンプレート **「ゾーンDNSを編集する」** → ゾーンリソース **すべてのゾーン**
→ 環境変数 **`CLOUDFLARE_DNS_TOKEN`** に入れる。★値はここに書かない（このリポは public）。

★**既存の `CLOUDFLARE_API_TOKEN` では動かない**（実測）。
　ゾーン一覧は 21 件見えるのに、DNS 操作だけ `10000: Authentication error` で弾かれる。
　**「見えている＝編集できる」ではない。** ツールがこの理由を画面に出すので迷わない。

### ★ネームサーバーは Cloudflare のまま変えない
Vercel の NS に移せば DNS 作業は消えるが、**他ドメインで Cloudflare の機能を使っているので不可**。
A レコードを足すだけにする。

### 覚えておく値（毎回調べ直さない）
| 何 | 値 |
|---|---|
| Vercel の A レコード | `76.76.21.21` |
| www の CNAME | `cname.vercel-dns.com` |
| プロキシ(オレンジ雲) | ★**必ず OFF**。ON だと Vercel の証明書発行が通らない |

### ★★Cloudflareのトークンは「用途ごとに権限が独立している」（2026-09-05 line-bot から書き戻し）

**同じ症状を3回踏んだので、ここに一般化して置く。**

上の DNS の話は特殊事情ではない。**Cloudflare の権限は機能ごとに完全に分かれていて、
1つの権限が他に波及しない。** 実測した例:

| やりたいこと | 要る権限 | ★これでは通らない |
|---|---|---|
| DNSレコードを足す | Zone → DNS → Edit | Zone→Read（見えるだけ） |
| メール受信を設定 | Zone → **Email Routing Rules** → Edit | Zone→DNS→Edit を持っていても**不可** |
| ページに鍵をかける | Account → Access: Apps and Policies → Edit | 他のAccount権限では**不可** |
| Workerを一覧する | Account → Workers Scripts → Read | — |

**★「ゾーンが21件見えている」は、そのゾーンに何かできる保証にならない。**
実測（2026-09-05, kimitotalk.link）:
```
見えるゾーン: 21件           ← Zone→Read はある
Worker: 8件                  ← Workers Scripts→Read もある
Access アプリ: 0件（触れる） ← Access→Edit もある
✗ Email Routing — 10000: Authentication error   ← ここだけ無い
```

**対処**: 足りない権限**だけ**を既存トークンに追記する。
新しく作り直さない（作り直すと GitHub Secrets 等の再登録が発生して事故る）。
→ **https://dash.cloudflare.com/profile/api-tokens** を直接開く → 対象トークンの
　 **Edit** → Permissions に1行足す → Save。**値は変わらないので再登録は不要。**

### ★★トークンは「手元に持ってこない」で済むことが多い（2026-09-05）

GitHub Secrets のトークンは**読み出せない**（設計上そうなっている）。
しかし **workflow の中では使える**ので、設定作業を workflow に置けば
**値を誰の目にも触れさせずに**実行できる。クリップボード経由すら要らない。

実例: `line-bot/.github/workflows/cloudflare-setup.yml` +
`line-bot/scripts/cloudflare-setup.mjs`
- `mode=check` … 何ができるかを読み取るだけ（★変更しない）
- `mode=email-routing` / `mode=access` … 実際に設定する

★**いきなり設定を変えず、必ず check から**。権限不足がその場で分かるので、
「設定したつもりが効いていない」を作らない。
★エラー本文にトークンが混ざり得るので、出力前に必ず伏せる（redact）。

### ★★★秘密は「発行」と「取り出し」を混同しない（2026-09-08 line-botから書き戻し）

line-botで、LINEアクセストークンをリッチメニュー適用のたびに「コピーして『取って』と
言ってください」とユーザーへ依頼し続けていた事故があった。★実際にはトークンは
**登録した時点でD1に既に保管されており**、オーナー権限のAPIキーがあればAPI経由で
取り出せた（`apps/worker/src/routes/line-accounts.ts` — staff権限では伏せるがownerなら返る）。
「保管済みの値を、毎回人に取りに行かせていた」だけだった。

**判断の分かれ目**（この2つを混同しない）:
- **「人にしかできない」＝発行・初回入力・認証**（ここは代行しない。上の`CLOUDFLARE_DNS_TOKEN`
  作成手順・Clerk/X Developer Portalでの新規発行等）
- **「もう保管されている」＝取り出すだけ**（ここを人にやらせない。DB・KV・管理画面のAPIが
  既に返せる値を、AIが自分でAPI経由取得せず人にコピペを頼むのは手抜き）

★2026-09-08時点でweb-ios-androidキット本体・配下の主要プロジェクトを調査した限りでは、
同じ構図（保管済みの値を毎回コピペで頼む実装）は見つからなかった（既存実装はすべて
「新規発行」「未設定時のみ依頼」の正当なパターン）。ただし新しく複数アカウント・
複数チャネルを扱う機能を作るときは、この判断基準を最初に自問すること:
値を要求する前に「これは今どこかに既に保管されていて、権限のあるAPIキーで
取り出せないか」を確認してから、それでも無理なときだけ人に頼む。

**line-botの実装作法**（他プロジェクトへ横展開するときの型）:
- 一覧モードでは値そのものを出さない（何があるかを見るだけ）
- 0件・複数件はfail-closedで失敗する（取り違えて別のものを壊さない）
- 何を取ったかはstderr、値だけstdout（パイプ前提。画面に出さない）
- ファイルに書かない・ログに残さない・会話に貼らない

正本: `line-bot/_docs/LINE-OPERATIONS.md` §4-3a／実装: `line-bot/scripts/line-token.mjs`

### ★同時に踏んだ罠（`vercel.json` はコメント不可）
`vercel.json` に `"//"` でコメントを書くと **デプロイが落ちる**:
`Invalid vercel.json - should NOT have additional property`
→ 設定の理由は**別ファイル**に残す（実例: `characterlive/DEPLOY.md`）。
　特に `/src/*.js` の `Content-Type: text/javascript` は、間違えると
　ES モジュールが実行されず**画面が真っ白**になるので、理由を残す価値が高い。

