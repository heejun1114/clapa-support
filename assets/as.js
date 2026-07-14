/* CLAPA A/S 창 — 접수·조회 통합(as.html 전용).
   - 탭 라우팅(#intake/#status), 진입 쿼리(?model=/?id=), 점검 모드(notices stopAs)
   - 아코디언 접수 흐름(S2~S4)·기기 기억/조회(S5)는 아래 채움 지점에 구현
   - 렌더는 textContent 전용(XSS 금지). IIFE. ES5+기본 웹 API. */
(function () {
  'use strict';
  var ROOT = (function () { var s = document.currentScript; return s ? s.src.replace(/assets\/as\.js.*$/, '') : './'; })();
  var ENDPOINT = '/chat';
  var API_TIMEOUT_MS = 15000;
  var MODEL_QUERY = '';   // ?model= 파싱값(대문자 코드)
  var ID_QUERY = '';      // ?id= 파싱값(AS-...)

  /* ---- 공용 헬퍼 ---- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;      // 항상 textContent(사용자·서버 데이터 안전)
    return n;
  }
  function sidValue() {
    try { return sessionStorage.getItem('clapaChat.sid') || ('as' + Date.now()); } catch (e) { return 'asnosession'; }
  }
  function api(body) {
    var payload = {}; for (var k in body) payload[k] = body[k];
    if (!payload.sessionId) payload.sessionId = sidValue();
    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, API_TIMEOUT_MS) : null;
    return fetch(ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload), signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) { return r.json(); })
      .then(function (d) { if (timer) clearTimeout(timer); return d; },
            function (e) { if (timer) clearTimeout(timer); throw e; });
  }
  function showToast(t) {
    var box = el('div', 'toast', t);
    document.body.appendChild(box);
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 3200);
  }

  /* ---- 탭 라우터 ---- */
  function currentTab() { return (location.hash === '#status') ? 'status' : 'intake'; }
  function setTab(name) {
    var isStatus = (name === 'status');
    document.getElementById('panel-intake').hidden = isStatus;
    document.getElementById('panel-status').hidden = !isStatus;
    document.getElementById('tab-intake').setAttribute('aria-selected', isStatus ? 'false' : 'true');
    document.getElementById('tab-status').setAttribute('aria-selected', isStatus ? 'true' : 'false');
    if (location.hash !== ('#' + name)) { try { location.hash = '#' + name; } catch (e) {} }
    if (isStatus && typeof onEnterStatus === 'function') onEnterStatus();       // [S5]
    if (!isStatus && typeof onEnterIntake === 'function') onEnterIntake();      // [S2~S4]
  }
  document.getElementById('tab-intake').addEventListener('click', function () { setTab('intake'); });
  document.getElementById('tab-status').addEventListener('click', function () { setTab('status'); });
  window.addEventListener('hashchange', function () { setTab(currentTab()); });

  /* ---- 점검 모드(notices stopAs) — 접수 탭만 점검 카드, 조회 탭 정상 ----
     판독 규칙은 chat.js loadAsStatus 와 동일: active!==false · stopAs===true · place==='as'
     · KST 오늘이 startsAt~endsAt 범위 안. 실패 시 false(fail-open). */
  function kstToday() {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }
  function checkAsPaused() {
    return fetch(ROOT + 'data/notices.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var list = (j && Array.isArray(j.notices)) ? j.notices : [];
        var today = kstToday();
        for (var i = 0; i < list.length; i++) {
          var n = list[i];
          if (!n || n.active === false || n.stopAs !== true) continue;
          var place = (n.place === 'banner' || n.place === 'list' || n.place === 'as')
            ? n.place : (n.banner === true ? 'banner' : 'list');
          if (place !== 'as') continue;
          if (typeof n.startsAt === 'string' && today < n.startsAt) continue;
          if (typeof n.endsAt === 'string' && today > n.endsAt) continue;
          return true;
        }
        return false;
      }).catch(function () { return false; });
  }
  function renderMaint(on) {
    var slot = document.getElementById('intake-maint');
    var live = document.getElementById('intake-live');
    if (on) {
      slot.hidden = false; live.style.display = 'none';
      slot.textContent = '';
      var card = el('div', 'as-maint-card');
      card.appendChild(el('div', 'amc-t', '지금은 A/S 접수를 잠시 점검하고 있어요'));
      card.appendChild(el('div', 'amc-b', '점검이 끝나는 대로 다시 정상적으로 접수를 받겠습니다. 이미 접수하신 건은 위 "내 접수 조회"에서 확인하실 수 있어요.'));
      slot.appendChild(card);
    } else { slot.hidden = true; live.style.display = ''; }
  }

  /* ---- 진입 쿼리 파싱 ---- */
  function parseQuery() {
    try {
      var q = new URLSearchParams(location.search);
      MODEL_QUERY = (q.get('model') || '').toString().trim().toUpperCase();
      ID_QUERY = (q.get('id') || '').toString().trim().toUpperCase();
    } catch (e) {}
  }

  /* =========================================================
     [S2] 아코디언 엔진·제품 섹션  → 여기에 구현
     [S3] 스마트 위층             → 여기에 구현
     [S4] 증상~완료               → 여기에 구현
     [S5] asStore·조회 탭         → 여기에 구현
     ========================================================= */

  /* ---- 부팅 ---- */
  function boot() {
    parseQuery();
    // endpoint 설정 로드(실패 시 기본 '/chat')
    fetch(ROOT + 'data/chat-config.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && typeof j.endpoint === 'string') ENDPOINT = j.endpoint; })
      .catch(function () {})
      .then(function () {
        // ?id= 있으면 조회 탭, 아니면 해시 우선(기본 접수)
        var startTab = (ID_QUERY || location.hash === '#status') ? 'status' : 'intake';
        setTab(startTab);
        checkAsPaused().then(renderMaint);
        if (typeof initIntake === 'function') initIntake();   // [S2~S4]
        if (typeof initStatus === 'function') initStatus();   // [S5]
      });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.ClapaAs = { setTab: setTab, currentTab: currentTab };
})();
