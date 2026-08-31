#!/usr/bin/env node
/**
 * check-heartbeat-present.mjs — ★製品は「異常なし」を自分で名乗れるか。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るか(2026-08-24・実損)
 *
 *   ある製品で、重いテストスイート(製品を起動する76本・1回22分)を回していた。
 *   ★実測すると、そのスイートが見つけた製品の不具合は【0件】だった。
 *   最後の完走で出た赤4本は、3本が「検査の期待値が古い」・1本が「計器自身の
 *   未初期化」で、製品の機能はどれも壊れていなかった。
 *
 *   同じ期間に実際に見つかった不具合5件の発見経路は、すべて別だった:
 *     ・オーナーの口頭/実機報告            3件
 *     ・★製品が自分で吐いた診断ログの実数  2件
 *
 *   ⟹ 外から製品を起動して覗く検査より、
 *      ★製品が自分の状態を記録している方が、実際に原因へ届いていた。
 *
 * ■ ★では重い検査を全部捨ててよいのか → 【捨ててはいけない盲点が1つある】
 *
 *   ログは「症状が出たとき」に書かれる。すると、
 *     A. 本当に何も起きなかった
 *     B. ★計器そのものが動いていなかった(起動直後に死んだ等)
 *   が【同じ見た目】になる。★沈黙は正常の証拠ではない。
 *
 *   実際にその製品には、こう書かれた一次記録がある:
 *     「Can't create control. の類は OnError を経由せず AHK が直接ダイアログを出す。
 *       競合を再現させて OnError に記録を仕込んだが【一度も呼ばれなかった】」
 *   ⟹ 起動時に落ちると、ログには本当に何も残らない。
 *
 * ■ ★何を数えるか
 *   「症状が無くても定期的に1行書く」仕組み(=心拍)が在るか。
 *   在れば、最後の心拍から【いつ動かなくなったか】が分かる。
 *
 *   心拍とみなす形(言語をまたいで、綴りの表で持つ):
 *     ・一定間隔で走る仕掛け (SetTimer / setInterval / Timer / schedule)
 *     ・かつ、その近くで記録している (log / append / write / heartbeat / snapshot)
 *
 * ■ ★この検査が判定しないこと
 *   心拍の中身が正しいかは見ない。間隔が適切かも見ない。
 *   ★「異常が無くても記録する仕掛けが在るか」だけ。空の心拍を書けば通る。
 *   ⟹ それでも意味がある。★沈黙と正常を区別する土台になるのはこの1点だけ。
 *
 * ■ ★強制しない(このキットの掟)
 *   心拍が1つも無いプロジェクトを一律に赤にはしない。
 *   ★「ログを書く仕組みを既に持っているのに、心拍だけが無い」ときに赤にする。
 *   ログを一切書かない小さなツールに心拍を求めても、通すためだけの空実装が増えるだけ。
 *
 * ■ 3値の終了コード
 *   0 = 合格 / 1 = ★測れた上での赤 / 2 = ★測れなかった
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 使い方:
 *   node check-heartbeat-present.mjs [対象ディレクトリ]
 *   node check-heartbeat-present.mjs --selftest   ← ★自分自身を毒で試す
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SRC_FILE_RE = /\.(ahk|js|mjs|ts|cs|py)$/;

/**
 * ★走査しないディレクトリ(2026-08-31 に生成物を追加)。
 *
 * 【なぜ生成物を外すか(実測)】キット自身に当てたとき、証跡がこう出ていた:
 *     ✅ 合格(心拍が在ります: api.ts, main-nyV2JAdP.js, worker-entry-O_x3YhXA.js, …)
 *   ★正体は dist/ 配下の【minify 済みビルド成果物】で、.gitignore された場所だった。
 *
 *   ・minify は1行が数万字になるため、②の【窓300字】の前提が崩れる
 *   ・生成物は【直せない】。赤くなっても人間が対処できない
 *   ・"main-nyV2JAdP.js" を見に行っても、人間には何の根拠にもならない
 *
 * ★元ソースに心拍が在れば生成物にも在るので、除外しても見逃しは増えない。
 */
const SKIP_DIRS = new Set([
  'node_modules', '.git',
  'dist', 'build', 'out', '.next', '.nuxt', '.output', 'coverage', 'vendor',
]);

