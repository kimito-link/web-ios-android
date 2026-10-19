// 役割: トップページに「いまの AI 運用の状況」を小さく出す(使用量のゲージ・使える頭脳の数・いま最初に使われる頭脳)。
// なぜ要るか: 詳しいダッシュボード(/hub/usage/)はあるが、トップページから辿れず「情報がまったく無いように見える」状態だった(2026-10-19 本人の指摘)。
//   入口と要点だけをここに置き、くわしくは /hub/usage/ へ送る。
// 使い方: index.html に <div id="ops-status"></div> を置き、このスクリプトを読み込む。データは専用ブランチ usage-data の
//   usage.json / brains.json(公開。割合・残量・状態だけで、鍵や会話は載せない)。読めなければ、欄ごと出さない(壊れた表示を見せない)。
(function () {
  var mount = document.getElementById('ops-status');
  if (!mount) return;
  var BASE = 'https://raw.githubusercontent.com/kimito-link/web-ios-android/usage-data/';
  var css =
    '.ops-card{max-width:680px;margin:0 auto 28px;background:#fff;border-radius:16px;box-shadow:0 2px 16px rgba(0,0,0,.07);padding:18px 22px;color:#14213d;font-family:inherit}' +
    '.ops-card h3{margin:0 0 4px;font-size:17px}.ops-sub{color:#5b6b86;font-size:12px;margin-bottom:12px}' +
    '.ops-row{display:flex;gap:16px;flex-wrap:wrap}.ops-g{flex:1 1 180px}' +
    '.ops-gl{display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px}.ops-gl b{font-weight:700}' +
    '.ops-bar{position:relative;height:12px;background:#e8edf6;border-radius:6px}.ops-fill{height:100%;border-radius:6px;background:#1f9d6b}' +
    '.ops-fill.watch{background:#d98a00}.ops-fill.danger{background:#d6455d}' +
    '.ops-pace{position:absolute;top:-4px;bottom:-4px;width:3px;background:#14213d;border-radius:2px}' +
    '.ops-chip{display:inline-block;font-size:11px;font-weight:700;color:#fff;border-radius:999px;padding:1px 8px;margin-left:6px;background:#1f9d6b}' +
    '.ops-chip.watch{background:#d98a00}.ops-chip.danger{background:#d6455d}' +
    '.ops-note{font-size:13px;margin-top:12px;color:#14213d}.ops-more{display:inline-block;margin-top:10px;font-size:13px;font-weight:700}';
  function get(name) {
    return fetch(BASE + name + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  Promise.all([get('usage.json'), get('brains.json'), import('/hub/usage/usage-history.mjs')]).then(function (res) {
    var usage = res[0], brains = res[1], lib = res[2];
    if (!usage || !usage.current || !usage.current.windows) return;
    var now = Date.now(), w = usage.current.windows;
    var TXT = { safe: '余裕あり', watch: '注意', danger: '危険' };
    function gauge(key, label) {
      var win = w[key];
      if (!win) return '';
      var st = lib.statusOf(win, lib.WINDOW_MS[key], now);
      if (st === 'unknown') st = 'safe';
      var el = Math.max(0, Math.min(100, lib.paceOf(win, lib.WINDOW_MS[key], now).elapsedPct));
      var used = Math.max(0, Math.min(100, win.percentUsed));
      return '<div class="ops-g"><div class="ops-gl"><span>' + label + '</span><b>' + used + '% 使用済み<span class="ops-chip ' + st + '">' + (TXT[st] || '') + '</span></b></div>' +
        '<div class="ops-bar"><div class="ops-fill ' + st + '" style="width:' + used + '%"></div><div class="ops-pace" style="left:calc(' + el + '% - 1px)"></div></div></div>';
    }
    var note = '';
    if (brains && brains.brains) {
      var ok = brains.brains.filter(function (b) { return b.status === 'ok'; }).length;
      note = '使える頭脳（無料API・ローカルLLM）: <b>' + ok + ' / ' + brains.brains.length + '</b>　／　いま最初に使われる頭脳: <b>' + (brains.nextLabels && brains.nextLabels.agent ? brains.nextLabels.agent : 'なし') + '</b>';
    }
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    mount.innerHTML = '<div class="ops-card"><h3>📊 いまの AI 運用の状況（ライブ）</h3>' +
      '<div class="ops-sub">帯＝使った割合、黒い縦線＝時間の経過。帯が線より右だと、時間の割に使いすぎです。</div>' +
      '<div class="ops-row">' + gauge('weekly', '週間（全モデル）') + gauge('five', '5時間の枠') + '</div>' +
      (note ? '<div class="ops-note">' + note + '</div>' : '') +
      '<a class="ops-more" href="/hub/usage/">くわしく見る（回復までの時間・推移・各頭脳の残量） →</a></div>';
  }).catch(function () { /* 読めなければ欄ごと出さない */ });
})();
