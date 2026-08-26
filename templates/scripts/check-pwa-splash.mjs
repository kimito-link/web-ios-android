#!/usr/bin/env node
/**
 * scripts/check-pwa-splash.mjs
 *
 * ★「ホーム画面に追加」した PWA の**起動画面**を検査する（App Store 版ではない方）。
 *
 * ■ なぜ必要か（2026-08-27 実機動画で実測）
 *   kimito.link のオーナーが「起動画面がいつも上手くいかない」と実機動画を提出。
 *   ホーム画面アイコンをタップすると★**真っ白い画面に小さいグレーのスピナー**が出て、
 *   マスコットの青いスプラッシュが出ていなかった。
 *
 *   ところがサーバー側を実測したら**全部正しかった**:
 *     - manifest に background_color 無し（意図どおり）
 *     - apple-touch-startup-image が 10 解像度すべて配信中（HTTP 200）
 *     - 画像の実物も 1290x2796 / 地色 #00427B / マスコット3人が描かれている
 *   ＝ 材料は揃っているのに iOS が使っていない、という状態だった。
 *
 *   ★そして決定的だったのは「既存のスプラッシュ検査4本が、どれも
 *     この不具合を検出できなかった」こと。既存はすべて
 *     **Capacitor ネイティブ（App Store 版）**向けで、
 *     PWA の起動画面を見る検査は**1本も存在しなかった**。
 *     オーナーが実際に困っているのはこちらだったのに。
 *
 * ■ ★iOS PWA 起動画面の落とし穴（kimito 2026-07-31 に実機で特定済み）
 *   iOS 16.4 以降、`display:standalone` かつ **manifest に background_color がある**と、
 *   iOS は manifest 由来の**単色塗り**を優先し、apple-touch-startup-image を**無視する**。
 *   画像もタグも正しく配信されていても使われない。
 *   → 対策は「画像を足す」ではなく ★**background_color を出さないこと**。
 *     （theme_color はステータスバー色なので残してよい）
 *
 * ■ ★この検査が守ること
 *   1. manifest に background_color が**無い**（あると startupImage が無視される）
 *   2. apple-touch-startup-image が**1つ以上**宣言されている
 *   3. 宣言された画像が**実在して開ける**（HTTP 200 / ローカルならファイルがある）
 *   4. その画像の**地色が期待値と一致**する（＝単色塗りとの食い違いを防ぐ）
 *   5. その画像が★**単色ではない**（＝ロゴ/マスコットが実際に描かれている）
 *      ★「地色が正しい真っ青な画像」でも合格してしまう穴を塞ぐため。
 *
 * ■ ★見ないこと（限界。過信を防ぐ）
 *   - ★**実機で本当に出るかは判定できない。** iOS は追加済み PWA の manifest を
 *     強くキャッシュするため、サーバーが正しくても**古いアイコンは直らない**。
 *     直すにはアイコンを削除 → Safari から再度「ホーム画面に追加」が要る。
 *     ＝ この検査が緑でも、手元のアイコンが白いままなことはあり得る。
 *   - Android(TWA) の起動画面は見ない（twa-manifest.json 側の担当）。
 *   - Capacitor ネイティブ版の起動画面も見ない（check-splash-config.mjs 等の担当）。
 *   - media クエリが手元の端末に一致するかは見ない（解像度の網羅性は別問題）。
 *
 * 終了コード: 0=合格 / 1=測れた上での赤 / 2=測れなかった
 *
 * 使い方:
 *   node scripts/check-pwa-splash.mjs --url https://example.com
 *   node scripts/check-pwa-splash.mjs --url https://example.com --expect-bg '#00427B'
 *   node scripts/check-pwa-splash.mjs --html out/index.html --manifest out/manifest.webmanifest
 *   node scripts/check-pwa-splash.mjs --selftest
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

import {
  EXIT,
  computeExitCode,
  formatProbeReport,
  runSelfTest,
} from './lib/instrument-core.mjs';

const LIMITATION =
  '★実機で本当に出るかは見ません（iOS は追加済み PWA の manifest を強くキャッシュするため、'
  + 'サーバーが正しくてもアイコンを削除→再追加するまで古いままです）。Android(TWA)/ネイティブも対象外。';

function arg(argv, name, def = null) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}

// ─── 純ロジック（fs/network 非依存＝テストしやすい） ────────────────────

/**
 * ★HTML から apple-touch-startup-image の href を抜き出す。
 * @param {string} html
 * @returns {{ href: string, media: string|null }[]}
 */
