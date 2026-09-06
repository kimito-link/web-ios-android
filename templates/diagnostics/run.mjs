#!/usr/bin/env node
// run.mjs — 汎用診断キット(diagnostics/)のランナー。対象リポジトリの種類を問わず、
//   4本のチェックを順に実行し結果をまとめて報告する。
//
// このキットの思想: ../../docs/ai-rules/04_SELF_VERIFICATION.md §5「工程ガード」の具体化。
//   「ローカルで動く」と「git clone直後(CI/Vercel/ストアビルド)でも動く」は別物、という原則を、
//   Node.js/JS/TSプロジェクトなら何にでも(このキット外のプロジェクトにも)適用できる形にした。
//
// 対応チェック(すべて依存ゼロ・Node標準API のみ):
//   1. check-tracked-imports    — git未追跡ファイルへのimportが無いか(../scripts/の正本を参照)
//   2. check-lockfile-sync      — package.jsonとlockfileの依存が一致しているか
//   3. check-secrets-not-tracked — .env等の秘密情報ファイルが誤って追跡されていないか
//   4. check-large-tracked-files — 巨大ファイルが誤って追跡されていないか
//
// 使い方:
//   node diagnostics/run.mjs [対象ディレクトリ]   # 省略時はcwd
//   個別に1本だけ実行したい場合は各スクリプトを直接呼ぶ(例: node diagnostics/check-lockfile-sync.mjs)。
//
// 出力: 各チェックの結果を1行ずつ集計し、1件でも失敗があれば exit 1(fail-closed)。

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET_DIR = resolve(process.argv[2] || process.cwd());

