#!/usr/bin/env node
// learnings/の地図整合検証 — 「新しい知見カードを追記したのに地図・最近の更新への
// 反映を忘れる」を機械的に検出する
// (設計: _docs/DESIGN-claude-md-web-version-2026-09-01.md §C-3)。
//
// 背景: kimito-skill.linkが「CLAUDE.mdの可視化」を掲げながら、実際には知見が
// 追加されるたびに人間もAIも「どこに何が増えたか」を確認できない状態だった。
// site/index.htmlの「このページの地図」パターンをlearnings/へ転用したが、
// 地図はh2の追加と手動で同期させる運用のため、更新を忘れると必ず腐る。
// ★「検査していない規範は守られない」（_docs/shared-parts-duplication-knowledge-base.md）
// の実践として、この整合を機械で見張る。
//
// RULE 1: site/learnings/index.html内の全<h2>がidを持つこと。
// RULE 2: 全h2のidが#page-map内の<a href="#...">に載っていること(載せ漏れ検知)。
// RULE 3: #page-map・#recent-updates内の全アンカーが実在するidを指すこと(空リンク検知)。
// RULE 4: #recent-updates の各行が<time datetime="YYYY-MM-DD">を持ち、日付降順であること。
//
// 実行: node scripts/verify-learnings-map.mjs
// exit 0 = 整合 / exit 1 = ドリフト検出(fail-closed) / exit 2 = 対象ファイルが無い(測定不能)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TARGET_PATH = path.join(ROOT, 'site', 'learnings', 'index.html');

const ANSI_RED = '\x1b[31m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_DIM = '\x1b[2m';
const ANSI_RESET = '\x1b[0m';

/**
 * 純ロジック本体。I/Oから切り離してselftest可能にする。
 * @param {string} html - learnings/index.html相当のHTML文字列
 * @returns {{failures: Array<{rule:string, message:string}>}}
 */
export function checkLearningsMap(rawHtml) {
  const failures = [];

  // ★HTMLコメントを先に落とす。運用手順の説明文に例示として
  //   <h2 id="新id"> のようなタグ片を書くと、コメントを除かずに走査すると
  //   本物のh2として誤検出する(実測で判明・2026-09-01)。
  const html = String(rawHtml || '').replace(/<!--[\s\S]*?-->/g, '');

  // #page-map / #recent-updates ブロックを抜き出す(単純な文字列探索。依存を増やさない)。
  const pageMapMatch = html.match(/<nav[^>]*id="page-map"[\s\S]*?<\/nav>/);
  const recentMatch = html.match(/<section[^>]*id="recent-updates"[\s\S]*?<\/section>/);
  const pageMapHtml = pageMapMatch ? pageMapMatch[0] : '';
  const recentHtml = recentMatch ? recentMatch[0] : '';

  if (!pageMapHtml) {
    failures.push({ rule: 'RULE 2', message: '#page-map ブロックが見つからない(地図そのものが無い)' });
  }

  // 全h2のid一覧(page-map/recent-updates自身のタイトルはh2ではないので対象外)。
  const h2Re = /<h2\b([^>]*)>/g;
  const h2Ids = [];
  let m;
  while ((m = h2Re.exec(html)) !== null) {
    const attrs = m[1];
    const idMatch = attrs.match(/\bid="([^"]+)"/);
    if (idMatch) {
      h2Ids.push(idMatch[1]);
    } else {
      const nearText = html.slice(m.index, m.index + 120).replace(/\s+/g, ' ');
      // RULE 1: idの無いh2を検出。
      failures.push({ rule: 'RULE 1', message: `id属性の無い<h2>がある: ${nearText}…` });
    }
  }

  // 地図内のリンク先id一覧。
  const linkRe = /href="#([a-z0-9-]+)"/g;
  const mapLinkIds = new Set();
  let lm;
  while ((lm = linkRe.exec(pageMapHtml)) !== null) mapLinkIds.add(lm[1]);
  const recentLinkIds = new Set();
  let rm;
  while ((rm = linkRe.exec(recentHtml)) !== null) recentLinkIds.add(rm[1]);

  // RULE 2: 全h2のidが地図に載っているか。
  for (const id of h2Ids) {
    if (!mapLinkIds.has(id)) {
      failures.push({ rule: 'RULE 2', message: `h2 id="${id}" が #page-map に載っていない(載せ漏れ)` });
    }
  }

  // 実在するid全体の集合(h2以外のsection/nav自身のidも許容: recent-updates, page-map)。
  const allIdRe = /\bid="([^"]+)"/g;
  const allIds = new Set();
  let am;
  while ((am = allIdRe.exec(html)) !== null) allIds.add(am[1]);

  // RULE 3: 地図・最近の更新のリンクが実在するidを指しているか(空リンク検知)。
  for (const id of mapLinkIds) {
    if (!allIds.has(id)) failures.push({ rule: 'RULE 3', message: `#page-map のリンク先 "#${id}" が実在しない` });
  }
  for (const id of recentLinkIds) {
    if (!allIds.has(id)) failures.push({ rule: 'RULE 3', message: `#recent-updates のリンク先 "#${id}" が実在しない` });
  }

  // RULE 4: #recent-updates の各行がtime datetimeを持ち、日付降順であること。
  if (recentHtml) {
    const liRe = /<li>([\s\S]*?)<\/li>/g;
    const dates = [];
    let li;
    while ((li = liRe.exec(recentHtml)) !== null) {
      const dtMatch = li[1].match(/<time\s+datetime="(\d{4}-\d{2}-\d{2})"/);
      if (!dtMatch) {
        failures.push({ rule: 'RULE 4', message: `#recent-updates の行に<time datetime>が無い: ${li[1].slice(0, 60)}…` });
        continue;
      }
      dates.push(dtMatch[1]);
    }
    for (let i = 1; i < dates.length; i++) {
      if (dates[i] > dates[i - 1]) {
        failures.push({ rule: 'RULE 4', message: `#recent-updates が日付降順になっていない(${dates[i - 1]} の次に ${dates[i]})` });
        break;
      }
    }
  }

  return { failures };
}

