/**
 * 配布テンプレの版と正本の所在。**このファイルだけが版を持つ**。
 *
 * なぜ版を持つか（このリポが生まれた理由そのもの）:
 *   generate-capacitor-splash.mjs が5リポにコピペされ、5つとも中身が違っていた
 *   （ハッシュ・行数とも全部バラバラ／2026-08-24 実測）。テンプレ方式は配りやすい
 *   代わりに「配った後に分岐したことに誰も気づけない」。版を刻んで
 *   check-splash-template-drift.mjs で照合すれば、分岐は**気づける**ようになる。
 *   分岐を防ぐことはできない。気づけるようにするのがここの役目。
 *
 * ★正本は web-ios-android キット（このファイル自身）。
 *   2026-08-24、最初は別リポ `github/splash/` を正本として試作したが、
 *   release CI（ios-appstore-release.yml / android-play-release.yml）が
 *   `scripts/generate-capacitor-splash.mjs` を名指しで呼ぶのはこのキット側であり、
 *   正本を分けると**まさに今回直した「5リポ分岐」と同じ構造を1段上で再現する**。
 *   よってキット側に統合し、`github/splash/` は非正本（試作の記録として残置）に降格した。
 */

/** 配布テンプレの版。テンプレの中身を変えたら必ず上げる。 */
export const SPLASH_TEMPLATE_VERSION = '1.2.0';

/** 正本の所在（各アプリから見た参照先）。 */
export const SPLASH_TEMPLATE_ORIGIN =
  'github/web-ios-android/templates/scripts';

/**
 * 各アプリにコピーされるファイルと、その役割。
 *
 * ★check-splash-template-drift.mjs は**配る対象には含める**（各アプリが
 *   コピー後に使う）が、キット自身に対して走らせても意味がない
 *   （このキットが正本そのものなので、常に差分ゼロにしかならない）。
 */
export const SPLASH_TEMPLATE_FILES = Object.freeze([
  'lib/instrument-core.mjs',
  'lib/splash-manifest.mjs',
  'check-splash-config.mjs',
  'check-splash-safe-circle.mjs',
  'check-splash-template-drift.mjs',
  'verify-ios-splash-not-default.mjs',
  'verify-android-splash-not-default.mjs',
]);