const CHECKS = [
  { name: 'check-tracked-imports', path: join(__dirname, '..', 'scripts', 'check-tracked-imports.mjs') },
  { name: 'check-lockfile-sync', path: join(__dirname, 'check-lockfile-sync.mjs') },
  { name: 'check-secrets-not-tracked', path: join(__dirname, 'check-secrets-not-tracked.mjs') },
  { name: 'check-large-tracked-files', path: join(__dirname, 'check-large-tracked-files.mjs') },
  // ★メタ検査: 検査自身が「サボると赤くなるか」を確かめているかを数える。
  //   2026-08-23: 上の3本は --selftest を無視して exit 0 を返していた(壊れても緑)。
  //   ★selfTarget: 対象プロジェクトではなく【この diagnostics 自身】を見る。
  { name: 'check-selftest-coverage', path: join(__dirname, 'check-selftest-coverage.mjs'), selfTarget: true },
  // ★「1つの手段だけで断定していないか」を数える(2026-09-06追加)。
  //   実損: AIエージェントが1日で9件訂正し、うち3件は【道具の出力を1つだけ見て断定】だった。
  //     git merge-tree だけ見て「衝突0件」→ 実際は7ファイル衝突
  //     文字列カウントだけで「抽出可能4個」→ 構文解析すると0個
  //   ★「間違えた回数」ではなく【別の手段でも確かめた回数】を数える。
  //     前者は正直に訂正を書くほど数字が悪化する＝正直さを罰するため。
  //   ★下限(--baseline)を渡すと、減ったときだけ赤にする。渡さなければ初回として今の値を提案する。
  { name: 'check-cross-checked', path: join(__dirname, 'check-cross-checked.mjs') },
  // ★HTMLの中に直接書かれたJSの構文検査(2026-09-06追加)。
  //   実損: 全リポでHTML内のJSが【検査を1バイトも通っていなかった】。
  //     eslint は「対象の設定が無い」として素通りし、★見ていないのに exit 0 を返す。
  //     実測 kimito-link 3,610行 / characterlive 651行 / ★このキット自身 321行。
  //   ★構文エラーが1つあると、そのブロックのJSは丸ごと実行されない(画面が真っ白になる)。
  //   ★依存ゼロ(node:vm のみ)。既製プラグインはメンテナ1人 or 1.0未満で、
  //     ずっと動くことを当てにできないため、あえて標準APIだけで書いてある。
  { name: 'check-inline-script-syntax', path: join(__dirname, 'check-inline-script-syntax.mjs') },
  // ★症状の言葉で原因索引を引けるか。引数が無ければ対象から自動で探す。
  //   2026-08-23: ページに名前は載っていたのに★ここに登録されておらず、
  //   引数も要るため【一度も走らない】状態だった(配ったのに届いていない型)。
  { name: 'check-symptom-index', path: join(__dirname, 'check-symptom-index.mjs') },
  // ★「遅い」と言われる経路に時間を測る計器があるか(2026-08-23追加)。
  //   実損: 計器が無い経路の遅さを推測で3回直そうとして3回とも外した。
  //   ★srcDir: ソースの置き場所を位置引数で渡す。リポ全体を渡すと node_modules 等で
  //   「利用者に見える操作らしい関数」が見つからず測れないことがある。
  {
    name: 'check-timing-instrumented',
    path: join(__dirname, 'check-timing-instrumented.mjs'),
    declaresDir: 'srcDir',
  },
  // ★製品が「異常なし」を自分で名乗れるか(2026-08-24追加)。
  //   実損: 製品を起動する重い検査76本(1回22分)が見つけた製品の不具合は【0件】で、
  //   実際の不具合5件はオーナーの報告と★製品自身の診断ログから見つかっていた。
  //   ⟹ 重い検査を減らすなら、その前に「沈黙と正常を区別できる」ことが要る。
  { name: 'check-heartbeat-present', path: join(__dirname, 'check-heartbeat-present.mjs') },
  // ★計器が【あるのに動かない】ものを探す(2026-08-25追加)。
  //   実損: 位置を測る計器が「分岐の片側でしか定義されない変数」を参照し、
  //   try に飲まれて【1件も記録されないまま】「原因が分かった」と報告した。
  //   ★計器が無いなら「無い」と分かる。あるのに動かないと沈黙を正常と読む。
  { name: 'check-instruments-reachable', path: join(__dirname, 'check-instruments-reachable.mjs') },
  // ★「コンソールが無いと固まる」書き方が残っていないか(2026-08-26追加)。
  //   実損: ビルドが Compress-Archive から【返ってこなく】なり、配布作業が止まった。
  //   ★エラーも stderr も空。1KB でも固まるので「重いから遅い」と誤診した。
  //   真因は進捗バーの描画で、抑止1行で 402ms に戻った。
  { name: 'check-silent-hang-guard', path: join(__dirname, 'check-silent-hang-guard.mjs') },
  // ★キーボードを奪ったまま返さない形が残っていないか(2026-09-01追加。
  //   soushin-suggest.linkから移植)。
  //   実損: AutoHotkey製の常駐ツールで、前面判定(WinActive)を持たないホットキーが
  //   1本だけ紛れ込み、常駐ウィンドウが閉じきれずに残ったときメモ帳でもブラウザでも
  //   Spaceキーが奪われた（同じ日に2回発生。うち1回はAIが修正後exeを再ビルドせず
  //   旧exeを起動したまま確認していたことが重なった＝別の教訓も参照）。
  //   ★対象に.ahkが無いプロジェクトはskip(AutoHotkey前提の検査。強制しない)。
  { name: 'check-hotkey-scope', path: join(__dirname, 'check-hotkey-scope.mjs') },
  // ★配る実体がソースより古くないかを見る(2026-09-01追加・実損)。
  //   上の Space 事故の【2回目】がこれ。コードは直っていたのに再発した:
  //     dist/soushin-suggest.ahk 15:22(修正済) / dist/soushin-suggest.exe 14:59(古い)
  //   ★製品が常駐したまま exe を掴み、ビルドが無言で失敗して古い実体が残っていた。
  //   ソース側の検査(sha256・構文)は全部緑だった＝この区間だけ無防備だった。
  //   ★成果物を作らないプロジェクトは skip(強制しない)。
  { name: 'check-build-fresh', path: join(__dirname, 'check-build-fresh.mjs') },
  // ★検査を「作った/格上げした」のに誰も呼んでいない状態を数える(2026-09-01追加)。
  //   実損3回: ①iOS 518 却下の検出役が pnpm check にも CI にも未登録だった
  //   ②登録済みだが毎回 skip していた ③★このキット自身で、linktree から格上げした
  //   計器3点が package.json・workflows・run.mjs のどこからも呼ばれていなかった
  //   （出自リポでは workflow から呼ばれていたのに、格上げ先では0件）。
  //   ★「templates/ へ格上げする」までは基準#5 にあるが、格上げ先で配線するところは
  //   誰も見ていなかった。呼ばれない検査は、存在しない検査と同じ。
  { name: 'check-gates-are-wired', path: join(__dirname, 'check-gates-are-wired.mjs'), kitRoot: true },
  // ★共有部品が「あるのに使われていない」を数える(2026-09-01追加)。
  //   実損: 同じ画面部品が3つ別々に実装され、ユーザーが
  //   「車輪の再発明もいいところです」と指摘した。重複禁止は
  //   ★キットに既に3箇所書いてあったのに守られなかった。
  //   ⟹ 文章を4箇所目に足しても解決しない。**検査していない規範は守られない**。
  //   ★代償は行数ではなく「一度直したバグが別の画面では直っていない」こと。
  //   ★sharedDir: 共有部品の置き場所。既定(shared/common/lib/shared)に無いリポは
  //   diagnostics.json で宣言すれば測れる（Next.js の lib/ 等）。
  {
    name: 'check-shared-parts-used',
    path: join(__dirname, 'check-shared-parts-used.mjs'),
    declares: { sharedDir: '--shared-dir' },
  },
  // ★「少しずつ違う実装」が複数箇所に増える状態を数える(2026-09-07追加、基準⑦の機械検出)。
  //   check-shared-parts-usedは【同名】関数しか拾えないため、名前も違う「似た塊」は
  //   別の検査として分離した(事実と推測を混ぜない。KEEP_SEPARATE)。
  //   詳細: _docs/DESIGN-criterion7-near-duplicate-detection-2026-09-07.md
  {
    name: 'check-near-duplicates',
    path: join(__dirname, 'check-near-duplicates.mjs'),
    declares: { nearDupBaseline: '--baseline' },
  },
  // ★説明した置き場所と、コードが実際に探す場所がズレていないか。
  //   ★説明はコードより先に腐る(このリポはLP本文が242版前で止まっていた実績あり)。
  { name: 'check-docs-match-code', path: join(__dirname, 'check-docs-match-code.mjs'), kitRoot: true },
  // ★selfTarget(templates/diagnostics自身)は、このキット最大の検査置き場
  //   templates/scripts(2026-08-25時点16本)を最初から対象外にしていた。
  //   実損: verify-ios-splash-not-default.mjs等5本の--selftest不備(問題1)は
  //   人力の手動監査でしか見つからず、この計器では一度も検出されなかった。
  //   ★2箇所目として固定で追加する(selfTargetDir=diagnostics.json宣言と独立、
  //   このキット自身が常に見る先。対象リポのdiagnostics.json宣言では上書きしない)。
  {
    name: 'check-selftest-coverage(scripts)',
    path: join(__dirname, 'check-selftest-coverage.mjs'),
    selfTargetDir: join(__dirname, '..', 'scripts'),
  },
  // ★新しい実装を作る前にCANONICAL CHECKを通した記録が無ければ完了扱いにできない
  //   最小の仕組み(2026-09-02、_docs/DESIGN-canonical-boundary-rules.md v1.0の実装)。
  //   新規source fileがある変更にのみDecision Receiptを要求する。
  //   ★scripts/直下（templates/scripts/、証明3点台帳と同じ置き場所）にあるため
  //   check-tracked-importsと同じ相対パスで参照する。
  { name: 'check-decision-receipt', path: join(__dirname, '..', 'scripts', 'check-decision-receipt.mjs') },
];

