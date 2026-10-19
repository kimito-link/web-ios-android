// 役割: 改名したアプリで、旧名称が「宣言した面」に残っていないかを調べる純関数(lint-pre-submission の CHECK 33)。
// なぜ要るか: malwarecheck を「マルウェアチェック.site」→「サイト侵害チェック」へ改名した版で、package.json の説明文・
//   www/index.html の title・store-assets に旧名称が残った(2026-10-18)。改名を検査する仕組みが無く、人が目で探していた。
// 使い方: app.config.json の identity.formerNames に { name, surfaces } を1行足す(改名のたびに台帳が伸びる)。
//   surfaces に書いた面だけを検査する。Web や拡張が旧名のまま意図的に残るアプリ(malwarecheck)は、その面を書かなければ検査されない
//   ＝「この面は旧名のままでよい」は事業判断なので機械は決めない。宣言が無ければ skip。
// 面ごとの対象パスは SURFACE_PATHS(配布先で足りなければここに足す)。fs に触らない。lint 本体が読み込みと出力をする。

export const SURFACE_PATHS = Object.freeze({
  // iOS/Android のストア掲載と、アプリ殻(Capacitor)に出る文言
  ios: [
    'store-assets/appstore/',
    'release-notes/',
    'capacitor.config.ts',
    'capacitor.config.json',
    'apps/mobile/capacitor.config.ts',
    'apps/mobile/package.json',
    'apps/mobile/www/',
  ],
  android: [
    'store-assets/play/',
    'release-notes/',
    'capacitor.config.ts',
    'capacitor.config.json',
    'apps/mobile/capacitor.config.ts',
    'apps/mobile/package.json',
    'apps/mobile/www/',
  ],
  web: ['public/', 'app/', 'src/', 'apps/web/app/', 'apps/web/public/'],
});

export const KNOWN_SURFACES = Object.freeze(Object.keys(SURFACE_PATHS));

const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase();

function lineAt(text, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

// 面に属するパスか(prefix 一致 or ファイル名の完全一致)。
export function pathsForSurfaces(surfaces) {
  const set = new Set();
  for (const s of surfaces) for (const p of SURFACE_PATHS[s] || []) set.add(p);
  return [...set];
}

export function belongsToSurface(relPath, surfacePaths) {
  return surfacePaths.some((p) => (p.endsWith('/') ? relPath.startsWith(p) : relPath === p));
}

// formerNames: [{ name, surfaces: string[] }]
// files: [{ path: 'リポ相対(/区切り)', text }]。displayName: 今の名前(旧名と同じなら台帳の誤り)。
export function checkNoFormerNames({ formerNames, files = [], displayName = '' } = {}) {
  const name = 'no-former-names-on-surface';
  if (formerNames == null) return { status: 'skip', name, detail: 'identity.formerNames が無い(改名していない)' };
  if (!Array.isArray(formerNames)) return { status: 'fail', name, detail: 'identity.formerNames が配列ではない', guideline: '2.3' };

  const problems = [];
  const cleanDisplay = norm(displayName);
  for (const entry of formerNames) {
    const former = String(entry?.name ?? '').trim();
    const surfaces = Array.isArray(entry?.surfaces) ? entry.surfaces : [];
    if (!former) { problems.push('formerNames に name が空の行がある'); continue; }
    if (surfaces.length === 0) { problems.push(`「${former}」に surfaces が無い(どの面で消すか宣言が必要)`); continue; }
    const unknown = surfaces.filter((s) => !KNOWN_SURFACES.includes(s));
    if (unknown.length) { problems.push(`「${former}」の surfaces に未知の面: ${unknown.join(',')}(既知: ${KNOWN_SURFACES.join(',')})`); continue; }
    if (cleanDisplay && norm(former) === cleanDisplay) { problems.push(`「${former}」が今の displayName と同じ(旧名の台帳の誤り)`); continue; }

    const surfacePaths = pathsForSurfaces(surfaces);
    const needle = norm(former);
    const hits = [];
    for (const f of files) {
      const rel = String(f?.path ?? '');
      if (!belongsToSurface(rel, surfacePaths)) continue;
      const text = String(f?.text ?? '');
      const hay = norm(text);
      let from = 0;
      while (true) {
        const i = hay.indexOf(needle, from);
        if (i < 0) break;
        hits.push(`${rel}:${lineAt(text, Math.min(i, text.length))}`);
        from = i + needle.length;
      }
    }
    if (hits.length) {
      problems.push(
        `旧名称「${former}」が ${surfaces.join('/')} の面に残っている: ${hits.slice(0, 8).join(', ')}${hits.length > 8 ? ` ほか${hits.length - 8}件` : ''}`,
      );
    }
  }
  if (problems.length) return { status: 'fail', name, detail: problems.join(' / '), guideline: '2.3' };
  return { status: 'ok', name, detail: `旧名称 ${formerNames.length} 件、宣言した面に残りなし` };
}
