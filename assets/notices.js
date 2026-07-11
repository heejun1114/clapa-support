/* 클래파 고객지원센터 — 공지사항 렌더러
 * data/notices.json 을 읽어 홈의 #notices 영역에 표시한다.
 * - 공지가 없으면(비활성/기간 외 포함) 영역 자체가 나타나지 않는다.
 * - XSS 차단: 모든 텍스트는 textContent 로만 주입.
 * - 링크는 허용 목록(사이트 내부 상대경로 + 지정 도메인)만 렌더한다.
 * - 편집은 백오피스(클래파 관리자)에서. */
(function () {
  'use strict';

  var MAX_SHOWN = 4;
  var ALLOWED_HOSTS = [
    'clapa.kr', 'www.clapa.kr',
    'smartstore.naver.com', 'brand.naver.com',
    'heejun1114.github.io'
  ];

  function todayKst() {
    // KST(UTC+9) 기준 YYYY-MM-DD
    var now = new Date(Date.now() + 9 * 3600 * 1000);
    return now.toISOString().slice(0, 10);
  }

  function inWindow(n, today) {
    if (n.startsAt && typeof n.startsAt === 'string' && today < n.startsAt) return false;
    if (n.endsAt && typeof n.endsAt === 'string' && today > n.endsAt) return false;
    return true;
  }

  function safeHref(url) {
    if (!url || typeof url !== 'string') return null;
    if (url.indexOf('//') === -1 && url.indexOf(':') === -1) {
      // 상대 경로(내부 링크)
      return url;
    }
    try {
      var u = new URL(url);
      if (u.protocol !== 'https:') return null;
      if (ALLOWED_HOSTS.indexOf(u.hostname) === -1) return null;
      return u.href;
    } catch (e) { return null; }
  }

  function fmtDate(iso) {
    if (!iso || typeof iso !== 'string' || iso.length < 10) return '';
    return iso.slice(5, 7) + '.' + iso.slice(8, 10);
  }

  function render(list) {
    var section = document.getElementById('notices');
    var box = document.getElementById('notice-list');
    if (!section || !box || !list.length) return;

    list.slice(0, MAX_SHOWN).forEach(function (n, i) {
      var item = document.createElement('details');
      item.className = 'notice-item';
      if (i === 0 && n.pinned) item.open = false; // 고정 공지도 접힌 채 시작(진행 비차단)

      var sum = document.createElement('summary');

      var pill = document.createElement('span');
      pill.className = 'notice-pill';
      pill.textContent = (typeof n.type === 'string' && n.type.trim()) ? n.type.trim() : '안내';

      var t = document.createElement('span');
      t.className = 'notice-t';
      t.textContent = String(n.title || '');

      var d = document.createElement('span');
      d.className = 'notice-d';
      d.textContent = fmtDate(n.createdAt);

      var chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      chev.setAttribute('class', 'notice-chev');
      chev.setAttribute('viewBox', '0 0 24 24');
      chev.setAttribute('width', '16');
      chev.setAttribute('height', '16');
      chev.setAttribute('fill', 'none');
      chev.setAttribute('stroke', 'currentColor');
      chev.setAttribute('stroke-width', '1.8');
      chev.setAttribute('stroke-linecap', 'round');
      chev.setAttribute('stroke-linejoin', 'round');
      chev.setAttribute('aria-hidden', 'true');
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M6 9l6 6 6-6');
      chev.appendChild(path);

      sum.appendChild(pill);
      sum.appendChild(t);
      sum.appendChild(d);
      sum.appendChild(chev);
      item.appendChild(sum);

      var body = document.createElement('div');
      body.className = 'notice-b';
      body.textContent = String(n.body || '');

      var href = safeHref(n.link);
      if (href) {
        body.appendChild(document.createTextNode('\n'));
        var a = document.createElement('a');
        a.href = href;
        if (href.indexOf('https://') === 0) { a.target = '_blank'; a.rel = 'noopener'; }
        a.textContent = (typeof n.linkLabel === 'string' && n.linkLabel.trim()) ? n.linkLabel.trim() : '자세히 보기 →';
        body.appendChild(a);
      }
      item.appendChild(body);
      box.appendChild(item);
    });

    section.hidden = false;
  }

  fetch('data/notices.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j || !Array.isArray(j.notices)) return;
      var today = todayKst();
      var visible = j.notices.filter(function (n) {
        return n && n.active !== false && n.title && inWindow(n, today);
      });
      visible.sort(function (a, b) {
        if (!!b.pinned - !!a.pinned) return (!!b.pinned - !!a.pinned);
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      });
      render(visible);
    })
    .catch(function () { /* 공지 로드 실패 시 조용히 미표시 */ });
})();
