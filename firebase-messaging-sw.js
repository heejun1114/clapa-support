/* =========================================================================
   CLAPA A/S 웹 푸시 서비스 워커 (firebase-messaging-sw.js)
   - 등록 시 ?config=<encodeURIComponent(JSON)> 쿼리로 Firebase 구성을 받는다
   - 알림 클릭 → data.url(기본 as-status.html) 딥링크
   ========================================================================= */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

(function () {
  var cfg = null;
  try {
    var m = /[?&]config=([^&]+)/.exec(self.location.search);
    if (m) cfg = JSON.parse(decodeURIComponent(m[1]));
  } catch (e) { cfg = null; }
  if (!cfg || !cfg.projectId) return;
  firebase.initializeApp(cfg);
  var messaging = firebase.messaging();
  messaging.onBackgroundMessage(function (payload) {
    var n = (payload && payload.notification) || {};
    var d = (payload && payload.data) || {};
    var title = n.title || d.title || 'CLAPA A/S 안내';
    var body = n.body || d.body || '';
    var url = d.url || './as-status.html';
    return self.registration.showNotification(title, { body: body, data: { url: url } });
  });
})();

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || './as-status.html';
  e.waitUntil(clients.openWindow(url));
});
