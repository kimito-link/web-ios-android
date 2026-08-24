(() => {
  const slots = document.querySelectorAll('[data-shindan-version-summary]');
  if (!slots.length) return;
  if (!document.getElementById('shindan-version-summary-style')) {
    const style = document.createElement('style');
    style.id = 'shindan-version-summary-style';
    style.textContent = '.sv-summary{margin:0 auto 28px;padding:22px;border:1px solid #e2e5ec;border-radius:20px;background:#fff;box-shadow:0 8px 30px #1a1a2e0d}.sv-summary__top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.sv-summary__eyebrow{font-size:.74rem;font-weight:900;color:#667eea}.sv-summary h2{margin:4px 0 6px;font-size:1.25rem;color:#1a1a2e}.sv-summary__sub{font-size:.86rem;color:#5f6475}.sv-summary__score{font-size:1.8rem;font-weight:900;color:#4058c9;white-space:nowrap}.sv-summary__bar{height:8px;background:#e4e8f0;border-radius:99px;overflow:hidden;margin:16px 0}.sv-summary__bar i{display:block;height:100%;background:linear-gradient(90deg,#667eea,#11a36a);border-radius:inherit}.sv-summary__chips{display:flex;flex-wrap:wrap;gap:7px}.sv-summary__chips span{font-size:.74rem;font-weight:800;padding:5px 9px;border-radius:999px;background:#f1f2f6;color:#505a6b}.sv-summary__latest{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:14px 0 0;padding:0;list-style:none}.sv-summary__latest li{display:flex;justify-content:space-between;gap:8px;padding:9px 10px;background:#f7f7fb;border-radius:10px;font-size:.78rem}.sv-summary__foot{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:16px;font-size:.78rem;color:#5f6475}.sv-summary__foot a{display:inline-block;padding:8px 12px;border-radius:999px;background:#667eea;color:#fff;font-weight:900;text-decoration:none}@media(max-width:640px){.sv-summary__top,.sv-summary__foot{display:grid}.sv-summary__latest{grid-template-columns:1fr}.sv-summary__score{font-size:1.45rem}}';
    document.head.appendChild(style);
  }
  const append = (parent, tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    parent.appendChild(node);
    return node;
  };
  for (const slot of slots) {
    const reportUrl = slot.dataset.reportUrl || '/check-shindan-version/report.json';
    fetch(reportUrl, { credentials: 'same-origin' }).then((response) => {
      if (!response.ok) throw new Error('report ' + response.status);
      return response.json();
    }).then((data) => {
      slot.textContent = '';
      const card = append(slot, 'section', 'sv-summary');
      card.setAttribute('aria-label', 'バージョンアップ情報');
      const top = append(card, 'div', 'sv-summary__top');
      const title = append(top, 'div');
      append(title, 'div', 'sv-summary__eyebrow', 'キットの更新状況');
      append(title, 'h2', '', 'v' + data.app.version + ' の準備状況');
      append(title, 'p', 'sv-summary__sub', '最新版の内容と、公開に必要な準備がどこまで終わったかを表示しています。');
      append(top, 'strong', 'sv-summary__score', data.progress.percent + '%');
      const bar = append(card, 'div', 'sv-summary__bar');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', String(data.progress.percent));
      append(bar, 'i').style.width = data.progress.percent + '%';
      const chips = append(card, 'div', 'sv-summary__chips');
      [['確認済み', data.counts.pass], ['確認中', data.counts.warning], ['まだ未確認', data.counts.unmeasured], ['見つかった問題', data.counts.fail]].forEach(([label, value]) => append(chips, 'span', '', label + ' ' + value));
      const publicLatest = Array.isArray(data.evolution.publicLatest) ? data.evolution.publicLatest : data.evolution.latest;
      if (Array.isArray(publicLatest) && publicLatest.length) {
        const list = append(card, 'ul', 'sv-summary__latest');
        publicLatest.slice(0, 4).forEach((row) => {
          const item = append(list, 'li');
          append(item, 'b', '', 'v' + row.version);
          const friendly = {'selftest を持たない診断キットの検査':'追加確認が必要な動作チェック','selftest を持たない配布スクリプト':'追加確認が必要な自動化処理','診断キットの検査本数':'現在使える動作チェック'};
          append(item, 'span', '', (friendly[row.label] || row.label) + (row.value !== '' ? ' ' + row.value + row.unit : ''));
        });
      }
      const foot = append(card, 'div', 'sv-summary__foot');
      append(foot, 'span', '', '更新 ' + data.generatedAtLabel);
      const link = append(foot, 'a', '', '更新内容と動作チェックを見る →');
      link.href = data.app.diagnosisUrl || '/check-shindan-version/';
      slot.setAttribute('aria-live', 'polite');
    }).catch(() => {
      slot.textContent = '';
      const fallback = append(slot, 'a', '', '更新情報と動作チェックを見る →');
      fallback.href = '/check-shindan-version/';
    });
  }
})();
