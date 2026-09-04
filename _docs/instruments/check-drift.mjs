#!/usr/bin/env node
/**
 * check-drift.mjs — ★計器の土台が【実コードとして】割れていないか見る。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★何を見て、何を見ないか
 *   見る   : 実コード（コメント・空行を除いたもの）
 *   ★見ない: コメント
 *
 *   ★理由: 各リポは自分が踏んだ事故をヘッダに書く。それは**正しい**
 *   （読む人が自分の事故で理解できる）。コメントまで一致を強制すると、
 *   ★各リポが自分の事例を書けなくなり、土台が「読めないもの」になる。
 *   実測(2026-08-21): tsuioku とキットは ★コメント66行違い・実コード71行一致。
 *
 * ■ 終了コード（この土台自身の3値規約に従う）
 *   0 = 一致 / 1 = ★実コードが割れている / ★2 = 測れなかった(ファイルが無い等)
 *
 * ■ 使い方
 *   node _docs/instruments/check-drift.mjs
 *   node _docs/instruments/check-drift.mjs --selftest   ★毒を入れて赤くなるか確認
 * ───────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = resolve(HERE, '../..');
const GH_ROOT = resolve(KIT_ROOT, '..');

const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 });

/**
 * ★放置日数の上限（ラチェット）。これを【超えたときだけ】鳴らす。
 *
 * ■ ★なぜ上限が要るか（2026-08-29）
 *   放置日数を出すようにしたら、最長★51日のものが見つかった。
 *   だが上限が無いと、51日が 100日・1000日になっても
 *   ★出力は同じ「🔴」のまま＝悪化に気づけない。
 *   100年後には全部が真っ赤で、誰も読まない紙になる。
 *
 * ■ ★なぜ「N日で即赤」にしないか
 *   割れているのは【他リポ】であって、このリポではない。
 *   他リポの事情でこのリポの作業を止めるのは正しくない
 *   （だから割れは門ではなく報にしてある）。
 *   ⟹ ★「いまの最長」を上限として固定し、**それより悪化したときだけ**鳴らす。
 *     既存の51日は許容する。減らすのは自由（減らしたらこの数も下げる）。
 *
 * ■ ★この数を下げるとき
 *   実際に放置が解消したら、この値も一緒に下げること。
 *   下げないと「上限に余裕がある」状態が続き、また静かに伸びる。
 *   （check-selftest-coverage.mjs の KNOWN_MISSING_SELFTEST_MAX と同じ運用）
 */
export const KNOWN_MAX_STALE_DAYS = 7;
/*
 * ★履歴（下げた記録を残す。上げるときも必ず理由を書くこと）
 *   2026-08-29  51 → 7
 *     51日だったのは tsuioku の check-tracked-imports。寄せる前に測ったら
 *     ★単に古いのではなく【別実装】（ロジックを src/lib/ へ切り出し・専用テストあり・
 *     実測で緑）だった。正本で上書きすると構造が壊れるので比較対象から外した。
 *     ＝★「一番古い＝一番壊れている」ではない。測ってから決める。
 */

/*
 * ★isMain（2026-08-28 追加）: PAIRS を他の検査から import できるようにしたので、
 *   読まれただけで本体や selftest が走らないようにする。
 *   ★手作りのパス文字列比較は使わない — Windows + 日本語パスだと
 *     「デスクトップ」がURLエンコードのまま比較され必ず false になり、
 *     本体が丸ごとスキップされたまま緑を返す（sakkino.link で実際に踏んだ実損）。
 */
const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;

/*
 * ★isMain を掛けるのを忘れると、この検査を import した別の検査が --selftest を
 *   付けて実行されたとき【こちらの selftest が横取りして緑を出す】。
 *   ＝呼んだ側の検査は一度も走らないのに緑になる。実際に踏んだ（2026-08-28）。
 */
const SELFTEST = isMain && process.argv.includes('--selftest');

/**
 * ★正本（キット側）と、追随するコピー。
 *
 * ★1ファイルしか見ていないと、配った他の実体は★黙って割れる。
 *   実際 2026-08-22 に台帳を配るまで、ここは instrument-core.mjs だけを見ていた。
 *   ★配る実体を増やしたら、必ずここに足すこと。
 *
 * ★`copies: []` は「まだ誰もコピーを持っていない」＝正常。
 *   ただし★正本が消えていたら赤（配ったはずのものが無い）。
 */
