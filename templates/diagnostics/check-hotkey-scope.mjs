#!/usr/bin/env node
/**
 * check-hotkey-scope.mjs — ★キーボードを奪ったまま返さない形を、出荷前に止める。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るか(2026-09-01・実損。soushin-suggest.link で発生)
 *
 *   AutoHotkey製の常駐ツールで、オーナーが作業中に
 *   「スペースキーを打っても変換されない」状態になった。
 *   ★製品を Stop-Process した瞬間に直った＝製品が原因。★同じ日に2回起きた。
 *
 *   真因は1行だった(src/072-image-viewer.ahk:388):
 *     #HotIf IsLauncherAlive() && !IvIsOpen()      ← ★WinActive が無い
 *     Space::IvShowHovered()
 *
 *   IsLauncherAlive() は「生きているか」であって「前面にいるか」ではない。
 *   そのウィンドウが前面でなくても真になり続けるので、
 *   ★メモ帳でもブラウザでも Space がこのホットキーへ吸われた。
 *   しかも飲み込むだけで下流アプリへ Send しない経路だったため、
 *   「変換できない」に見えた。
 *
 *   ★他の4本(数字キー/Enter/^+f)は全部 WinActive を条件に持っていて無事だった。
 *   つまり【1本だけ仲間外れ】だったのを、誰も見ていなかった。
 *
 * ■ ★なぜ「毒」が要らないか
 *
 *   この検査は綴りでも件数でもなく【条件式の形】を見る。
 *   ★WinActive を消せばその場で赤になる。仕掛けは要らない。
 *
 * ■ 何を赤にするか
 *
 *   「キーボードのキー」を握るホットキーの #HotIf 条件に
 *   ★WinActive( が1つも無ければ赤。
 *
 *   ・マウスだけのブロック(LButton/RButton/MButton/XButton/WheelUp 等)は対象外。
 *     ★マウスは「押した場所」が対象を決めるので、前面判定が無くても
 *     他アプリのキーボードを奪わない。
 *   ・条件が【関数名】のとき(例: HotIf LauncherPickHotkeyActive)は、
 *     ★その関数の中で WinActive を呼んでいれば合格とする。
 *   ・どうしても例外にしたい行には、直前の行に
 *       ; hotkey-scope-exempt: 理由
 *     を書く。★理由を書かせることで「なんとなくの例外」を作らせない。
 *
 * ■ ★この検査が判定しないこと
 *
 *   ・ホットキーの中身が正しいかは見ない。
 *   ・WinActive を書きさえすれば通る(空の WinActive を書けば騙せる)。
 *   ★それでも意味がある: 今回の実損は「書き忘れ」だったから。
 *
 * ■ ★AutoHotkey前提の検査であること(強制しない・このキットの掟)
 *
 *   この検査は AutoHotkey の #HotIf/Hotkey 構文だけを見る。
 *   ★対象に .ahk が1件も無いプロジェクトは skip する(check-heartbeat-present.mjs
 *   と同じ設計: ログを書かない製品に心拍を求めないのと同様、AutoHotkeyでない
 *   プロジェクトに AutoHotkey 用の判定を強制しない)。
 *
 * ■ 3値の終了コード
 *   0 = 合格(またはskip) / 1 = ★測れた上での赤 / 2 = ★測れなかった
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 使い方:
 *   node check-hotkey-scope.mjs [対象ディレクトリ]
 *   node check-hotkey-scope.mjs --selftest   ← ★自分自身を毒で試す
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// マウス専用のキー名。これしか無いブロックは前面判定が無くても安全。
const MOUSE_ONLY = [
  'LButton', 'RButton', 'MButton', 'XButton1', 'XButton2',
  'WheelUp', 'WheelDown', 'WheelLeft', 'WheelRight',
];

// ★「出荷しないファイル」を読まない(2026-09-01・実測で偽陽性6件)。
//
// 【何が起きたか】soushin-suggest.link で赤6件が出たが、★実体は全部
//   出荷対象外だった: dist-demo/(デモ生成物) と tmp/tauridev-52/(外部レビューへ
//   渡した【過去版 v1.40.0】のコピー)。src/ は例外宣言付きで正しく緑だった。
//
// 【なぜ放置できないか】出荷しないファイルで赤が出続けると
//   ★赤が常態になって誰も見なくなる。本物が1件混ざっても埋もれる。
//   (「警告だけのガードは無いのと同じ」と同型の壊れ方)
//
// ★除外は検査を【弱める】変更なので、selftest に正の対照を必ず置くこと
//   (⑫ tmp/ は拾わない ⇔ ⑬ src/ なら拾う。この対がないと
//    「除外しすぎて何も見ない検査」が緑のまま通る)。
const SKIP_DIRS = new Set([
  'node_modules', '.git',
  'dist', 'build', 'out', '.next', '.nuxt', '.output', 'coverage', 'vendor',
  // ★作業用・外部へ渡したコピー。出荷物ではない
  'tmp', 'temp', '.tmp',
  // ★デモ用の生成物
  'dist-demo', 'demo',
  // ★退避・過去版
  'backup', 'archive', '_old',
]);

// ★版番号入りのファイル名は【過去版のコピー】とみなして読まない。
//   例: soushin-suggest-v1.40.0.ahk。ディレクトリ除外だけだと、
//   出荷ディレクトリ直下に置かれた過去版を拾ってしまう。
const OLD_VERSION_FILE = /-v\d+\.\d+/;

/**
 * ソース1本(文字列)を読み、危険なホットキーブロックを返す。
 * ★ファイルの中身(文字列)だけを受け取り、I/O から切り離す(selftestのため)。
 *
 * @param {string} text
 * @param {string} fileName
 * @param {Record<string, boolean>} predicateHasWinActive 関数名→中でWinActiveを呼ぶか
 * @returns {Array<{file:string, line:number, key:string, cond:string, why:string}>}
 */
