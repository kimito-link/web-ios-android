#!/usr/bin/env node
/**
 * check-cross-tool-instruction-sync.mjs
 * ★CLAUDE.mdの「核ブロック」が、Codex等の別ツール用ファイル（AGENTS.md）へ
 *   直接転記されている箇所と、無言でズレていないかを見る。
 *
 * ─────────────────────────────────────────────────────────────────
 * ■ なぜ要るか（2026-09-25、line-botで実際に転記した直後に発覚した穴）
 *
 *   Claude Codeの`@import`構文はClaude Code専用（Codex CLI公式ドキュメント・
 *   agents.md標準仕様のどちらにも存在しない。2026-09-25裏取り済み）。さらに
 *   Codexはgitルートより上の階層を探索しないため、独立リポジトリである
 *   line-botから`../web-ios-android/CLAUDE.md`は原理的に届かない。
 *
 *   ⟹ Codex向けには「核ブロックの本文をAGENTS.mdへ直接転記する」以外の
 *      手段が無い（Claude Code公式ドキュメントが推奨する`@AGENTS.md`
 *      importやシンボリックリンクは、Codex側にimport機能そのものが無い
 *      2026-09-25時点では効かない。issue openai/codex#12115が未解決）。
 *
 *   だが「配布境界をまたぐ意図的な複製」（CLAUDE.md非交渉ルール6番）は、
 *   複製した瞬間から★正本が動くと無言で腐る。check-drift.mjsは実コード
 *   （JS/TS）のファイル全体比較専用で、Markdownの一部分（見出し区切りの
 *   1セクションだけ）を複数ファイルへ転記する今回の形には使えない
 *   （2026-09-25、codeOnly()の設計思想はそのまま流用できるが、
 *   「ファイル全体」対「ファイルの一部」という前提が違うため転用不可と判断）。
 *
 * ■ 何を見るか
 *   正本ファイルの中から、見出し文字列で指定した1セクションだけを抜き出し、
 *   そのSHA256ハッシュを記録する。コピー側ファイルに埋め込まれた
 *   `<!-- sync:核ブロック hash:<40桁省略ハッシュ> -->` のようなマーカーコメントと
 *   突き合わせ、正本セクションが変わったのにマーカーが古いままなら赤にする。
 *
 *   ★完全一致比較にしない理由: コピー側（AGENTS.md）は転記に加えて
 *   「Codex固有の実損エピソード」等の追加文言を持ってよい設計にしている
 *   （line-bot/AGENTS.md 15-22行目）。完全一致を強制すると、コピー側が
 *   自分の事例を書けなくなる（check-drift.mjsが「コメントは各リポの
 *   事例のままでよい」としているのと同じ思想）。
 *
 * ■ 3値の意味（この土台の3値規約）
 *   0 = pass         … 正本のハッシュとマーカーが一致（追随済み）
 *   1 = fail          … 正本のハッシュが変わったのにマーカーが古い（要追随）
 *   2 = inconclusive  … 正本/コピー/マーカーのいずれかが見つからない（測れない）
 *
 * ■ 使い方
 *   node _docs/instruments/check-cross-tool-instruction-sync.mjs
 *   node _docs/instruments/check-cross-tool-instruction-sync.mjs --selftest
 *
 * ■ 新しいコピー先を増やすとき
 *   下の PAIRS にエントリを1つ足す。正本側にはマーカーは要らない
 *   （正本はセクション自体がそのまま正）。コピー側ファイルの該当セクション
 *   直前に `<!-- sync:<label> hash:<ハッシュ先頭12桁> -->` を書く。
 *   このスクリプトが出す「→ 直し方」にそのままコピペできる行を出力する。
 * ─────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = resolve(HERE, '../..');
const GH_ROOT = resolve(KIT_ROOT, '..');

const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 });

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
const SELFTEST = isMain && process.argv.includes('--selftest');

/**
 * ★正本ファイルの中から、見出し文字列で1セクションだけ抜き出す。
 * `startHeading` に一致する行から、次に同じか上位の見出し（`##`以上）が
 * 出るまで（無ければファイル末尾まで）を返す。
 *
 * ★「上位」の判定は先頭の`#`の個数で行う。`## 見出しA`のセクション内に
 *   `### 小見出し`があっても、それはセクションの一部として含める
 *   （line-bot/AGENTS.mdの核ブロックが`###`を含まない構成なので、
 *   このキットのCLAUDE.md側にも同じ深さの制約は課さない＝`##`が来たら
 *   終わり、`###`以下は継続、という単純な規則で足りる）。
 */
