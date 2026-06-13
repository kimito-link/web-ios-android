/**
 * プライバシーポリシーページ生成スクリプト
 *
 * app.config.json を読み込み、src/privacy/index.html を生成する。
 * 生成される HTML は src/about/index.html と同じスタイル・レイアウトに従う。
 *
 * CLI:
 *   node scripts/generate-privacy-page.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAppConfig, getProjectRoot } from './lib/app-config.mjs';

const ROOT = getProjectRoot();

function buildHtml(cfg) {
  const displayName   = cfg.identity.displayName;
  const email         = cfg.contact.email;
  const marketingUrl  = cfg.contact.marketingUrl;
  const privacyUrl    = cfg.contact.privacyUrl;
  const targetAgeMin  = 18; // default
  const hasInAppPurchase = cfg.businessModel.hasInAppPurchase ?? false;
  const hasSubscription  = cfg.businessModel.hasSubscription  ?? false;

  // Determine current year/month for last-updated line
  const now = new Date();
  const lastUpdated = `${now.getFullYear()}年${now.getMonth() + 1}月`;

  const purchaseSection = (hasInAppPurchase || hasSubscription)
    ? `
                <section class="article__section">
                    <h2 class="article__h2">💳 アプリ内課金・サブスクリプション</h2>
                    <p>本アプリは${hasSubscription ? 'サブスクリプション' : ''}${hasInAppPurchase && hasSubscription ? 'および' : ''}${hasInAppPurchase ? 'アプリ内課金' : ''}を提供しています。決済はお使いのプラットフォーム（App Store / Google Play）を通じて行われ、${displayName}は決済情報を収集・保存しません。</p>
                </section>`
    : `
                <section class="article__section">
                    <h2 class="article__h2">💳 課金・サブスクリプション</h2>
                    <p>本アプリは完全無料です。アプリ内課金およびサブスクリプションはありません。</p>
                </section>`;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
    <!-- ye:favicon:start -->
    <link rel="icon" type="image/x-icon" href="../icons/favicon.ico">
    <link rel="icon" type="image/png" sizes="16x16" href="../icons/favicon-16.png">
    <link rel="icon" type="image/png" sizes="32x32" href="../icons/favicon-32.png">
    <link rel="icon" type="image/png" sizes="48x48" href="../icons/favicon-48.png">
    <link rel="apple-touch-icon" href="../icons/apple-touch-icon.png">
    <link rel="manifest" href="../manifest.webmanifest">
    <meta name="theme-color" content="#c9899a">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="apple-mobile-web-app-title" content="ゆっくりエクソ">
    <meta property="og:image" content="../icons/og-image.jpg">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:image" content="../icons/og-image.jpg">
    <!-- ye:favicon:end -->
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>プライバシーポリシー | ${displayName}</title>
    <meta name="description" content="${displayName}のプライバシーポリシー。本アプリは個人情報を収集せず、すべてのデータは端末内にのみ保存されます。">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="../css/style.css">
</head>
<body data-depth="1">
    <div data-header></div>

    <nav class="breadcrumb">
        <a href="../">ホーム</a>
        <span class="breadcrumb__sep">/</span>
        <span>プライバシーポリシー</span>
    </nav>

    <main>
        <article class="article">
            <div class="container container--narrow">
                <header class="article__header">
                    <h1 class="article__title">プライバシーポリシー</h1>
                </header>

                <section class="article__section">
                    <h2 class="article__h2">🛡️ 基本方針（データ収集なし）</h2>
                    <p>${displayName}（以下「本アプリ」）は、ユーザーのプライバシーを最優先に設計されています。本アプリは個人情報を収集せず、外部サーバーへのデータ送信も行いません。</p>
                    <p>記録した内容はすべてお使いの端末の中だけに保存されます。開発者を含む第三者が閲覧・取得することは一切できません。</p>
                </section>

                <section class="article__section">
                    <h2 class="article__h2">📋 収集する情報</h2>
                    <p>本アプリは以下の情報を<strong>収集しません</strong>。</p>
                    <ul>
                        <li>氏名・メールアドレス・電話番号などの個人情報</li>
                        <li>位置情報（GPS・Wi-Fi・Bluetooth による位置）</li>
                        <li>広告 ID（IDFA / GAID）</li>
                        <li>端末の連絡先・カメラ・マイク・写真ライブラリ</li>
                        <li>クラッシュレポートや分析データの外部送信</li>
                    </ul>
                    <p>アプリ内でユーザーが入力するセルフケア記録・メモなどは、端末内にのみ保存され、外部へは一切送信されません。</p>
                </section>

                <section class="article__section">
                    <h2 class="article__h2">💾 データの保存場所</h2>
                    <p>本アプリが扱うすべてのデータは、<strong>端末内のローカルストレージ</strong>にのみ保存されます。</p>
                    <ul>
                        <li>クラウド同期は行いません</li>
                        <li>外部データベース・サーバーへの接続はありません</li>
                        <li>アプリをアンインストールするとデータはすべて削除されます</li>
                    </ul>
                </section>

                <section class="article__section">
                    <h2 class="article__h2">🤝 第三者への提供</h2>
                    <p>本アプリは、ユーザーのデータを第三者へ提供・販売・共有することは<strong>一切ありません</strong>。</p>
                    <p>提供するデータが存在しないため、第三者提供の同意取得も不要です。</p>
                </section>

                <section class="article__section">
                    <h2 class="article__h2">📢 広告</h2>
                    <p>本アプリは広告を表示しません。広告ネットワーク・アナリティクス SDK の組み込みもありません。</p>
                </section>

                <section class="article__section">
                    <h2 class="article__h2">👤 アカウント</h2>
                    <p>本アプリはアカウント登録が<strong>不要</strong>です。ユーザー登録・ログインなしですべての機能をご利用いただけます。</p>
                    <p>アカウントが存在しないため、データの削除依頼などの手続きも不要です。アプリをアンインストールするだけで、すべての記録が端末から完全に削除されます。</p>
                </section>
${purchaseSection}
                <section class="article__section">
                    <h2 class="article__h2">👶 子どものプライバシー</h2>
                    <p>本アプリは<strong>${targetAgeMin}歳以上</strong>の方を対象としています。${targetAgeMin}歳未満の方のご利用は想定しておりません。</p>
                    <p>本アプリは個人情報を収集しないため、年齢を問わずデータが外部に送信されることはありません。</p>
                </section>

                <section class="article__section">
                    <h2 class="article__h2">🔄 本ポリシーの変更</h2>
                    <p>本プライバシーポリシーは、法令の改正・アプリのアップデート等に伴い予告なく変更される場合があります。変更後のポリシーは本ページに掲載した時点で効力を生じます。</p>
                    <p>重要な変更がある場合は、アプリのリリースノートまたは本ページにて告知します。</p>
                    <p>最新のポリシーは常に <a href="${privacyUrl}" target="_blank" rel="noopener">${privacyUrl}</a> でご確認ください。</p>
                </section>

                <section class="article__section">
                    <h2 class="article__h2">📧 お問い合わせ</h2>
                    <p>本プライバシーポリシーに関するご質問・ご意見は、下記の窓口よりお問い合わせください。</p>
                    <ul>
                        <li>メール：<a href="mailto:${email}">${email}</a></li>
                        <li>ウェブサイト：<a href="${marketingUrl}" target="_blank" rel="noopener">${marketingUrl}</a></li>
                    </ul>
                </section>

                <div class="article__source">
                    最終更新：${lastUpdated}<br>
                    本ページの内容は予告なく変更されることがあります。
                </div>
            </div>
        </article>
    </main>

    <div data-footer></div>

    <script src="../js/common.js"></script>
</body>
</html>
`;
}

// Main
const cfg = loadAppConfig();
const html = buildHtml(cfg);

const outDir  = path.join(ROOT, 'src', 'privacy');
const outFile = path.join(outDir, 'index.html');

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, html, 'utf8');

console.log('Generated: src/privacy/index.html');