// ---------------------------------------------------------------------------
// selftest: 毒フィクスチャで両方向(赤/緑)を確認する。
// ---------------------------------------------------------------------------
function runSelftest() {
  const fails = [];

  // ① 正の対照: 整合が取れたHTMLは緑。
  const good = `
    <section id="recent-updates"><ul>
      <li><time datetime="2026-09-02">2026-09-02</time> <a href="#foo">Foo</a></li>
      <li><time datetime="2026-09-01">2026-09-01</time> <a href="#bar">Bar</a></li>
    </ul></section>
    <nav id="page-map"><ul>
      <li><a href="#foo">Foo</a></li>
      <li><a href="#bar">Bar</a></li>
    </ul></nav>
    <h2 id="foo">Foo</h2>
    <h2 id="bar">Bar</h2>
  `;
  {
    const r = checkLearningsMap(good);
    if (r.failures.length !== 0) fails.push('★整合の取れたHTMLを赤にしている: ' + JSON.stringify(r.failures));
  }

  // ② RULE 1: idの無いh2は赤。
  {
    const bad = good.replace('<h2 id="bar">Bar</h2>', '<h2>Bar</h2>');
    const r = checkLearningsMap(bad);
    if (!r.failures.some((f) => f.rule === 'RULE 1')) fails.push('★idの無いh2を検出できない');
  }

  // ③ RULE 2: h2はあるが地図に載っていないものは赤(載せ漏れ)。
  {
    const bad = good.replace('<h2 id="bar">Bar</h2>', '<h2 id="bar">Bar</h2><h2 id="baz">Baz</h2>');
    const r = checkLearningsMap(bad);
    if (!r.failures.some((f) => f.rule === 'RULE 2' && f.message.includes('baz'))) {
      fails.push('★地図への載せ漏れを検出できない');
    }
  }

  // ④ RULE 3: 地図のリンクが実在しないidを指していれば赤(空リンク)。
  {
    const bad = good.replace('<li><a href="#bar">Bar</a></li>\n    </ul></nav>', '<li><a href="#bar">Bar</a></li>\n      <li><a href="#ghost">Ghost</a></li>\n    </ul></nav>');
    const r = checkLearningsMap(bad);
    if (!r.failures.some((f) => f.rule === 'RULE 3' && f.message.includes('ghost'))) {
      fails.push('★空リンクを検出できない');
    }
  }

  // ⑤ RULE 4: 日付が降順でなければ赤。
  {
    const bad = good.replace('2026-09-02', '2026-08-01');
    const r = checkLearningsMap(bad);
    if (!r.failures.some((f) => f.rule === 'RULE 4')) fails.push('★日付の昇順を検出できない');
  }

  // ⑥ #page-map 自体が無ければ赤。
  {
    const bad = good.replace(/<nav id="page-map">[\s\S]*?<\/nav>/, '');
    const r = checkLearningsMap(bad);
    if (!r.failures.some((f) => f.rule === 'RULE 2' && f.message.includes('地図そのものが無い'))) {
      fails.push('★地図が丸ごと無い状態を検出できない');
    }
  }

  // ⑦ ★実損の再現: コメント内の<h2>例示を本物のh2と誤検出しないこと(2026-09-01)。
  //    運用手順の説明文に <h2 id="新id"> という例示を書いたところ、コメントを除かずに
  //    走査する版はこれを本物のh2として拾い、実在しないid="新id"の載せ漏れを誤検出した。
  const withComment = good + '\n<!-- 例: <h2 id="新id">サンプル</h2> のように書く -->';
  {
    const r = checkLearningsMap(withComment);
    if (r.failures.length !== 0) fails.push('★コメント内のh2例示を本物のh2と誤認している: ' + JSON.stringify(r.failures));
  }

  if (fails.length > 0) {
    console.error('[verify-learnings-map] ✗ selftest NG');
    fails.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('[verify-learnings-map] selftest OK'
    + '(整合済みは緑 / idなしh2 / 載せ漏れ / 空リンク / 日付昇順 / 地図丸ごと欠落)');
  process.exit(0);
}

function main() {
  if (process.argv.includes('--selftest')) return runSelftest();

  if (!fs.existsSync(TARGET_PATH)) {
    console.error(`[verify-learnings-map] ★測れませんでした: 対象が見つからない (${TARGET_PATH})`);
    process.exit(2);
  }

  const html = fs.readFileSync(TARGET_PATH, 'utf8');
  const { failures } = checkLearningsMap(html);

  if (failures.length === 0) {
    console.log(`${ANSI_GREEN}✓${ANSI_RESET} learnings/の地図整合ドリフトなし ${ANSI_DIM}(RULE 1-4 全通過)${ANSI_RESET}`);
    process.exit(0);
  }

  console.log(`${ANSI_RED}--- learnings map drift (${failures.length}) ---${ANSI_RESET}`);
  for (const f of failures) console.log(`${ANSI_RED}✗${ANSI_RESET} [${f.rule}] ${f.message}`);
  console.log('');
  console.log(`${ANSI_RED}verify-learnings-map failed.${ANSI_RESET} learnings/の地図とカードがズレている。`);
  console.log('  → 直し方: h2を追加/削除したら #page-map にも1行足す/消す。');
  console.log('     #recent-updates は新しい行を先頭に足し、10行を超えたら末尾を削る。');
  process.exit(1);
}

main();