export function extractSection(text, startHeadingSubstring) {
  const lines = text.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith('#') && l.includes(startHeadingSubstring));
  if (startIdx === -1) return null;
  const startLevel = lines[startIdx].match(/^#+/)[0].length;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    const m = lines[i].match(/^#+/);
    if (m && m[0].length <= startLevel) { endIdx = i; break; }
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

/** ★セクション本文からSHA256を計算し、読みやすい先頭12桁だけ返す。 */
export function sectionHash(sectionText) {
  const normalized = sectionText
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 12);
}

/**
 * ★コピー側ファイルから `<!-- sync:<label> hash:<12桁> -->` マーカーを探す。
 * 見つからなければ null（＝まだマーカーを埋めていない＝測れない）。
 */
function findMarkerHash(copyText, label) {
  const re = new RegExp(`<!--\\s*sync:${escapeRegExp(label)}\\s+hash:([0-9a-f]{12})\\s*-->`);
  const m = copyText.match(re);
  return m ? m[1] : null;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rel(p) {
  return p.split(GH_ROOT).join('').replace(/^[\\/]+/, '');
}

/**
 * ★転記ペアの一覧。1件目は2026-09-25にline-botへ転記した核ブロック。
 *
 * canonicalPath   … 正本ファイル
 * canonicalHeading… 正本側でセクションを切り出す見出しの部分文字列
 * copyPath        … 転記先ファイル
 * label           … マーカーコメントに使う短い識別子（英数字のみ推奨）
 */
export const PAIRS = [
  {
    label: 'core-block',
    canonicalPath: resolve(KIT_ROOT, 'CLAUDE.md'),
    canonicalHeading: '★核: 質問する前にこの手順を必ず通す',
    copyPath: resolve(GH_ROOT, 'line-bot/AGENTS.md'),
  },
];

function compare(pair) {
  if (!existsSync(pair.canonicalPath)) {
    return { verdict: 'inconclusive', detail: `正本が見つかりません: ${rel(pair.canonicalPath)}` };
  }
  if (!existsSync(pair.copyPath)) {
    return { verdict: 'inconclusive', detail: `コピー先が見つかりません: ${rel(pair.copyPath)}` };
  }
  const canonicalText = readFileSync(pair.canonicalPath, 'utf8');
  const section = extractSection(canonicalText, pair.canonicalHeading);
  if (section === null) {
    return {
      verdict: 'inconclusive',
      detail: `正本に見出し「${pair.canonicalHeading}」が見つかりません（改題された可能性）`,
    };
  }
  const currentHash = sectionHash(section);
  const copyText = readFileSync(pair.copyPath, 'utf8');
  const markerHash = findMarkerHash(copyText, pair.label);

  if (markerHash === null) {
    return {
      verdict: 'inconclusive',
      detail: `${rel(pair.copyPath)} にマーカーが未設置です`,
      howToFix: `転記ブロックの直前にこの1行を追加してください:\n`
        + `    <!-- sync:${pair.label} hash:${currentHash} -->`,
    };
  }
  if (markerHash !== currentHash) {
    return {
      verdict: 'fail',
      evidence: { 正本ハッシュ: currentHash, マーカーのハッシュ: markerHash },
      detail: `正本 ${rel(pair.canonicalPath)} の「${pair.canonicalHeading}」セクションが`
        + `更新されましたが、${rel(pair.copyPath)} のマーカーが追随していません。`,
      howToFix: `1. ${rel(pair.copyPath)} の転記内容を正本の最新セクションに合わせて書き直す\n`
        + `    2. マーカーを更新: <!-- sync:${pair.label} hash:${currentHash} -->`,
    };
  }
  return { verdict: 'pass', evidence: { hash: currentHash } };
}

/* ── --selftest: 毒を入れて赤くなるか確認する ───────────────── */
if (SELFTEST) {
  const fails = [];

  // 毒1: セクション抽出。見出しの直後から次の同格見出しまでを正しく切れるか
  const sample = '# Title\n\n## A\nline1\nline2\n\n## B\nline3\n';
  const secA = extractSection(sample, 'A');
  if (secA === null || secA.includes('line3') || !secA.includes('line1')) {
    fails.push(`セクション抽出が壊れている(得た: ${JSON.stringify(secA)})`);
  }

  // 毒2: 存在しない見出しを渡すと null になるべき
  if (extractSection(sample, '存在しない見出し') !== null) {
    fails.push('存在しない見出しでnullを返さなかった');
  }

  // 毒3: ハッシュが変われば違う値になり、末尾空白差は無視するべき
  const h1 = sectionHash('foo\nbar');
  const h2 = sectionHash('foo\nbar  ');
  const h3 = sectionHash('foo\nbaz');
  if (h1 !== h2) fails.push('末尾空白差をハッシュが拾ってしまう(誤検知の原因)');
  if (h1 === h3) fails.push('内容が違うのに同じハッシュになった(検知漏れ)');

  // 毒4: マーカー未設置は inconclusive であるべき(測れないを緑にしない)
  {
    const r = compare({
      label: 'selftest-dummy',
      canonicalPath: resolve(HERE, 'check-cross-tool-instruction-sync.mjs'),
      canonicalHeading: '存在しない見出し-selftest用',
      copyPath: resolve(HERE, 'check-cross-tool-instruction-sync.mjs'),
    });
    if (r.verdict !== 'inconclusive') fails.push(`見出し不在をinconclusiveにできない(得た: ${r.verdict})`);
  }

  // 毒5: 存在しないファイルを渡すと inconclusive
  {
    const r = compare({
      label: 'selftest-dummy2',
      canonicalPath: resolve(HERE, '.nope-does-not-exist.md'),
      canonicalHeading: 'x',
      copyPath: resolve(HERE, '.nope-does-not-exist2.md'),
    });
    if (r.verdict !== 'inconclusive') fails.push(`存在しない正本をinconclusiveにできない(得た: ${r.verdict})`);
  }

  if (fails.length) {
    console.error('[check-cross-tool-instruction-sync] ★selftest 失敗（検知器が効いていません）:');
    for (const f of fails) console.error('  - ' + f);
    process.exit(EXIT.FAIL);
  }
  console.log('[check-cross-tool-instruction-sync] selftest OK');
  process.exit(EXIT.PASS);
}

if (isMain) {
  let worst = EXIT.PASS;
  for (const pair of PAIRS) {
    const r = compare(pair);
    const mark = r.verdict === 'pass' ? '✅' : r.verdict === 'fail' ? '🔴' : '🟡';
    console.log(`[check-cross-tool-instruction-sync] ${mark} ${pair.label} — ${r.verdict}`);
    if (r.evidence) console.log('  根拠: ' + JSON.stringify(r.evidence, null, 0));
    if (r.detail) console.log('  ' + r.detail);
    if (r.howToFix) console.log('  → 直し方:\n    ' + r.howToFix.replace(/\n/g, '\n    '));
    if (r.verdict === 'fail') worst = EXIT.FAIL;
    else if (r.verdict === 'inconclusive' && worst === EXIT.PASS) worst = EXIT.INCONCLUSIVE;
  }
  process.exit(worst);
}
