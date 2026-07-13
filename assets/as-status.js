/* =========================================================================
   CLAPA A/S 접수 조회 (as-status.js)
   - 조회 카드(관대한 접수번호 파싱·?id= 프리필·sessionStorage 자동 조회)
   - 4단계 스테퍼(접수→확인중→처리중→완료) + 취소/보류 배지
   - step/flag 는 서버(asStatus) 산출값만 사용 — 프런트 문자열 휴리스틱 금지
   - 보안: 서버 응답은 전부 textContent 로만 렌더(innerHTML 미사용)
   - 인증정보: sessionStorage 'asStatus.cred' = {id, phone4} (탭 단위)
   ========================================================================= */
(function () {
  'use strict';

  var CRED_KEY = 'asStatus.cred';
  var PHONE = '1522-8508';
  var HOURS = '평일 09:00~15:00';
  var STEPS = ['접수', '확인중', '처리중', '완료'];
  /* 불일치·미존재 동일 문구 — 접수번호 열거 방지 */
  var LOOKUP_FAIL = '접수 내역을 확인하지 못했습니다. 접수번호와 연락처 뒷 4자리를 다시 확인해 주세요.';

  var ENDPOINT = '';
  var cred = null;          // 조회 성공한 {id, phone4} — 대화창·알림받기(Task 10·11)가 공유
  var looking = false;

  var formEl = document.getElementById('lookup-form');
  var idInput = document.getElementById('lk-id');
  var p4Input = document.getElementById('lk-p4');
  var btnEl = document.getElementById('lk-btn');
  var msgBox = document.getElementById('lk-msg');
  var resultEl = document.getElementById('result');
  var stIdEl = document.getElementById('st-id');
  var badgeEl = document.getElementById('st-badge');
  var stepperEl = document.getElementById('stepper');
  var flagNoteEl = document.getElementById('st-flag-note');
  var dateEl = document.getElementById('st-date');
  var updatedEl = document.getElementById('st-updated');
  if (!formEl) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* 관대한 접수번호 파싱 — 'as 260710 160225'·'AS-260710-160225'·'260710160225' 모두 허용 */
  function normalizeAsId(raw) {
    var d = String(raw == null ? '' : raw).replace(/\D/g, '');
    if (d.length !== 12) return '';
    return 'AS-' + d.slice(0, 6) + '-' + d.slice(6);
  }

  function sidValue() {
    try { return sessionStorage.getItem('clapaChat.sid') || 'asstatus'; } catch (e) { return 'asstatus'; }
  }

  /* GAS 호출 — 기존 폼과 동일한 text/plain JSON POST, 쿼터용 sessionId 자동 첨부 */
  function api(body) {
    body.sessionId = sidValue();
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function showMsg(t) { msgBox.textContent = t; msgBox.hidden = false; }
  function clearMsg() { msgBox.textContent = ''; msgBox.hidden = true; }
  function setBusy(b) {
    looking = b;
    btnEl.disabled = b;
    btnEl.textContent = b ? '조회 중…' : '조회하기';
  }

  function loadCred() {
    try {
      var raw = sessionStorage.getItem(CRED_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (c && typeof c.id === 'string' && typeof c.phone4 === 'string') return c;
    } catch (e) {}
    return null;
  }
  function saveCred(c) { try { sessionStorage.setItem(CRED_KEY, JSON.stringify(c)); } catch (e) {} }

  function renderStepper(step) {
    stepperEl.textContent = '';
    stepperEl.hidden = false;
    stepperEl.setAttribute('aria-label', '진행 상태: ' + STEPS[step]);
    for (var i = 0; i < STEPS.length; i++) {
      if (i > 0) stepperEl.appendChild(el('span', 'stp-bar' + (i <= step ? ' is-done' : '')));
      stepperEl.appendChild(el('span', 'stp' + (i < step ? ' is-done' : (i === step ? ' is-now' : '')), STEPS[i]));
    }
  }

  function renderStatus(d) {
    resultEl.hidden = false;
    stIdEl.textContent = cred.id;
    badgeEl.hidden = true;
    flagNoteEl.hidden = true;
    if (d.flag === 'cancelled' || d.flag === 'held') {
      stepperEl.hidden = true;
      badgeEl.hidden = false;
      badgeEl.textContent = d.flag === 'cancelled' ? '접수 취소' : '처리 보류';
      badgeEl.className = 'st-badge ' + (d.flag === 'cancelled' ? 'is-cancel' : 'is-hold');
      flagNoteEl.hidden = false;
      flagNoteEl.textContent = d.flag === 'cancelled'
        ? '이 접수는 취소 처리되었습니다. 궁금하신 점은 전화(' + PHONE + ', ' + HOURS + ') 또는 아래 대화창으로 문의해 주세요.'
        : '이 접수는 잠시 보류 중입니다. 확인이 끝나는 대로 순서대로 연락드리겠습니다.';
    } else {
      var step = (typeof d.step === 'number' && d.step >= 0 && d.step <= 3) ? d.step : 0;
      renderStepper(step);
    }
    dateEl.textContent = d.date ? String(d.date) : '-';
    updatedEl.textContent = d.updatedAt ? String(d.updatedAt) : '-';
    /* 조회 성공 훅 — 접수 대화창(Task 10)·알림 받기(Task 11)가 여기서 초기화됩니다 */
    if (typeof initThread === 'function') initThread();
    if (typeof initPush === 'function') initPush();
  }

  function lookup(id, phone4, silent) {
    if (looking) return;
    if (!ENDPOINT) {
      showMsg('지금은 온라인 조회가 어렵습니다. 전화(' + PHONE + ', ' + HOURS + ')로 확인 부탁드립니다.');
      return;
    }
    clearMsg();
    setBusy(true);
    api({ action: 'asStatus', id: id, phone4: phone4 })
      .then(function (d) {
        if (d && d.ok) {
          cred = { id: id, phone4: phone4 };
          saveCred(cred);
          renderStatus(d);
        } else if (!silent) {
          showMsg(LOOKUP_FAIL);
        }
      })
      .catch(function () {
        if (!silent) showMsg('연결이 원활하지 않습니다. 잠시 후 다시 시도하시거나 전화(' + PHONE + ', ' + HOURS + ')로 확인 부탁드립니다.');
      })
      .then(function () { setBusy(false); });
  }

  formEl.addEventListener('submit', function (e) {
    e.preventDefault();
    var id = normalizeAsId(idInput.value);
    var p4 = String(p4Input.value || '').replace(/\D/g, '');
    if (!id) { showMsg('접수번호를 다시 확인해 주세요. 예) AS-260710-160225'); return; }
    if (p4.length !== 4) { showMsg('연락처 뒷 4자리를 숫자로 입력해 주세요.'); return; }
    idInput.value = id;   // 정규화 결과를 되비춰 확인 가능하게
    lookup(id, p4, false);
  });

  /* 부팅 — endpoint 로드 후 ?id= 프리필, 저장된 인증정보가 있으면 자동 조회 */
  fetch('data/chat-config.json?t=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { if (j && typeof j.endpoint === 'string') ENDPOINT = j.endpoint; })
    .catch(function () {})
    .then(function () {
      var qid = '';
      try { qid = normalizeAsId(new URLSearchParams(location.search).get('id') || ''); } catch (e) {}
      var saved = loadCred();
      if (qid) idInput.value = qid;
      if (saved && (!qid || saved.id === qid)) {
        idInput.value = saved.id;
        p4Input.value = saved.phone4;
        lookup(saved.id, saved.phone4, true);   // 자동 조회 실패는 조용히 — 수동 조회로 유도
      }
    });

  /* 콘솔 검증용 최소 노출 */
  window.ClapaAsStatus = { normalizeAsId: normalizeAsId };
})();
