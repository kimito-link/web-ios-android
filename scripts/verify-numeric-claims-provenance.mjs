#!/usr/bin/env node
/**
 * verify-numeric-claims-provenance.mjs — サイト全体で「数値を伴う実績主張」に出典があるか軽くスクリーニングする。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ なぜ作ったか（実損）
 *   site/index.html（LP）に「実際に9つのアプリへ当てたところ無傷は1つだけ」
 *   「あるアプリで3点で却下」という2つの実績主張があったが、_docs/配下のKBにも
 *   git履歴にも根拠が無い誇張表現だった（2026-08-25、ユーザー指摘で発覚・削除）。
 *   既存の scripts/verify-claims-coverage.mjs は site/index.html の
 *   data-claim 属性9件しか見ておらず、site配下の残り33ファイルは
 *   一切自動検証の対象外だった。この穴を塞ぐ。
 *
 * ■ 何を見て、何を見ないか（自然言語の真偽は判定できない前提の軽量スクリーニング）
 *   見る: 「実際に」「実例」「実績」「実測」等のキーワードと、助数詞つきの数値
 *         （○本/○分/○件/○回/○日/○個/○%/○倍）が近傍で共起する箇所。
 *   ★見ない: その数値が実際に正しいかどうか（それは人・AIが出典を読んで判断する）。
 *   判定するのは「出典コメント（<!-- 出典: ... -->）が近くにあるか」だけ。
 *   これは代理指標であり完全な裏取りの代わりにはならない
 *   （CLAUDE.md「新しい機能・検査を作るときの4つの基準」§2 車輪の再発明をしない、
 *    に沿って自然言語処理の再発明はしない）。
 *
 * ■ 終了コード（instrument-core.mjs と同じ3値規約）
 *   0 = 検出した数値主張すべてに出典コメントがある（日付があれば鮮度も基準内）
 *   1 = 使わない（自然言語検出は誤検知が多いため、いきなり赤にはしない設計。下記参照）
 *   2 = 出典コメントの無い数値主張、または出典が古すぎる（要確認。緑ではない）
 *
 * ★出典なしを FAIL(1) ではなく INCONCLUSIVE(2) にしている理由:
 *   正規表現ベースの自然言語検出は誤検知が多い（バージョン番号・価格・日付等を
 *   実績主張と誤認する）。「間違って書くと即赤」にすると、このキットで過去に
 *   死んだ「一括強制のゲート」と同じ失敗を繰り返す（_docs/instruments/README.md
 *   掟⑥参照）。★「検査自体は走った・出典なしの候補が何件ある」を必ず報告し、
 *   最終判断は人・AIのレビューに委ねる。
 *
 * ■ ★2026-08-26追加: 出典コメントの日付（鮮度）
 *   出典コメントは元々「<!-- 出典: パス -->」形式のみで、いつ実測・確認したかの
 *   情報を持たなかった。実際にsite/内の既存コメントを調査したところ、
 *   「（2026-08-23実損）」のようにYYYY-MM-DD形式の日付が自然言語の注記内に
 *   既に散在していた（構造化された規約ではなく、書き手の自然な慣習）。
 *   ★この既存の慣習に乗り、コメント内にYYYY-MM-DD形式の日付があれば任意で
 *   拾って鮮度判定する。日付が無いコメントは従来通り「出典あり」として合格
 *   （既存コメントの大半を書き換えさせない・後方互換）。
 *   閾値は180日（半年）。実績数値は半年経てば再確認の価値が生まれるという
 *   一般的なレビューサイクルに基づく（会議での複数案の中で最も標準的だった値）。
 *
 * ■ 使い方
 *   node scripts/verify-numeric-claims-provenance.mjs
 *   node scripts/verify-numeric-claims-provenance.mjs --selftest   ★毒→検知を確認
 * ───────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { EXIT, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SELFTEST = process.argv.includes('--selftest');

/**
 * ★人が書いた主張文ではなく、機械が実測レポートから動的生成する成果物のディレクトリ。
 *   generate-shindan-version.mjs が .instrument-report.json から aria-valuenow 等を
 *   都度書き出す（templates/scripts/generate-shindan-version.mjs:162,224）。
 *   ここに出典コメントを書いても次回生成で消えるため、そもそもこの検査の対象外にする。
 */