/**
 * ★2026-08-28: export した。登録漏れを機械に見つけさせるため（check-drift-coverage.mjs が読む）。
 *   ★この表は【手で書く】ので、必ず書き忘れる。実際にキット自身の
 *     scripts/lib/instrument-core.mjs が登録されないまま古い土台で動いていた。
 *   ⟹ 表そのものを検査対象にする。
 */
export const PAIRS = [
  {
    label: '計器の土台',
    canonical: resolve(KIT_ROOT, 'templates/scripts/lib/instrument-core.mjs'),
    /*
     * ★kimitolink-linktree は 2026-08-24 に採用（＝この土台の★収穫元でもあるリポ）。
     *   normalizeProbeResult の核（根拠なき pass の降格）は元々
     *   kimitolink-linktree/scripts/lib/diag-core.mjs:18 から収穫したもの。
     *   ★発明はあちらが先で、キットが汎用化して selftest/limitation を足した。
     *   採用の動機は、その良い型が★自リポ内では diag.mjs 1本にしか適用されておらず、
     *   他20本以上の計器が恩恵ゼロだったこと。
     */
    copies: [
      resolve(GH_ROOT, 'tsuioku-no-kirameki.com/scripts/lib/instrument-core.mjs'),
      resolve(GH_ROOT, 'kimitolink-linktree/scripts/lib/instrument-core.mjs'),
      /*
       * ★surechigai-romi.link は 2026-08-27 に登録。
       *   ここは★逆方向だった: surechigai の方が正本より進んでおり、
       *   証拠の古さを測る stale 検知（3件のテスト付き）を独自に持っていた。
       *   ★実コードを比べたら「正本にしか無い行」はゼロ＝完全な上位互換だったので、
       *   消すのではなく★正本へ取り込んでから登録した。
       *   ＝ 割れているコピーを見つけたら、どちらが正しいかを先に測ること。
       */
      resolve(GH_ROOT, 'surechigai-romi.link/scripts/lib/instrument-core.mjs'),
      /*
       * ★2026-08-28 追加（check-drift-coverage.mjs が見つけた登録漏れ）。
       *   ★KIT_ROOT/scripts/ は【このキット自身が使っているコピー】。
       *     登録されていなかったため、正本より12行古い土台のまま止まっており、
       *     しかもキットの検査4本がそれを import していた
       *     ＝★配る側が古い土台で自分を検査していた。
       *   ★best-trust.biz は当時たまたま実コードが一致していたが未登録だった
       *     ＝次に正本が動いた瞬間に無言で割れる時限爆弾。
       */
      resolve(KIT_ROOT, 'scripts/lib/instrument-core.mjs'),
      resolve(GH_ROOT, 'best-trust.biz/scripts/lib/instrument-core.mjs'),
      /*
       * ★2026-09-04 追加（check-drift-coverage.mjs が再び登録漏れを検出）。
       *   soushin-suggest.link は【配っているのに台帳に無い】状態が続いていた。
       *   ★登録時点で正本と実コードが完全一致（diff ゼロ）＝まだ割れていないが、
       *     これは安全の証拠ではなく★「次に正本が動いた瞬間に無言で割れる」形。
       *     best-trust.biz と同じ時限爆弾で、同じ理由で登録する。
       */
      resolve(GH_ROOT, 'soushin-suggest.link/scripts/lib/instrument-core.mjs')
    ]
  },
  {
    label: '進化台帳（判定）',
    canonical: resolve(KIT_ROOT, 'templates/scripts/lib/improvement-ledger.mjs'),
    /*
     * ★キット自身が使っているコピー（2026-08-23〜。配る側が使わない仕組みは死ぬ）。
     *
     * ★tsuioku の src/lib/improvementLedger.js は【表を内蔵する旧世代】なので
     *   ここには入れていない。キット版は★表を引数で受け取る形に変えてある
     *   （空の表で偽の緑になる穴を塞ぐため・2026-08-22 に実測で確認）。
     *   tsuioku をキット版へ寄せたときに、そのパスもここへ足す。
     */
    copies: [
      resolve(KIT_ROOT, 'scripts/lib/improvement-ledger.mjs'),
      // ★kimitolink-linktree は 2026-08-24 に採用（キット外で初の採用先）。
      resolve(GH_ROOT, 'kimitolink-linktree/scripts/lib/improvement-ledger.mjs'),
      // ★2026-08-28 追加（登録漏れ）。配っていたのに表に無かった。
      resolve(GH_ROOT, 'surechigai-romi.link/scripts/lib/improvement-ledger.mjs')
      /*
       * ★soushin-suggest.link は 2026-09-04 に【登録から外した】。
       *   1日 放置・正本にしか無い行 70・コピーにしか無い行 178 と出ていたが、
       *   ★実際に両方を読むと「古いコピー」ではなく別物だった:
       *     正本   … 依存ゼロの【ライブラリ】。表を引数で受け取り関数を export する
       *     soushin … dist/soushin-suggest.exe を見る【単体の実行スクリプト】
       *   ★名前が同じだけで役割が違うので、どちらへ寄せても片方が壊れる。
       *   tsuioku の improvementLedger.js を「旧世代だから入れない」と判断したのと
       *   同じ扱い（上のコメント参照）。
       *   ★寄せるなら先に soushin 側を「ライブラリ＋薄い実行部」に分ける作業が要る。
       *   それをやったときに、このパスをここへ戻すこと。
       */
    ]
  },
  {
    label: '進化台帳（鮮度）',
    canonical: resolve(KIT_ROOT, 'templates/scripts/lib/improvement-staleness.mjs'),
    copies: [
      resolve(GH_ROOT, 'kimitolink-linktree/scripts/lib/improvement-staleness.mjs'),
      // ★2026-08-28 追加（登録漏れ）。★キット自身のコピーが抜けていた。
      resolve(KIT_ROOT, 'scripts/lib/improvement-staleness.mjs'),
      resolve(GH_ROOT, 'surechigai-romi.link/scripts/lib/improvement-staleness.mjs')
    ]
  },
  {
    label: '進化台帳（門番）',
    canonical: resolve(KIT_ROOT, 'templates/scripts/check-improvement.mjs'),
    copies: [
      resolve(KIT_ROOT, 'scripts/check-improvement.mjs'),
      resolve(GH_ROOT, 'kimitolink-linktree/scripts/check-improvement.mjs'),
      // ★2026-08-28 追加（登録漏れ）。
      resolve(GH_ROOT, 'surechigai-romi.link/scripts/check-improvement.mjs'),
      resolve(GH_ROOT, 'tsuioku-no-kirameki.com/scripts/check-improvement.mjs')
    ]
  },
  {
    label: '進化台帳（記録の口）',
    canonical: resolve(KIT_ROOT, 'templates/scripts/record-improvement.mjs'),
    copies: [
      resolve(KIT_ROOT, 'scripts/record-improvement.mjs'),
      resolve(GH_ROOT, 'kimitolink-linktree/scripts/record-improvement.mjs'),
      // ★2026-08-28 追加（登録漏れ）。
      resolve(GH_ROOT, 'surechigai-romi.link/scripts/record-improvement.mjs'),
      resolve(GH_ROOT, 'tsuioku-no-kirameki.com/scripts/record-improvement.mjs')
    ]
  },
  {
    label: '検査の実行記録（4つ目の状態）',
    canonical: resolve(KIT_ROOT, 'templates/scripts/check-instrument-ran.mjs'),
    copies: [
      resolve(KIT_ROOT, 'scripts/check-instrument-ran.mjs'),
      // ★2026-08-28 追加（登録漏れ）。
      resolve(GH_ROOT, 'surechigai-romi.link/scripts/check-instrument-ran.mjs')
    ]
  },
  {
    /*
     * ★2026-08-24 追加。kimitolink-linktree が毒テストで実損を見つけ、
     *   キット版でも同じ毒（signingConfig 行のコメントアウト）で exit 0 を
     *   再現してから両方直した。★配る側が壊れていると全新規アプリに配られる。
     *
     * ★実コードは同一だが import パスだけ違う（キットは ./lib、
     *   プロダクトは scripts/app 配下なので ../lib）。
     *   codeOnly 比較はこの1行の差を「割れ」と見なすため、ここには入れない。
     *   ★入れるなら先にパスの持ち方を揃えること。
     */
    label: '署名ゲート（★パス差のため比較対象外・手で同期）',
    canonical: resolve(KIT_ROOT, 'templates/scripts/verify-android-signing-config.mjs'),
    copies: []
  },
  {
    /*
     * ★未コミット import ゲート。2026-08-25 に kimitolink-linktree が採用。
     *   このファイルは lib/ を import しないので、パス差が無く★そのまま比較できる。
     *
     * ★採用時に配布元の欠陥が見つかった: コメント内の使用例（JSDoc の
     *   `import ... from "./x"`）を実物と誤読して★嘘の赤を出していた。
     *   linktree の実リポで実測して発覚 → 正本を直してから配った。
     *   ＝ 配る前に「実物のリポで走らせる」と、配布物の欠陥が見つかる。
     */
    label: '未コミット import ゲート',
    canonical: resolve(KIT_ROOT, 'templates/scripts/check-tracked-imports.mjs'),
    /*
     * ★sakkino.link は 2026-08-27 に同期（それまで★検査が1行も走っていなかった）。
     *   isMain の判定が手作りのパス比較で、Windows + 日本語パスだと
     *   「デスクトップ」がURLエンコードのまま比較され必ず false になり、
     *   ★本体が丸ごとスキップされたまま exit 0 を返していた。
     *   ＝ 出力ゼロの緑。実測で発覚。
     *
     * ★surechigai-romi.link は既に pathToFileURL 版で正しく走っているため、
     *   実コードが一致するかをここで見る。
     */
    copies: [
      resolve(GH_ROOT, 'kimitolink-linktree/scripts/check-tracked-imports.mjs'),
      resolve(GH_ROOT, 'sakkino.link/scripts/check-tracked-imports.mjs'),
      // ★2026-08-28 追加（登録漏れ）。上のコメントが「surechigai は正しく走っている」と
      //   書いているのに、★実際には登録されていなかった＝見ていなかった。
      resolve(GH_ROOT, 'surechigai-romi.link/scripts/check-tracked-imports.mjs')
      /*
       * ★tsuioku-no-kirameki.com は【外した】（2026-08-29・実測して判断）。
       *
       *   放置日数 51日で最長だったので直そうとしたが、寄せる前に測ったら
       *   ★単に古いのではなく【別実装】だった:
       *     正本 340行 / tsuioku 79行。判定ロジックを src/lib/trackedImports.js に
       *     切り出し、★専用テスト(trackedImports.test.js)まで持っている。
       *   実測: `npm run check:tracked-imports` は緑（782ファイル・未追跡0件）。
       *   ＝壊れて放置されていたのではなく、リファクタされた別系統。
       *
       *   ★正本で上書きすると、切り出した構造とテストが壊れる。
       *   ⟹ 行比較の対象から外す（署名ゲートと同じ扱い）。
       *
       *   ★ただし tsuioku 側には --selftest が無い（毒で赤くなるか誰も確かめていない）。
       *     これは別途 tsuioku 側で足すべき宿題として残す。
       *     ここに登録し直すのは、両者の構造を揃える判断をしたときだけ。
       */
    ]
  },
  {
    /*
     * ★lockfile 照合。2026-08-27 に「対象外(skip)」を exit 0 → exit 2 に変えた。
     *   surechigai は pnpm 運用のため package-lock.json が無く、
     *   ★一度も照合していないのに緑を返していた（実測）。
     */
    label: 'lockfile 照合',
    canonical: resolve(KIT_ROOT, 'templates/diagnostics/check-lockfile-sync.mjs'),
    copies: [
      resolve(GH_ROOT, 'kimitolink-linktree/scripts/diagnostics/check-lockfile-sync.mjs'),
      resolve(GH_ROOT, 'surechigai-romi.link/scripts/diagnostics/check-lockfile-sync.mjs'),
      // ★2026-08-28 追加（登録漏れ）。
      resolve(GH_ROOT, 'soushin-suggest.link/scripts/check-lockfile-sync.mjs')
    ]
  },
  {
    label: '全文脈と判断の進化台帳（入口）',
    canonical: resolve(KIT_ROOT, 'templates/scripts/context-engine.mjs'),
    // ★2026-08-28: 「コピー0件」ではなかった。実際には配られていたのに未登録だった。
    copies: [resolve(GH_ROOT, 'surechigai-romi.link/scripts/context-engine.mjs')]
  },
  {
    label: '完全版の計器（統合入口）',
    canonical: resolve(KIT_ROOT, 'templates/scripts/run-instruments.mjs'),
    // ★2026-08-28: 同上。配っていたのに表が「0件」と言っていた。
    copies: [resolve(GH_ROOT, 'surechigai-romi.link/scripts/run-instruments.mjs')]
  },
  {
    label: '本体の診断・進化進捗ページ（生成器）',
    canonical: resolve(KIT_ROOT, 'templates/scripts/generate-shindan-version.mjs'),
    // ★2026-08-28: 同上。
      /*
       * ★2026-09-04 時点で割れている（正本 440行 / このコピー 221行）。
       *   ★あえて今回は寄せていない: これは【公開ページを生成する】スクリプトで、
       *     CANONICAL_URL・製品名・homeUrl が本体ロジックに直書きされている。
       *   正本へ寄せると本番の出力が変わるため、★生成結果を実ページと突き合わせて
       *     から入れ替えること（登録は外さない＝割れたままだと分かる方が安全）。
       */
    copies: [resolve(GH_ROOT, 'soushin-suggest.link/scripts/generate-shindan-version.mjs')]
  }
];

