#!/usr/bin/env node
/**
 * 「外の誰かが決めた数字」をコードに写したまま古くなっていないかを検査する。
 *
 * 【なぜ要るか】2026-10-12、kimito.link の応援熱量機能で見つけた穴。
 *   X API の従量課金を使う機能に日次予算ガードを入れたが、
 *   **ガードが守っていたのは「見積りの合計」であって実際の請求額ではなかった**。
 *   見積りはコード内の単価定数から計算される。X が値上げしても定数は変わらない。
 *   ＝ 上限 $0.30/日 のつもりが黙って $3.00/日 になりうる。
 *   ★**計器は緑のまま、気づくのは請求書**。CI の赤には永久に出ない。
 *
 *   同じ形の負債は外部の数字を写すたびに生まれる:
 *     - API の従量単価・レート制限値
 *     - 無料枠の上限（ビルド時間・帯域）
 *     - ストアの審査要件（targetSdk の期限など）
 *     - 競合の価格（LPに書いた比較表）
 *
 * 【なぜ「実際の値を取りに行く」設計にしないか】
 *   請求APIや価格ページを自動で読む案は採らない:
 *     - 認証と権限が増える（請求APIは強い権限を要求しがち）
 *     - 価格ページのHTML構造に依存すると、向こうの改装で黙って壊れる
 *     - ★壊れたときに「取れなかった＝緑」に倒れると、無いより悪い
 *   代わりに **「人が最後に確かめた日」だけを機械に見張らせる**。
 *   確認そのものは人がやる。機械は「そろそろ確かめろ」と言うだけ。
 *
 * 【3値で返す】0=根拠つき合格 / 1=測れた赤 / ★2=測れなかった（緑ではない）
 *
 * 使い方:
 *   node scripts/check-external-constants-freshness.mjs
 *   node scripts/check-external-constants-freshness.mjs --selftest
 *
 * 設定: リポ直下の external-constants.json（または --config <path>）
 *   {
 *     "maxAgeDays": 30,
 *     "warnAgeDays": 24,
 *     "entries": [
 *       {
 *         "name": "X API 従量単価",
 *         "file": "lib/server/ouen/x-cost.ts",
 *         "constant": "PRICING_VERIFIED_AT",
 *         "source": "https://docs.x.com/x-api/getting-started/pricing",
 *         "howToFix": "出典を開いて単価を確認し、変わっていれば定数を・同じなら日付だけ更新"
 *       }
 *     ]
 *   }
 *
 * ★検査対象のファイルには `export const <constant> = "YYYY-MM-DD";` を置く。
 *   ★日付は**単価そのものと同じファイル**に置くこと。別の台帳に書くと、
 *     値を直した人が日付を直し忘れる（離れているほど腐る）。
 *
 * ★標準出力の文言で合否を判定しないこと（文言を変えた瞬間に無言で壊れる）。
 *   判定は exit code で読む。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/** ★3値。0=根拠つき合格 / 1=測れた赤 / 2=測れなかった（★緑ではない）。 */
const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 });

/**
 * ★根拠なき pass を inconclusive へ降格する（fail-closed の最小実装）。
 *   「0件だから緑」は、測っていない場合と区別が付かない。
 */
function normalize(r) {
  const evidence = r && r.evidence && typeof r.evidence === 'object' ? r.evidence : null;
  let verdict = r?.verdict;
  if (verdict === 'pass' && (!evidence || Object.keys(evidence).length === 0)) {
    verdict = 'inconclusive';
  }
  if (!['pass', 'fail', 'inconclusive'].includes(verdict)) verdict = 'inconclusive';
  return { ...r, verdict, evidence };
}

/** ★fail > inconclusive > pass。1件でも「測れなかった」があれば緑にしない。 */
function computeExitCode(results) {
  const list = (Array.isArray(results) ? results : []).map(normalize);
  if (list.length === 0) return EXIT.INCONCLUSIVE;
  if (list.some((r) => r.verdict === 'fail')) return EXIT.FAIL;
  if (list.some((r) => r.verdict === 'inconclusive')) return EXIT.INCONCLUSIVE;
  return EXIT.PASS;
}

const MARK = { pass: '[OK]', fail: '[NG]', inconclusive: '[??]' };

function formatReport(results) {
  return results
    .map(normalize)
    .map((r) => {
      const lines = [`${MARK[r.verdict]} ${r.probe}`];
      if (r.detail) lines.push(`     ${r.detail}`);
      if (r.verdict !== 'pass' && r.howToFix) lines.push(`     直し方: ${r.howToFix}`);
      if (r.evidence) lines.push(`     根拠: ${JSON.stringify(r.evidence)}`);
      return lines.join('\n');
    })
    .join('\n');
}