export function findUnscopedHotkeys(text, fileName = '(inline)', predicateHasWinActive = {}) {
  const findings = [];
  const lines = String(text || '').split(/\r?\n/);
  let cond = null; // 現在有効な #HotIf の条件(null = 全画面)
  let exemptBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // 例外宣言。次のホットキーブロック1つを見逃す。
    // ★例外宣言はブロック全体に効く(#HotIfが来るまで)。
    //   4本並んだホットキーに1行ずつ書かせるのは冗長で、書き漏れも生む。
    if (/^;\s*hotkey-scope-exempt\s*:/.test(line)) { exemptBlock = true; continue; }
    if (/^;/.test(line)) continue;

    // #HotIf / HotIf の条件を拾う。★条件は複数行に折り返されることがある
    //   (090-startup.ahk:148-149が実例)ので、次行が &&/|| で始まるなら連結する。
    if (/^#?HotIf\b/.test(line)) {
      cond = line.replace(/^#?HotIf\s*/, '');
      exemptBlock = false; // 新しいブロックでは例外を持ち越さない
      let j = i + 1;
      while (j < lines.length && /^(&&|\|\|)/.test(lines[j].trim())) {
        cond += ' ' + lines[j].trim();
        j++;
      }
      continue;
    }

    // ★ホットキー定義は2つの書き方がある。両方を拾う。
    //   (a) ラベル形式   Space::Foo()
    //   (b) 関数形式     Hotkey "Enter", Foo
    //   ★(b)を見落とすと、製品の数字キー・Enterがまるごと検査の外に出る。
    let keyPart = '';
    let m;
    if ((m = line.match(/^\s*Hotkey\s+"([^"]+)"\s*\./))) {
      // ★キー名を式で組み立てている(例: Hotkey "+" . Mod(A_Index,10))。
      //   静的には確定できないので、条件側の判定にだけ委ねる。
      keyPart = '(式で組み立て)';
    } else if ((m = line.match(/^\s*Hotkey\s+"([^"]+)"/))) {
      keyPart = m[1].trim();
    } else if ((m = line.match(/^([A-Za-z0-9_~$*!^+#<>&\s]+?)::/))) {
      // ★キー名に使える文字だけを認める。ComCall(...) のような
      //   「:: を含む普通の式」を誤ってホットキーと読まないため。
      keyPart = m[1].trim();
      // ★~ 付きは【素通し】(キーを飲み込まない)ので他アプリを壊さない。
      //   実例: ~^c / ~LButton up は記録だけして通す。
      if (/^~/.test(keyPart)) continue;
    } else {
      continue;
    }

    if (exemptBlock) continue;

    // マウスだけなら安全
    if (MOUSE_ONLY.some((k) => keyPart.includes(k))) continue;

    // ★条件が空(#HotIf単独 or 未設定) = 全画面で有効
    if (!cond || !cond.trim()) {
      findings.push({ file: fileName, line: i + 1, key: keyPart, cond: '(条件なし=全画面)', why: '前面判定が無い' });
      continue;
    }

    // 条件にWinActiveがあれば合格
    if (/WinActive\s*\(/.test(cond)) continue;

    // 条件が関数名だけのとき、その関数が中でWinActiveを見ていれば合格
    let fnOk = false;
    for (const fn of Object.keys(predicateHasWinActive)) {
      if (cond.includes(fn)) { fnOk = predicateHasWinActive[fn] === true; break; }
    }
    if (fnOk) continue;

    findings.push({ file: fileName, line: i + 1, key: keyPart, cond, why: '条件にWinActiveが無い' });
  }
  return findings;
}

/**
 * ★対象ディレクトリを走査し、.ahk 全体から述語関数のWinActive有無を先に調べてから判定する。
 * .ahk が1件も無ければ ok:false, skip:true(対象外。合格ではない)。
 */
export function scanDirectory(dir) {
  if (!dir || !existsSync(dir)) return { ok: false, skip: false, reason: `対象が見つからない: ${dir}` };

  const files = [];
  const walk = (d) => {
    let ents = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(join(d, e.name));
        continue;
      }
      if (!e.name.endsWith('.ahk')) continue;
      if (OLD_VERSION_FILE.test(e.name)) continue;   // ★過去版のコピーは出荷物ではない
      files.push(join(d, e.name));
    }
  };
  walk(dir);

  // ★AutoHotkeyでないプロジェクトには当たらない。強制しない(このキットの掟)。
  if (files.length === 0) return { ok: false, skip: true, reason: '.ahk が1つも無い' };

  files.sort();
  const bodies = files.map((f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } });
  const allText = bodies.join('\n');

  // 述語関数が中でWinActiveを見ているかを先に調べる(条件が関数名のときに使う)
  // ★(*)や引数付きの定義も拾う(LauncherPickHotkeyActive(*)が実例)
  const predicates = {};
  const fnDefRe = /^([A-Za-z_]\w*)\([^)]*\)\s*\{/gm;
  let m;
  while ((m = fnDefRe.exec(allText)) !== null) {
    const name = m[1];
    let body = allText.slice(m.index);
    const endRel = body.indexOf('\n}');
    if (endRel > 0) body = body.slice(0, endRel);
    predicates[name] = /WinActive\s*\(/.test(body);
  }

  const all = [];
  for (let i = 0; i < files.length; i++) {
    const fileName = files[i].split(/[\\/]/).pop();
    all.push(...findUnscopedHotkeys(bodies[i], fileName, predicates));
  }
  return { ok: true, skip: false, files: files.length, findings: all };
}

// ---------------------------------------------------------------------------
// ★自己校正。毒を仕掛けずに、判定が両方向へ動くことをその場で確かめる。
// ---------------------------------------------------------------------------
function runSelftest() {
  const fails = [];

  // ① ★実損の再現: 前面を見ないSpaceは赤
  {
    const bad = '#HotIf IsLauncherAlive() && !IvIsOpen()\nSpace::IvShowHovered()\n#HotIf';
    const r = findUnscopedHotkeys(bad);
    if (r.length !== 1) fails.push(`★前面を見ないSpaceを赤にできない(件数=${r.length})`);
  }

  // ② ★正の対照: WinActiveがあれば緑
  {
    const good = '#HotIf IsLauncherAlive() && WinActive("ahk_id " . g.Hwnd)\nSpace::Foo()\n#HotIf';
    const r = findUnscopedHotkeys(good);
    if (r.length !== 0) fails.push('★WinActive付きを誤って赤にしている');
  }

  // ③ ★複数行の条件を読めること(090-startup.ahk:148-149の実例)
  {
    const multi = 'HotIf (*) => IsObject(g) && !mode\n          && WinActive("ahk_id " . g.Hwnd)\nHotkey "Enter", Foo\nHotIf';
    const r = findUnscopedHotkeys(multi);
    if (r.length !== 0) fails.push('★折り返した条件のWinActiveを見落としている');
  }

  // ④ マウス専用は対象外(前面判定が無くても安全)
  {
    const mouse = '#HotIf CopyOnSelectApp()\n~LButton up:: {\n}\n#HotIf';
    const r = findUnscopedHotkeys(mouse);
    if (r.length !== 0) fails.push('★マウス専用を誤って赤にしている');
  }

  // ⑤ ★条件がまったく無いキーは赤(全画面で奪う)
  {
    const naked = 'Space::Foo()';
    const r = findUnscopedHotkeys(naked);
    if (r.length !== 1) fails.push('★条件なしのキーを赤にできない');
  }

  // ⑥ 述語関数が中でWinActiveを見ていれば緑(063:497の実例)
  {
    const pred = 'HotIf LauncherPickHotkeyActive\nHotkey "1", Foo\nHotIf';
    const r = findUnscopedHotkeys(pred, '(inline)', { LauncherPickHotkeyActive: true });
    if (r.length !== 0) fails.push('★中でWinActiveを見る述語を誤って赤にしている');
  }

  // ⑦ ★負の対照: 述語が中でも見ていなければ赤(⑥と1点しか違わない対で測る)
  {
    const pred2 = 'HotIf SomePredicate\nHotkey "1", Foo\nHotIf';
    const r = findUnscopedHotkeys(pred2, '(inline)', { SomePredicate: false });
    if (r.length !== 1) fails.push('★WinActiveを見ない述語を緑にしている');
  }

  // ⑧ 例外宣言が効くこと(理由を書けば1つだけ見逃す)
  {
    const ex = '#HotIf Foo()\n; hotkey-scope-exempt: 理由をここに書く\nSpace::Bar()\n#HotIf';
    const r = findUnscopedHotkeys(ex);
    if (r.length !== 0) fails.push('★例外宣言が効いていない');
  }

  // ⑨ ★Hotkey形式(関数形式)も拾えること。見落とすと数字キー・Enterが検査の外に出る。
  {
    const fnForm = '#HotIf Foo()\nHotkey "Enter", Bar\n#HotIf';
    const r = findUnscopedHotkeys(fnForm);
    if (r.length !== 1) fails.push('★Hotkey関数形式のキーを見落としている(件数=' + r.length + ')');
  }

  // ⑩ ★「::」を含むだけの普通の式をホットキーと誤読しないこと
  {
    const notHotkey = '#HotIf Foo()\nComCall(6, props, "ptr", key, "ptr", propvar)\n#HotIf';
    const r = findUnscopedHotkeys(notHotkey);
    if (r.length !== 0) fails.push('★普通の式をホットキーと誤読している(件数=' + r.length + ')');
  }

  // ⑪ ★.ahkが1件も無いプロジェクトはskip(対象外。合格ではない)であること
  {
    const dir = mkdtempSync(join(tmpdir(), 'nl-hk-noahk-'));
    writeFileSync(join(dir, 'a.mjs'), 'console.log("not ahk")\n');
    const r = scanDirectory(dir);
    if (!(r.ok === false && r.skip === true)) fails.push('★.ahk無しをskip扱いにできていない: ' + JSON.stringify(r));
  }

  // ─────────────────────────────────────────────────────────────────────
  // ★⑫⑬⑭ は【対で測る】。除外は検査を弱める変更なので、
  //   「拾わない」だけを確かめると "何も見ない検査" が緑で通ってしまう。
  //   同じ中身を置き場所だけ変えて、拾う/拾わない が反転することを見る。
  // ─────────────────────────────────────────────────────────────────────
  const DANGEROUS = 'Space::Foo()' + String.fromCharCode(10);   // ★前面判定なし＝本来は必ず赤

  // ⑫ ★正の対照: src/ に置けば拾える(除外しすぎていない証明)
  {
    const dir = mkdtempSync(join(tmpdir(), 'nl-hk-pos-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ahk'), DANGEROUS);
    const r = scanDirectory(dir);
    if (!(r.ok === true && r.findings && r.findings.length === 1)) {
      fails.push('★src/の危険なホットキーを拾えていない(除外しすぎ): ' + JSON.stringify(r));
    }
  }

  // ⑬ ★負の対照: 同じ中身でも tmp/ なら読まない(出荷物ではない)
  {
    const dir = mkdtempSync(join(tmpdir(), 'nl-hk-tmp-'));
    mkdirSync(join(dir, 'tmp'));
    writeFileSync(join(dir, 'tmp', 'a.ahk'), DANGEROUS);
    const r = scanDirectory(dir);
    if (!(r.ok === false && r.skip === true)) {
      fails.push('★tmp/配下(出荷対象外)を読んでしまっている: ' + JSON.stringify(r));
    }
  }

  // ⑭ ★版番号入りのファイル名は過去版のコピー。src/直下でも読まない
  {
    const dir = mkdtempSync(join(tmpdir(), 'nl-hk-ver-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'app-v1.40.0.ahk'), DANGEROUS);
    const r = scanDirectory(dir);
    if (!(r.ok === false && r.skip === true)) {
      fails.push('★版番号入り(過去版のコピー)を読んでしまっている: ' + JSON.stringify(r));
    }
  }

  if (fails.length > 0) {
    console.error('[check-hotkey-scope] ✗ selftest NG');
    fails.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('[check-hotkey-scope] selftest OK'
    + '(前面なし=赤 / WinActive有=緑 / 折り返し条件 / マウス除外 / 述語の中身 / 例外宣言'
    + ' / Hotkey関数形式 / 誤読防止 / .ahk無しはskip)');
  process.exit(0);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) return runSelftest();

  const dir = args.find((a) => !a.startsWith('--')) || process.cwd();
  console.log(`[check-hotkey-scope] ${new Date().toISOString()}`);

  const res = scanDirectory(dir);

  if (res.skip) {
    console.log(`[check-hotkey-scope] skip: この対象は AutoHotkey ではありません(${res.reason})。`);
    console.log('  → ★対象外です。合格ではありません。');
    process.exit(0);
  }
  if (!res.ok) {
    console.error(`[check-hotkey-scope] ★測れませんでした: ${res.reason}`);
    process.exit(2);
  }

  if (res.findings.length === 0) {
    console.log(`[check-hotkey-scope] ✅ 合格(検査 ${res.files} ファイル・前面判定の無いキーボードホットキーは0件)`);
    process.exit(0);
  }

  console.error(`[check-hotkey-scope] 🔴 NG: 前面判定の無いキーボードホットキーが ${res.findings.length} 件`);
  for (const x of res.findings) {
    console.error(`  ${x.file}:${x.line}  キー=${x.key}`);
    console.error(`      条件: ${x.cond}`);
    console.error(`      理由: ${x.why}`);
  }
  console.error('');
  console.error('  → ★条件に WinActive("ahk_id " . <対象Gui>.Hwnd) を足してください。');
  console.error('     前面を見ないと、常駐ウィンドウが閉じきれずに残ったとき');
  console.error('     ★全アプリでそのキーを奪います(2026-09-01にSpaceで実害)。');
  console.error('  → 例外にする正当な理由があるなら、直前の行に次を書いてください:');
  console.error('       ; hotkey-scope-exempt: 理由');
  process.exit(1);
}

main();