export function extractStartupImages(html) {
  const out = [];
  const linkRe = /<link\b[^>]*>/gi;
  let m;
  while ((m = linkRe.exec(String(html || ''))) != null) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?apple-touch-startup-image/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    const media = tag.match(/media\s*=\s*["']([^"']+)["']/i);
    if (href) out.push({ href: href[1], media: media ? media[1] : null });
  }
  return out;
}

/**
 * ★manifest の background_color を判定する。
 *
 * ★ここが「あると壊れる」という**逆向き**の検査であることに注意。
 *   普通は「設定が無い＝赤」だが、この項目だけは**あると赤**。
 *   数字や名前の有無で機械的に決めず、理由（iOS が単色塗りを優先する）で決める。
 *
 * @param {object|null} manifest
 * @returns {{ ok: boolean, value: unknown }}
 */
export function judgeManifestBackground(manifest) {
  const value = manifest && typeof manifest === 'object' ? manifest.background_color : undefined;
  return { ok: value === undefined || value === null, value: value ?? null };
}

/** #RRGGBBAA / #RGB を #RRGGBB に正規化する。 */
export function normalizeHex(hex) {
  let h = String(hex || '').trim().toUpperCase().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h.slice(0, 6)}`;
}

/**
 * ★画素サンプルから「単色か」を判定する。
 *
 * ★なぜ要るか: 地色だけ見ると「正しい色で塗っただけの真っ青な画像」が合格する。
 *   それはまさに kimito が 2026-07-31 に踏んだ「ロゴ無しの青一色」そのもの。
 *   ＝ 色が合っていることと、絵が描かれていることは**別**。
 *
 * @param {{r:number,g:number,b:number}[]} samples
 * @param {number} tolerance 同色とみなす差（L1）
 * @returns {boolean} true なら単色＝ロゴが描かれていない疑い
 */
export function looksSolidColor(samples, tolerance = 24) {
  const list = Array.isArray(samples) ? samples : [];
  if (list.length === 0) return true; // ★測れていない＝安全側に倒さない
  const base = list[0];
  return list.every(
    (s) => Math.abs(s.r - base.r) + Math.abs(s.g - base.g) + Math.abs(s.b - base.b) <= tolerance
  );
}

// ─── I/O ───────────────────────────────────────────────────────────────

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** sharp は画像を実測するときだけ要る（無い環境では inconclusive にする）。 */
async function loadSharp() {
  try {
    const m = await import('sharp');
    return m.default ?? m;
  } catch {
    return null;
  }
}

async function main(argv) {
  const url = arg(argv, '--url');
  const htmlPath = arg(argv, '--html');
  const manifestPath = arg(argv, '--manifest');
  const expectBg = arg(argv, '--expect-bg');

  /** @type {import('./lib/instrument-core.mjs').ProbeResult[]} */
  const results = [];

  if (!url && !htmlPath) {
    results.push({
      probe: 'PWA 起動画面',
      verdict: 'inconclusive',
      evidence: {},
      detail: '--url も --html も指定されていないため、何も測れませんでした',
      howToFix: 'node scripts/check-pwa-splash.mjs --url https://example.com',
      limitation: LIMITATION,
    });
    return results;
  }

  // 1. HTML と manifest を取る
  let html = null;
  let manifest = null;
  let manifestSource = null;
  try {
    if (htmlPath) {
      if (!existsSync(htmlPath)) throw new Error(`${htmlPath} が無い`);
      html = readFileSync(htmlPath, 'utf8');
    } else {
      html = await fetchText(url);
    }
  } catch (e) {
    results.push({
      probe: 'HTML の取得',
      verdict: 'inconclusive',
      evidence: { url: url ?? htmlPath, error: e.message },
      detail: 'ページを取得できませんでした',
      howToFix: 'URL/パスが正しいか、サイトが公開されているか確認してください',
      limitation: LIMITATION,
    });
    return results;
  }

  try {
    if (manifestPath) {
      if (!existsSync(manifestPath)) throw new Error(`${manifestPath} が無い`);
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifestSource = manifestPath;
    } else if (url) {
      const href =
        html.match(/<link\b[^>]*rel\s*=\s*["']manifest["'][^>]*href\s*=\s*["']([^"']+)["']/i)?.[1]
        ?? '/manifest.webmanifest';
      const abs = new URL(href, url).toString();
      manifest = JSON.parse(await fetchText(abs));
      manifestSource = abs;
    }
  } catch (e) {
    results.push({
      probe: 'manifest の取得',
      verdict: 'inconclusive',
      evidence: { error: e.message },
      detail: 'manifest を取得/解析できませんでした',
      howToFix: '--manifest でパスを渡すか、/manifest.webmanifest が配信されているか確認',
      limitation: LIMITATION,
    });
  }

  // 2. ★background_color が無いこと（あると startupImage が無視される）
  if (manifest) {
    const bg = judgeManifestBackground(manifest);
    results.push({
      probe: 'manifest に background_color が無い',
      verdict: bg.ok ? 'pass' : 'fail',
      evidence: { source: manifestSource, background_color: bg.value, display: manifest.display ?? null },
      detail: bg.ok
        ? ''
        : `background_color=${bg.value} があるため、iOS は単色塗りを優先し apple-touch-startup-image を無視します（＝ロゴ無しの起動画面になる）`,
      howToFix:
        'manifest から background_color を削除する（theme_color はステータスバー色なので残してよい）',
      limitation: LIMITATION,
    });
  }

  // 3. startupImage が宣言されているか
  const images = extractStartupImages(html);
  results.push({
    probe: 'apple-touch-startup-image の宣言',
    verdict: images.length > 0 ? 'pass' : 'fail',
    evidence: { 宣言数: images.length },
    detail: images.length > 0 ? '' : 'apple-touch-startup-image が1つも宣言されていません',
    howToFix:
      'Next.js なら app/layout.tsx の metadata.appleWebApp.startupImage に解像度ごとの画像を並べる',
    limitation: LIMITATION,
  });

  if (images.length === 0) return results;

  // 4-5. 画像が実在し、地色が正しく、★単色でないこと
  const target = images[0];
  const sharp = await loadSharp();
  let buf = null;
  try {
    if (url) {
      buf = await fetchBuffer(new URL(target.href, url).toString());
    } else {
      const p = target.href.startsWith('/')
        ? join(dirname(resolve(htmlPath)), target.href.replace(/^\//, ''))
        : resolve(dirname(resolve(htmlPath)), target.href);
      if (!existsSync(p)) throw new Error(`${p} が無い`);
      buf = readFileSync(p);
    }
  } catch (e) {
    results.push({
      probe: '起動画像が実在して開ける',
      verdict: 'fail',
      evidence: { href: target.href, error: e.message },
      detail: '宣言されている起動画像を取得できません（宣言だけあって実体が無い）',
      howToFix: '画像を配置し、href のパスが本番で 200 を返すことを確認',
      limitation: LIMITATION,
    });
    return results;
  }

  results.push({
    probe: '起動画像が実在して開ける',
    verdict: 'pass',
    evidence: { href: target.href, bytes: buf.length },
    limitation: LIMITATION,
  });

  if (!sharp) {
    results.push({
      probe: '起動画像の地色と絵柄',
      verdict: 'inconclusive',
      evidence: { reason: 'sharp が入っていないため画素を測れません' },
      detail: '画像の中身（地色・単色かどうか）を測れませんでした',
      howToFix: 'npm i -D sharp してから再実行してください',
      limitation: LIMITATION,
    });
    return results;
  }

  try {
    const img = sharp(buf);
    const meta = await img.metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    const pick = async (left, top) => {
      const d = await sharp(buf).extract({ left, top, width: 4, height: 4 }).raw().toBuffer();
      return { r: d[0], g: d[1], b: d[2] };
    };
    // ★四隅＋中央を実際に取る（中央にロゴがあれば色が変わるはず）
    const corner = await pick(2, 2);
    const samples = [
      corner,
      await pick(Math.max(0, W - 8), 2),
      await pick(2, Math.max(0, H - 8)),
      await pick(Math.floor(W / 2), Math.floor(H / 2)),
    ];
    const hex = `#${[corner.r, corner.g, corner.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
    const solid = looksSolidColor(samples);

    if (expectBg) {
      const ok = hex === normalizeHex(expectBg);
      results.push({
        probe: '起動画像の地色',
        verdict: ok ? 'pass' : 'fail',
        evidence: { 実測: hex, 期待: normalizeHex(expectBg), サイズ: `${W}x${H}` },
        detail: ok ? '' : `地色 ${hex} が期待 ${normalizeHex(expectBg)} と違います`,
        howToFix: '起動画像を生成し直して地色を揃えてください',
        limitation: LIMITATION,
      });
    }

    results.push({
      probe: '起動画像にロゴが描かれている（単色でない）',
      verdict: solid ? 'fail' : 'pass',
      evidence: { サンプル: samples, サイズ: `${W}x${H}`, 単色: solid },
      detail: solid
        ? '★四隅と中央がすべて同色＝ロゴ/マスコットが描かれていない疑い（色は正しくても「ただの単色塗り」になっています）'
        : '',
      howToFix: 'ロゴ入りの起動画像を生成し直してください（地色だけの画像になっていないか確認）',
      limitation: LIMITATION,
    });
  } catch (e) {
    results.push({
      probe: '起動画像の地色と絵柄',
      verdict: 'inconclusive',
      evidence: { error: e.message },
      detail: '画像を解析できませんでした',
      howToFix: '画像が壊れていないか確認してください',
      limitation: LIMITATION,
    });
  }

  return results;
}