/** ★selftest が単体で使う正本（土台）。 */
const CANONICAL = PAIRS[0].canonical;

/**
 * ★コメント・文字列内は触らず、行コメント/ブロックコメント/空行だけ落とす。
 * ★`templates/scripts/lib/instrument-proof.mjs` に同一ロジックの独立コピーがある。
 *   このファイルは配布物ではない（templates/配下ではない）ため import では
 *   共有できず、意図的に2箇所へ複製している。どちらかを変えたらもう片方も揃える。
 */
export function codeOnly(text) {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .filter((l) => l.trim() !== '')
    .map((l) => l.trimEnd())
    .join('\n');
}

function rel(p) {
  return p.split(GH_ROOT).join("").replace(/^[\/]+/, "");
}

/**
 * ★割れの「向き」を測る。どちらが進んでいるかを読み手に渡すため。
 *
 * ■ ★なぜ要るか（2026-08-28 に実際に踏んだ）
 *   この検査は割れを見つけると「正本に合わせる」と書く。だが 2026-08-27 は
 *   ★正本が遅れている側だった（surechigai が pnpm 照合を先に実装していた）。
 *   指示どおり正本に寄せると【測定能力が消える】ところだった。
 *   同じ日の記録にも「★割れているコピーを見つけたら、どちらが正しいかを先に測ること」
 *   と書いてあるのに、出力にはその手掛かりが一つも無かった。
 *
 * ■ ★判定は変えない（掟⑥: レポートにする。一括強制のゲートにしない）
 *   向きは「手掛かり」であって証明ではない。行が増えた＝進んだ、とは限らない。
 *   だから verdict は fail のままにして、★読み手に測る材料だけを渡す。
 *
 * @param {string} base codeOnly 済みの正本
 * @param {string} copy codeOnly 済みのコピー
 * @returns {{onlyCanonical:number, onlyCopy:number}} 片側にしか無い行数
 */