const GENERATED_DIRS = new Set(['check-shindan-version']);

/** site/配下の *.html を再帰的に列挙する（verify-internal-links.mjs と同じロジック・車輪の再発明をしない）。 */
function listHtmlFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && GENERATED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listHtmlFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

/** 数値主張らしきパターン: 実績を示す語 + 助数詞つき数値、が同じ行〜近傍にあるもの。 */
const CLAIM_KEYWORDS = /実際に|実例|実績|実測/;
const NUMBER_WITH_COUNTER = /\d[\d,]*(?:\.\d+)?\s*(?:本|分|件|回|日間?|個|%|倍|秒|ミリ秒|人|ヶ月|か月)/;
const PROVENANCE_COMMENT = /<!--\s*出典\s*:/;
/** ★出典コメント内のYYYY-MM-DD形式の日付（任意）。既存の慣習「（2026-08-23実損）」等を拾う。 */
const PROVENANCE_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
/** ★何日経ったら出典が「古すぎる」とみなすか。 */
const STALE_DAYS_THRESHOLD = 180;

/**
 * ★出典コメントの近傍テキストから最初のYYYY-MM-DD日付を拾い、経過日数を返す。
 *   日付が見つからなければnull（＝鮮度判定の対象外。日付なしコメントは今まで通り合格）。
 * @param {string} nearbyText
 * @param {number} nowMs
 * @returns {number|null}
 */
function staleDays(nearbyText, nowMs) {
  const m = nearbyText.match(PROVENANCE_DATE);
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return Math.floor((nowMs - t) / (1000 * 60 * 60 * 24));
}

/**
 * 1ファイルを走査し、出典コメントの無い数値主張候補を返す。
 * <style>/<script>ブロックは除外し、本文相当のみを見る。
 * ★行番号を元ファイルと一致させるため、ブロックを削除せず改行数を保ったまま
 *   中身だけ空にする（削除すると報告する行番号が実ファイルとズレて、
 *   出典コメントを追加すべき場所を見誤らせる事故になる）。
 */
function blankOutBlocks(text, blockRegex) {
  return text.replace(blockRegex, (match) => match.replace(/[^\n]/g, ''));
}

/**
 * @param {string} filePath
 * @param {number} nowMs ★Date.now()を直接使わない。selftestが実行日に依存しない毒にするため引数化
 * @returns {Array<{line: number, text: string, reason: 'missing'|'stale', staleDays?: number}>}
 */
function scanFile(filePath, nowMs) {
  const raw = readFileSync(filePath, 'utf8');
  let body = blankOutBlocks(raw, /<style[\s\S]*?<\/style>/gi);
  body = blankOutBlocks(body, /<script[\s\S]*?<\/script>/gi);
  const lines = body.split('\n');

  const findings = [];
  const CONTEXT_WINDOW = 6; // 前後6行以内に出典コメントがあれば「あり」とみなす

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!CLAIM_KEYWORDS.test(line) || !NUMBER_WITH_COUNTER.test(line)) continue;

    const windowStart = Math.max(0, i - CONTEXT_WINDOW);
    const windowEnd = Math.min(lines.length, i + CONTEXT_WINDOW + 1);
    const nearby = lines.slice(windowStart, windowEnd).join('\n');

    if (!PROVENANCE_COMMENT.test(nearby)) {
      findings.push({ line: i + 1, text: line.trim().slice(0, 120), reason: 'missing' });
      continue;
    }

    // ★出典コメントはあるので合格候補。日付が併記されていれば鮮度を見る
    //   （日付が無ければここで判定を打ち切り＝従来通り合格。後方互換）。
    const days = staleDays(nearby, nowMs);
    if (days !== null && days > STALE_DAYS_THRESHOLD) {
      findings.push({ line: i + 1, text: line.trim().slice(0, 120), reason: 'stale', staleDays: days });
    }
  }
  return findings;
}

function rel(p) {
  return p.split(ROOT).join('').replace(/^[\/\\]+/, '');
}

function scanAll(siteDir, nowMs = Date.now()) {
  const files = listHtmlFiles(siteDir);
  if (files.length === 0) {
    return { verdict: 'inconclusive', detail: `HTMLが1件も見つかりませんでした: ${rel(siteDir)}` };
  }

  const perFile = [];
  for (const f of files) {
    const findings = scanFile(f, nowMs);
    if (findings.length > 0) perFile.push({ file: rel(f), findings });
  }

  return {
    verdict: perFile.length === 0 ? 'pass' : 'inconclusive',
    scannedFiles: files.length,
    perFile,
  };
}

