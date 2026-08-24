# 出荷前に「malwarecheck.site満点」を先取りする（AIが読む1枚）

> ★この1枚だけで着手できる粒度で書いてあります。
> 移植元: `malwarecheck.site`（`packages/core/src/scoring/weights.ts` の減点表・
> ヘッダ判定ロジック）。あちらは「他人のサイトを外部から診断するツール」、
> こちらは「自分のアプリを出荷する前に、同じ基準で先取りチェックする道具」。

---

## 0. 何をするものか

`web-ios-android` キットで作ったWebサイトを実際に `malwarecheck.site` のようなセキュリティ診断
サービスへ投げたときに減点されないよう、**同じ減点基準を出荷前に自分でチェック**する。

```bash
node templates/scripts/verify-security-score.mjs
# app.config.json の identity.productionDomain を自動で読んでGETする

node templates/scripts/verify-security-score.mjs --url https://example.com
# 任意のURLを直接指定する場合
```

---

## 1. 守っている不変条件（malwarecheck.site から継承）

`malwarecheck.site` の `_docs/five-passive-security-checks-DESIGN.md` /
`_docs/owasp-coverage-triage-DESIGN.md` で確定した方針をそのまま引き継ぐ:

> **公開URLへのGETのみ。攻撃・侵入・総当たりは一切しない。**

★このスクリプトも同じ。SQLi/XSSの実注入テスト・ポートスキャン・パスワード総当たり等は
**一切行わない**。`.env` / `.git/config` の存在確認も「GETして200が返るか」だけを見る
（中身をダンプしたり、取得した秘密情報を保存したりはしない）。

理由（malwarecheck.site側の裁定を踏襲）:
1. 同意なき能動探査は攻撃行為そのもの
2. ストア審査（Google Play等）で「攻撃ツール」と誤読されるリスク
3. 受動チェックで「安全」と断定すると過信を招く（このスクリプトも「兆候が無い」を
   「安全」と読み替えない。limitationを必ず出力する）

---

## 2. チェックしている項目（malwarecheck.site の WEIGHTS と対応）

| 項目 | 減点 | 何を見るか |
|---|---|---|
| httpsMissing | 25 | HTTPS到達性 |
| sslError | 20 | ※現状未実装（TLS証明書エラーの検出はNode標準fetchでは限界があるため見送り） |
| envFileExposed | 30 | `/.env` がGETで200を返すか |
| gitDirExposed | 25 | `/.git/config` がGETで200を返すか |
| hstsMissing | 3 | `Strict-Transport-Security` ヘッダー |
| cspMissing | 8 | `Content-Security-Policy` ヘッダー |
| xFrameOptionsMissing | 5 | `X-Frame-Options`（またはCSPの`frame-ancestors`） |
| xContentTypeMissing | 4 | `X-Content-Type-Options: nosniff` |
| referrerPolicyMissing | 3 | `Referrer-Policy` |
| permissionsPolicyMissing | 2 | `Permissions-Policy` |
| serverVersionExposed | 4 | `Server` ヘッダーにバージョン番号が出ていないか |
| poweredByExposed | 4 | `X-Powered-By` ヘッダーの有無 |
| cookieInsecure | 6 | `Set-Cookie` に `Secure`/`HttpOnly` があるか |

★**この検査の限界**（`verify-security-score.mjs` の出力にも毎回明記される）:
- `malwarecheck.site` 本体が持つ crt.sh照合・SPF/DMARC・Pwned Passwords連携等の
  外部API依存項目は再現していない。ヘッダ・HTML静的解析で完結する項目のみ。
- 「兆候が無い」は「安全」を意味しない。実際に `malwarecheck.site` へ投げての
  確認も推奨する（このスクリプトはあくまで出荷前の先取りチェック）。

---

## 3. 直し方（減点されたときの対応）

デプロイ先（Vercel / Cloudflare Pages）ごとに、セキュリティヘッダーの設定場所が違う。

**Vercel（`next.config.ts` 等）**:
```ts
async headers() {
  return [{
    source: '/(.*)',
    headers: [
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
      { key: 'Content-Security-Policy', value: "default-src 'self'; ..." },
    ],
  }];
}
```

**静的サイト（Cloudflare Pages 等）**: `_headers` ファイルに同様の設定を書く。

`.env` / `.git` 露出は、静的配信ルート（`public/` や `site/` 等）にこれらのファイルを
**置かないこと**で防ぐ（ビルド成果物に混入していないか確認する）。

---

## 4. 完了の判定

```bash
node templates/scripts/verify-security-score.mjs --selftest ; echo "exit=$?"   # 0であること
node templates/scripts/verify-security-score.mjs                                # 実サイトに対して0であること
```

★**exit 2（inconclusive）が出た場合は「安全」ではなく「測れなかった」**。
`app.config.json` の `identity.productionDomain` が空、またはデプロイ未完了の可能性が高い。
