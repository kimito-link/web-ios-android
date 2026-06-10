import type { CapacitorConfig } from '@capacitor/cli';

/**
 * 【金型テンプレート】server.url リモート読込型の Capacitor 設定。
 *
 * これは web-ios-android キットの参照テンプレ。**このファイルを各アプリにコピーし、
 * {{...}} を手で実値に書き換える**(コピペ + 数行置換)。
 *
 * ⚠️ 自動生成はしない。発明会議(golden-pattern-inventions-council)で「app.config.json から
 * capacitor.config を自動生成」案は reject された。理由: config.ts を生成物に格下げすると
 * 黒画面原則2「config.ts を唯一の真実の源に」を侵し、allowNavigation/scheme:https の生成漏れで
 * 黒画面が再発する時限爆弾になる。各アプリの capacitor.config.ts が唯一の真実の源。
 * 手書き数行のためにジェネレータを恒久保守するのは純損(個人運用規模)。
 *
 * 黒画面回避の金型(_docs/CAPACITOR-GOLDEN-RULES.md / fujisan POSTMORTEM)に厳密準拠:
 *   - 独自の VC / UIWindow / AppDelegate 注入は入れない(原則1「作り分けない」)
 *   - App-Bound Domains 許可設定(ios.scheme / limitsNavigationsToAppBoundDomains:false /
 *     server.iosScheme:'https' / allowNavigation)を入れてリモート読込を成立させる
 *   - 起動フラッシュ対策は backgroundColor + patch-ios-launch-dark.mjs の2点だけ(増やさない)
 *
 * 実証アプリ: リバースハック(partnership)/ 富士山 / Exosome。値だけ違い構造は完全同一。
 */
const config: CapacitorConfig = {
  appId: '{{bundleId}}',
  appName: '{{displayName}}',
  webDir: 'www',
  backgroundColor: '{{backgroundColorARGB}}',
  ios: {
    contentInset: 'always',
    scheme: '{{iosScheme}}',
    limitsNavigationsToAppBoundDomains: false,
    backgroundColor: '{{backgroundColorARGB}}',
  },
  android: {
    backgroundColor: '{{backgroundColorARGB}}',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1500,
      launchFadeOutDuration: 300,
      backgroundColor: '{{backgroundColorARGB}}',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
  server: {
    url: 'https://{{productionDomain}}',
    cleartext: false,
    hostname: '{{productionDomain}}',
    androidScheme: 'https',
    iosScheme: 'https',
    allowNavigation: [
      '{{productionDomain}}',
      '*.{{rootDomain}}',
    ],
  },
};

export default config;
