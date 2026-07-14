/* 홈 A/S 카드 재방문 표시 — 로컬 티켓 있으면 "○○님, 진행 중 접수 N건 — 최근 상태" 1줄로 교체.
   렌더 실패·데이터 없음은 무해(카드는 정적으로 항상 표시). textContent 전용. */
(function () {
  'use strict';
  try {
    var profile = JSON.parse(localStorage.getItem('clapaAs.v1.profile') || 'null');
    var tickets = JSON.parse(localStorage.getItem('clapaAs.v1.tickets') || '[]');
    if (!Array.isArray(tickets)) tickets = [];
    var live = tickets.filter(function (t) { return t && !t.closedAt; });
    var sub = document.getElementById('as-card1-sub');
    if (!sub || !live.length) return;
    var name = (profile && profile.name) ? profile.name : '';
    var recent = live[0];
    var line = (name ? name + '님, ' : '') + '진행 중 접수 ' + live.length + '건 — ' + (recent.lastStatus || '접수') + ' · ';
    sub.textContent = '';
    sub.appendChild(document.createTextNode(line));
    var a = document.createElement('a');
    a.href = 'as.html#status'; a.textContent = '내 접수 조회';
    sub.appendChild(a);
  } catch (e) { /* 무해 */ }
})();
