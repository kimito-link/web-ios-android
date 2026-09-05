#!/usr/bin/env node
// Play が実際に配布する APK の署名が assetlinks.json に載っているかの検証。
// ★TWA の「アドレスバーが消えない」を出荷前に機械で捕まえる唯一の手段。
//
// 背景（2026-09-05、Exosome のドメイン移行で実際に踏んだ）:
//   assetlinks.json には【アップロード鍵】の指紋だけが登録されていた。
//   Play App Signing が有効だと、Google がアップロードされた AAB を
//   ★別の鍵で再署名して配布する。その鍵が assetlinks.json に無いと
//   実機で Digital Asset Links 検証に失敗し、TWA が Custom Tab に落ちて
//   画面上部に URL の帯が出る。
//   製品版へ昇格する直前にこの検査を入れて発見した。入れていなければ
//   全ユーザーのアプリにアドレスバーが出たまま配信されていた。
//
// ★なぜ既存の手段では捕まらないのか（全部試して確認済み）:
//   - verify-assetlinks-published.mjs … 配信の有無と package_name 一致まで。
//       指紋は「Play App Signing で変わりうる」として意図的に判定対象外。
//       ★その空白がここ。この検査がその穴を埋める。
//   - Google の Digital Asset Links API
//     (digitalassetlinks.googleapis.com/v1/statements:list)
//       … statement ファイルの構文と到達性しか見ない。
//       ★どの鍵で APK が署名されているかは見ていないので、
//         不一致でも errorCode なしで通る。実際に通ってしまった。
//   - keytool -printcert -jarfile / apksigner verify --print-certs
//       … ローカル成果物の【アップロード鍵】が出るだけ。配布される署名ではない。
//   - bubblewrap validate / doctor
//       … validate は PWA 品質、doctor は JDK/SDK パス。署名は見ない。
//   - adb shell pm get-app-links
//       … Android App Links の検証状態。TWA 起動時に Chrome が行う DAL 検証とは
//         別の仕組みで、verified でもアドレスバーが出ることがある。
//
// 使う API（唯一「配布される署名」を返すもの）:
//   GET androidpublisher/v3/applications/{pkg}/generatedApks/{versionCode}
//   → generatedApks[].certificateSha256Hash
//   scope: https://www.googleapis.com/auth/androidpublisher
//   ★その versionCode が Play にアップロード済みでないと取れない。
//     だからリリース工程では「公開の後」に置く（公開前には測れない）。
//
// 使い方:
//   GOOGLE_PLAY_SA_JSON_PATH=.secrets/google-play-sa.json \
//   node scripts/verify-twa-signing-matches-assetlinks.mjs [--version-code 4]
//   node scripts/verify-twa-signing-matches-assetlinks.mjs --selftest   毒→赤を確認
//
// 終了コード（instrument-core の3値規約）:
//   0 = 合格 / 1 = 測れた上での赤（不一致＝アドレスバーが出る）
//   2 = 測れなかった（SA未設定・未アップロード等）
import fs from 'node:fs';
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';
import { cfg } from './lib/app-config.mjs';

const LIMIT = '★この検査が判定しないこと: 実機での表示そのものは見ていません。'
  + '署名の一致は必要条件であって、Chrome 側の DAL キャッシュが古いと'
  + '一致していても一時的にアドレスバーが出ることがあります（通常は数十分で解消）。';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const norm = (fp) => String(fp || '').toUpperCase().replace(/\s/g, '');

/**
 * ★判定の本体（純関数・ネットワークに触らない＝テストしやすい）。
 * @param {string[] | null} deliveredFingerprints
 *   Play が配布する署名。null は取得できなかった（測れなかった）ことを示す
 * @param {string[] | null} declaredFingerprints
 *   assetlinks.json に載っている署名。null は取得できなかったことを示す
 * @returns {import('./lib/instrument-core.mjs').ProbeResult[]}
 */
export function judgeSigningMatch(deliveredFingerprints, declaredFingerprints) {
  const probe = 'Playが配布する署名とassetlinks.jsonの一致';

  if (deliveredFingerprints === null) {
    return [{
      probe,
      verdict: 'inconclusive',
      detail: 'Play から配布用の署名を取得できませんでした',
      howToFix: 'サービスアカウントJSON(GOOGLE_PLAY_SA_JSON_PATH)と、その versionCode が Play にアップロード済みか確認してください',
      limitation: LIMIT
    }];
  }

  if (declaredFingerprints === null) {
    return [{
      probe,
      verdict: 'inconclusive',
      detail: '本番サイトの assetlinks.json を取得できませんでした',
      howToFix: '先に verify-assetlinks-published.mjs で配信状況を確認してください',
      limitation: LIMIT
    }];
  }

  const delivered = [...new Set(deliveredFingerprints.map(norm))].filter(Boolean);
  const declared = [...new Set(declaredFingerprints.map(norm))].filter(Boolean);

  if (delivered.length === 0) {
    return [{
      probe,
      verdict: 'inconclusive',
      detail: 'Play の応答に署名が1件も含まれていませんでした',
      howToFix: 'その versionCode が実際にアップロードされているか確認してください',
      limitation: LIMIT
    }];
  }

  const missing = delivered.filter((f) => !declared.includes(f));

  if (missing.length > 0) {
    return [{
      probe,
      verdict: 'fail',
      evidence: {
        配布される署名: delivered,
        assetlinksに載っている署名: declared,
        載っていない署名: missing
      },
      detail: '配布される APK の署名が assetlinks.json に載っていません。このまま出すと実機でアドレスバーが出ます',
      howToFix: `assetlinks.json の sha256_cert_fingerprints に次を追加して再デプロイしてください: ${missing.join(', ')}（アップロード鍵は消さずに残すこと）`,
      limitation: LIMIT
    }];
  }

  return [{
    probe,
    verdict: 'pass',
    evidence: { 配布される署名: delivered, assetlinksに載っている署名: declared },
    limitation: LIMIT
  }];
}

