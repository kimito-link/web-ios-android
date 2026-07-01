// 金型トップページ。汎用 UI 部品（components/hero.tsx 等）を差し替えて LP を組む。
// ここは最小の動作確認用。実アプリでは HeroSection / FaqSection などに置き換える。
export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="font-mincho text-4xl font-bold text-ink">
        {"{{displayName}}"}
      </h1>
      <p className="mt-4 text-lg text-ink-muted">{"{{shortDescription}}"}</p>
      <p className="mt-8 text-sm text-ink-muted">
        この雛形は web-ios-android キットの <code>templates/next-app/</code> です。
        <br />
        Clerk 認証を使う場合は <code>README-clerk.md</code> を参照してください。
      </p>
    </main>
  );
}
