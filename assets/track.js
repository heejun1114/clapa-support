/* CLAPA 고객지원센터 — 조회 통계 비콘 (개인정보 없음: 페이지·기능 사용 횟수만 집계)
 * 백엔드: 챗봇과 같은 GAS 웹앱(data/chat-config.json 의 endpoint), action:"track".
 * endpoint 가 비어 있으면 아무것도 하지 않습니다. 실패는 조용히 무시(사이트 동작에 영향 0).
 */
(function () {
  'use strict';
  if (!document.currentScript) return;

  var ROOT = new URL('..', document.currentScript.src); // assets/track.js → 사이트 루트
  var endpoint = '';
  var queue = [];
  var started = Date.now();
  var dwellSent = false;

  /* 탭 단위 익명 세션 id (챗봇과 무관, 무작위) */
  var sid = '';
  try {
    sid = sessionStorage.getItem('clapaTrackSid') || '';
    if (!sid) {
      sid = 't' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      sessionStorage.setItem('clapaTrackSid', sid);
    }
  } catch (e) { sid = 't' + Math.random().toString(36).slice(2, 10); }

  var isMobile = false;
  try { isMobile = window.matchMedia('(max-width: 768px)').matches; } catch (e) {}

  /* 사이트 루트 기준 페이지 경로: index / products/bvc-s185 / warranty */
  function pagePath() {
    var p = location.pathname;
    var root = ROOT.pathname;
    if (p.indexOf(root) === 0) p = p.slice(root.length);
    p = p.replace(/index\.html$/, '').replace(/\.html$/, '').replace(/\/$/, '');
    return p || 'index';
  }

  function post(payload) {
    try {
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, body)) return;
      fetch(endpoint, { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'text/plain' } })
        .catch(function () {});
    } catch (e) { /* 통계 실패는 무시 */ }
  }

  function send(type, item, detail, n) {
    var ev = { action: 'track', type: type, item: (item || '').toString().slice(0, 120),
               detail: (detail || '').toString().slice(0, 200), sessionId: sid,
               m: isMobile ? 1 : 0, n: n || 0 };
    if (!endpoint) { if (queue.length < 20) queue.push(ev); return; }
    post(ev);
  }
  window.clapaTrack = send; // chat.js 등에서 선택적으로 사용

  /* endpoint 로드 후 큐 방출 */
  fetch(new URL('data/chat-config.json?t=' + Date.now(), ROOT).href, { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (!cfg || !cfg.endpoint || !/^https:\/\/script\.google\.com\//.test(cfg.endpoint)) return;
      endpoint = cfg.endpoint;
      var q = queue; queue = [];
      for (var i = 0; i < q.length; i++) post(q[i]);
    })
    .catch(function () {});

  /* 1) 페이지 조회 */
  var title = (document.title || '').replace(/\s*[—|-]\s*(CLAPA|클래파).*$/i, '').trim();
  send('page', pagePath(), title);

  /* 2) 체류시간(초) — 탭을 떠날 때 1회 */
  function sendDwell() {
    if (dwellSent || !endpoint) { dwellSent = dwellSent || !endpoint; return; }
    dwellSent = true;
    var sec = Math.round((Date.now() - started) / 1000);
    if (sec >= 3) send('dwell', pagePath(), title, Math.min(sec, 7200));
  }
  window.addEventListener('pagehide', sendDwell);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') sendDwell();
  });

  /* 3) 기능 사용 클릭(위임 — 없는 요소는 그냥 무시됨) */
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var a;
    if ((a = t.closest('a[href*="manuals/"]'))) {
      var pdf = (a.getAttribute('href') || '').split('/').pop();
      send('manual', decodeURIComponent(pdf || ''), pagePath());
      return;
    }
    if ((a = t.closest('a.part-card'))) {
      var nm = a.querySelector('.part-name'), md = a.querySelector('.part-model');
      send('parts', ((md && md.textContent) || '') + ' ' + ((nm && nm.textContent) || ''), pagePath());
      return;
    }
    if ((a = t.closest('a[href*="smartstore.naver.com"]'))) {
      send('store', (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 80), pagePath());
      return;
    }
    if ((a = t.closest('[data-clapa-chat-trigger], .chat-fab'))) {
      send('chat_open', pagePath());
      return;
    }
    if ((a = t.closest('a.qm-item'))) {
      send('quick', (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40));
      return;
    }
    if ((a = t.closest('button[aria-expanded]')) && a.classList.contains('is-open')) {
      var row = a.closest('li, .plist-row, .prod-row');
      var code = row && row.querySelector('.row-parts') ? row.querySelector('.row-parts').getAttribute('data-code') : '';
      if (code) send('parts_open', code);
    }
  }, true);

  /* 4) 검색 사용 — Enter 로 검색했을 때만(입력 중 노이즈 제외) */
  var si = document.getElementById('support-search');
  if (si) {
    si.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && si.value && si.value.trim()) {
        send('search', si.value.trim().slice(0, 60));
      }
    });
  }
})();