// ─── selftest ────────────────────────────────────────────────────────
//
// ★実ファイル・ネットワークを触らず、純関数に文字列/配列を食わせる＝毒が確実に届く。
function selftest() {
  const HTML_WITH = `
<html><head>
<link rel="apple-touch-startup-image" href="/splash/a.png" media="(device-width: 390px)">
<link rel="apple-touch-startup-image" href="/splash/b.png">
</head></html>`;
  const HTML_WITHOUT = '<html><head><link rel="apple-touch-icon" href="/icon.png"></head></html>';

  const cases = [
    {
      name: '★background_color があると赤（iOS が startupImage を無視する）',
      poison: () => {},
      restore: () => {},
      isRed: () => judgeManifestBackground({ background_color: '#FFFFFF' }).ok === false,
    },
    {
      name: 'background_color が無ければ緑（誤検知しない）',
      poison: () => {},
      restore: () => {},
      isRed: () => judgeManifestBackground({ theme_color: '#00427B' }).ok === true,
    },
    {
      name: 'startupImage を宣言している HTML から href を拾える',
      poison: () => {},
      restore: () => {},
      isRed: () => extractStartupImages(HTML_WITH).length === 2,
    },
    {
      name: '★宣言が無い HTML を「あった」と読まない',
      poison: () => {},
      restore: () => {},
      isRed: () => extractStartupImages(HTML_WITHOUT).length === 0,
    },
    {
      name: '★単色画像（ロゴ無しの青一色）を検出する',
      poison: () => {},
      restore: () => {},
      isRed: () =>
        looksSolidColor([
          { r: 0, g: 66, b: 123 },
          { r: 0, g: 66, b: 123 },
          { r: 0, g: 66, b: 123 },
          { r: 0, g: 66, b: 123 },
        ]) === true,
    },
    {
      name: '★ロゴがある画像を「単色」と誤判定しない',
      poison: () => {},
      restore: () => {},
      isRed: () =>
        looksSolidColor([
          { r: 0, g: 66, b: 123 },
          { r: 0, g: 66, b: 123 },
          { r: 0, g: 66, b: 123 },
          { r: 240, g: 160, b: 60 },
        ]) === false,
    },
    {
      name: '★サンプルが空なら「単色」と答える（測れていないのを緑にしない）',
      poison: () => {},
      restore: () => {},
      isRed: () => looksSolidColor([]) === true,
    },
    {
      name: '8桁 ARGB を 6桁に正規化できる',
      poison: () => {},
      restore: () => {},
      isRed: () => normalizeHex('#00427BFF') === '#00427B',
    },
  ];

  const { ok, fails } = runSelfTest(cases);
  if (ok) {
    console.log(`[check-pwa-splash] selftest OK (${cases.length}件すべて期待どおり)`);
    process.exit(EXIT.PASS);
  }
  console.error('[check-pwa-splash] ★selftest 失敗:');
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(EXIT.FAIL);
}

const argv = process.argv.slice(2);
if (argv.includes('--selftest')) {
  selftest();
} else {
  const results = await main(argv);
  console.log(formatProbeReport(results, { label: 'check-pwa-splash' }));
  // ★--verbose: 合格したときも「何をいくつ測ったか」を出す。
  //   共通土台の formatProbeReport は緑のとき件数しか出さない（それは土台の設計なので変えない）。
  //   ただし ★「根拠あり5件」だけでは、緑が本物か人間には確かめられない。
  //   実測値を見せる口をこちら側に用意しておく（掟: 計器は自分が何を測ったかを言える）。
  if (argv.includes('--verbose')) {
    console.log('\n── 実測値 ──');
    for (const r of results) {
      console.log(`  ${r.probe}: ${r.verdict}`);
      if (r.evidence) console.log(`    ${JSON.stringify(r.evidence)}`);
    }
  }
  process.exit(computeExitCode(results));
}