/** selftest: 期待と実際が全件一致で合格。★1件でも外れたら赤。 */
function runSelfTest(cases) {
  const bad = cases.filter((c) => c.actual !== c.expected);
  for (const c of cases) {
    console.log(`${c.actual === c.expected ? '[OK]' : '[NG]'} ${c.name}` +
      (c.actual === c.expected ? '' : `（期待 ${c.expected} / 実際 ${c.actual}）`));
  }
  if (bad.length > 0) {
    console.error(`[外部定数] ★selftest 失敗: ${bad.length}件`);
    process.exit(EXIT.FAIL);
  }
  console.log(`[外部定数] selftest 合格（${cases.length}件）`);
  process.exit(EXIT.PASS);
}

export const DEFAULT_MAX_AGE_DAYS = 30;
export const DEFAULT_WARN_AGE_DAYS = 24;

/**
 * 日付文字列から鮮度を判定する（純粋関数）。
 *
 * @param {string|undefined} verifiedAt "YYYY-MM-DD"
 * @param {number} maxAgeDays
 * @param {number} nowMs
 * @param {number} warnAgeDays
 * @returns {{verdict:'fresh'|'warn'|'stale'|'missing', ageDays:number|null}}
 */
export function judgeFreshness(
  verifiedAt,
  maxAgeDays = DEFAULT_MAX_AGE_DAYS,
  nowMs = Date.now(),
  warnAgeDays = DEFAULT_WARN_AGE_DAYS
) {
  if (typeof verifiedAt !== 'string' || verifiedAt.trim() === '') {
    return { verdict: 'missing', ageDays: null };
  }
  // ★形を先に縛る。Date.parse は "2026-13-99" のような壊れた値を黙って通すことがある。
  if (!/^\d{4}-\d{2}-\d{2}$/.test(verifiedAt.trim())) {
    return { verdict: 'missing', ageDays: null };
  }
  const ms = Date.parse(`${verifiedAt.trim()}T00:00:00Z`);
  if (Number.isNaN(ms)) return { verdict: 'missing', ageDays: null };

  const ageDays = (nowMs - ms) / (24 * 60 * 60 * 1000);
  // ★未来日付は「確かめていない」と同じ扱い。
  //   打ち間違い（2026→2099）を緑にすると、計器が永久に鳴らなくなる。
  if (ageDays < 0) return { verdict: 'missing', ageDays };

  if (ageDays > maxAgeDays) return { verdict: 'stale', ageDays };
  if (ageDays > warnAgeDays) return { verdict: 'warn', ageDays };
  return { verdict: 'fresh', ageDays };
}

/**
 * ソースから日付定数を取り出す。
 * ★定数名で拾う（コメント文言に依存させない）。
 * @param {string} source
 * @param {string} constant
 * @returns {string|undefined}
 */
export function extractVerifiedAt(source, constant) {
  const safe = String(constant ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!safe) return undefined;
  const m = new RegExp(`${safe}\\s*=\\s*["']([^"']*)["']`).exec(String(source ?? ''));
  return m ? m[1] : undefined;
}

/**
 * 1件を測る。
 * @returns {{probe:string, verdict:'pass'|'fail'|'inconclusive', evidence:object|null, detail?:string, howToFix?:string, limitation?:string}}
 */
export function probeEntry(entry, opts = {}) {
  const { readFile, nowMs = Date.now(), maxAgeDays, warnAgeDays } = opts;
  const name = entry?.name || entry?.constant || '(無名)';
  const probe = `外部定数の鮮度: ${name}`;

  if (!entry?.file || !entry?.constant) {
    return {
      probe,
      verdict: 'inconclusive',
      evidence: null,
      detail: 'file と constant の両方が要ります。',
      howToFix: '設定の entries[] に file と constant を書いてください。'
    };
  }

  let source;
  try {
    source = readFile(entry.file);
  } catch {
    // ★ファイルが消えていたら緑にしない（機能を消したなら設定からも消す）。
    return {
      probe,
      verdict: 'inconclusive',
      evidence: null,
      detail: `対象ファイルが読めません: ${entry.file}`,
      howToFix: 'パスを直すか、機能ごと消したなら設定から entry を削除してください。'
    };
  }

  const verifiedAt = extractVerifiedAt(source, entry.constant);
  const { verdict, ageDays } = judgeFreshness(verifiedAt, maxAgeDays, nowMs, warnAgeDays);
  const age = ageDays === null ? null : Math.floor(ageDays);
  const base = { file: entry.file, constant: entry.constant, verifiedAt: verifiedAt ?? null };
  const howToFix =
    entry.howToFix ||
    `${entry.source || '出典'} を開いて実際の値を確認し、` +
      `変わっていれば定数を・変わっていなければ ${entry.constant} の日付だけを更新してください。`;

  if (verdict === 'missing') {
    return {
      probe,
      verdict: 'inconclusive',
      evidence: null,
      detail: `${entry.constant} が読めません（値: ${verifiedAt ?? 'なし'}）。`,
      howToFix: `${entry.file} に export const ${entry.constant} = "YYYY-MM-DD"; を置いてください（未来日付は不可）。`
    };
  }

  if (verdict === 'stale') {
    return {
      probe,
      verdict: 'fail',
      evidence: { ...base, ageDays: age, maxAgeDays },
      detail: `確認から ${age} 日経過（上限 ${maxAgeDays} 日）。`,
      howToFix,
      limitation: '★実際の値が変わったかは見ていません。「確かめた日が古い」ことだけを見ます。'
    };
  }

  // warn も合格扱い（赤にはしない）。ただし根拠に残して見えるようにする。
  return {
    probe,
    verdict: 'pass',
    evidence: { ...base, ageDays: age, maxAgeDays, warn: verdict === 'warn' },
    detail: verdict === 'warn' ? `確認から ${age} 日経過。そろそろ確認を。` : '',
    howToFix: verdict === 'warn' ? howToFix : '',
    limitation: '★実際の値が変わったかは見ていません。「確かめた日が古い」ことだけを見ます。'
  };
}

