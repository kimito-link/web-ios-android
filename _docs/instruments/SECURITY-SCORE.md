# 出荷前に「malwarecheck.site満点」を内部確認＋本体実測する（AIが読む1枚）

> ★この1枚だけで着手できる粒度で書いてあります。
> 内部先取り: `malwarecheck.site` の減点表・ヘッダ判定ロジックを移植。
> 最終確認: `malwarecheck.site/api/scan` へ公開URLだけを送り、本体スコアも実測する。

---

## 0. 何をするものか

`web-ios-android` キットで作ったWebサイトを、次の2段階で確認する。

1. 同じ減点基準を内部スクリプトで先取りチェックする。
2. `malwarecheck.site` 本体の公開診断APIでも実測し、両方100点のときだけ緑にする。

```bash
node templates/scripts/verify-security-score.mjs
# app.config.json の identity.productionDomain を自動で読んでGETする

node templates/scripts/verify-security-score.mjs --url https://example.com
# 任意のURLを直接指定する場合

node templates/scripts/verify-security-score.mjs --url https://example.com --local-only
# 外部サービスを使えないときの内部先取りのみ（本体100点の証明にはならない）
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

## 2. チェックしている項目（malwarecheck.site の WEIGHTS 全26項目との対応）

★**車輪の再発明をしない方針（2026-08-25確立）**: malwarecheck.site 本体は
26項目すべてを正式実装済みの公式スコアリングエンジン。それを自前で再実装するのは
車輪の再発明であり、かつ移植の過程で必ずズレる。だから**正確な判定は必ず本体実測
（`scoreViaMalwarecheck`）に委ねる**。内部先取り（`scoreUrl`）は「本体が一時的に
使えないときの最低限の目安」に位置づけを絞り、以下13項目のみを持つ
（`--local-only` で内部先取りだけを見られるが、これは満点の証明にはならない）。

| WEIGHTS全項目 | 減点 | 内部先取り | 本体実測 |
|---|---|---|---|
| httpsMissing | 25 | ✅ | ✅ |
| sslError | 20 | ❌（Node標準fetchでは証明書検証の詳細が取れないため見送り） | ✅ |
| hstsMissing | 3 | ✅ | ✅ |
| cspMissing | 8 | ✅ | ✅ |
| xFrameOptionsMissing | 5 | ✅ | ✅ |
| xContentTypeMissing | 4 | ✅ | ✅ |
| referrerPolicyMissing | 3 | ✅ | ✅ |
| permissionsPolicyMissing | 2 | ✅ | ✅ |
| wpPathExposed | 5 | ❌ | ✅ |
| wpVersionExposed | 5 | ❌ | ✅ |
| externalScriptsMany | 8 | ❌ | ✅ |
| suspiciousExternalDomain | 15 | ❌ | ✅ |
| iframeMany | 8 | ❌ | ✅ |
| redirectChainLong | 12 | ❌ | ✅ |
| redirectCrossDomain | 15 | ❌ | ✅ |
| redirectTampering | 15 | ❌ | ✅ |
| robotsMissing | 2 | ❌ | ✅ |
| sitemapMissing | 2 | ❌ | ✅ |
| titleMetaAbnormal | 8 | ❌ | ✅ |
| unreachable | 30 | △（到達不可はinconclusive扱いで代替） | ✅ |
| envFileExposed | 30 | ✅ | ✅ |
| gitDirExposed | 25 | ✅ | ✅ |
| backupFileExposed | 18 | ❌ | ✅ |
| directoryListing | 12 | ❌ | ✅ |
| serverVersionExposed | 4 | ✅ | ✅ |
| poweredByExposed | 4 | ✅ | ✅ |
| cookieInsecure | 6 | ✅ | ✅ |
| credentialInsecureAction | 10 | ❌ | ✅ |

★上記に加えて本体実測は `reputation`（VirusTotal等の外部評価API連携）、
`email-hygiene`（SPF/DMARC）、`surface`（crt.sh証明書透明性ログ照合）、
`injection-surface`（SQLi/XSS受動シグネチャ）、`credential`（ログインフォーム静的解析）
の各カテゴリも持つ。これらは外部API連携・専用パーサが要るため内部先取りには
移植していない（同じ理由＝再発明しない）。

★**この検査の限界**（`verify-security-score.mjs` の出力にも毎回明記される）:
- 内部先取りはヘッダ・HTML静的解析で完結する13項目のみ。**正式なスコアは本体実測**。
- 公開URLだけを外部サービスへ送る。秘密情報やローカルファイルは送らない。
- 「100点」は外部から見える簡易診断の満点であり、安全性や感染の有無を保証しない。
- `reputation`カテゴリ（VirusTotal等）の減点は**自サイトの設定不備ではない**。
  ヘッダを直しても消えない（実測: 2026-08-25、`malwarecheck.site`自身がこのカテゴリで
  減点されるケースを確認済み。`howToFix`はカテゴリ別に案内を分けてある）。

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
node templates/scripts/verify-security-score.mjs                                # 内部100＋本体100で0
```

★**exit 2（inconclusive）が出た場合は「安全」ではなく「測れなかった」**。
`app.config.json` の `identity.productionDomain` が空、デプロイ未完了、または
`malwarecheck.site` 本体が一時的に利用できない可能性がある。

短時間に何度も外部診断すると、対象本体ではなく
`Vercel Security Checkpoint` などのアクセス確認画面を取得する場合があります。
その画面の71点などを対象サイトの点数として扱わず、「測れなかった」にします。
時間を空けて再実行し、対象本体を取得した実測で100点になった場合だけ完了です。
