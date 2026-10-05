#!/usr/bin/env node
/**
 * measure-page-flicker.mjs — 任意の URL を開いた直後の「ちらつき」を、録画のフレームと要素の座標で数える。
 *
 * ■ なぜ要るか（2026-10-05、kimito.link の /dashboard/ → sign-in で「白 → 紺がパッと出て消える → 中身が下にずれる」）
 *   目視では「ちかちかする」までしか言えず、直したかどうかも判定できなかった。
 *   使い捨ての計測スクリプト（Playwright 録画 ＋ ffmpeg フレーム解析）で原因を 3 つに分けられたので、
 *   どのサイト・どのページでも同じ数値が出る道具にした。次に同じ症状が出たとき、誰でも同じ道具で測る。
 *
 * ■ 何を測るか（summary.txt の 3 行）
 *   白一色フレーム    … 画面の 98% 以上が白(輝度>=250)のフレーム枚数。描画前の地色が見えている時間
 *   フラッシュ        … 前フレームとの平均輝度差 > 50 のフレーム枚数。全画面が一瞬で別の色になった回数
 *                        （全画面オーバーレイの出現・消滅が典型。出る・消えるで 2 枚になる）
 *   縦ずれ            … 既にあった要素が縦に動いた回数。Chrome の Layout Instability API（layout-shift エントリ、
 *                        CLS の元データ）をそのまま数える＝車輪の再発明をしない。動いた要素と前後の top を添える
 *                        （後から挿入される要素／本物と寸法の違うプレースホルダが典型）
 *   補助: 最初に画面が変わるまでの秒数（地色が続いた長さ）、CLS 合計、--track した要素の移動（いつ・何 px）、
 *         console error 数、遷移列（3xx リダイレクト含む）、navigation timing
 *
 * ■ 使い方
 *   node scripts/qa/measure-page-flicker.mjs <url> --out <dir> [--cpu 2] [--network 3g|4g|none] [--seconds 8]
 *        [--device "iPhone 15 Pro Max"] [--track "<css>"]... [--cookie "name=value;domain=.example.com"]...
 *        [--no-standalone] [--allow-sw] [--playwright <path>] [--ffmpeg <path>]
 *   node scripts/qa/measure-page-flicker.mjs --selftest
 *
 *   Playwright は【呼び出し元のリポ】（process.cwd()）の node_modules から解決する。この金型自体は依存を持たない。
 *   見つからなければ exit 2 で案内する（このリポに playwright を入れるか --playwright <path> で指定）。
 *   ffmpeg は PATH か環境変数 FFMPEG か --ffmpeg。無ければ exit 2。
 *
 * ■ 出力（--out の中）
 *   video.webm     録画（既定 8 秒）
 *   timeline.json  遷移列・3xx 応答・console error・navigation timing・layout-shift・要素の座標履歴・パラメータ
 *   frames.csv     0.1 秒ごと: 時刻・平均輝度・白画素率・前フレーム差分・追跡要素ごとの top
 *   tiles.png      0.2 秒ごとのフレームを 8 列に並べた画像（目視用。Read で見る）
 *   summary.txt    上の 3 行と補助情報。標準出力にも同じものを出す
 *
 * ■ 終了コード（3 値。_docs/instruments/HANDOFF-new-app.md）
 *   0 = フラッシュ 0 かつ 縦ずれ 0
 *   1 = どちらかが 1 以上（測れた上での赤）
 *   2 = 測れなかった（Playwright/ffmpeg が無い・ページが開けない・録画が 0 フレーム 等）。0 と同じ緑に数えない
 *
 * ■ 測っていないもの（過信を防ぐ）
 *   - 実機の速さ・色味。CPU と回線を絞った「見立て」（既定: CPU 2 倍遅・DevTools の Fast 3G 相当）
 *   - iOS Safari 固有の挙動（Chromium で iPhone の画面・UA を模しているだけ）
 *   - 白一色フレームは 98% 以上が白のときだけ数える。ロゴや文字が少し出ている白画面は「最初に画面が変わるまでの秒数」で見る
 *   - 縦ずれは Chrome が 3px 以上の移動とみなしたものだけ。frames.csv の top 列は既定で `main > *`（main が無ければ
 *     `body > *`）だけを追う。入れ子の要素の列が欲しければ --track で足す
 *   - 視覚的に同じ色のまま要素が入れ替わる変化（差分が小さい）は拾えない
 *
 * ■ 出典
 *   kimito.link sign-in の調査（2026-10-05）。判断と実測は _docs/DESIGN-signin-no-flicker-2026-10-05.md。
 *   同じ流儀の道具: surechigai-romi.link/scripts/qa/measure-launch-timeline.mjs（PWA 起動の段階ラベル、サイト固有）、
 *   templates/scripts/measure-webapk-launch.sh（Android 実機の WebAPK 起動）。この金型はブラウザ上の汎用版。
 */