/**
 * ★割れが「いつから放置されているか」を git から測る。
 *
 * ■ ★なぜ必要か（2026-08-28 に登録漏れ22件を塞いだ直後に直面した）
 *   登録を増やした瞬間、隠れていた割れが14件まとめて見えた。
 *   ★14件の赤が毎回出続けると、人は必ず読まなくなる（掟⑥のオオカミ少年）。
 *   かといって数を上限で抑えると「消えた」事故になる（掟⑨）。
 *
 *   ⟹ ★割れの「件数」ではなく【放置された時間】を見る。
 *     割れること自体は正常（各リポが独自に育つのは健全）。
 *     異常なのは★割れたまま誰も気づかないこと。
 *
 * ■ ★台帳を作らない
 *   「いつ割れたか」を手で書く表にすると、必ず腐る（オプトインの台帳は必ず死ぬ）。
 *   git が既に答えを持っているので、★毎回そこから計算する。
 *
 * @param {string} filePath
 * @returns {string|null} 最終更新日(YYYY-MM-DD)。git で追えなければ null
 */
function lastCommitDate(filePath) {
  const repoRoot = findRepoRoot(filePath);
  if (!repoRoot) return null;
  try {
    const out = execFileSync(
      'git',
      ['-C', repoRoot, 'log', '-1', '--format=%ad', '--date=short', '--', filePath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** ★.git を持つ最も近い親を探す（git 管理外なら null）。 */
function findRepoRoot(filePath) {
  let dir = dirname(resolve(filePath));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(resolve(dir, '.git'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** ★2つの日付の差を日数で返す。どちらか測れなければ null（0を返さない）。 */
function daysBetween(a, b) {
  if (!a || !b) return null;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round(Math.abs(ta - tb) / 86400000);
}

function driftDirection(base, copy) {
  const baseLines = new Set(base.split('\n').map((l) => l.trim()));
  const copyLines = new Set(copy.split('\n').map((l) => l.trim()));
  let onlyCanonical = 0;
  let onlyCopy = 0;
  for (const l of baseLines) if (l && !copyLines.has(l)) onlyCanonical += 1;
  for (const l of copyLines) if (l && !baseLines.has(l)) onlyCopy += 1;
  return { onlyCanonical, onlyCopy };
}

function compare(canonicalPath, copies) {
  if (!existsSync(canonicalPath)) {
    return {
      verdict: 'inconclusive',
      detail: `正本が見つかりません: ${rel(canonicalPath)}`,
      howToFix: '★配っているはずの実体が欠けています。キット側のファイルを復旧する'
    };
  }
  const base = codeOnly(readFileSync(canonicalPath, 'utf8'));
  const checked = [];
  const drifted = [];
  const missing = [];

  for (const p of copies) {
    if (!existsSync(p)) { missing.push(p); continue; }
    checked.push(p);
    if (codeOnly(readFileSync(p, 'utf8')) !== base) drifted.push(p);
  }

  /*
   * ★「コピーを1本も宣言していない」と「宣言したのに見つからない」を分ける。
   *   ★前者は正常（まだ誰も持っていない実体。正本があることは確かめた）。
   *   ★後者は【測れなかった】＝緑にしない（掟⑤: 測れなかったを素通しさせない）。
   *   ここを一緒にすると、配ったばかりの実体で常に🟡が出て★読み手が慣れてしまう。
   */
  if (copies.length === 0) {
    return {
      verdict: 'pass',
      evidence: { 正本: 1, コピー: 0 },
      limitation: '★まだ追随するコピーがありません（正本の存在だけを確かめました）'
    };
  }
  if (checked.length === 0) {
    return {
      verdict: 'inconclusive',
      detail: `比較できたコピーが0本（見つからない: ${missing.length}本）`,
      howToFix: 'copies のパスを実在するものに直す。リポを clone していないなら、それは正常'
    };
  }
  if (drifted.length) {
    // ★向きと「放置された日数」を測って読み手に渡す（判定は変えない）。
    const canonDate = lastCommitDate(canonicalPath);
    const dirs = drifted.map((p) => {
      const copyDate = lastCommitDate(p);
      return {
        path: p,
        ...driftDirection(base, codeOnly(readFileSync(p, 'utf8'))),
        staleDays: daysBetween(canonDate, copyDate)
      };
    });
    // ★正本にしか無い行が0＝正本側に足りないものがある＝コピーが上位互換の疑い。
    const aheadCopies = dirs.filter((d) => d.onlyCanonical === 0 && d.onlyCopy > 0);
    // ★古い順に出す。件数で殴らず「どれが一番放置されているか」を先頭に置く。
    dirs.sort((a, b) => (b.staleDays ?? -1) - (a.staleDays ?? -1));
    const lines = dirs.map((d) => {
      // ★測れなかったときに 0 日と書かない（測れなかったを緑に混ぜない）。
      const age = d.staleDays === null ? '放置日数★測れず' : `★${d.staleDays}日 放置`;
      return `    ${rel(d.path)} … ${age} / 正本にしか無い行 ${d.onlyCanonical} / このコピーにしか無い行 ${d.onlyCopy}`;
    });
    const howToFix = aheadCopies.length
      ? '★寄せる前に測ること。下の「正本にしか無い行 0」のコピーは【正本より進んでいる】疑いが'
        + '濃厚です（正本に足りない行がありません）。そのまま正本に寄せると機能が消えます。'
        + '\n    ⟹ 進んでいる実装を正本へ取り込み、そのうえで他のコピーを揃える'
      : '正本(キット側)の実コードに合わせる。★コメントは各リポの事例のままでよい';
    const measured = dirs.filter((d) => d.staleDays !== null).map((d) => d.staleDays);
    const worstStale = measured.length ? Math.max(...measured) : null;
    return {
      verdict: 'fail',
      evidence: {
        比較: checked.length,
        割れ: drifted.length,
        上位互換の疑い: aheadCopies.length,
        // ★測れなかったものは 0 にせず「測れず」の件数として別に出す。
        最長放置日数: worstStale === null ? '★測れず' : worstStale,
        放置日数を測れず: dirs.length - measured.length
      },
      detail: `★実コードが割れています（★放置が長い順）:\n${lines.join('\n')}`,
      howToFix,
      limitation: '★実コードの一致だけを見ます。土台の中身が正しいかは見ません。'
        + '★行数は手掛かりであって証明ではありません（行が増えた＝進んだ、とは限らない）。'
        + '★放置日数は「正本とコピーの最終コミット日の差」です'
        + '（コミットしていない手元の変更は見えません）'
    };
  }
  return {
    verdict: 'pass',
    evidence: { 比較: checked.length, 割れ: 0, 未存在: missing.length },
    limitation: '★実コードの一致だけを見ます。土台の中身が正しいかは見ません'
  };
}

/* ── --selftest: ★毒を食わせ、赤が出ることを確認する ───────────────── */
if (SELFTEST) {
  const fails = [];

  // 毒1: 実コードが違うコピーを渡す → fail になるべき
  const poisonFile = resolve(HERE, '.drift-poison.tmp.mjs');
  const { writeFileSync, rmSync } = await import('node:fs');
  try {
    writeFileSync(poisonFile, readFileSync(CANONICAL, 'utf8') + '\nexport const POISON = 1;\n');
    const r = compare(CANONICAL, [poisonFile]);
    if (r.verdict !== 'fail') fails.push(`実コードの差を検知できない(得た: ${r.verdict})`);
  } finally {
    try { rmSync(poisonFile, { force: true }); } catch { /* 復帰は best-effort */ }
  }

  // 毒2: ★コメントだけ違うコピー → pass のままであるべき(誤検知しない)
  const commentFile = resolve(HERE, '.drift-comment.tmp.mjs');
  try {
    writeFileSync(commentFile, '// ★このリポ固有の事故の記録\n' + readFileSync(CANONICAL, 'utf8'));
    const r = compare(CANONICAL, [commentFile]);
    if (r.verdict !== 'pass') fails.push(`★コメント差を割れと誤検知した(得た: ${r.verdict})`);
  } finally {
    try { rmSync(commentFile, { force: true }); } catch { /* 復帰は best-effort */ }
  }

  // 毒3: ★1本も存在しない → inconclusive であるべき(緑にしない)
  const r3 = compare(CANONICAL, [resolve(HERE, '.nope-does-not-exist.mjs')]);
  if (r3.verdict !== 'inconclusive') fails.push(`★0本を緑にした(得た: ${r3.verdict})`);

  /*
   * 毒4: ★放置日数が「測れなかった」ときに 0 を返してはいけない。
   *
   *   ★実データでは全ファイルが git 管理下にあるため、この経路は【一度も通らない】。
   *     ＝実行して緑でも、この穴は塞がっていない。
   *     （最大入力に無い項目は、網羅ゲートを素通しする — 実際に踏んだ型）
   *   ⟹ ここで直接その分岐を撃つ。
   *
   *   ★なぜ致命的か: 0日 は「今日同期された」という意味になる。
   *     測れていないものを「今日同期済み」と読ませるのは、
   *     ★最も危険な嘘（測れなかったを緑に混ぜる）。
   */
  if (daysBetween(null, '2026-08-28') !== null) fails.push('★片方が測れないのに日数を返した');
  if (daysBetween('2026-08-28', null) !== null) fails.push('★片方が測れないのに日数を返した(逆)');
  if (daysBetween('壊れた日付', '2026-08-28') !== null) fails.push('★解釈できない日付で日数を返した');
  if (daysBetween('2026-08-21', '2026-08-27') !== 6) fails.push('★日数の計算が合わない');
  if (daysBetween('2026-08-27', '2026-08-21') !== 6) fails.push('★順序を入れ替えると日数が変わる');

  /*
   * 毒5: ★放置日数のラチェットが機能しているか。
   *   上限が無いと 51日→1000日 になっても出力が変わらず、悪化に気づけない。
   *   ★上限そのものが消える/緩む変更を検出する。
   */
  if (typeof KNOWN_MAX_STALE_DAYS !== 'number' || !Number.isFinite(KNOWN_MAX_STALE_DAYS)) {
    fails.push('★放置日数の上限が数値でない(ラチェットが効かない)');
  }
  if (KNOWN_MAX_STALE_DAYS > 365) {
    fails.push('★放置日数の上限が1年を超えている(事実上の無制限＝鳴らない)');
  }

  if (fails.length) {
    console.error('[check-drift] ★selftest 失敗（検知器が効いていません）:');
    for (const f of fails) console.error('  - ' + f);
    process.exit(EXIT.FAIL);
  }
  console.log('[check-drift] selftest OK（実コードの差を検知 / ★コメント差は誤検知しない / 0本を緑にしない）');
  process.exit(EXIT.PASS);
}

/*
 * ── ★配っている実体すべてを見る（1本だけ見ていると他は黙って割れる） ─────
 *
 * ★isMain ガード: 冒頭で定義済み。import されただけで本体が走るのを止める。
 */
let worst = EXIT.PASS;
let worstStaleDays = 0;
for (const pair of isMain ? PAIRS : []) {
  const r = compare(pair.canonical, pair.copies);
  const mark = r.verdict === 'pass' ? '✅' : r.verdict === 'fail' ? '🔴' : '🟡';
  console.log(`[check-drift] ${mark} ${pair.label} — ${r.verdict}`);
  if (r.evidence) console.log('  根拠: ' + JSON.stringify(r.evidence, null, 0));
  if (r.detail) console.log('  ' + r.detail);
  if (r.howToFix) console.log('  → 直し方: ' + r.howToFix);
  if (r.limitation) console.log('  → この検査の限界: ' + r.limitation);

  // ★放置日数の最長を覚えておく（下でラチェットに掛ける）。
  const s = r.evidence && r.evidence['最長放置日数'];
  if (typeof s === 'number' && s > worstStaleDays) worstStaleDays = s;

  // ★優先順は fail > inconclusive > pass（土台の computeExitCode と同じ規約）。
  if (r.verdict === 'fail') worst = EXIT.FAIL;
  else if (r.verdict === 'inconclusive' && worst === EXIT.PASS) worst = EXIT.INCONCLUSIVE;
}

if (isMain) {
  /*
   * ★放置のラチェット。既存の放置は許容し、【それより悪化したときだけ】鳴らす。
   *   上限が無いと 51日→1000日 になっても出力が変わらず、悪化に気づけない。
   */
  if (worstStaleDays > KNOWN_MAX_STALE_DAYS) {
    console.log('');
    console.log(`[check-drift] 🔴 ★放置が上限を超えました: ${worstStaleDays}日 `
      + `(上限 ${KNOWN_MAX_STALE_DAYS}日)`);
    console.log('  → 直し方: 一番古いものを揃えるか、'
      + `直せない理由があるなら KNOWN_MAX_STALE_DAYS を ${worstStaleDays} に上げて【理由をコメントに書く】。`);
    console.log('  ★数字を黙って上げないこと。上げた理由が残らないと、次の人は上げ続けます。');
    worst = EXIT.FAIL;
  } else if (worstStaleDays > 0) {
    console.log('');
    console.log(`[check-drift] ・ 最長の放置 ${worstStaleDays}日（上限 ${KNOWN_MAX_STALE_DAYS}日・まだ超えていません）`);
    console.log('  ★減らしたら KNOWN_MAX_STALE_DAYS も一緒に下げてください'
      + '（下げないと、また静かに伸びます）。');
  }
  process.exit(worst);
}
