/**
 * product-map.mjs — best-trust の台帳(repositories.json)から
 * 「registry product id → ストアID(ascAppId/playPackageName)」を実行時に結合する。
 *
 * 設計: _docs/DESIGN-revenue-bottleneck-dashboard-2026-09-08.md §B-1
 * ★新しいマッピングファイルは作らない。既にある2つの正本(repositories.json と
 * 各リポの app.config.json)を都度読んで結合するだけ。コピーを作るとdriftする。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * repositories.json の localPath 配下から app.config.json を探す。
 * 直下に無ければ1階層下まで見る(設計F5: henshin-hisho/ios-app/ 等のケース)。
 */
function findAppConfig(githubRoot, localPath) {
  if (!localPath) return null;
  const base = join(githubRoot, localPath);
  const direct = join(base, 'app.config.json');
  if (existsSync(direct)) return direct;

  if (!existsSync(base)) return null;
  let entries;
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const nested = join(base, e.name, 'app.config.json');
    if (existsSync(nested)) return nested;
  }
  return null;
}

/**
 * @param {string} githubRoot - github/ 直下の絶対パス
 * @returns {Array<{
 *   id: string, name: string, brand: string|null, url: string,
 *   localPath: string, ascAppId: string|null, playPackageName: string|null
 * }>}
 */
export function loadProductMap(githubRoot) {
  const repoJsonPath = join(githubRoot, 'best-trust', 'data', 'repositories.json');
  if (!existsSync(repoJsonPath)) {
    throw new Error(`repositories.json not found: ${repoJsonPath}`);
  }
  const catalog = JSON.parse(readFileSync(repoJsonPath, 'utf8'));
  const repos = Array.isArray(catalog?.repositories) ? catalog.repositories : [];

  const products = [];
  for (const r of repos) {
    if (r.role !== 'product' || !r.product) continue;
    const appConfigPath = findAppConfig(githubRoot, r.localPath);
    let ascAppId = null;
    let playPackageName = null;
    if (appConfigPath) {
      try {
        const cfg = JSON.parse(readFileSync(appConfigPath, 'utf8'));
        ascAppId = cfg?.stores?.ascAppId || null;
        playPackageName = cfg?.stores?.playPackageName || null;
      } catch {
        // 壊れたapp.config.jsonは無視(verify-app-config-schemaが別途検出する)。
        // ここでは「取得できなかった」扱いにするだけで、収集全体は止めない。
      }
    }
    products.push({
      id: r.product,
      name: r.name,
      brand: r.brand || null,
      url: r.github?.homepage || '',
      localPath: r.localPath || null,
      ascAppId,
      playPackageName,
    });
  }
  return products;
}

export function statLocalPathExists(githubRoot, localPath) {
  if (!localPath) return false;
  try {
    return statSync(join(githubRoot, localPath)).isDirectory();
  } catch {
    return false;
  }
}