/**
 * ★コメントを落とす(2026-08-31)。綴りで判定する前に必ず通す。
 *
 * 【なぜ要るか】コメントは「書いてあるだけ」で、動く保証がゼロ。
 *   ★実測で、心拍を停止させた製品が【コメント1行】だけで合格した。
 *   ここで落としておけば、以後どの判定も「書いてあるだけ」に騙されない。
 *
 * 【★対象の綴り】このキットは言語をまたぐので、行コメントは表で持つ:
 *   ; (AutoHotkey) / # (Python・シェル・PowerShell) / // (JS/TS/C#)
 *   ブロックコメント (JS/TS/C#) も落とす。
 *
 * 【★やらないこと】文字列リテラルの中までは見ない。
 *   "heartbeat" という【文字列】を書けば通ってしまうが、
 *   ★それはログに出す文言である可能性が高く、コメントほど無害ではない。
 *   完全な構文解析はこのキットの方針(依存を増やさない)に反するので踏み込まない。
 */
export function stripComments(src) {
  return String(src || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')   // ブロックコメント。★行より先に落とす
    .replace(/^[ \t]*[;#].*$/gm, '')    // AHK(;) / Python・シェル・PowerShell(#)
    .replace(/^[ \t]*\/\/.*$/gm, '');   // JS/TS/C#
}

/** 定期的に走る仕掛けが在るか。 */
export function hasPeriodic(src) {
  const s = String(src || '');
  return /SetTimer|setInterval|System\.Threading\.Timer|schedule|every\(|cron/i.test(s);
}

/** 記録する仕掛けが在るか(ログを書く製品かどうかの判定にも使う)。 */
export function hasLogging(src) {
  const s = String(src || '');
  return /FileAppend|appendFile|writeFile|console\.log|logger|Log\(|Snapshot\(/.test(s);
}

/**
 * ★心拍とみなせるか。
 *
 * 【★最初の版は偽の緑を出した(2026-08-24・実測)】
 *   当初は「同じファイルに SetTimer と FileAppend が在れば心拍」と判定した。
 *   実在する製品(1万行・31ファイル)に当てたところ【合格】と出たが、
 *   ★その製品に心拍は実装されていなかった。
 *   ログを書く製品なら、定期処理と記録が同居するファイルは普通に在る。
 *   ⟹ 部分一致は偽の緑を作る。この検査自身がその型を踏んだ。
 *
 * 【★直した判定】記録が【定期実行の中】に在ることを見る。
 *   ・明示的な heartbeat / 心拍 の綴り、または
 *   ・「繰り返す仕掛けの呼び出しの内側」に記録がある
 *   ★ここまで厳しくして初めて「症状が無くても書く」を捉えられる。
 *
 * 【★この判定の限界】タイマーで呼ぶ関数が別に定義されていて、
 *   その中で記録している形は【見つけられない】。
 *   ⟹ ★見逃す方向の誤りであり、偽の緑より安全。
 *      確実に見つけてほしいなら、関数名か注釈に heartbeat と書くこと。
 */
export function looksLikeHeartbeat(src) {
  const s = stripComments(String(src || ''));
  // ① 明示的に名乗っているもの。★最も確実で、実装者の意図が読める。
  //
  // 【★偽の緑を出した(2026-08-31・実測)】当初は綴りが在るだけで true にしていた:
  //     if (/heartbeat|Heartbeat|HEARTBEAT|心拍/.test(s)) return true;
  //   実在の製品で心拍を【3重に停止】させた(呼び出しを削除・周期を負(1回きり)に
  //   改変・綴りを置換)にもかかわらず、★残った2つだけで【合格】が出た:
  //     global DIAG_HEARTBEAT_MS := 300000   ← 定数の宣言
  //     ; ★心拍を始める                      ← コメント
  //   ⟹ ★コメント1行だけで通る = 実装がゼロでも緑。
  //      この検査の目的(沈黙と正常を区別する)と、挙動が矛盾していた。
  //
  // 【★直した判定】コードとして名乗っているものだけを認める:
  //   ・コメントを先に落とす(stripComments)
  //   ・★定数の【宣言だけ】は根拠にしない。関数の定義か呼び出しの形を要求する。
  //     DIAG_HEARTBEAT_MS := 300000 は「値を置いた」だけで、打つ保証が無い。
  //
  // 【この判定の限界】heartbeat という名前を使わずに実装した心拍は①では拾えない。
  //   ★見逃す方向の誤りであり、偽の緑より安全(②が拾う可能性も残る)。
  if (/\w*(?:heartbeat|Heartbeat|HEARTBEAT|心拍)\w*\s*\(/.test(s)) return true;
  // ② 繰り返す仕掛けの【内側】で記録しているもの。
  //    SetTimer(() => Log(...))  /  setInterval(() => { ...write... }, n)
  // ★閉じ括弧では区切らない。setInterval(() => {...}, n) は最初の ")" が
  //   引数の途中に来るため、そこで切ると本体を読めない(最初の実装がこれで外した)。
  //   ⟹ 呼び出し位置から一定の文字数だけを「内側」とみなす。
  const CALL_RE = /(SetTimer|setInterval|schedule|every)\s*\(/g;
  const WINDOW = 300;
  let m;
  while ((m = CALL_RE.exec(s)) !== null) {
    // ★窓は「同じ呼び出しの中」に閉じること。
    //   【実測で分かった偽の緑(2026-08-24)】固定長300字で切ったところ、
    //     SetTimer(CheckLauncherFocus, 150)     ← 記録していない(フォーカス監視)
    //     }                                      ← 関数の終わり
    //     ...別の関数の FileAppend(...)          ← ★これを拾って合格を出した
    //   ⟹ 空行や関数の終わりを越えて読まない。
    let inner = s.slice(m.index, m.index + WINDOW);
    const stop = inner.search(/\n\s*\n|\n\}|\n[A-Za-z_]\w*\s*\(/);
    if (stop > 0) inner = inner.slice(0, stop);
    if (!hasLogging(inner)) continue;
    // ★【繰り返すか】を必ず確かめる。ここが心拍の本体。
    //
    // 【実測で分かった偽の緑(2026-08-24)】実在の製品にこう書かれていた:
    //     SetTimer(() => DiagLogSnapshot("startup"), -5000)
    //   ★AutoHotkey の SetTimer は【負の周期 = 1回だけ】。繰り返さない。
    //   「定期実行の中で記録している」だけを見ると、この1回きりの記録を
    //   心拍と誤認して【合格】を出す。実際に出した。
    //   ⟹ 1回しか書かないものは、沈黙と正常を区別できない = 心拍ではない。
    if (isOneShot(inner)) continue;
    return true;
  }
  return false;
}

/**
 * ★「1回だけ実行」の形か。心拍から除外するために要る。
 *   ・AutoHotkey: SetTimer(f, -1000)  … 負の周期は1回だけ
 *   ・JS:         setTimeout(f, 1000) … そもそも1回
 *   ★判断がつかないものは false(=繰り返す)を返す。
 *     見逃しより偽の緑を嫌う、というこのキットの方針に合わせる。
 */
export function isOneShot(callSrc) {
  const s = String(callSrc || '');
  if (/setTimeout\s*\(/.test(s)) return true;
  // SetTimer(..., -1234) の形。★カンマの後の負の数を見る。
  if (/SetTimer\s*\([\s\S]{0,200}?,\s*-\s*\d/.test(s)) return true;
  return false;
}

export function scanDirectory(dir) {
  if (!dir || !existsSync(dir)) {
    return { ok: false, reason: `対象が見つからない: ${dir}` };
  }
  let files = 0;
  let logging = false;
  let heartbeat = false;
  const evidence = [];
  const walk = (d) => {
    let ents = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      // ★node_modules と .git は見ない(遅いうえ、直せないものを数えても意味が無い)
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(join(d, e.name));
        continue;
      }
      if (!SRC_FILE_RE.test(e.name)) continue;
      let body = '';
      try { body = readFileSync(join(d, e.name), 'utf8'); } catch { continue; }
      files++;
      if (hasLogging(body)) logging = true;
      if (looksLikeHeartbeat(body)) { heartbeat = true; evidence.push(e.name); }
    }
  };
  walk(dir);
  // ★ソースが1つも無いのは「合格」ではない。測れていない。
  if (files === 0) return { ok: false, reason: '対象にソースが1つも見つからない' };
  return { ok: true, files, logging, heartbeat, evidence };
}

function runSelftest() {
  const fails = [];
  const mk = (name, contents) => {
    const d = mkdtempSync(join(tmpdir(), 'nl-hb-' + name + '-'));
    for (const [f, c] of Object.entries(contents)) writeFileSync(join(d, f), c);
    return d;
  };

  // ① ★負の対照: ログは書くが心拍が無い → 赤にできること
  const a = mk('nolog', { 'a.mjs': 'function save(x){ writeFileSync("p", x); }\n' });
  const ra = scanDirectory(a);
  if (!(ra.ok && ra.logging === true && ra.heartbeat === false))
    fails.push('★ログ有り・心拍無しを見抜けない: ' + JSON.stringify(ra));

  // ② ★正の対照: 心拍が在れば見つけること
  const b = mk('hb', { 'b.mjs': 'function tick(){ setInterval(() => { console.log("alive"); }, 1000); }\n' });
  const rb = scanDirectory(b);
  if (!(rb.ok && rb.heartbeat === true))
    fails.push('★心拍を見つけられない: ' + JSON.stringify(rb));

  // ③ ★別ファイルに在るだけでは心拍と認めないこと
  const c = mk('split', {
    'c1.mjs': 'function tick(){ setInterval(() => { doWork(); }, 1000); }\n',
    'c2.mjs': 'function save(x){ writeFileSync("p", x); }\n',
  });
  const rc = scanDirectory(c);
  if (rc.heartbeat !== false)
    fails.push('★別々の仕組みを心拍と誤認している: ' + JSON.stringify(rc));

  // ④ ★ソースが無いのを緑にしないこと(測定不能と合格を混ぜない)
  const d = mkdtempSync(join(tmpdir(), 'nl-hb-empty-'));
  const rd = scanDirectory(d);
  if (rd.ok !== false)
    fails.push('★ソース0件を合格にしている: ' + JSON.stringify(rd));

  // ⑤ ★node_modules を数えないこと
  const e = mkdtempSync(join(tmpdir(), 'nl-hb-deps-'));
  mkdirSync(join(e, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(e, 'node_modules', 'x', 'b.mjs'),
    'function tick(){ setInterval(() => { console.log("x"); }, 1); }\n');
  writeFileSync(join(e, 'c.mjs'), 'function save(x){ writeFileSync("p", x); }\n');
  const re2 = scanDirectory(e);
  if (!(re2.ok && re2.files === 1 && re2.heartbeat === false))
    fails.push('★node_modules を数えてしまっている: ' + JSON.stringify(re2));

  // ⑥ ★heartbeat と名乗る【関数】は心拍と認めること(明示的な実装への配慮)。
  //    ★綴りが在るだけでは足りない。関数の定義/呼び出しの形であることが条件
  //    (下の⑪と対で読むこと。1文字の違いではなく「コードか否か」が分かれ目)。
  const f = mk('word', { 'f.ahk': 'DiagHeartbeat() {\n  ; 心拍\n}\n' });
  const rf = scanDirectory(f);
  if (!(rf.ok && rf.heartbeat === true))
    fails.push('★明示的な heartbeat を見つけられない: ' + JSON.stringify(rf));

  // ⑦ ★【実損の再現】1回きりの実行を心拍と誤認しないこと。
  //    実在の製品に SetTimer(() => DiagLogSnapshot("startup"), -5000) と書かれており、
  //    最初の実装はこれを心拍と誤認して【合格】を出した(2026-08-24)。
  //    ★AutoHotkey の負の周期は「1回だけ」。1回では沈黙と正常を区別できない。
  const g = mk('oneshot', {
    'g.ahk': 'SetTimer(() => DiagLogSnapshot("startup"), -5000)\nFileAppend("x", "p")\n',
  });
  const rg = scanDirectory(g);
  if (rg.heartbeat !== false)
    fails.push('★1回きりの実行を心拍と誤認している: ' + JSON.stringify(rg));

  // ⑧ ★正の対照: 同じ形でも【繰り返す】なら心拍と認めること。
  //    ⑦と1文字(マイナス記号)しか違わない対で測る。
  const h = mk('repeat', {
    'h.ahk': 'SetTimer(() => DiagLogSnapshot("beat"), 60000)\nFileAppend("x", "p")\n',
  });
  const rh = scanDirectory(h);
  if (rh.heartbeat !== true)
    fails.push('★繰り返す記録を心拍と認められない: ' + JSON.stringify(rh));

  // ⑨ ★setTimeout も1回きり(JS側の同型)
  const i = mk('js1shot', {
    'i.mjs': 'setTimeout(() => { console.log("once"); }, 5000);\n',
  });
  const ri = scanDirectory(i);
  if (ri.heartbeat !== false)
    fails.push('★setTimeout を心拍と誤認している: ' + JSON.stringify(ri));

  // ⑩ ★【実損の再現】関数の外まで読んで別の記録を拾わないこと。
  //    実在の製品でこの形が【合格】になった(2026-08-24):
  //      SetTimer(CheckLauncherFocus, 150)   ← 記録していない(フォーカス監視)
  //      }                                    ← 関数の終わり
  //      ...離れた場所の FileAppend(...)      ← ★これを拾っていた
  const j = mk('leak', {
    'j.ahk': 'HideWindow() {\n    SetTimer(CheckFocus, 150)\n}\n\n'
      + 'SaveThing() {\n    FileAppend("x", "p")\n}\n',
  });
  const rj = scanDirectory(j);
  if (rj.heartbeat !== false)
    fails.push('★関数の外の記録を拾って心拍と誤認している: ' + JSON.stringify(rj));

  // ⑪ ★【実損の再現】コメントと定数の宣言だけを心拍と認めないこと(2026-08-31)。
  //    実在の製品で心拍を3重に停止させた(呼び出しを削除・周期を負に改変・綴りを置換)
  //    にもかかわらず、★残ったこの2行だけで【合格】が出た。
  //    ⟹ コメントは「書いてあるだけ」で動く保証がゼロ。
  //       定数の宣言も「値を置いた」だけで、打つ保証が無い。
  const k = mk('commentonly', {
    'k.ahk': '; ★心拍を始める(2026-08-31)\n'
      + 'global DIAG_HEARTBEAT_MS := 300000\n'
      + 'FileAppend("x", "p")\n',
  });
  const rk = scanDirectory(k);
  if (rk.heartbeat !== false)
    fails.push('★コメント/定数の宣言だけを心拍と誤認している: ' + JSON.stringify(rk));

  // ⑫ ★正の対照: ⑪と同じ綴りでも【呼び出す】なら心拍と認めること。
  //    ★⑪との差は「コードか否か」の1点だけ。ここが両方向で動いて初めて
  //      「コメントに騙されない」と言える(片側だけなら何も検出しない検査でも通る)。
  const l = mk('called', {
    'l.ahk': 'SetTimer(DiagHeartbeatTick, 300000)\n'
      + 'DiagHeartbeatTick() {\n    FileAppend("beat", "p")\n}\n',
  });
  const rl = scanDirectory(l);
  if (rl.heartbeat !== true)
    fails.push('★コードとして名乗る心拍を見つけられない: ' + JSON.stringify(rl));

  if (fails.length) {
    console.error('[check-heartbeat-present] ★selftest 失敗:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log('[check-heartbeat-present] selftest OK'
    + '(心拍の有無を両方向で判定 / ★1回きりを心拍と誤認しない / 別々の仕組みを誤認しない'
    + ' / ★コメント・定数の宣言だけでは緑にしない / 0件を緑にしない)');
  process.exit(0);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) return runSelftest();

  const dir = args.find((a) => !a.startsWith('--')) || process.cwd();
  const res = scanDirectory(dir);

  if (!res.ok) {
    console.error(`[check-heartbeat-present] ★測れませんでした: ${res.reason}`);
    console.error('  → 対処: ソースのあるディレクトリを引数で渡してください。');
    process.exit(2);
  }

  // ★ログを書かない製品には心拍を求めない(通すためだけの空実装を増やさない)。
  if (!res.logging) {
    console.log(`[check-heartbeat-present] skip: この対象はログを書いていません(${res.files} ファイル)。`);
    console.log('  → ★対象外です。合格ではありません。');
    process.exit(0);
  }

  if (res.heartbeat) {
    console.log(`[check-heartbeat-present] ✅ 合格(心拍が在ります: ${res.evidence.slice(0, 5).join(', ')})。`);
    process.exit(0);
  }

  console.error('[check-heartbeat-present] 🔴 ログは書いているのに、心拍(定期的に「異常なし」を残す仕組み)が在りません。');
  console.error('  → ★なぜ要るか: 症状が出たときだけ書くログでは、');
  console.error('     「何も起きなかった」と「計器そのものが動いていなかった」が同じ見た目になります。');
  console.error('     起動直後に落ちた場合、ログには本当に何も残りません(実損の記録あり)。');
  console.error('  → 直し方: 一定間隔で1行だけ書く。時刻・版・稼働時間・主要カウンタで足ります。');
  console.error('  → ★この検査が判定しないこと: 心拍の中身も間隔も見ません。空の心拍を書けば通ります。');
  process.exit(1);
}

main();