// ───────────────────────── selftest ─────────────────────────
// ★毒を入れて赤くなることを、検査自身が証明する。
function selftestCases() {
  const DAY = 24 * 60 * 60 * 1000;
  const BASE = Date.parse('2026-10-12T00:00:00Z');
  const src = (d) => `export const VERIFIED_AT = "${d}";`;
  const entry = { name: 'テスト', file: 'x.ts', constant: 'VERIFIED_AT', source: 'http://example' };
  const run = (d, days) =>
    probeEntry(entry, {
      readFile: () => src(d),
      nowMs: BASE + days * DAY,
      maxAgeDays: 30,
      warnAgeDays: 24
    }).verdict;

  return [
    { name: '確認直後は合格', actual: run('2026-10-12', 0), expected: 'pass' },
    // ★境界テスト（勘の丸い数字を置かないための歯止め）
    { name: '境界ちょうど(30日)は赤にしない', actual: run('2026-10-12', 30), expected: 'pass' },
    { name: '★境界を1日超えたら赤', actual: run('2026-10-12', 31), expected: 'fail' },
    { name: '手前(25日)はまだ合格', actual: run('2026-10-12', 25), expected: 'pass' },
    {
      name: '★壊れた形は緑にしない',
      actual: run('2026/10/12', 0),
      expected: 'inconclusive'
    },
    {
      name: '★未来日付は緑にしない',
      actual: run('2099-01-01', 0),
      expected: 'inconclusive'
    },
    {
      name: '★定数が無ければ緑にしない',
      actual: probeEntry(entry, {
        readFile: () => 'export const OTHER = 1;',
        nowMs: BASE,
        maxAgeDays: 30,
        warnAgeDays: 24
      }).verdict,
      expected: 'inconclusive'
    },
    {
      name: '★ファイルが読めなければ緑にしない',
      actual: probeEntry(entry, {
        readFile: () => {
          throw new Error('ENOENT');
        },
        nowMs: BASE,
        maxAgeDays: 30,
        warnAgeDays: 24
      }).verdict,
      expected: 'inconclusive'
    }
  ];
}

function loadConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

function main() {
  if (process.argv.includes('--selftest')) {
    return runSelfTest(selftestCases());
  }

  const i = process.argv.indexOf('--config');
  const configPath = path.resolve(
    process.cwd(),
    i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 'external-constants.json'
  );

  let config;
  try {
    config = loadConfig(configPath);
  } catch {
    console.error(
      `[外部定数] ★設定が読めません: ${configPath}\n` +
        '  entries[] に {name, file, constant, source} を書いてください。'
    );
    // ★設定が無い＝測れなかった。緑にしない。
    process.exit(EXIT.INCONCLUSIVE);
  }

  const entries = Array.isArray(config?.entries) ? config.entries : [];
  if (entries.length === 0) {
    console.error('[外部定数] ★entries が空です。何も測っていないので緑にしません。');
    process.exit(EXIT.INCONCLUSIVE);
  }

  const maxAgeDays = Number(config.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS);
  const warnAgeDays = Number(config.warnAgeDays ?? DEFAULT_WARN_AGE_DAYS);

  const results = entries.map((entry) =>
    probeEntry(entry, {
      readFile: (f) => fs.readFileSync(path.resolve(process.cwd(), f), 'utf8'),
      maxAgeDays,
      warnAgeDays
    })
  );

  console.log('--- 外部定数の鮮度 ---');
  console.log(formatReport(results));
  process.exit(computeExitCode(results));
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main();
