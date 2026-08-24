import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { loadShindanVersionReport, type ShindanStatus } from "../../lib/shindan-version";
import styles from "./shindan-version.module.css";

export const metadata: Metadata = {
  title: "更新情報と動作チェック",
  description: "最新版、準備の進み具合、動作確認の結果を分かりやすく表示します。",
};

const labels: Record<ShindanStatus, string> = {
  pass: "確認済み",
  warning: "確認中",
  fail: "問題あり",
  unmeasured: "未確認",
};

const marks: Record<ShindanStatus, string> = {
  pass: "✓",
  warning: "△",
  fail: "!",
  unmeasured: "?",
};

const friendlyMetrics: Record<string, string> = {
  "selftest を持たない診断キットの検査": "追加確認が必要な動作チェック",
  "selftest を持たない配布スクリプト": "追加確認が必要な自動化処理",
  "診断キットの検査本数": "現在使える動作チェック",
};

export default async function CheckShindanVersionPage() {
  const report = await loadShindanVersionReport();
  const { app, progress, counts, stages, evolution } = report;
  const publicLatest = evolution.publicLatest || evolution.latest;
  const displayName = app.name === "web-ios-android" ? "アプリ公開キット" : app.name;
  const ringColor = counts.fail > 0 ? "#b4232f" : progress.percent === 100 ? "#047857" : "#b45309";
  const progressMessage = counts.fail > 0
    ? `確認が必要な項目が ${counts.fail} 件あります。詳しい内容は下で確認できます。`
    : progress.percent === 100
      ? "必要な確認はすべて終わっています。"
      : `あと ${Math.max(0, progress.total - progress.completed)} 項目を確認すると完了です。`;

  return (
    <main
      className={styles.page}
      style={{
        "--diagnosis-brand": app.primaryColor,
        "--diagnosis-accent": app.accentColor,
        "--diagnosis-ring": ringColor,
      } as CSSProperties}
    >
      <header className={styles.siteHeader}>
        <div className={styles.siteHeaderInner}>
          <a className={styles.brand} href={app.homeUrl || "/"}>
            <span className={styles.brandMark}>{displayName.slice(0, 1)}</span>
            <span className={styles.brandCopy}><strong>{displayName}</strong><small>更新情報と動作チェック</small></span>
          </a>
          <a className={styles.homeButton} href={app.homeUrl || "/"}>説明ページへ戻る</a>
        </div>
      </header>

      <div className={styles.wrap}>
        <section className={styles.intro}>
          <h1>更新情報と動作チェック</h1>
          <p>最新版の内容と、公開に必要な準備がどこまで整っているかを確認できます。</p>
        </section>

        <nav className={styles.jumpLinks} aria-label="ページ内メニュー">
          <a href={app.homeUrl || "/"}>製品の説明</a>
          <a href="#updates">最新の更新</a>
          <a href="#status">準備の状況</a>
        </nav>

        <section className={styles.overview} id="status">
          <div className={styles.overviewTop}>
            <div>
              <p className={styles.eyebrow}>現在の準備状況</p>
              <h2>v{app.version} は {progress.percent}% 確認済み</h2>
              <p className={styles.overviewMessage}>{progressMessage}</p>
            </div>
            <div
              className={styles.ring}
              style={{ background: `conic-gradient(var(--diagnosis-ring) ${progress.percent}%, #e5e7eb 0)` }}
              role="img"
              aria-label={`確認の進み具合 ${progress.percent}%`}
            >
              <div><strong>{progress.percent}%</strong><span>{progress.completed} / {progress.total} 確認済み</span></div>
            </div>
          </div>
          <div className={styles.stats} aria-label="確認結果">
            <div><strong>{counts.pass}</strong><span>確認できた項目</span></div>
            <div><strong>{counts.warning}</strong><span>確認中</span></div>
            <div><strong>{counts.unmeasured}</strong><span>まだ未確認</span></div>
            <div><strong>{counts.fail}</strong><span>見つかった問題</span></div>
          </div>
        </section>

        <section className={styles.explain} id="updates" aria-labelledby="user-version-updates">
          <p className={styles.audience}>最新版</p>
          <h2 id="user-version-updates">今回の更新内容</h2>
          <ul className={styles.latest}>
            {publicLatest.length > 0 ? publicLatest.map((row, index) => (
              <li key={`${row.version}-${row.label}-${index}`}>
                <b>v{row.version}</b><span>{friendlyMetrics[row.label] || row.label}{row.value !== "" ? ` ${row.value}${row.unit}` : ""}</span>
              </li>
            )) : <li><span>新しい更新内容は、確認でき次第ここに表示します。</span></li>}
          </ul>
          <p className={styles.note}>この内容は製品の説明ページにも同じ情報が表示されます。</p>
        </section>

        <details className={styles.technical}>
          <summary>詳しい確認内容を見る（開発者向け）</summary>
          <div className={styles.technicalBody}>
            <div className={styles.sectionTitle}>
              <p className={styles.audience}>開発・確認用</p>
              <h2>項目ごとの結果と、次にすること</h2>
            </div>
            <section className={styles.grid}>
              {stages.map((stage) => (
                <article className={`${styles.stage} ${styles[stage.status]}`} key={stage.id}>
                  <div className={styles.stageHead}>
                    <div>
                      <span className={styles.status}>{marks[stage.status]} {labels[stage.status]}</span>
                      <h2>{stage.title}</h2>
                    </div>
                    <strong>{stage.completed}/{stage.total}</strong>
                  </div>
                  <p>{stage.summary}</p>
                  <div
                    className={styles.bar}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={stage.percent}
                    aria-label={`${stage.title} ${stage.percent}%`}
                  ><i style={{ width: `${stage.percent}%` }} /></div>
                  <ul>
                    {stage.checks.map((check) => (
                      <li className={styles[`check_${check.status}`]} key={check.label}>
                        <span>{marks[check.status]}</span>
                        <div>
                          <b>{check.label}</b>
                          <small>{check.evidence}</small>
                          {check.status !== "pass" && check.nextAction ? <em>次: {check.nextAction}</em> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </section>
            <p className={styles.note}>この割合は出来の良し悪しを採点したものではなく、確認が終わった項目の割合です。未確認の項目を、問題なしとして数えることはありません。</p>
            <p className={styles.meta}>version {app.version} / commit {report.commit || "未取得"} / 更新 {report.generatedAtLabel}</p>
          </div>
        </details>
      </div>
    </main>
  );
}