console.log(`[diagnostics] 対象: ${TARGET_DIR}`);
console.log('');

const results = [];
for (const check of CHECKS) {
  if (!existsSync(check.path)) {
    console.log(`- ${check.name}: SKIP(スクリプトが見つからない: ${check.path})`);
    results.push({ name: check.name, status: 'skip' });
    continue;
  }
  try {
    // check-tracked-imports.mjs は引数を取らず process.cwd() 基準で動く契約(正本の既存仕様)。
    // 自作3本は引数(対象ディレクトリ)も見るが、cwd をTARGET_DIRに揃えれば両方が正しく動く。
    // ★selfTarget=この diagnostics 自身 / kitRoot=キットのルート(site/ を見るため)
    // ★対象リポが diagnostics.json で自分の検査置き場を宣言していれば、
    //   selftest網羅はそちらを見る(宣言が無ければ従来どおりキット自身)。
    //   ★これが無いと、対象リポのゲートが何本あっても一度も測られない。
    let declaredChecks = '';
    let declaredPattern = '';
    let declared = {};
    try {
      const dp = join(TARGET_DIR, 'diagnostics.json');
      if (existsSync(dp)) {
        const dj = JSON.parse(readFileSync(dp, 'utf8'));
        declared = dj && typeof dj === 'object' ? dj : {};
        if (dj && typeof dj.checks === 'string' && dj.checks.trim()) {
          declaredChecks = join(TARGET_DIR, dj.checks.trim());
        }
        if (dj && typeof dj.checkPattern === 'string' && dj.checkPattern.trim()) {
          declaredPattern = dj.checkPattern.trim();
        }
      }
    } catch { declaredChecks = ''; declared = {}; }

    // ★declaresDir: 位置引数で渡す場所を対象リポが宣言できる（--flag ではない検査用）。
    const declaredDir = check.declaresDir && typeof declared[check.declaresDir] === 'string'
      && declared[check.declaresDir].trim()
      ? join(TARGET_DIR, declared[check.declaresDir].trim())
      : '';

    const scanDir = check.kitRoot
      ? join(__dirname, '..', '..')
      : check.selfTargetDir ? check.selfTargetDir
      : check.selfTarget ? (declaredChecks || __dirname)
      : (declaredDir || TARGET_DIR);

    // ★対象リポが宣言した場所を、それを必要とする検査へ渡す(2026-09-01追加)。
    //   ★実損: kimitolink-linktree で check-shared-parts-used と
    //   check-timing-instrumented が **2本とも「測れませんでした」**になっていた。
    //   どちらも引数を渡せば測れるのに、run.mjs は checks/checkPattern しか
    //   読まないので**渡す手段が無かった**＝ランナー経由では永久に測れない。
    //   ★README は「場所を知っているのは対象リポなので宣言させる」「キット側に
    //   決め打ちを足し続ける設計は腐る」と書いている。その思想どおり宣言で解く。
    const declaredArgs = [];
    if (check.declares) {
      for (const [key, flag] of Object.entries(check.declares)) {
        const v = declared[key];
        // ★配列宣言は複数回のフラグへ展開する（2026-09-03追加）。
        //   実損: sharedDirを配列化してscripts/lib+templates/scripts/libの両方を
        //   宣言しても、ここが文字列しか受け付けないため無言でフラグが渡らず、
        //   run.mjs経由の実行だけ既定値(shared/common/lib/shared)に戻っていた。
        if (Array.isArray(v)) {
          for (const item of v) {
            if (typeof item === 'string' && item.trim()) declaredArgs.push(flag, item.trim());
          }
        } else if (typeof v === 'string' && v.trim()) {
          declaredArgs.push(flag, v.trim());
        }
      }
    }

    const extraArgs = (check.selfTarget && declaredChecks && declaredPattern)
      ? ['--pattern', declaredPattern] : declaredArgs;
    const output = execFileSync('node', [check.path, scanDir, ...extraArgs], { encoding: 'utf8', stdio: 'pipe', cwd: TARGET_DIR });
    process.stdout.write(output);
    const status = /\(skip\)/.test(output) ? 'skip' : 'pass';
    results.push({ name: check.name, status });
  } catch (err) {
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    // ★3値の終了コード(このキットの掟): 0=合格 / 1=測れた赤 / ★2=測れなかった。
    //   2 を fail に混ぜると「測っていない」を「異常あり」と誤報し、
    //   逆に見逃すと「異常なし」と誤報する。★どちらにも混ぜず別の名前で出す。
    const status = err.status === 2 ? 'unmeasured' : 'fail';
    results.push({ name: check.name, status });
  }
  console.log('');
}

