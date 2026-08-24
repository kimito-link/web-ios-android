import { loadShindanVersionReport } from "../lib/shindan-version";

const friendlyMetrics: Record<string, string> = {
  "selftest を持たない診断キットの検査": "追加確認が必要な動作チェック",
  "selftest を持たない配布スクリプト": "追加確認が必要な自動化処理",
  "診断キットの検査本数": "現在使える動作チェック",
};

export async function ShindanVersionSummary() {
  const report = await loadShindanVersionReport();
  const { app, progress, counts, evolution } = report;
  const publicLatest = evolution.publicLatest || evolution.latest;

  return (
    <section className="mt-12 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="version-update-title">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="text-xs font-black text-brand">キットの更新状況</p>
          <h2 id="version-update-title" className="mt-1 text-2xl font-bold text-ink">v{app.version} の準備状況</h2>
          <p className="mt-2 text-sm text-ink-muted">最新版の内容と、公開に必要な準備がどこまで終わったかを表示しています。</p>
        </div>
        <strong className="text-3xl text-brand">{progress.percent}%</strong>
      </div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-label={`診断・進化の進捗 ${progress.percent}%`}>
        <i className="block h-full rounded-full bg-brand" style={{ width: `${progress.percent}%` }} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-ink-muted">
        <span className="rounded-full bg-slate-100 px-3 py-1">確認済み {counts.pass}</span>
        <span className="rounded-full bg-amber-50 px-3 py-1">確認中 {counts.warning}</span>
        <span className="rounded-full bg-amber-50 px-3 py-1">まだ未確認 {counts.unmeasured}</span>
        <span className="rounded-full bg-rose-50 px-3 py-1">見つかった問題 {counts.fail}</span>
      </div>
      {publicLatest.length > 0 ? (
        <ul className="mt-5 grid gap-2 sm:grid-cols-2">
          {publicLatest.slice(0, 4).map((row, index) => (
            <li className="flex justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm" key={`${row.version}-${row.label}-${index}`}>
              <b>v{row.version}</b><span>{friendlyMetrics[row.label] || row.label}{row.value !== "" ? ` ${row.value}${row.unit}` : ""}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-muted">
        <span>更新 {report.generatedAtLabel}</span>
        <a className="rounded-full bg-brand px-4 py-2 font-black text-white" href="/check-shindan-version/">更新内容と動作チェックを見る →</a>
      </div>
    </section>
  );
}
