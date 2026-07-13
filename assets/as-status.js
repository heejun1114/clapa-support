/* =========================================================================
   CLAPA A/S 접수 조회 (as-status.js)
   - 조회 카드(관대한 접수번호 파싱·?id= 프리필·sessionStorage 자동 조회)
   - 4단계 스테퍼(접수→확인중→처리중→완료) + 취소/보류 배지
   - step/flag 는 서버(asStatus) 산출값만 사용 — 프런트 문자열 휴리스틱 금지
   - 접수 대화창: 말풍선 스레드·15초 폴링(숨김 시 중지)·사진 첨부·asFile 썸네일
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

  /* GAS 호출 — 기존 폼과 동일한 text/plain JSON POST, 쿼터용 sessionId 자동 첨부
     호출자 객체는 변형하지 않고 복제해서 보내며, 15초 타임아웃(조회·폴링·전송 공용) */
  var API_TIMEOUT_MS = 15000;
  function api(body) {
    var payload = {};
    for (var k in body) { if (Object.prototype.hasOwnProperty.call(body, k)) payload[k] = body[k]; }
    payload.sessionId = sidValue();
    var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, API_TIMEOUT_MS) : null;
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) { return r.json(); })
      .then(
        function (d) { if (timer) clearTimeout(timer); return d; },
        function (e) { if (timer) clearTimeout(timer); throw e; }
      );
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
      if (!silent) showMsg('지금은 온라인 조회가 어렵습니다. 전화(' + PHONE + ', ' + HOURS + ')로 확인 부탁드립니다.');
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

  /* ------------------------------------------------------------------ *
   * 접수 대화창 — 15초 폴링(페이지 표시 중), visibilitychange 시 중지
   * 매 폴링마다 전체 스레드를 받아(since 미사용) 멱등 렌더:
   * 응답 서명(개수+마지막 ts+마지막 text)이 달라졌을 때만 DOM 재구성
   * ------------------------------------------------------------------ */
  var POLL_MS = 15000;
  var pollTimer = null;
  var threadBound = false;
  var lastTs = '';          // 마지막으로 본 CS 메시지 ts — 새 답변 감지(스크롤·타이틀)용
  var renderedSig = '';     // 렌더된 스레드 서명 — 같으면 재구성 생략(깜빡임 방지)
  var firstLoad = true;
  var baseTitle = document.title;
  var titleFlagged = false;
  var fileCache = {};   // fileId → dataURI (불변 캐시)

  var threadSec = document.getElementById('thread-sec');
  var threadList = document.getElementById('th-list');
  var threadForm = document.getElementById('th-form');
  var threadInput = document.getElementById('th-input');
  var threadSendBtn = document.getElementById('th-send');
  var threadAttachBtn = document.getElementById('th-attach');
  var threadFileInput = document.getElementById('th-file');

  function initThread() {
    if (!threadSec) return;
    threadSec.hidden = false;
    if (!threadBound) {
      threadBound = true;
      threadForm.addEventListener('submit', onThreadSend);
      threadAttachBtn.addEventListener('click', function () { threadFileInput.click(); });
      threadFileInput.addEventListener('change', onThreadAttach);
      document.addEventListener('visibilitychange', onVisChange);
      window.addEventListener('focus', clearTitleFlag);
    }
    // 다른 접수를 새로 조회하면 스레드를 비우고 처음부터
    threadList.textContent = '';
    lastTs = '';
    renderedSig = '';
    firstLoad = true;
    fetchMsgs();
    startPoll();
  }

  function startPoll() { if (!pollTimer) pollTimer = setInterval(fetchMsgs, POLL_MS); }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function onVisChange() {
    if (!threadBound || threadSec.hidden) return;
    if (document.hidden) stopPoll();
    else { clearTitleFlag(); fetchMsgs(); startPoll(); }
  }
  function clearTitleFlag() {
    if (titleFlagged) { titleFlagged = false; document.title = baseTitle; }
  }

  function threadSig(msgs) {
    var last = msgs.length ? msgs[msgs.length - 1] : null;
    return msgs.length + '|' + (last ? String(last.ts) : '') + '|' +
      (last ? String(last.text == null ? '' : last.text) : '');
  }

  /* toBottom: 전송·첨부 직후 내 메시지가 보이도록 하단 고정 */
  function fetchMsgs(toBottom) {
    if (!cred) return;
    api({ action: 'asMsgs', id: cred.id, phone4: cred.phone4 }).then(function (d) {
      if (!d || !d.ok || !Array.isArray(d.msgs)) return;
      var sig = threadSig(d.msgs);
      if (sig === renderedSig) return;   // 변화 없음 — DOM 그대로 유지
      renderedSig = sig;

      var csTs = '';
      for (var i = 0; i < d.msgs.length; i++) {
        var m = d.msgs[i];
        if (m && m.dir === 'cs' && String(m.ts) > csTs) csTs = String(m.ts);
      }
      var newCs = !firstLoad && csTs !== '' && csTs > lastTs;
      if (csTs > lastTs) lastTs = csTs;

      var nearBottom = threadList.scrollHeight - threadList.scrollTop - threadList.clientHeight < 48;
      var prevScroll = threadList.scrollTop;
      threadList.textContent = '';
      for (var j = 0; j < d.msgs.length; j++) { if (d.msgs[j]) renderMsg(d.msgs[j]); }

      threadList.scrollTop = prevScroll;   // 위로 올려 읽던 위치 복원
      if (newCs) {
        try { threadList.scrollTo({ top: threadList.scrollHeight, behavior: 'smooth' }); }
        catch (e) { threadList.scrollTop = threadList.scrollHeight; }
        if (!document.hasFocus()) { titleFlagged = true; document.title = '(새 답변) ' + baseTitle; }
      } else if (firstLoad || toBottom === true || nearBottom) {
        threadList.scrollTop = threadList.scrollHeight;
      }
      firstLoad = false;
    }).catch(function () { /* 폴링 실패는 조용히 — 다음 주기 재시도 */ });
  }

  function renderMsg(m) {
    var mine = m.dir === 'customer';
    var row = el('div', 'th-row ' + (mine ? 'is-me' : 'is-cs'));
    var bubble = el('div', 'th-bubble');
    var parts = String(m.text == null ? '' : m.text).split('\n');
    for (var i = 0; i < parts.length; i++) {
      if (i > 0) bubble.appendChild(document.createElement('br'));
      bubble.appendChild(document.createTextNode(parts[i]));
    }
    row.appendChild(bubble);
    var att = [];
    if (Array.isArray(m.att)) att = m.att;
    else if (typeof m.att === 'string' && m.att) { try { att = JSON.parse(m.att) || []; } catch (e) { att = []; } }
    for (var j = 0; j < att.length; j++) {
      if (att[j] && att[j].id && /^image\//.test(String(att[j].mime || ''))) row.appendChild(buildThumb(att[j]));
    }
    row.appendChild(el('span', 'th-time', formatTs(m.ts)));
    threadList.appendChild(row);
  }

  /* asFile 프록시로 썸네일 로드 — 본인 접수 인증(id+phone4), 결과는 세션 내 캐시 */
  function buildThumb(f) {
    var img = document.createElement('img');
    img.className = 'th-thumb';
    img.alt = String(f.name || '첨부 사진');
    if (fileCache[f.id]) { img.src = fileCache[f.id]; return img; }
    api({ action: 'asFile', fileId: f.id, id: cred.id, phone4: cred.phone4 })
      .then(function (d) {
        if (d && d.ok && d.data) {
          var src = 'data:' + String(d.mime || 'image/jpeg') + ';base64,' + String(d.data);
          fileCache[f.id] = src;
          img.src = src;
        }
      }).catch(function () {});
    return img;
  }

  function formatTs(ts) {
    var s = String(ts == null ? '' : ts);
    var m = s.match(/^\d{4}-(\d{2}-\d{2}) (\d{2}:\d{2})/);   // 'yyyy-MM-dd HH:mm:ss' → 'MM-dd HH:mm'
    return m ? (m[1] + ' ' + m[2]) : s;
  }

  function onThreadSend(e) {
    e.preventDefault();
    if (!cred || threadSendBtn.disabled) return;
    var text = String(threadInput.value || '').trim().slice(0, 1000);
    if (!text) return;
    threadSendBtn.disabled = true;
    api({ action: 'asMsgSend', id: cred.id, phone4: cred.phone4, text: text })
      .then(function (d) {
        if (d && d.ok) { threadInput.value = ''; fetchMsgs(true); }
        else showMsg('메시지를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
      })
      .catch(function () { showMsg('연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.'); })
      .then(function () { threadSendBtn.disabled = false; });
  }

  /* 사진 첨부 — 폼과 동일 압축(as-media.js 재사용) → asUpload → 스레드에 안내 메시지 */
  function onThreadAttach() {
    if (!cred) return;
    var f = threadFileInput.files && threadFileInput.files[0];
    threadFileInput.value = '';
    if (!f || !/^image\//.test(f.type)) return;
    threadAttachBtn.disabled = true;
    threadAttachBtn.textContent = '올리는 중…';
    window.ClapaAsMedia.compressImage(f, 1600, 0.8)
      .catch(function () {
        if (f.size <= 5 * 1024 * 1024) return { blob: f, name: f.name, mime: f.type || 'image/jpeg' };
        throw new Error('too-big');
      })
      .then(function (p) {
        return window.ClapaAsMedia.fileToB64(p.blob).then(function (b64) {
          return api({ action: 'asUpload', id: cred.id, phone4: cred.phone4, name: p.name, mime: p.mime, data: b64 });
        }).then(function (d) {
          if (!d || !d.ok) throw new Error('upload');
          return api({ action: 'asMsgSend', id: cred.id, phone4: cred.phone4, text: '[사진] ' + p.name + ' 을(를) 보냈습니다.' });
        });
      })
      .then(function () { fetchMsgs(true); })
      .catch(function () { showMsg('사진을 올리지 못했습니다. 파일 크기를 줄여 다시 시도해 주세요.'); })
      .then(function () {
        threadAttachBtn.disabled = false;
        threadAttachBtn.textContent = '사진 첨부';
      });
  }

  /* 콘솔 검증용 최소 노출 */
  window.ClapaAsStatus = { normalizeAsId: normalizeAsId };
})();
