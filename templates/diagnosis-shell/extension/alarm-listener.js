// 拡張のサービスワーカーへコピーする、端末内の再確認アラーム。
// なぜ要るか: 拡張を閉じたあとでも、指定した日に端末の通知を出せるようにする。
// サーバーへは送らない。案内の入力欄はここには無い。アイコンのパスは拡張自身の既存アイコンに合わせる。

const ICON_URL = "icons/icon-128.png";

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm || typeof alarm.name !== "string" || !alarm.name.startsWith("recheck:")) return;
  const domain = alarm.name.split(":")[1] || "";
  chrome.notifications.create(alarm.name, {
    type: "basic",
    iconUrl: ICON_URL,
    title: "再確認の日です",
    message: domain ? `${domain} を再確認` : "ドメインを再確認",
  });
});