/* ── --selftest ─────────────────────────────────────────── */
if (SELFTEST) {
  const fails = [];
  const tmpDir = mktempSiteDir();

  try {
    // 毒1: 出典コメント無しの数値主張 → inconclusiveで検知するはず
    writeFileSync(join(tmpDir, 'poison.html'), `<html><body>
      <p>実際に検査したところ、76本のテストで不具合が3件見つかりました。</p>
    </body></html>`);
    const r1 = scanAll(tmpDir);
    if (r1.verdict !== 'inconclusive' || r1.perFile.length !== 1) {
      fails.push(`出典なしの数値主張を検知できない(得た: verdict=${r1.verdict}, 件数=${r1.perFile?.length})`);
    }
    rmSync(join(tmpDir, 'poison.html'));

    // 毒2: 出典コメントが近傍にある数値主張 → passになるはず
    writeFileSync(join(tmpDir, 'clean.html'), `<html><body>
      <!-- 出典: _docs/example.md -->
      <p>実際に検査したところ、76本のテストで不具合が3件見つかりました。</p>
    </body></html>`);
    const r2 = scanAll(tmpDir);
    if (r2.verdict !== 'pass') {
      fails.push(`出典ありの数値主張を誤検知した(得た: verdict=${r2.verdict}, findings=${JSON.stringify(r2.perFile)})`);
    }
    rmSync(join(tmpDir, 'clean.html'));

    // 毒3: <style>ブロック内の数値（CSSノイズ）は誤検知しないはず
    writeFileSync(join(tmpDir, 'css-noise.html'), `<html><head><style>
      .box { margin: 76px; } /* 実際に76個のボックスがある設計だがCSSなので対象外 */
    </style></head><body><p>本文には数値主張なし</p></body></html>`);
    const r3 = scanAll(tmpDir);
    if (r3.verdict !== 'pass') {
      fails.push(`<style>内のノイズを誤検知した(得た: verdict=${r3.verdict})`);
    }
    rmSync(join(tmpDir, 'css-noise.html'));

    // 毒4: 対象0件 → inconclusiveであるべき
    const emptyDir = join(tmpDir, 'empty');
    mkdirSync(emptyDir);
    const r4 = scanAll(emptyDir);
    if (r4.verdict !== 'inconclusive') fails.push(`対象0件を緑にした(得た: ${r4.verdict})`);

    // ★2026-08-26追加: 出典の鮮度判定。nowMsを固定し実行日に依存しない毒にする
    //   （instrument-core.mjs runSelfTestの掟「状態に依存しない毒にする」に従う）。
    const FIXED_NOW = Date.parse('2026-08-26T00:00:00Z');

    // 毒5: 出典コメントに古い日付（閾値超）→ inconclusiveで検知するはず
    writeFileSync(join(tmpDir, 'stale.html'), `<html><body>
      <!-- 出典: _docs/example.md（2026-01-01実測） -->
      <p>実際に検査したところ、76本のテストで不具合が3件見つかりました。</p>
    </body></html>`);
    const r5 = scanAll(tmpDir, FIXED_NOW);
    if (r5.verdict !== 'inconclusive' || r5.perFile[0]?.findings[0]?.reason !== 'stale') {
      fails.push(`古い出典日付を検知できない(得た: verdict=${r5.verdict}, findings=${JSON.stringify(r5.perFile)})`);
    }
    rmSync(join(tmpDir, 'stale.html'));

    // 毒なし: 出典コメントの日付が閾値内 → passのはず（誤検知しない）
    writeFileSync(join(tmpDir, 'fresh.html'), `<html><body>
      <!-- 出典: _docs/example.md（2026-08-01実測） -->
      <p>実際に検査したところ、76本のテストで不具合が3件見つかりました。</p>
    </body></html>`);
    const r6 = scanAll(tmpDir, FIXED_NOW);
    if (r6.verdict !== 'pass') {
      fails.push(`閾値内の出典日付を誤検知した(得た: verdict=${r6.verdict}, findings=${JSON.stringify(r6.perFile)})`);
    }
    rmSync(join(tmpDir, 'fresh.html'));

    // 毒なし: 日付の無い出典コメント → 従来通りpassのはず（後方互換・既存コメントを壊さない）
    writeFileSync(join(tmpDir, 'no-date.html'), `<html><body>
      <!-- 出典: _docs/example.md -->
      <p>実際に検査したところ、76本のテストで不具合が3件見つかりました。</p>
    </body></html>`);
    const r7 = scanAll(tmpDir, FIXED_NOW);
    if (r7.verdict !== 'pass') {
      fails.push(`日付なし出典コメントを誤検知した(得た: verdict=${r7.verdict}, findings=${JSON.stringify(r7.perFile)})`);
    }
    rmSync(join(tmpDir, 'no-date.html'));
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  if (fails.length) {
    console.error('[verify-numeric-claims-provenance] selftest 失敗（検知器が効いていません）:');
    for (const f of fails) console.error('  - ' + f);
    process.exit(EXIT.FAIL);
  }
  console.log('[verify-numeric-claims-provenance] selftest OK（出典なし検知・誤検知なし・CSSノイズ除外・対象0件・古い出典検知・閾値内は誤検知なし・日付なしは後方互換で合格）');
  process.exit(EXIT.PASS);
}

function mktempSiteDir() {
  return mkdtempSync(join(tmpdir(), 'verify-numeric-claims-selftest-'));
}

/* ── 通常実行 ───────────────────────────────────────────── */
const SITE_DIR = resolve(ROOT, 'site');
const result = scanAll(SITE_DIR);

if (result.verdict === 'inconclusive' && !result.perFile) {
  console.log(formatProbeReport([{
    probe: '数値主張の出典スクリーニング',
    verdict: 'inconclusive',
    detail: result.detail,
    howToFix: 'site/ ディレクトリが存在するか確認する',
  }]));
  process.exit(EXIT.INCONCLUSIVE);
}

if (result.verdict === 'inconclusive') {
  const allFindings = result.perFile.flatMap((f) => f.findings.map((find) => ({ ...find, file: f.file })));
  const missingCount = allFindings.filter((f) => f.reason === 'missing').length;
  const staleCount = allFindings.filter((f) => f.reason === 'stale').length;
  const lines = allFindings
    .map((find) => find.reason === 'stale'
      ? `${find.file}:${find.line} 「${find.text}」（出典が${find.staleDays}日前・閾値${STALE_DAYS_THRESHOLD}日）`
      : `${find.file}:${find.line} 「${find.text}」（出典なし）`)
    .join(' / ');
  console.log(formatProbeReport([{
    probe: '数値主張の出典スクリーニング',
    verdict: 'inconclusive',
    evidence: { 走査ファイル数: result.scannedFiles, 出典なし候補: missingCount, 出典が古い候補: staleCount },
    detail: lines,
    howToFix: '出典なし: 実際に主張の裏付け（_docs/配下のKB・git履歴・実行コマンドの出力）を確認し、'
      + '出典があれば直前に <!-- 出典: パス --> を追加する。裏付けが無ければ、断定を避けた一般的な表現に言い換える'
      + '（例:「よくあるのは〜」）。誤検知（バージョン番号・価格等）ならこの検査の対象外として無視してよい。'
      + `出典が古い: 実際に再確認し、出典コメント内の日付をYYYY-MM-DD形式で最新の確認日に更新する。`,
    limitation: '正規表現による軽量スクリーニングで、数値の正しさは判定しない。誤検知（バージョン番号・日付等）を含みうる。'
      + '出典コメントが無いこと・出典コメント内の日付が古いことを機械的に検知するだけで、最終判断は人・AIのレビューに委ねる設計'
      + '（CLAUDE.md「4つの基準」参照）。日付のない出典コメントは鮮度判定の対象外＝従来通り合格',
  }]));
  process.exit(EXIT.INCONCLUSIVE);
}

console.log(formatProbeReport([{
  probe: '数値主張の出典スクリーニング',
  verdict: 'pass',
  evidence: { 走査ファイル数: result.scannedFiles, 出典なし候補: 0 },
  limitation: '正規表現による軽量スクリーニング。数値そのものの正しさまでは判定しない',
}]));
process.exit(EXIT.PASS);