/* ── ここから下は I/O（判定はしない） ───────────────────────── */

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).toString('base64url');
  const crypto = await import('node:crypto');
  const sig = crypto.createSign('RSA-SHA256').update(`${header}.${claim}`).sign(sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${sig}`
    })
  });
  if (!res.ok) throw new Error(`token -> ${res.status}`);
  return (await res.json()).access_token;
}

async function fetchDelivered(pkg, versionCode) {
  const saPath = process.env.GOOGLE_PLAY_SA_JSON_PATH;
  if (!saPath || !fs.existsSync(saPath)) return null;
  try {
    const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
    const token = await getAccessToken(sa);
    const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}`;

    let vc = versionCode;
    if (!vc) {
      // 指定が無ければ全トラックの最大 versionCode を見る
      const editRes = await fetch(`${base}/edits`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (!editRes.ok) return null;
      const editId = (await editRes.json()).id;
      try {
        const tr = await fetch(`${base}/edits/${editId}/tracks`, { headers: { Authorization: `Bearer ${token}` } });
        if (!tr.ok) return null;
        const codes = [];
        for (const t of (await tr.json()).tracks || []) {
          for (const r of t.releases || []) for (const c of r.versionCodes || []) codes.push(Number(c));
        }
        if (!codes.length) return null;
        vc = String(Math.max(...codes));
      } finally {
        await fetch(`${base}/edits/${editId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
      }
    }

    const res = await fetch(`${base}/generatedApks/${vc}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const json = await res.json();
    return (json.generatedApks || []).map((g) => g.certificateSha256Hash).filter(Boolean);
  } catch {
    return null;
  }
}

async function fetchDeclared(domain, pkg) {
  try {
    const res = await fetch(`https://${domain}/.well-known/assetlinks.json`);
    if (!res.ok) return null;
    const json = await res.json();
    const out = [];
    for (const e of json) {
      const t = e?.target || {};
      if (t.namespace !== 'android_app') continue;
      if (pkg && t.package_name !== pkg) continue;
      for (const f of t.sha256_cert_fingerprints || []) out.push(f);
    }
    return out;
  } catch {
    return null;
  }
}

// ── selftest（★毒→赤。実ネットワークに触れず組み立てた値で完結） ──
function selftest() {
  const A = 'AA:BB:CC:DD';
  const B = '11:22:33:44';
  const cases = [
    {
      name: '毒1: 配布される署名が assetlinks に無い（アドレスバーが出る）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeSigningMatch([B], [A])) === EXIT.FAIL
    },
    {
      name: '毒2: Play から署名を取れなかった（測れなかった＝2）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeSigningMatch(null, [A])) === EXIT.INCONCLUSIVE
    },
    {
      name: '毒3: assetlinks を取れなかった（測れなかった＝2）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeSigningMatch([A], null)) === EXIT.INCONCLUSIVE
    },
    {
      name: '毒4: Play の応答が空（0件を合格にしない）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeSigningMatch([], [A])) === EXIT.INCONCLUSIVE
    },
    {
      name: '毒5: 大文字小文字・空白の違いで誤判定しない（正規化の確認）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeSigningMatch([' aa:bb:cc:dd '], [A])) === EXIT.PASS
    }
  ];

  const { ok, fails } = runSelfTest(cases);
  if (!ok) {
    console.error('🔴 selftest 失敗:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log(`✅ selftest 合格（${cases.length}件: 不一致・Play取得失敗・assetlinks取得失敗・空応答・正規化を確認）`);
  process.exit(EXIT.PASS);
}

async function main() {
  if (process.argv.includes('--selftest')) {
    selftest(); // ★内部で process.exit する
    return;
  }

  const pkg = arg('--package', cfg('stores.playPackageName'));
  const domain = arg('--domain', cfg('identity.productionDomain'));
  const versionCode = arg('--version-code', null);

  if (!pkg || !domain) {
    const results = [{
      probe: 'Playが配布する署名とassetlinks.jsonの一致',
      verdict: 'inconclusive',
      detail: 'playPackageName または productionDomain が未設定です',
      howToFix: 'app.config.json を埋めるか --package / --domain で渡してください',
      limitation: LIMIT
    }];
    console.log(formatProbeReport(results));
    process.exit(computeExitCode(results));
  }

  const [delivered, declared] = await Promise.all([
    fetchDelivered(pkg, versionCode),
    fetchDeclared(domain, pkg)
  ]);

  const results = judgeSigningMatch(delivered, declared);
  console.log(formatProbeReport(results));
  const code = computeExitCode(results);
  // ★GitHub Actions のログで赤く出す（既存の verify-* と同じ流儀）。
  if (code === EXIT.FAIL) {
    for (const r of results.filter((x) => x.verdict === 'fail')) {
      console.error(`::error::${r.probe}: ${r.detail}`);
    }
  }
  process.exit(code);
}

main().catch((e) => {
  console.error('エラー:', e?.message || e);
  process.exit(EXIT.INCONCLUSIVE);
});