const failed = results.filter((r) => r.status === 'fail');
// ★「測れなかった(exit 2)」は fail でも skip でもない第3の状態。
//   ここに入れ忘れると【全チェック緑】と表示して exit 0 になる＝
//   ★測っていないものを「異常なし」と報告する、このキットが最も嫌う形になる。
const unmeasured = results.filter((r) => r.status === 'unmeasured');
const skipped = results.filter((r) => r.status === 'skip');
console.log('--- 診断結果まとめ ---');
for (const r of results) {
  const mark = r.status === 'pass' ? '✓' : r.status === 'skip' ? '-' : r.status === 'unmeasured' ? '?'
    : '✗';
  console.log(`${mark} ${r.name}: ${r.status}`);
}
console.log('');

if (failed.length > 0) {
  console.error(`[diagnostics] ${failed.length}件のチェックで問題を検出。上記の対処を確認してください。`);
  process.exit(1);
}

if (unmeasured.length > 0) {
  // ★測れなかったものを緑にしない。かといって「異常あり」とも言わない。
  console.error(
    `[diagnostics] ★${unmeasured.length}件が【測れませんでした】: `
    + unmeasured.map((r) => r.name).join(' / ')
  );
  console.error('  → これは「異常なし」ではありません。測れなかった理由を上の出力で確認してください。');
  process.exit(2);
}
// ★skip が過半なら「緑」と名乗らない。
//   2026-08-23: まっさらな新規プロジェクトで【実行1件・skip5件】なのに
//   「全チェック緑」と出た。★ほとんど何も測っていないのに「問題なし」に読める。
//   ＝ このキットの掟「使っていない0と動くはずの0は別物」に反する。
const ran = results.length - skipped.length;
if (skipped.length > ran) {
  console.log(
    `[diagnostics] ★ほとんど測れていません(実行${ran}件・skip${skipped.length}件)。`
  );
  console.log(`  → これは「問題なし」ではありません。skip の理由を上で確認してください。`);
  console.log(`    (git 未初期化・package.json 無しなどで、検査の前提が無い場合に skip します)`);
} else {
  console.log(`[diagnostics] 全チェック緑(実行${ran}件・skip${skipped.length}件)。`);
}