import { createRequire } from "node:module";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

// 3 値の終了コード（templates/scripts/lib/instrument-core.mjs の EXIT と同じ値。この道具は配布先の
// scripts/qa/ に単体でコピーされる前提なので import せず、値だけを揃える＝意図的な複製）
const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 });

// 判定のしきい値（knob にしない。緩めて通す動機を作らないため固定）
const TH = Object.freeze({
  FPS: 10,            // 解析のフレームレート
  WHITE_PX: 250,      // この輝度以上を「白画素」とみなす
  WHITE_ONLY_PCT: 98, // 白画素がこの割合以上のフレームを「白一色」とみなす
  FLASH_DIFF: 50,     // 前フレームとの平均輝度差がこれを超えたら「フラッシュ」
  CHANGE_DIFF: 8,     // これを超えたら「画面が変わった」（地色が続いた長さの終点）
  SCALE_W: 86,        // 解析用の縮小幅（1/5 程度で十分）
  MAX_TRACKED: 24,    // 追跡する要素の上限（frames.csv の列数を抑える）
});

// DevTools のプリセット相当。3g は 2026-10-05 の計測と同じ値
const NETWORK = Object.freeze({
  "3g": { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  "4g": { latency: 20, downloadThroughput: (4 * 1024 * 1024) / 8, uploadThroughput: (3 * 1024 * 1024) / 8 },
  none: null,
});

// ───────────────────────── 引数 ─────────────────────────
function parseArgs(argv) {
  const o = { url: null, out: null, cpu: 2, network: "3g", seconds: 8, device: "iPhone 15 Pro Max", track: [], cookies: [], standalone: true, allowSw: false, playwright: null, ffmpeg: null, selftest: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} には値が要ります`); return argv[++i]; };
    if (a === "--out") o.out = next();
    else if (a === "--cpu") o.cpu = Number(next());
    else if (a === "--network") o.network = next();
    else if (a === "--seconds") o.seconds = Number(next());
    else if (a === "--device") o.device = next();
    else if (a === "--track") o.track.push(next());
    else if (a === "--cookie") o.cookies.push(next());
    else if (a === "--no-standalone") o.standalone = false;
    else if (a === "--allow-sw") o.allowSw = true;
    else if (a === "--playwright") o.playwright = next();
    else if (a === "--ffmpeg") o.ffmpeg = next();
    else if (a === "--selftest") o.selftest = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else if (a.startsWith("--")) throw new Error(`知らないオプション: ${a}`);
    else if (!o.url) o.url = a;
    else throw new Error(`引数が多すぎます: ${a}`);
  }
  return o;
}

function usage() {
  return [
    "usage: node measure-page-flicker.mjs <url> --out <dir> [--cpu 2] [--network 3g|4g|none] [--seconds 8]",
    '       [--device "iPhone 15 Pro Max"] [--track "<css>"]... [--cookie "name=value;domain=.example.com"]...',
    "       [--no-standalone] [--allow-sw] [--playwright <path>] [--ffmpeg <path>]",
    "       node measure-page-flicker.mjs --selftest",
  ].join("\n");
}

// "name=value;domain=.example.com;path=/" → Playwright の cookie
function parseCookie(spec, url) {
  const parts = spec.split(";").map((s) => s.trim()).filter(Boolean);
  const [name, ...rest] = parts[0].split("=");
  const c = { name: name.trim(), value: rest.join("=").trim(), path: "/" };
  for (const p of parts.slice(1)) {
    const [k, v] = p.split("=").map((s) => s.trim());
    if (k === "domain") c.domain = v;
    else if (k === "path") c.path = v;
  }
  if (!c.domain) c.domain = new URL(url).hostname;
  c.secure = !/^(localhost|127\.0\.0\.1)$/.test(c.domain.replace(/^\./, ""));
  c.sameSite = "Lax";
  return c;
}

// ───────────────────────── 依存の解決 ─────────────────────────
function loadPlaywright(explicitPath) {
  const bases = [];
  if (explicitPath) bases.push(resolve(explicitPath));
  bases.push(process.cwd());
  const tried = [];
  for (const base of bases) {
    const req = createRequire(join(base, "package.json"));
    for (const spec of [base === process.cwd() ? null : base, "playwright"].filter(Boolean)) {
      try {
        const mod = req(spec);
        if (mod && mod.chromium && mod.devices) return { mod, from: req.resolve(spec) };
      } catch (e) { tried.push(`${spec} from ${base}: ${String(e.message || e).split("\n")[0]}`); }
    }
  }
  return { mod: null, tried };
}

function findFfmpeg(explicitPath) {
  const candidates = [explicitPath, process.env.FFMPEG, "ffmpeg"].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ["-version"], { encoding: "utf8" });
    if (r.status === 0) return c;
  }
  return null;
}

// ───────────────────────── 解析（純関数。--selftest の対象） ─────────────────────────
/** gray の rawvideo をフレームごとに 平均輝度 / 白画素率 / 前フレーム差分 にする */
function analyzeFrames(raw, w, h, fps) {
  const size = w * h;
  const n = Math.floor(raw.length / size);
  const rows = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    const f = raw.subarray(i * size, (i + 1) * size);
    let sum = 0, white = 0, diff = 0;
    for (let p = 0; p < size; p++) {
      sum += f[p];
      if (f[p] >= TH.WHITE_PX) white++;
      if (prev) diff += Math.abs(f[p] - prev[p]);
    }
    rows.push({ t: i / fps, mean: sum / size, whitePct: (white / size) * 100, diff: prev ? diff / size : null });
    prev = f;
  }
  return rows;
}

/** フレーム表 → 白一色・フラッシュ・最初の変化 */
function summarizeFrames(rows) {
  const whiteOnly = rows.filter((r) => r.whitePct >= TH.WHITE_ONLY_PCT);
  const flash = rows.filter((r) => r.diff != null && r.diff > TH.FLASH_DIFF);
  const firstChange = rows.find((r) => r.diff != null && r.diff > TH.CHANGE_DIFF);
  return {
    frames: rows.length,
    whiteOnlyCount: whiteOnly.length,
    whiteOnlyAt: whiteOnly.map((r) => r.t),
    flashCount: flash.length,
    flashAt: flash.map((r) => ({ t: r.t, diff: r.diff, meanBefore: rows[rows.indexOf(r) - 1]?.mean ?? null, meanAfter: r.mean })),
    firstChangeAt: firstChange ? firstChange.t : null,
  };
}

/**
 * layout-shift エントリ → 縦ずれ（正本の数え方）。
 *   数える: sources のどれかが縦に動いた件、または sources が取れない件（動いたことは確か）
 *   数えない: 入力直後の件（ページ側で除外済み）/ 横にしか動いていない件
 */
function countLayoutShifts(entries) {
  return entries.filter((e) => {
    if (!(e.value > 0)) return false;
    const src = Array.isArray(e.sources) ? e.sources : [];
    if (src.length === 0) return true;
    return src.some((s) => s.fromTop != null && s.toTop != null && s.fromTop !== s.toTop);
  });
}

/**
 * 追跡要素の座標履歴 → 移動回数（補助。--track で指定した要素が「いつ・何 px」動いたかを出す）。
 *   数える: 一度出た要素の top が変わった（高さだけの変化は数えない。下にある要素の移動として現れる）
 *   数えない: 初回出現 / 消滅 / スクロールによる一斉移動（scrollY の変化量と top の変化量が一致）
 */
function countVerticalShifts(rectEvents) {
  const prevByKey = new Map();
  const shifts = [];
  for (const e of rectEvents) {
    const prev = prevByKey.get(e.key);
    if (e.top != null && prev && prev.top != null && prev.top !== e.top) {
      const delta = e.top - prev.top;
      const scrollDelta = (prev.scrollY ?? 0) - (e.scrollY ?? 0);
      if (delta !== scrollDelta) shifts.push({ wall: e.wall, key: e.key, from: prev.top, to: e.top, delta });
    }
    prevByKey.set(e.key, e);
  }
  return shifts;
}

function selftest() {
  const fails = [];
  const check = (name, ok) => { if (!ok) fails.push(name); };
  // 1) 白 3 枚 → 暗転 → 戻る: 白一色 3、フラッシュ 2、最初の変化は 0.3s
  const w = 4, h = 2, fps = 10;
  const frame = (v) => Buffer.alloc(w * h, v);
  const raw = Buffer.concat([frame(255), frame(255), frame(255), frame(72), frame(72), frame(215)]);
  const rows = analyzeFrames(raw, w, h, fps);
  const s = summarizeFrames(rows);
  check("フレーム数を数える", s.frames === 6);
  check("白一色フレームを数える", s.whiteOnlyCount === 3);
  check("フラッシュを出入りで 2 枚数える", s.flashCount === 2 && s.flashAt[0].t === 0.3);
  check("最初の変化の時刻", s.firstChangeAt === 0.3);
  check("変化の無い録画はフラッシュ 0", summarizeFrames(analyzeFrames(Buffer.concat([frame(200), frame(200)]), w, h, fps)).flashCount === 0);
  // 2) 0 フレームを緑にしない（呼び出し側で INCONCLUSIVE にする前提。summarize は frames=0 を返す）
  check("0 フレームは frames=0", summarizeFrames(analyzeFrames(Buffer.alloc(0), w, h, fps)).frames === 0);
  // 3) 縦ずれ
  const ev = [
    { key: "a", top: 100, height: 50, scrollY: 0 },           // 初回出現: 数えない
    { key: "a", top: 205, height: 50, scrollY: 0 },           // 下に 105: 数える
    { key: "a", top: 205, height: 300, scrollY: 0 },          // 高さだけ: 数えない
    { key: "b", top: 400, height: 10, scrollY: 0 },           // 初回出現
    { key: "a", top: 105, height: 300, scrollY: 100 },        // スクロール 100 と一致: 数えない
    { key: "b", top: 300, height: 10, scrollY: 100 },         // 同上
    { key: "b", top: null, height: null, scrollY: 100 },      // 消滅: 数えない
    { key: "b", top: 320, height: 10, scrollY: 100 },         // 再出現: 直前が absent なので数えない
    { key: "b", top: 330, height: 10, scrollY: 100 },         // 10 動いた: 数える
  ];
  const shifts = countVerticalShifts(ev);
  check("追跡要素の移動を 2 回と数える", shifts.length === 2 && shifts[0].delta === 105 && shifts[1].delta === 10);
  check("追跡要素の移動無しは 0", countVerticalShifts([{ key: "a", top: 1, height: 1, scrollY: 0 }, { key: "a", top: 1, height: 2, scrollY: 0 }]).length === 0);
  const ls = [
    { value: 0.12, sources: [{ node: "a", fromTop: 76, toTop: 76 }, { node: "div", fromTop: 163, toTop: 268 }] }, // 縦に動いた: 数える
    { value: 0.0001, sources: [{ node: "a", fromTop: 76, toTop: 76 }] },                                        // 横だけ: 数えない
    { value: 0.004, sources: [] },                                                                                // sources 無し: 数える
    { value: 0, sources: [{ node: "p", fromTop: 1, toTop: 9 }] },                                                 // value 0: 数えない
  ];
  check("縦ずれ(layout-shift)を 2 件と数える", countLayoutShifts(ls).length === 2);
  check("縦ずれ無しは 0", countLayoutShifts([]).length === 0);
  // 4) 引数
  const o = parseArgs(["https://x.test/", "--out", "o", "--cpu", "4", "--network", "none", "--track", "main", "--track", "h1", "--no-standalone"]);
  check("引数を読む", o.url === "https://x.test/" && o.cpu === 4 && o.network === "none" && o.track.length === 2 && o.standalone === false);
  check("cookie を読む", (() => { const c = parseCookie("__client_uat=1;domain=.example.com", "https://a.example.com/"); return c.name === "__client_uat" && c.value === "1" && c.domain === ".example.com" && c.secure === true; })());
  if (fails.length) { console.error("selftest FAIL:\n  - " + fails.join("\n  - ")); return EXIT.FAIL; }
  console.log("selftest OK (14 checks)");
  return EXIT.PASS;
}

// ───────────────────────── 計測本体 ─────────────────────────
async function measure(o) {
  const inconclusive = (msg) => { console.error(`🟡 測れませんでした: ${msg}`); return EXIT.INCONCLUSIVE; };
  if (!o.url || !o.out) { console.error(usage()); return EXIT.INCONCLUSIVE; }
  try { new URL(o.url); } catch { return inconclusive(`URL が不正です: ${o.url}`); }
  if (!(o.network in NETWORK)) return inconclusive(`--network は ${Object.keys(NETWORK).join("|")} のいずれか`);
  if (!(Number.isFinite(o.cpu) && o.cpu >= 1)) return inconclusive("--cpu は 1 以上の数");
  if (!(Number.isFinite(o.seconds) && o.seconds >= 1 && o.seconds <= 60)) return inconclusive("--seconds は 1〜60");

  const pw = loadPlaywright(o.playwright);
  if (!pw.mod) {
    return inconclusive([
      `Playwright が見つかりません（探した起点: ${o.playwright ? resolve(o.playwright) + " と " : ""}${process.cwd()}）。`,
      "  このリポに `npm i -D playwright && npx playwright install chromium` で入れるか、",
      "  playwright が入っているリポのルートを --playwright <path> で指定してください。",
      ...pw.tried.map((t) => "  tried: " + t),
    ].join("\n"));
  }
  const { chromium, devices } = pw.mod;
  const dev = devices[o.device];
  if (!dev) return inconclusive(`--device "${o.device}" は Playwright の devices に無い。例: ${Object.keys(devices).filter((k) => /iPhone 1[45]|Pixel 7|Galaxy S9/.test(k) && !/landscape/.test(k)).slice(0, 6).join(" / ")}`);
  const ff = findFfmpeg(o.ffmpeg);
  if (!ff) return inconclusive("ffmpeg が見つかりません。PATH に入れるか、環境変数 FFMPEG または --ffmpeg <path> で指定してください。");

  const outDir = resolve(o.out);
  mkdirSync(outDir, { recursive: true });
  const tmpDir = join(outDir, ".video-tmp");
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  const vw = dev.viewport.width, vh = dev.viewport.height;
  const t0 = Date.now();
  const log = {
    params: { url: o.url, cpu: o.cpu, network: o.network, seconds: o.seconds, device: o.device, standalone: o.standalone, serviceWorkers: o.allowSw ? "allow" : "block", track: o.track, cookies: o.cookies.map((c) => c.split("=")[0]), playwright: pw.from, measuredAt: new Date(t0).toISOString() },
    navigations: [], responses: [], console: [], pageErrors: [], layoutShifts: [], rects: [], final: null,
  };
  const ms = () => Date.now() - t0;

  const browser = await chromium.launch();
  let exit = EXIT.INCONCLUSIVE;
  try {
    const ctx = await browser.newContext({ ...dev, serviceWorkers: o.allowSw ? "allow" : "block", recordVideo: { dir: tmpDir, size: { width: vw, height: vh } } });
    // ページ側からの報告口。遷移をまたいでも生きる（addInitScript は文書ごとに走り直すので、文書内に溜めると最初の文書の分が消える）
    await ctx.exposeBinding("__flickerReport", (src, evt) => {
      if (src.frame !== src.page.mainFrame()) return;
      if (evt.kind === "layout-shift") log.layoutShifts.push(evt);
      else if (evt.kind === "rect") log.rects.push(evt);
    });
    await ctx.addInitScript(({ standalone, trackSelectors, maxTracked }) => {
      if (standalone) {
        // ホーム画面から開いた PWA を模す（navigator.standalone / display-mode: standalone）
        try { Object.defineProperty(navigator, "standalone", { get: () => true }); } catch {}
        const orig = window.matchMedia.bind(window);
        window.matchMedia = (q) => (String(q).includes("display-mode: standalone") ? { ...orig("all"), matches: true, media: q } : orig(q));
      }
      const report = (evt) => { try { window.__flickerReport(evt); } catch {} };
      // 要素の短い記述（Text ノードや SVG でも落ちないように。ここで例外を出すと計測対象のページの pageerror に混ざる）
      const describe = (node) => {
        try {
          if (!node || node.nodeType !== 1) return node && node.nodeName ? `#${String(node.nodeName).toLowerCase()}` : null;
          const el = node;
          const tag = el.tagName.toLowerCase();
          const id = el.id && typeof el.id === "string" ? `#${el.id}` : "";
          const testid = el.getAttribute("data-testid");
          const classes = [...el.classList].filter((c) => !/^cl-internal/.test(c)).slice(0, 2);
          const cls = !id && !testid && classes.length ? "." + classes.join(".") : "";
          const base = `${tag}${id}${testid ? `[data-testid=${testid}]` : ""}${cls}`.slice(0, 60);
          // 同じ記述の兄弟が複数あるときだけ順番を付ける
          const same = (c) => c.tagName === el.tagName && String(c.className) === String(el.className) && c.id === el.id;
          const sib = el.parentElement ? [...el.parentElement.children].filter(same) : [el];
          return sib.length > 1 ? `${base}:nth(${sib.indexOf(el) + 1})` : base;
        } catch { return null; }
      };
      // 縦ずれの正本: 業界標準の Layout Instability API（Chrome の layout-shift エントリ。既にあった要素が 3px 以上動いたときに
      // 1 フレーム 1 件で記録され、sources に動いた要素と前後の位置が入る）。自前の座標追跡はこの補助（frames.csv の列と --track の詳細）
      try {
        new PerformanceObserver((list) => {
          try {
            for (const e of list.getEntries()) {
              if (e.hadRecentInput) continue;
              report({ kind: "layout-shift", wall: performance.timeOrigin + e.startTime, value: e.value, sources: (e.sources || []).slice(0, 6).map((s) => ({ node: describe(s.node), fromTop: s.previousRect ? Math.round(s.previousRect.y) : null, toTop: s.currentRect ? Math.round(s.currentRect.y) : null, height: s.currentRect ? Math.round(s.currentRect.height) : null })) });
            }
          } catch {}
        }).observe({ type: "layout-shift", buffered: true });
      } catch {}
      // rAF ごとに追跡要素の top/height を取り、変わったときだけ報告する
      const last = new Map();
      const skipTag = new Set(["SCRIPT", "STYLE", "LINK", "NOSCRIPT", "META", "TEMPLATE"]);
      const pick = () => {
        const sels = trackSelectors.length ? trackSelectors : [document.querySelector("main") ? "main > *" : "body > *"];
        const out = [];
        for (const s of sels) {
          let found;
          try { found = document.querySelectorAll(s); } catch { continue; }
          for (const el of found) { if (skipTag.has(el.tagName)) continue; out.push(el); if (out.length >= maxTracked) return out; }
        }
        return out;
      };
      const tick = () => {
        const seen = new Set();
        for (const el of pick()) {
          const key = describe(el);
          if (seen.has(key)) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          seen.add(key);
          const sig = `${Math.round(r.top)}:${Math.round(r.height)}`;
          if (last.get(key) !== sig) {
            last.set(key, sig);
            report({ kind: "rect", wall: Date.now(), key, top: Math.round(r.top), height: Math.round(r.height), scrollY: Math.round(window.scrollY), href: location.href });
          }
        }
        for (const key of [...last.keys()]) {
          if (!seen.has(key)) { last.delete(key); report({ kind: "rect", wall: Date.now(), key, top: null, height: null, scrollY: Math.round(window.scrollY), href: location.href }); }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { standalone: o.standalone, trackSelectors: o.track, maxTracked: TH.MAX_TRACKED });

    if (o.cookies.length) await ctx.addCookies(o.cookies.map((c) => parseCookie(c, o.url)));

    const page = await ctx.newPage();
    const videoStartWall = Date.now(); // 録画はページ生成とともに始まる。フレーム時刻とのずれは 0.1 秒程度
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) log.navigations.push({ t: ms(), url: f.url() }); });
    page.on("response", (r) => {
      const rt = r.request().resourceType();
      const st = r.status();
      if (rt === "document" || (st >= 300 && st < 400)) {
        log.responses.push({ t: ms(), status: st, type: rt, url: r.url().slice(0, 200), location: r.headers()["location"] ?? null, cacheControl: r.headers()["cache-control"] ?? null });
      }
    });
    page.on("console", (m) => { if (m.type() === "error") log.console.push({ t: ms(), text: m.text().slice(0, 300) }); });
    page.on("pageerror", (e) => log.pageErrors.push({ t: ms(), text: String(e).slice(0, 300) }));

    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: o.cpu });
    if (NETWORK[o.network]) {
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, ...NETWORK[o.network] });
    }

    log.gotoStart = ms();
    try {
      await page.goto(o.url, { waitUntil: "commit", timeout: Math.max(15000, o.seconds * 1000) });
    } catch (e) {
      await ctx.close().catch(() => {});
      return inconclusive(`ページを開けませんでした: ${String(e.message || e).split("\n")[0]}`);
    }
    log.gotoCommit = ms();
    await page.waitForTimeout(o.seconds * 1000);
    try {
      log.final = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0];
        return {
          href: location.href,
          title: document.title,
          redirectCount: nav?.redirectCount ?? null,
          nav: nav ? { redirectEnd: nav.redirectEnd, responseStart: nav.responseStart, domContentLoaded: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, type: nav.type } : null,
          htmlAttributes: Object.fromEntries([...document.documentElement.attributes].map((a) => [a.name, a.value.slice(0, 80)])),
          bodyBackground: getComputedStyle(document.body).backgroundColor,
          htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
        };
      });
    } catch (e) { log.finalError = String(e).slice(0, 300); }
    await ctx.close();

    // 録画を取り出す
    const webm = readdirSync(tmpDir).find((n) => n.endsWith(".webm"));
    if (!webm) return inconclusive("録画ファイルが生成されませんでした");
    const videoPath = join(outDir, "video.webm");
    rmSync(videoPath, { force: true });
    renameSync(join(tmpDir, webm), videoPath);
    rmSync(tmpDir, { recursive: true, force: true });

    // ffmpeg: 10fps・縮小・グレースケールの raw
    const W = TH.SCALE_W, H = 2 * Math.round((W * vh) / vw / 2);
    const raw = execFileSync(ff, ["-v", "error", "-i", videoPath, "-vf", `fps=${TH.FPS},scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 1 << 28 });
    const rows = analyzeFrames(raw, W, H, TH.FPS);
    if (rows.length === 0) return inconclusive("録画から 1 フレームも取り出せませんでした");
    const fs = summarizeFrames(rows);

    // タイル（0.2 秒ごと・8 列）
    const tileRows = Math.max(1, Math.ceil((rows.length / TH.FPS) * 5 / 8));
    try {
      execFileSync(ff, ["-v", "error", "-y", "-i", videoPath, "-vf", `fps=5,scale=172:-2,tile=8x${tileRows}:padding=4:color=red`, "-frames:v", "1", join(outDir, "tiles.png")]);
    } catch (e) { log.tilesError = String(e.message || e).slice(0, 200); }

    // 縦ずれ（正本: layout-shift）と追跡要素の移動（補助）
    const rects = log.rects.map((r) => ({ ...r, tVideo: (r.wall - videoStartWall) / 1000 }));
    const trackedMoves = countVerticalShifts(rects);
    const layoutShifts = log.layoutShifts.map((e) => ({ ...e, tVideo: (e.wall - videoStartWall) / 1000 })).sort((a, b) => a.wall - b.wall);
    const shifts = countLayoutShifts(layoutShifts);
    const clsTotal = layoutShifts.reduce((a, e) => a + (e.value || 0), 0);

    // frames.csv（要素ごとの top は、そのフレーム時刻までの最新値）
    const keys = [...new Set(rects.map((r) => r.key))].slice(0, TH.MAX_TRACKED);
    const csv = [["t_s", "mean", "white_pct", "diff", ...keys.map((k) => `top:${k}`)].map(csvCell).join(",")];
    for (const r of rows) {
      const state = {};
      for (const e of rects) { if (e.tVideo <= r.t + 0.05) state[e.key] = e.top; }
      csv.push([r.t.toFixed(1), r.mean.toFixed(1), r.whitePct.toFixed(1), r.diff == null ? "" : r.diff.toFixed(1), ...keys.map((k) => (state[k] == null ? "" : state[k]))].map(csvCell).join(","));
    }
    writeFileSync(join(outDir, "frames.csv"), csv.join("\n") + "\n");

    // timeline.json
    log.videoStartWall = videoStartWall;
    log.rects = rects;
    log.layoutShifts = layoutShifts;
    log.verticalShifts = shifts;
    log.trackedMoves = trackedMoves.map((s) => ({ ...s, tVideo: (s.wall - videoStartWall) / 1000 }));
    log.frameSummary = fs;
    log.clsTotal = clsTotal;
    writeFileSync(join(outDir, "timeline.json"), JSON.stringify(log, null, 2));

    // summary.txt
    exit = fs.flashCount === 0 && shifts.length === 0 ? EXIT.PASS : EXIT.FAIL;
    const lines = [
      `measure-page-flicker  ${o.url}`,
      `  device=${o.device} cpu×${o.cpu} network=${o.network} seconds=${o.seconds} standalone=${o.standalone ? "yes" : "no"} frames=${fs.frames}@${TH.FPS}fps`,
      `  白一色フレーム(>=${TH.WHITE_ONLY_PCT}% が輝度>=${TH.WHITE_PX}): ${fs.whiteOnlyCount} 枚${fs.whiteOnlyCount ? ` at t=[${fs.whiteOnlyAt.map((t) => t.toFixed(1)).join(",")}]` : ""}`,
      `  フラッシュ(前フレームとの平均輝度差>${TH.FLASH_DIFF}): ${fs.flashCount} 枚${fs.flashCount ? ` at ${fs.flashAt.map((f) => `${f.t.toFixed(1)}s(diff=${f.diff.toFixed(0)}, 輝度 ${f.meanBefore?.toFixed(0)}→${f.meanAfter.toFixed(0)})`).join(" ")}` : ""}`,
      `  縦ずれ(layout-shift: 既にあった要素が縦に動いた回数): ${shifts.length} 回  CLS 合計 ${clsTotal.toFixed(4)}${shifts.length ? "\n" + shifts.map((e) => `    ${e.tVideo.toFixed(1)}s score=${e.value.toFixed(4)} ` + e.sources.filter((s) => s.fromTop !== s.toTop).map((s) => `${s.node} ${s.fromTop}→${s.toTop}`).join(", ")).join("\n") : ""}`,
      `  追跡要素の移動(--track の要素の top が動いた回数): ${trackedMoves.length} 回${trackedMoves.length ? "\n" + log.trackedMoves.map((s) => `    ${s.tVideo.toFixed(1)}s ${s.key} top ${s.from}→${s.to} (${s.delta > 0 ? "+" : ""}${s.delta}px)`).join("\n") : ""}`,
      `  最初に画面が変わるまで(差分>${TH.CHANGE_DIFF}): ${fs.firstChangeAt == null ? "変化なし" : fs.firstChangeAt.toFixed(1) + " 秒"}`,
      `  console error: ${log.console.length} 件 / pageerror: ${log.pageErrors.length} 件`,
      `  遷移: ${log.navigations.map((n) => `${(n.t / 1000).toFixed(1)}s ${n.url}`).join(" → ") || "(なし)"}`,
      `  3xx: ${log.responses.filter((r) => r.status >= 300 && r.status < 400).map((r) => `${r.status} ${r.url} → ${r.location}`).join(" | ") || "(なし)"}`,
      `  navigation timing: ${log.final?.nav ? `responseStart=${Math.round(log.final.nav.responseStart)}ms DCL=${Math.round(log.final.nav.domContentLoaded)}ms load=${Math.round(log.final.nav.load)}ms redirects=${log.final.redirectCount}` : "(取れず)"}`,
      `  追跡した要素: ${keys.length ? keys.join(", ") : "(なし。--track で指定するか、main/body の子が描かれていない)"}`,
      `  判定: ${exit === EXIT.PASS ? "🟢 フラッシュ 0・縦ずれ 0" : "🔴 フラッシュまたは縦ずれあり"}  (exit ${exit})`,
      `  出力: ${outDir}  (video.webm / timeline.json / frames.csv / tiles.png / summary.txt)`,
    ];
    const summary = lines.join("\n") + "\n";
    writeFileSync(join(outDir, "summary.txt"), summary);
    process.stdout.write(summary);
    return exit;
  } finally {
    await browser.close().catch(() => {});
  }
}

function csvCell(v) { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

// ───────────────────────── entry ─────────────────────────
{
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(String(e.message || e)); console.error(usage()); process.exit(EXIT.INCONCLUSIVE); }
  if (o.help) { console.log(usage()); process.exit(EXIT.PASS); }
  else if (o.selftest) process.exit(selftest());
  else measure(o).then((code) => process.exit(code), (e) => { console.error(`🟡 測れませんでした: ${String(e.stack || e)}`); process.exit(EXIT.INCONCLUSIVE); });
}
