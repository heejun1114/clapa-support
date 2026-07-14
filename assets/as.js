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

  /* ========================= [S2] 아코디언 엔진 + 제품 섹션 ========================= */
  var CATALOG = null;      // chat-catalog.json
  var SEARCH_IDX = null;   // search-index.json (썸네일 img 소스)
  var state = {
    product: null,          // {code, name} — 카탈로그에서 확정
    freeProduct: '',        // 자유 입력 제품명(코드 없음)
    symptom: { chips: [], text: '' },
    photos: [],
    contact: { name: '', phone: '', store: '', purchaseDate: '', address: '' },
    order: null             // orderLookup로 확정된 {orderId,productName,productOption,paymentDate}
  };
  var sectionState = { product: 'open', symptom: 'dim', photo: 'dim', contact: 'dim' };
  var sectionSummary = { product: '', symptom: '', photo: '', contact: '' };
  var selectedCat = '';     // 제품 섹션에서 펼친 카테고리(UI 상태)
  var SECTION_ORDER = ['product', 'symptom', 'photo', 'contact'];

  /* ---- 카탈로그·썸네일 ---- */
  function catalogModels() {
    if (!CATALOG || !CATALOG.models) return [];
    var out = [], models = CATALOG.models, i;
    for (i = 0; i < models.length; i++) {
      if (models[i] && models[i].cat !== 'shinil') out.push(models[i]);   // 신일 OEM 제외
    }
    return out;
  }
  function modelByCode(code) {
    if (!code || !CATALOG || !CATALOG.models) return null;
    var target = String(code).toUpperCase(), models = CATALOG.models, i, j, al;
    for (i = 0; i < models.length; i++) {                 // 코드 완전일치 우선
      if (String(models[i].code).toUpperCase() === target) return models[i];
    }
    for (i = 0; i < models.length; i++) {                 // 없으면 aliases 포함
      al = models[i].aliases || [];
      for (j = 0; j < al.length; j++) {
        if (String(al[j]).toUpperCase() === target) return models[i];
      }
    }
    return null;
  }
  function boundedIn(hay, needle) {
    // code 뒤 문자가 영숫자가 아닐 때만 매치(BFB-SF500 vs BFB-SF500E 구분)
    if (!hay) return false;
    var idx = hay.indexOf(needle);
    while (idx !== -1) {
      if (!/[A-Za-z0-9]/.test(hay.charAt(idx + needle.length))) return true;
      idx = hay.indexOf(needle, idx + 1);
    }
    return false;
  }
  function thumbFor(code) {
    // search-index.json의 product 항목 img 재사용(정적 매핑·빌드 금지)
    if (!code || !SEARCH_IDX || !SEARCH_IDX.length) return '';
    var target = String(code), i, it;
    for (i = 0; i < SEARCH_IDX.length; i++) {             // 1차: 코드 경계 매치
      it = SEARCH_IDX[i];
      if (!it || it.t !== 'product' || !it.img) continue;
      if (boundedIn(it.title, target) || boundedIn(it.k, target)) return it.img;
    }
    for (i = 0; i < SEARCH_IDX.length; i++) {             // 2차: 단순 포함 폴백
      it = SEARCH_IDX[i];
      if (!it || it.t !== 'product' || !it.img) continue;
      if ((it.title && it.title.indexOf(target) !== -1) || (it.k && it.k.indexOf(target) !== -1)) return it.img;
    }
    return '';
  }

  /* ---- 아코디언 상태기계 ---- */
  function stateToClass(s) { return s === 'open' ? 'is-open' : (s === 'done' ? 'is-done' : 'is-dim'); }
  function applySectionClasses() {
    for (var i = 0; i < SECTION_ORDER.length; i++) {
      var key = SECTION_ORDER[i], host = document.getElementById('sec-' + key);
      if (host) host.className = 'sec-card ' + stateToClass(sectionState[key]);
    }
  }
  function renderSectionByKey(key) {   // 각 섹션 렌더는 해당 태스크가 정의(가드)
    if (key === 'product') { renderProductSection(); return; }
    if (key === 'symptom' && typeof renderSymptomSection === 'function') { renderSymptomSection(); return; }
    if (key === 'photo' && typeof renderPhotoSection === 'function') { renderPhotoSection(); return; }
    if (key === 'contact' && typeof renderContactSection === 'function') { renderContactSection(); return; }
  }
  function openSection(key) {
    sectionState[key] = 'open';
    renderSectionByKey(key);
    applySectionClasses();
  }
  function completeSection(key, summary) {
    sectionState[key] = 'done';
    sectionSummary[key] = summary || '';
    renderSectionByKey(key);
    for (var i = SECTION_ORDER.indexOf(key) + 1; i < SECTION_ORDER.length; i++) {  // 다음 미완료 자동 open
      if (sectionState[SECTION_ORDER[i]] !== 'done') { openSection(SECTION_ORDER[i]); break; }
    }
    applySectionClasses();
  }
  function reopenSection(key) {         // 요약 줄 클릭 시(다른 열린 섹션은 접지 않음 — 자유 이동)
    if (sectionState[key] !== 'done') return;
    sectionState[key] = 'open';
    renderSectionByKey(key);
    applySectionClasses();
  }

  /* ---- 제품 섹션(카테고리 6종 → 썸네일 그리드) ---- */
  function catOrder() { return (CATALOG && CATALOG.cats) ? Object.keys(CATALOG.cats) : []; }  // cats 삽입 순서
  function catCount(catKey) {
    var models = catalogModels(), n = 0, i;
    for (i = 0; i < models.length; i++) { if (models[i].cat === catKey) n++; }
    return n;
  }
  function modelsInCat(catKey) {
    var models = catalogModels(), out = [], i;
    for (i = 0; i < models.length; i++) { if (models[i].cat === catKey) out.push(models[i]); }
    return out;
  }
  function chooseProduct(m) {
    state.product = { code: m.code, name: m.name };
    state.freeProduct = '';
    selectedCat = m.cat;
    completeSection('product', '✓ 제품 — ' + m.code + ' ' + m.name);
    renderAside();
  }
  function chooseFreeProduct(nameStr) {
    var v = String(nameStr || '').replace(/\s+/g, ' ').trim();
    if (!v) { showToast('제품 이름을 입력해 주세요.'); return; }
    state.freeProduct = v;
    state.product = null;
    completeSection('product', '✓ 제품 — ' + v);   // 코드 없음
    renderAside();
  }
  function renderProductSection() {
    var host = document.getElementById('sec-product');
    if (!host) return;
    host.className = 'sec-card ' + stateToClass(sectionState.product);
    host.textContent = '';

    /* 헤드: "1 제품" + 완료 시 요약 줄 */
    var head = el('div', 'sec-head');
    head.appendChild(el('span', 'sec-num', '1'));
    var main = el('span', 'sec-head-main');
    var titleEl;
    if (sectionState.product === 'done') {
      titleEl = el('div', 'sec-done-line', sectionSummary.product);
      main.appendChild(titleEl);
      head.appendChild(main);
      var editBtn = el('button', 'sec-edit', '변경'); editBtn.type = 'button';
      editBtn.addEventListener('click', function (e) { e.stopPropagation(); reopenSection('product'); });
      head.appendChild(editBtn);
      head.addEventListener('click', function () { reopenSection('product'); });
    } else {
      titleEl = el('span', 'sec-title', '제품');
      main.appendChild(titleEl);
      head.appendChild(main);
    }
    headA11y(head, titleEl, 'product');   // [S4] heading 시맨틱 + aria-expanded
    host.appendChild(head);

    /* 바디(완료 시 CSS가 숨김) */
    var body = el('div', 'sec-body');
    body.appendChild(el('p', 'prod-help', '수리가 필요한 제품을 선택해 주세요. 종류를 고르면 사진으로 찾을 수 있어요.'));

    var cats = el('div', 'prod-cats');
    var order = catOrder();
    for (var c = 0; c < order.length; c++) {
      (function (catKey) {
        var active = (selectedCat === catKey);
        var card = el('button', 'cat-card' + (active ? ' is-active' : '')); card.type = 'button';
        card.setAttribute('aria-pressed', active ? 'true' : 'false');
        card.appendChild(el('span', 'cat-name', CATALOG.cats[catKey]));
        card.appendChild(el('span', 'cat-count', catCount(catKey) + '종'));
        card.addEventListener('click', function () {
          selectedCat = (selectedCat === catKey) ? '' : catKey;   // 다시 누르면 접힘
          renderProductSection();
        });
        cats.appendChild(card);
      })(order[c]);
    }
    body.appendChild(cats);

    if (selectedCat) {
      var grid = el('div', 'prod-grid');
      var list = modelsInCat(selectedCat), i;
      for (i = 0; i < list.length; i++) {
        (function (m) {
          var tile = el('button', 'prod-tile'); tile.type = 'button';
          tile.setAttribute('aria-label', m.code + ' ' + m.name);
          var thumb = el('span', 'prod-thumb');
          var url = thumbFor(m.code);
          if (url) {
            var img = document.createElement('img');
            img.src = url; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
            img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); };  // 실패 시 회색 placeholder
            thumb.appendChild(img);
          }
          tile.appendChild(thumb);
          tile.appendChild(el('span', 'prod-code', m.code));   // 모델코드 대표(상단)
          tile.appendChild(el('span', 'prod-name', m.name));   // 이름 보조(하단)
          tile.addEventListener('click', function () { chooseProduct(m); });
          grid.appendChild(tile);
        })(list[i]);
      }
      body.appendChild(grid);
    }

    /* 자유 입력 폴백 — "찾는 제품이 없어요" */
    var free = el('div', 'prod-free');
    free.appendChild(el('div', 'prod-free-label', '찾는 제품이 없어요'));
    var frow = el('div', 'prod-free-row');
    var input = document.createElement('input');
    input.type = 'text'; input.maxLength = 80; input.className = 'prod-free-input';
    input.placeholder = '제품 이름을 입력해 주세요';
    input.setAttribute('aria-label', '제품 이름 직접 입력');
    if (state.freeProduct) input.value = state.freeProduct;
    var go = el('button', 'prod-free-go', '이 이름으로 접수'); go.type = 'button';
    go.addEventListener('click', function () { chooseFreeProduct(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); chooseFreeProduct(input.value); }
    });
    frow.appendChild(input); frow.appendChild(go);
    free.appendChild(frow);
    body.appendChild(free);

    host.appendChild(body);
  }

  /* ---- 요약 aside(≥900px, 실시간 갱신 — S3·S4가 확장) ---- */
  function asideRow(label, value) {
    var row = el('div', 'aside-row');
    row.appendChild(el('span', 'aside-k', label));
    row.appendChild(el('span', 'aside-v', value || '—'));   // 미입력은 "—"
    return row;
  }
  function productSummary() {
    if (state.product) return state.product.code + ' ' + state.product.name;
    if (state.freeProduct) return state.freeProduct;
    return '';
  }
  function symptomSummary() {
    var s = state.symptom || {}, parts = [];
    if (s.chips && s.chips.length) parts.push(s.chips.join(', '));
    if (s.text) parts.push(s.text);
    return parts.join(' — ');   // "칩1, 칩2 — 직접입력" 포맷
  }
  function contactSummary() {
    var c = state.contact || {};
    if (c.name && c.phone) return c.name + ' · ' + c.phone;
    return c.name || c.phone || '';
  }
  function renderAside() {
    var host = document.getElementById('intake-aside');
    if (!host) return;
    host.textContent = '';
    var card = el('div', 'aside-card');
    card.appendChild(el('div', 'aside-title', '접수 요약'));
    card.appendChild(asideRow('제품', productSummary()));
    card.appendChild(asideRow('증상', symptomSummary()));
    card.appendChild(asideRow('연락처', contactSummary()));
    card.appendChild(el('p', 'aside-safe', '남겨주신 연락처는 A/S 안내에만 사용합니다.'));
    host.appendChild(card);
    if (typeof renderIntakeTop === 'function') renderIntakeTop();   // [S5] 재방문 인사·같은 제품 진행 중 안내 갱신
  }

  /* ---- 진입 쿼리 자동 선택 + 접수 탭 부팅 훅 ---- */
  function applyModelQuery() {
    if (!MODEL_QUERY) return;
    var m = modelByCode(MODEL_QUERY);
    if (!m) return;
    state.product = { code: m.code, name: m.name };
    selectedCat = m.cat;
    completeSection('product', '✓ 제품 — ' + m.code + ' ' + m.name);   // 카테고리 UI 접힌 채 시작
  }
  function initIntake() {
    if (!document.getElementById('sec-product')) return;   // 접수 UI 미탑재 가드
    Promise.all([
      fetch(ROOT + 'data/chat-catalog.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }),
      fetch(ROOT + 'data/search-index.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); })
    ]).then(function (arr) {
      CATALOG = arr[0]; SEARCH_IDX = arr[1];
      renderProductSection();
      applyModelQuery();
      if (typeof renderUpstairs === 'function') renderUpstairs();            // [S3]
      if (typeof renderSymptomSection === 'function') renderSymptomSection(); // [S4]
      if (typeof renderPhotoSection === 'function') renderPhotoSection();     // [S4]
      if (typeof renderContactSection === 'function') renderContactSection(); // [S4]
      if (typeof renderSubmit === 'function') renderSubmit();                 // [S4]
      renderAside();
    }).catch(function () { showToast('제품 목록을 불러오지 못했어요. 새로고침해 주세요.'); });
  }

  /* ========================= [S3] 스마트 위층(빠른 시작) =========================
     제품 아코디언 위에 얹는 선택형 도우미 4행:
       ① 내 제품(기기 기억 — asStore, S5 정의 전엔 조용히 비표시)
       ② 네이버 구매 매칭(이름+전화 → orderMatch)
       ③ 사진으로 찾기(리사이즈→modelIdent, 탭해야 확정)
       ④ 주문번호(paste 즉시 자동 조회 → orderLookup)
     어떤 실패도 접수 진행을 막지 않는다(비차단). 주문번호·이미지 localStorage 저장 없음. */

  var orderMatchTries = 0;   // 전화 매칭 세션 실패 카운터(3회 후 ② 행 조용히 접기)
  var phoneCollapsed = false;

  /* 개발자 상수 아이콘 SVG(innerHTML 허용 — 사용자·서버 데이터 아님) */
  var ICON_BAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 8h11l-1 11.5H7.5z"/><path d="M9 8V6.2a3 3 0 0 1 6 0V8"/></svg>';
  var ICON_CAMERA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5h3L8.4 6h7.2L17 8.5h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.1"/></svg>';
  var ICON_RECEIPT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3h11v18l-2.2-1.4-2.2 1.4L11 20.6 8.8 22 6.5 20.6z"/><path d="M9.5 8h5M9.5 12h5"/></svg>';
  var ICON_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  var ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  var ICON_UPLOAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4"/><path d="m8 8 4-4 4 4"/><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg>';

  function iconEl(cls, svg) {
    var s = el('span', cls); s.setAttribute('aria-hidden', 'true'); s.innerHTML = svg; return s;
  }
  function safeCopy(text) {   // §5-4 안심 카피 한 줄
    var w = el('p', 'up-safe');
    w.appendChild(iconEl('', ICON_LOCK));
    w.appendChild(el('span', null, text));
    return w;
  }
  function setNote(noteEl, text, retry) {
    noteEl.textContent = text || '';
    noteEl.hidden = !text;
    if (retry) noteEl.className = 'up-note is-retry'; else noteEl.className = 'up-note';
  }

  /* ---- 공용 헬퍼: 카탈로그 코드 매핑 ---- */
  function resolveModel(productName, productOption) {
    // (productName+' '+productOption)에서 카탈로그 code·aliases를 긴 코드 우선 포함매칭.
    // 실패 시 '' (제품 수동 선택 유도). 부품 상품이면 옵션/이름에 박힌 본품 코드가 잡힌다.
    if (!CATALOG || !CATALOG.models) return '';
    var hay = String((productName || '') + ' ' + (productOption || '')).toUpperCase();
    if (!hay.replace(/\s+/g, '')) return '';
    var pairs = [], models = CATALOG.models, i, j, al, code, parts, p;
    for (i = 0; i < models.length; i++) {
      if (!models[i] || models[i].cat === 'shinil') continue;       // 신일 OEM 제외
      code = String(models[i].code || '');
      parts = code.split('/');                                       // 결합 코드(BES-131W/CES-232W) 분해
      for (p = 0; p < parts.length; p++) {
        if (parts[p]) pairs.push({ token: parts[p].toUpperCase(), code: models[i].code });
      }
      al = models[i].aliases || [];
      for (j = 0; j < al.length; j++) {
        if (al[j]) pairs.push({ token: String(al[j]).toUpperCase(), code: models[i].code });
      }
    }
    pairs.sort(function (a, b) { return b.token.length - a.token.length; });  // 긴 코드 우선
    for (i = 0; i < pairs.length; i++) {
      if (pairs[i].token.length >= 4 && boundedIn(hay, pairs[i].token)) return pairs[i].code;
    }
    return '';
  }

  /* 후보 탭 시 제품 확정(브리프 계약 시그니처 그대로) */
  function applyMatchedProduct(sel) {
    if (sel.code) {
      var m = modelByCode(sel.code);
      state.product = m ? { code: m.code, name: m.name } : { code: sel.code, name: sel.name || '' };
      if (m) { state.freeProduct = ''; selectedCat = m.cat; }
    } else {
      state.freeProduct = sel.name || ''; state.product = null;
    }
    completeSection('product', '✓ 제품 — ' + (state.product ? (state.product.code + ' ' + state.product.name) : state.freeProduct));
    renderAside();
  }

  /* 전화 매칭·주문조회에서 얻은 연락처/구매정보를 state.contact에 채움 */
  function autofillContact(patch) {
    if (!patch) return;
    for (var k in patch) { if (patch.hasOwnProperty(k) && patch[k] != null && patch[k] !== '') state.contact[k] = patch[k]; }
    if (typeof renderContactSection === 'function') renderContactSection();  // S4 있으면 갱신
    renderAside();
  }

  /* ---- 후보 카드 빌더 ---- */
  function candCard(code, nameText, subText, confidence, onTap) {
    var card = el('button', 'up-cand'); card.type = 'button';
    card.setAttribute('aria-label', (code || nameText || '제품') + ' 담기');
    var thumb = el('span', 'up-cand-thumb');
    var url = thumbFor(code);
    if (url) {
      var img = document.createElement('img');
      img.src = url; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); };
      thumb.appendChild(img);
    }
    card.appendChild(thumb);
    var meta = el('div', 'up-cand-meta');
    if (code) meta.appendChild(el('div', 'up-cand-code', code));
    if (nameText) meta.appendChild(el('div', 'up-cand-name', nameText));
    if (subText) meta.appendChild(el('div', 'up-cand-sub', subText));
    if (typeof confidence === 'number') {
      var pct = Math.max(0, Math.min(100, Math.round(confidence * 100)));
      var conf = el('div', 'up-conf');
      var track = el('div', 'up-conf-track');
      var fill = el('div', 'up-conf-fill'); fill.style.width = pct + '%';
      track.appendChild(fill);
      conf.appendChild(track);
      conf.appendChild(el('span', 'up-conf-num', pct + '%'));
      meta.appendChild(conf);
    }
    card.appendChild(meta);
    card.appendChild(el('span', 'up-cand-go', '담기'));
    card.addEventListener('click', onTap);
    return card;
  }

  /* ② 네이버 구매 매칭 바디 */
  function buildPhoneBody(body) {
    var f1 = el('div', 'up-field');
    var nameIn = document.createElement('input');
    nameIn.type = 'text'; nameIn.className = 'up-input'; nameIn.maxLength = 40;
    nameIn.placeholder = '주문자 이름'; nameIn.autocomplete = 'name';
    nameIn.setAttribute('aria-label', '주문자 이름');
    var phoneIn = document.createElement('input');
    phoneIn.type = 'tel'; phoneIn.className = 'up-input'; phoneIn.maxLength = 20;
    phoneIn.placeholder = '전화번호'; phoneIn.autocomplete = 'tel';
    phoneIn.setAttribute('inputmode', 'tel'); phoneIn.setAttribute('aria-label', '전화번호');
    try {   // 기기 프로필 프리필(S5 정의 후, 있으면 편의)
      if (window.asStore && asStore.profile) {
        var pf = asStore.profile();
        if (pf) { if (pf.name) nameIn.value = pf.name; if (pf.phone) phoneIn.value = pf.phone; }
      }
    } catch (e) {}
    f1.appendChild(nameIn); f1.appendChild(phoneIn);
    var f2 = el('div', 'up-field');
    var go = el('button', 'up-go', '구매 제품 찾기'); go.type = 'button';
    f2.appendChild(go);
    var cands = el('div', 'up-cands');
    var note = el('div', 'up-note'); note.hidden = true;
    body.appendChild(f1); body.appendChild(f2); body.appendChild(cands); body.appendChild(note);
    body.appendChild(safeCopy('입력하신 이름과 전화번호는 구매 확인에만 잠깐 사용해요.'));

    function collapsePhone() {   // 3회 실패 후 조용히 제거(토스트 없음)
      phoneCollapsed = true;
      var wrap = body.parentNode;
      if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }
    function run() {
      if (go.disabled) return;                                     // 조회 중 연타 무시(동시 발사·tries 과증가 방지)
      var nm = nameIn.value.replace(/\s+/g, ' ').trim();
      var ph = phoneIn.value.trim();
      cands.textContent = '';
      if (!nm || ph.replace(/\D/g, '').length < 9) { setNote(note, '이름과 전화번호를 모두 입력해 주세요.'); return; }
      setNote(note, '');
      go.disabled = true; go.textContent = '찾는 중…';
      api({ action: 'orderMatch', name: nm, phone: ph }).then(function (d) {
        go.disabled = false; go.textContent = '구매 제품 찾기';
        var purchases = (d && d.ok && d.purchases) ? d.purchases : [];
        if (purchases.length) {
          renderPhoneCands(purchases, nm, ph);
        } else {
          orderMatchTries++;
          setNote(note, '입력하신 정보로는 구매 이력을 찾지 못했어요. 아래에서 제품을 골라 주셔도 됩니다.');
          if (orderMatchTries >= 3) collapsePhone();
        }
      }, function () {
        go.disabled = false; go.textContent = '구매 제품 찾기';
        setNote(note, '입력하신 정보로는 구매 이력을 찾지 못했어요. 아래에서 제품을 골라 주셔도 됩니다.');
      });
    }
    function renderPhoneCands(purchases, nm, ph) {
      cands.textContent = '';
      for (var i = 0; i < purchases.length; i++) {
        (function (p) {
          var code = '';
          if (p.model && modelByCode(p.model)) code = modelByCode(p.model).code;
          else code = resolveModel(p.productName || '', '');
          var shownCode = code || (p.model || '');
          var sub = p.purchaseMonth ? ('구매 ' + p.purchaseMonth) : '';
          cands.appendChild(candCard(shownCode, p.productName || '', sub, null, function () {
            if (code) applyMatchedProduct({ code: code });
            else applyMatchedProduct({ name: p.productName || '' });
            autofillContact({ name: nm, phone: ph });
            cands.textContent = '';
            setNote(note, '제품과 연락처를 담았어요. 아래에서 이어서 진행해 주세요.');
          }));
        })(purchases[i]);
      }
    }
    go.addEventListener('click', run);
    phoneIn.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); run(); } });
  }

  /* ③ 사진으로 찾기 바디 */
  function buildPhotoBody(body) {
    var label = el('label', 'up-file');
    label.appendChild(iconEl('', ICON_UPLOAD));
    label.appendChild(el('span', null, '사진 선택 또는 촬영'));
    var fileIn = document.createElement('input');
    fileIn.type = 'file'; fileIn.accept = 'image/*';   // 모바일에서 카메라 촬영도 선택 가능
    fileIn.setAttribute('aria-label', '제품 사진 올리기');
    label.appendChild(fileIn);
    var cands = el('div', 'up-cands');
    var note = el('div', 'up-note'); note.hidden = true;
    body.appendChild(label); body.appendChild(cands); body.appendChild(note);
    body.appendChild(safeCopy('올려주신 사진은 제품을 찾는 데만 쓰고 남겨두지 않아요.'));

    var FALLBACK = '사진만으로는 제품을 확정하기 어려워요. 아래에서 종류를 골라 주세요.';
    function send(b64, mime) {
      api({ action: 'modelIdent', image: { data: b64, mime: mime } }).then(function (d) {
        if (d && d.ok && d.candidates && d.candidates.length && (d.candidates[0].confidence == null || d.candidates[0].confidence >= 0.4)) {
          renderPhotoCands(d.candidates);
        } else if (d && d.ok) {
          setNote(note, FALLBACK);                                   // 0건·저신뢰
        } else if (d && d.code === 'quota') {
          setNote(note, '사진 찾기를 잠시 후 다시 시도해 주세요.', true);
        } else if (d && d.code === 'input') {
          setNote(note, d.error || FALLBACK);
        } else {
          setNote(note, FALLBACK);                                   // gemini·기타
        }
      }, function () { setNote(note, FALLBACK); });                  // 네트워크
    }
    function renderPhotoCands(cs) {
      cands.textContent = '';
      setNote(note, '');                                           // "확인 중" 안내 정리
      for (var i = 0; i < cs.length; i++) {
        (function (c) {
          cands.appendChild(candCard(c.code || '', c.name || '', '', c.confidence, function () {
            applyMatchedProduct({ code: c.code, name: c.name });     // 탭해야 확정
            cands.textContent = '';
            setNote(note, '제품을 담았어요. 아래에서 이어서 진행해 주세요.');
          }));
        })(cs[i]);
      }
    }
    fileIn.addEventListener('change', function () {
      var file = fileIn.files && fileIn.files[0];
      fileIn.value = '';                                             // 같은 파일 재선택 허용
      if (!file) return;
      cands.textContent = '';
      setNote(note, '사진을 확인하고 있어요…');
      var media = window.ClapaAsMedia;
      if (media && media.compressImage && media.fileToB64) {
        media.compressImage(file, 1280, 0.85).then(function (res) {
          return media.fileToB64(res.blob).then(function (b64) { send(b64, 'image/jpeg'); });
        }).catch(function () { fallbackOriginal(file, media); });
      } else {
        fallbackOriginal(file, media);
      }
    });
    function fallbackOriginal(file, media) {
      // 리사이즈 불가 시 원본 4MB 이하만 그대로 전송
      if (!/^image\//.test(file.type || '') || file.size > 4 * 1024 * 1024) { setNote(note, FALLBACK); return; }
      if (media && media.fileToB64) {
        media.fileToB64(file).then(function (b64) { send(b64, file.type); }).catch(function () { setNote(note, FALLBACK); });
      } else {
        var fr = new FileReader();
        fr.onload = function () { var s = String(fr.result || ''); var i = s.indexOf(','); send(i >= 0 ? s.slice(i + 1) : s, file.type); };
        fr.onerror = function () { setNote(note, FALLBACK); };
        fr.readAsDataURL(file);
      }
    }
  }

  /* ④ 주문번호 바디 */
  function buildOrderBody(body) {
    var f = el('div', 'up-field');
    var numIn = document.createElement('input');
    numIn.type = 'text'; numIn.className = 'up-input'; numIn.maxLength = 24;
    numIn.placeholder = '주문번호 (숫자)'; numIn.autocomplete = 'off';
    numIn.setAttribute('inputmode', 'numeric'); numIn.setAttribute('pattern', '[0-9]*');
    numIn.setAttribute('aria-label', '주문번호');
    var go = el('button', 'up-go', '찾기'); go.type = 'button';
    f.appendChild(numIn); f.appendChild(go);
    var out = el('div', 'up-cands');
    var note = el('div', 'up-note'); note.hidden = true;
    body.appendChild(f); body.appendChild(out); body.appendChild(note);
    body.appendChild(safeCopy('주문번호는 확인 후 저장하지 않아요.'));

    function buildOrderInfo(o) {
      var box = el('div', 'up-orderinfo');
      function row(k, v) { var r = el('div', 'up-oi-row'); r.appendChild(el('span', 'up-oi-k', k)); r.appendChild(el('span', 'up-oi-v', v || '—')); return r; }
      box.appendChild(row('제품', o.productName || '—'));
      if (o.productOption) box.appendChild(row('옵션', o.productOption));
      box.appendChild(row('구매처', '네이버 스토어'));
      if (o.paymentDate) box.appendChild(row('구매일', o.paymentDate));
      var clr = el('button', 'up-oi-clear', '지우기'); clr.type = 'button';
      clr.addEventListener('click', function () {
        state.order = null; state.contact.store = ''; state.contact.purchaseDate = '';
        if (typeof renderContactSection === 'function') renderContactSection();
        renderAside();
        out.textContent = ''; setNote(note, '');
      });
      box.appendChild(clr);
      return box;
    }
    function confirmOrder(o) {
      state.order = { orderId: o.orderId, productName: o.productName, productOption: o.productOption, paymentDate: o.paymentDate };
      autofillContact({ store: '네이버 스토어', purchaseDate: o.paymentDate || '' });
      out.textContent = '';
      var code = resolveModel(o.productName || '', o.productOption || '');
      if (code) { applyMatchedProduct({ code: code }); setNote(note, ''); }
      else { setNote(note, '주문은 확인했어요. 어떤 제품인지 아래에서 골라 주세요.'); }
      out.appendChild(buildOrderInfo(o));                            // 구매정보 카드(읽기 전용)
    }
    function handleOrders(orders) {
      out.textContent = '';
      if (orders.length >= 2) {                                      // 상품 선택 UI
        for (var i = 0; i < orders.length; i++) {
          (function (o) {
            var code = resolveModel(o.productName || '', o.productOption || '');
            var sub = [];
            if (o.productOption) sub.push(o.productOption);
            if (o.paymentDate) sub.push(o.paymentDate);
            out.appendChild(candCard(code, o.productName || '', sub.join(' · '), null, function () { confirmOrder(o); }));
          })(orders[i]);
        }
      } else {
        confirmOrder(orders[0]);                                     // 단일 바로 확정
      }
    }
    function lookup(raw) {
      if (go.disabled) return;                                     // 조회 중 중복 lookup 무시(연속 paste·연타)
      var digits = String(raw || '').replace(/\D/g, '');
      out.textContent = ''; setNote(note, '');
      go.disabled = true; go.textContent = '확인 중…';
      api({ action: 'orderLookup', orderId: digits }).then(function (d) {
        go.disabled = false; go.textContent = '찾기';
        numIn.value = '';                                            // 프라이버시: 조회 후 비움
        if (d && d.ok && d.orders && d.orders.length) {
          handleOrders(d.orders);
        } else if (d && d.retryable) {
          setNote(note, d.error || '잠시 후 다시 시도해 주세요.', true);
        } else {
          setNote(note, '주문을 확인하지 못했습니다. 주문번호를 다시 확인해 주세요. 그냥 아래에서 제품을 골라도 됩니다.');
        }
      }, function () {
        go.disabled = false; go.textContent = '찾기';
        numIn.value = '';
        setNote(note, '잠시 후 다시 시도해 주세요.', true);
      });
    }
    go.addEventListener('click', function () { lookup(numIn.value); });
    numIn.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); lookup(numIn.value); } });
    numIn.addEventListener('paste', function () {                    // paste 즉시 자동 조회
      setTimeout(function () {
        var v = numIn.value.replace(/\D/g, '');
        if (/^\d{8,24}$/.test(v)) lookup(numIn.value);
      }, 0);
    });
  }

  /* ① 내 제품(기기 기억) — asStore 있고 티켓 있을 때만 */
  function buildKnown(card) {
    if (!window.asStore) return;
    var tickets = [];
    try { tickets = (asStore.tickets && asStore.tickets()) || []; } catch (e) { tickets = []; }
    if (!tickets.length) return;
    var seen = {}, items = [], i, t, key;
    for (i = 0; i < tickets.length; i++) {   // 모델 기준 중복 제거(최신순 가정 — 첫 등장 유지)
      t = tickets[i]; if (!t) continue;
      key = String(t.model || t.modelName || '').toUpperCase();
      if (!key || seen[key]) continue;
      seen[key] = 1; items.push(t);
    }
    if (!items.length) return;
    var box = el('div', 'up-known');
    box.appendChild(el('div', 'up-known-label', '최근 맡기신 제품'));
    var list = el('div', 'up-known-list');
    for (i = 0; i < items.length; i++) {
      (function (tk) {
        var nameText = tk.modelName || tk.model || '';
        var chip = el('button', 'up-known-chip'); chip.type = 'button';
        chip.setAttribute('aria-label', nameText + ' 다시 접수');
        var thumb = el('span', 'up-known-thumb');
        var url = thumbFor(tk.model);
        if (url) {
          var img = document.createElement('img');
          img.src = url; img.alt = ''; img.loading = 'lazy';
          img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); };
          thumb.appendChild(img);
        }
        chip.appendChild(thumb);
        var tx = el('span', 'up-known-tx');
        tx.appendChild(el('span', 'up-known-name', nameText));
        if (tk.createdAt) tx.appendChild(el('span', 'up-known-date', '마지막 접수 ' + String(tk.createdAt).slice(0, 10)));
        chip.appendChild(tx);
        chip.addEventListener('click', function () {
          if (tk.model && modelByCode(tk.model)) applyMatchedProduct({ code: tk.model });
          else applyMatchedProduct({ name: nameText });
        });
        list.appendChild(chip);
      })(items[i]);
    }
    box.appendChild(list);
    box.appendChild(safeCopy('다음에 더 편하게 오시도록 이 기기에만 살짝 기억해 둘게요. 언제든 지울 수 있어요.'));
    card.appendChild(box);
  }

  /* 방법 disclosure(아코디언 — 한 번에 하나만 열림) */
  function buildMethod(iconSvg, labelText, bodyBuildFn) {
    var wrap = el('div', 'up-method');
    var head = el('button', 'up-method-head'); head.type = 'button';
    head.setAttribute('aria-expanded', 'false');
    head.appendChild(iconEl('up-method-ic', iconSvg));
    head.appendChild(el('span', 'up-method-label', labelText));
    head.appendChild(iconEl('up-chev', ICON_CHEV));
    var body = el('div', 'up-method-body');
    bodyBuildFn(body);
    head.addEventListener('click', function () {
      var willOpen = wrap.className.indexOf('is-open') === -1;
      var sibs = wrap.parentNode ? wrap.parentNode.querySelectorAll('.up-method') : [];
      for (var i = 0; i < sibs.length; i++) {
        sibs[i].className = 'up-method';
        var h = sibs[i].querySelector('.up-method-head'); if (h) h.setAttribute('aria-expanded', 'false');
      }
      if (willOpen) { wrap.className = 'up-method is-open'; head.setAttribute('aria-expanded', 'true'); }
    });
    wrap.appendChild(head); wrap.appendChild(body);
    return wrap;
  }

  function renderUpstairs() {
    var host = document.getElementById('upstairs');
    if (!host) return;
    host.textContent = '';
    var card = el('div', 'up-card');
    var head = el('div', 'up-head');
    head.appendChild(el('span', 'up-eyebrow', '빠른 시작'));
    head.appendChild(el('div', 'up-title', '어떤 제품인지 빠르게 찾아드릴게요'));
    head.appendChild(el('p', 'up-sub', '아래 방법이 편하면 이용해 보세요. 바로 아래 목록에서 골라도 됩니다.'));
    card.appendChild(head);
    buildKnown(card);
    var methods = el('div', 'up-methods');
    if (!phoneCollapsed) methods.appendChild(buildMethod(ICON_BAG, '네이버로 구매하셨어요?', buildPhoneBody));
    methods.appendChild(buildMethod(ICON_CAMERA, '사진으로 찾기', buildPhotoBody));
    methods.appendChild(buildMethod(ICON_RECEIPT, '주문번호로 찾기', buildOrderBody));
    card.appendChild(methods);
    host.appendChild(card);
  }

  /* ========================= [S4] 증상 → 사진 → 연락처 → 제출 → 완료 =========================
     소비: state/completeSection/openSection/renderAside(S2), applyMatchedProduct·autofillContact(S3),
           api(S1), window.ClapaAsMedia(as-media.js), window.asStore(S5, if 가드).
     필수 4: 제품·증상(칩∨텍스트)·이름·휴대폰. 첨부는 비차단(asUpload). */

  /* 개발자 상수 아이콘(innerHTML 허용 — 사용자·서버 데이터 아님) */
  var ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4 10-11"/></svg>';
  var ICON_VIDEO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h8A1.5 1.5 0 0 1 15 6.5v11A1.5 1.5 0 0 1 13.5 19h-8A1.5 1.5 0 0 1 4 17.5z"/><path d="m15 10 5-3v10l-5-3z"/></svg>';
  var AS_TALK = 'https://talk.naver.com/ct/w44cu1?frm=psf';   // 네이버 톡톡 상담 채널(chat.js와 동일)
  var AS_STEPS = ['접수', '확인중', '처리중', '완료'];         // as-status.js STEPS와 동일(발명 금지)

  /* 아코디언 헤드 a11y: 제목에 heading 시맨틱 + 열림 상태 aria-expanded(구조 침습 없이) */
  function headA11y(head, titleEl, key) {
    if (titleEl) { titleEl.setAttribute('role', 'heading'); titleEl.setAttribute('aria-level', '3'); }
    head.setAttribute('aria-expanded', sectionState[key] === 'open' ? 'true' : 'false');
  }

  /* 공용 섹션 헤드(증상·사진·연락처) — 완료 시 요약 줄 + 변경 버튼 */
  function secHead(key, num, titleText) {
    var head = el('div', 'sec-head');
    head.appendChild(el('span', 'sec-num', num));
    var main = el('span', 'sec-head-main');
    var titleEl;
    if (sectionState[key] === 'done') {
      titleEl = el('div', 'sec-done-line', sectionSummary[key]);
      main.appendChild(titleEl);
      head.appendChild(main);
      var editBtn = el('button', 'sec-edit', '변경'); editBtn.type = 'button';
      editBtn.addEventListener('click', function (e) { e.stopPropagation(); reopenSection(key); });
      head.appendChild(editBtn);
      head.addEventListener('click', function () { reopenSection(key); });
    } else {
      titleEl = el('span', 'sec-title', titleText);
      main.appendChild(titleEl);
      head.appendChild(main);
    }
    headA11y(head, titleEl, key);
    return head;
  }

  /* ---- 증상 섹션(카테고리별 칩 + textarea) ----
     칩 근거: 기존 폼 v2 #as-chips 계승 + FAQ '상황' 라인 + 심층분석 실빈도.
     발명 금지 — 근거 없는 증상 문구는 만들지 않고 공통칩만 유지. */
  var SYM_COMMON = ['전원이 안 켜져요', '소음·진동', '파손·부품이 필요해요'];  // v2 #as-chips 계승(전 카테고리 공통)
  var SYM_BY_CAT = {
    wireless: ['충전이 안 돼요', '흡입력이 약해요', '사용 시간이 짧아요'],       // v2칩 + FAQ 충전불량/흡입력저하/사용시간단축
    wetdry:   ['흡입력이 약해요'],                                             // v2 '흡입력 약함' + FAQ(유선=충전 제외)
    fan:      ['충전이 안 돼요'],                                              // 무선선풍기 다수 + FAQ '완충 표시인데 작동 안 됨'
    heat:     [],                                                             // 근거 불충분 → 공통칩만
    dehum:    ['물이 넘쳐요'],                                                 // 심층분석 '만수 아닌데 넘침' + FAQ 만수센서 오작동
    living:   []                                                              // 근거 불충분 → 공통칩만
  };
  function currentCat() {
    if (state.product && state.product.code) {
      var m = modelByCode(state.product.code);
      if (m && m.cat) return m.cat;
    }
    return '';
  }
  function chipsForCategory() {
    var cat = currentCat();
    var extra = (cat && SYM_BY_CAT[cat]) ? SYM_BY_CAT[cat] : [];
    var out = extra.concat(SYM_COMMON);
    // 이미 선택된 칩이 현재 세트에 없으면(제품 변경 등) 그대로 노출해 해제 가능하게 유지
    var picked = state.symptom.chips, i;
    for (i = 0; i < picked.length; i++) { if (out.indexOf(picked[i]) === -1) out.push(picked[i]); }
    out.push('기타');
    return out;
  }
  function toggleChip(label, chipEl) {
    var idx = state.symptom.chips.indexOf(label), on;
    if (idx === -1) { state.symptom.chips.push(label); on = true; }
    else { state.symptom.chips.splice(idx, 1); on = false; }
    chipEl.className = 'chip' + (on ? ' on' : '');
    chipEl.setAttribute('aria-pressed', on ? 'true' : 'false');
    renderAside();
  }
  function symptomShort() {
    var s = state.symptom;
    if (s.chips.length) { var j = s.chips.join(', '); return j.length > 30 ? j.slice(0, 30) + '…' : j; }
    var t = s.text.trim();
    return t.length > 24 ? t.slice(0, 24) + '…' : t;
  }
  function submitSymptom() {
    if (!state.symptom.chips.length && !state.symptom.text.trim()) { showToast('증상을 선택하거나 적어 주세요.'); return; }
    completeSection('symptom', '✓ 증상 — ' + symptomShort());
  }
  function renderSymptomSection() {
    var host = document.getElementById('sec-symptom');
    if (!host) return;
    host.className = 'sec-card ' + stateToClass(sectionState.symptom);
    host.textContent = '';
    host.appendChild(secHead('symptom', '2', '증상'));

    var body = el('div', 'sec-body');
    body.appendChild(el('p', 'sec-help', '어떤 증상인지 골라 주세요. 여러 개 선택할 수 있어요.'));
    var chipWrap = el('div', 'sym-chips');
    chipWrap.setAttribute('role', 'group'); chipWrap.setAttribute('aria-label', '증상 유형 선택');
    var labels = chipsForCategory(), i;
    for (i = 0; i < labels.length; i++) {
      (function (label) {
        var on = state.symptom.chips.indexOf(label) !== -1;
        var chip = el('button', 'chip' + (on ? ' on' : ''), label); chip.type = 'button';
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        chip.addEventListener('click', function () { toggleChip(label, chip); });
        chipWrap.appendChild(chip);
      })(labels[i]);
    }
    body.appendChild(chipWrap);

    var ta = document.createElement('textarea');
    ta.className = 'sym-text'; ta.rows = 3; ta.maxLength = 1000;
    ta.placeholder = '더 자세히 적어주시면 처리가 빨라져요 (선택)';
    ta.setAttribute('aria-label', '증상 자세히 적기');
    ta.value = state.symptom.text;
    ta.addEventListener('input', function () { state.symptom.text = ta.value; renderAside(); });
    body.appendChild(ta);

    var next = el('button', 'sec-next', '다음'); next.type = 'button';
    next.addEventListener('click', submitSymptom);
    body.appendChild(next);
    host.appendChild(body);
  }

  /* symptom 전송 포맷 "칩1, 칩2 — 직접입력"(확정 계약) */
  function buildSymptom() {
    var joined = state.symptom.chips.join(', ');
    var text = state.symptom.text.trim();
    if (joined && text) return joined + ' — ' + text;
    return joined || text;
  }

  /* ---- 사진·영상 섹션(선택·비차단) ---- */
  var MAX_PHOTOS = 5, MAX_VIDEO_MB = 25, ORIGINAL_IMG_MAX_MB = 5;
  function photoCount() { var n = 0, i; for (i = 0; i < state.photos.length; i++) { if (state.photos[i].kind === 'image') n++; } return n; }
  function hasVideo() { var i; for (i = 0; i < state.photos.length; i++) { if (state.photos[i].kind === 'video') return true; } return false; }
  function photoSummary() {
    var n = state.photos.length;
    return n ? ('✓ 사진·영상 ' + n + '개') : '사진 없이 진행';
  }
  function renderPhotoTiles(tiles) {
    tiles.textContent = '';
    var i;
    for (i = 0; i < state.photos.length; i++) {
      (function (item, idx) {
        var tile = el('div', 'ph-tile');
        if (item.kind === 'image' && item.url) {
          var img = document.createElement('img');
          img.src = item.url; img.alt = item.name || '';
          tile.appendChild(img);
        } else {
          var vid = el('div', 'ph-tile-vid');
          vid.appendChild(iconEl('', ICON_VIDEO));
          vid.appendChild(el('span', null, '영상'));
          tile.appendChild(vid);
        }
        tile.appendChild(el('span', 'ph-tile-name', item.name || ''));
        var rm = el('button', 'ph-rm', '×'); rm.type = 'button';
        rm.setAttribute('aria-label', (item.name || '첨부') + ' 삭제');
        rm.addEventListener('click', function (e) {
          e.stopPropagation();
          try { if (item.url) URL.revokeObjectURL(item.url); } catch (er) {}
          state.photos.splice(idx, 1);
          renderPhotoTiles(tiles); renderAside();
        });
        tile.appendChild(rm);
        tiles.appendChild(tile);
      })(state.photos[i], i);
    }
  }
  function addPhotoFiles(files, tiles, note) {
    var added = 0, i;
    for (i = 0; i < files.length; i++) {
      var f = files[i];
      var isImage = /^image\//.test(f.type);
      var isVideo = f.type === 'video/mp4' || f.type === 'video/quicktime';
      if (!isImage && !isVideo) { setNote(note, '사진 또는 영상(mp4·mov) 파일만 올릴 수 있어요.'); continue; }
      if (isImage && photoCount() >= MAX_PHOTOS) { setNote(note, '사진은 최대 5장까지 올릴 수 있어요.'); continue; }
      if (isVideo && hasVideo()) { setNote(note, '영상은 1개만 올릴 수 있어요.'); continue; }
      if (isVideo && f.size > MAX_VIDEO_MB * 1024 * 1024) { setNote(note, '영상이 커요. 접수 후 대화창이나 톡톡으로 보내 주세요.'); continue; }
      var url = ''; try { url = URL.createObjectURL(f); } catch (e) {}
      state.photos.push({ file: f, kind: isImage ? 'image' : 'video', name: f.name, url: url });
      added++;
    }
    if (added) setNote(note, '');
    renderPhotoTiles(tiles); renderAside();
  }
  function bindPhotoDrop(drop, fileIn, tiles, note) {
    drop.addEventListener('click', function () { fileIn.click(); });
    drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 32) { e.preventDefault(); fileIn.click(); }
    });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.className = 'ph-drop hot'; });
    drop.addEventListener('dragleave', function () { drop.className = 'ph-drop'; });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); drop.className = 'ph-drop';
      addPhotoFiles((e.dataTransfer && e.dataTransfer.files) || [], tiles, note);
    });
    fileIn.addEventListener('change', function () { addPhotoFiles(fileIn.files || [], tiles, note); fileIn.value = ''; });
  }
  function renderPhotoSection() {
    var host = document.getElementById('sec-photo');
    if (!host) return;
    host.className = 'sec-card ' + stateToClass(sectionState.photo);
    host.textContent = '';
    host.appendChild(secHead('photo', '3', '사진·영상 (선택)'));

    var body = el('div', 'sec-body');
    body.appendChild(el('p', 'sec-help', '증상이 보이는 사진이나 짧은 영상을 올려주시면 접수 확인이 빨라져요. 없어도 접수할 수 있어요.'));

    var drop = el('div', 'ph-drop');
    drop.setAttribute('role', 'button'); drop.tabIndex = 0;
    drop.setAttribute('aria-label', '사진·영상 첨부 선택');
    drop.appendChild(iconEl('ph-drop-ic', ICON_UPLOAD));
    drop.appendChild(el('div', 'ph-drop-t', '사진·영상을 여기에 올려 주세요'));
    drop.appendChild(el('div', 'ph-drop-s', '눌러서 선택하거나 끌어다 놓으세요 · 사진 최대 5장, 영상 1개(25MB 이하)'));
    var fileIn = document.createElement('input');
    fileIn.type = 'file'; fileIn.multiple = true; fileIn.accept = 'image/*,video/*';
    fileIn.className = 'ph-file-input'; fileIn.tabIndex = -1; fileIn.setAttribute('aria-hidden', 'true');
    body.appendChild(drop); body.appendChild(fileIn);

    var tiles = el('div', 'ph-tiles');
    body.appendChild(tiles);
    var note = el('div', 'up-note'); note.hidden = true;
    body.appendChild(note);
    body.appendChild(safeCopy('올려주신 사진은 A/S 확인에만 사용합니다.'));

    var next = el('button', 'sec-next', '다음'); next.type = 'button';
    next.addEventListener('click', function () { completeSection('photo', photoSummary()); });
    body.appendChild(next);

    bindPhotoDrop(drop, fileIn, tiles, note);
    renderPhotoTiles(tiles);
    host.appendChild(body);
  }

  /* 첨부 준비(이미지 압축, 실패 시 원본 상한) — 폼 v2 prepareUpload 계승 */
  function preparePhoto(item) {
    var media = window.ClapaAsMedia;
    if (item.kind !== 'image') return Promise.resolve({ blob: item.file, name: item.name, mime: item.file.type });
    if (media && media.compressImage) {
      return media.compressImage(item.file, 1600, 0.8).catch(function () {
        if (item.file.size <= ORIGINAL_IMG_MAX_MB * 1024 * 1024) return { blob: item.file, name: item.name, mime: item.file.type || 'image/jpeg' };
        throw new Error('too-big');
      });
    }
    return Promise.resolve({ blob: item.file, name: item.name, mime: item.file.type });
  }
  /* 순차 업로드(asUpload, 기존 계약) — 접수 성공 후 백그라운드, 실패해도 비차단.
     전부 settle 후 실패분이 있으면 자동소멸 토스트 1회(완료 화면은 그대로 유지). */
  function uploadPhotos(id, phone4, sid) {
    var media = window.ClapaAsMedia;
    var items = state.photos.slice();
    var fails = 0;
    var seq = Promise.resolve();
    items.forEach(function (item) {
      seq = seq.then(function () {
        return preparePhoto(item).then(function (p) {
          if (!(media && media.fileToB64)) { fails++; return null; }
          return media.fileToB64(p.blob).then(function (b64) {
            return fetch(ENDPOINT, {
              method: 'POST', headers: { 'Content-Type': 'text/plain' },
              body: JSON.stringify({ action: 'asUpload', sessionId: sid, id: id, phone4: phone4, name: p.name, mime: p.mime, data: b64 })
            }).then(function (r) { return r.json(); })
              .then(function (d) { if (!(d && d.ok)) fails++; });
          });
        }).catch(function () { fails++; });   // 개별 실패는 삼키되 카운트
      });
    });
    return seq.then(function () {
      if (fails > 0) showToast('사진 일부가 전송되지 않았어요. 네이버 톡톡으로 보내주시면 확인해 드릴게요.');
    });
  }

  /* ---- 연락처 섹션 ---- */
  function formatPhone(v) {
    var d = String(v || '').replace(/\D/g, '').slice(0, 11);
    if (d.length < 4) return d;
    if (d.length < 7) return d.slice(0, 3) + '-' + d.slice(3);
    if (d.length < 11) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
    return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
  }
  function contactPrefilled() {
    var c = state.contact;
    return !!(c.name || c.phone || c.store || c.purchaseDate || c.address);
  }
  function ctField(labelText, key, opts) {
    opts = opts || {};
    var wrap = el('div', 'ct-field');
    var id = 'ct-' + key;
    var lab = el('label', 'ct-label', labelText); lab.setAttribute('for', id);
    if (opts.required) lab.appendChild(el('span', 'ct-req', '필수'));
    wrap.appendChild(lab);
    var input = document.createElement('input');
    input.id = id; input.className = 'ct-input'; input.type = opts.type || 'text';
    if (opts.inputmode) input.setAttribute('inputmode', opts.inputmode);
    if (opts.autocomplete) input.autocomplete = opts.autocomplete;
    input.maxLength = opts.maxLength || 60;
    if (opts.placeholder) input.placeholder = opts.placeholder;
    input.value = state.contact[key] || '';
    input.addEventListener('input', function () {
      if (key === 'phone') input.value = formatPhone(input.value);
      state.contact[key] = input.value;
      renderAside();
    });
    wrap.appendChild(input);
    return wrap;
  }
  function renderContactSection() {
    var host = document.getElementById('sec-contact');
    if (!host) return;
    host.className = 'sec-card ' + stateToClass(sectionState.contact);
    host.textContent = '';
    host.appendChild(secHead('contact', '4', '연락처'));

    var body = el('div', 'sec-body');
    if (contactPrefilled()) body.appendChild(el('p', 'ct-prefill', '입력하신 정보로 미리 채웠어요. 다른 분 접수라면 고쳐 주세요.'));
    else body.appendChild(el('p', 'sec-help', 'A/S 안내를 받으실 연락처를 남겨 주세요.'));

    body.appendChild(ctField('이름', 'name', { required: true, maxLength: 40, autocomplete: 'name', placeholder: '받으실 분 이름' }));
    body.appendChild(ctField('휴대폰', 'phone', { required: true, type: 'tel', inputmode: 'tel', maxLength: 20, autocomplete: 'tel', placeholder: '010-0000-0000' }));
    body.appendChild(ctField('주소', 'address', { maxLength: 120, autocomplete: 'street-address', placeholder: '수리품 회수·발송 주소 (선택)' }));
    var grid = el('div', 'ct-grid');
    grid.appendChild(ctField('구매처', 'store', { maxLength: 40, placeholder: '예) 네이버 스토어 (선택)' }));
    grid.appendChild(ctField('구매일', 'purchaseDate', { maxLength: 20, placeholder: '예) 2025-06 (선택)' }));
    body.appendChild(grid);

    var safe = el('p', 'ct-safe');
    safe.appendChild(iconEl('', ICON_LOCK));
    safe.appendChild(el('span', null, '남겨주신 연락처는 A/S 안내에만 사용합니다.'));
    body.appendChild(safe);
    host.appendChild(body);
  }

  /* ---- 제출 + 완료 화면 ---- */
  function validateIntake() {
    if (!state.product && !state.freeProduct) return { ok: false, msg: '제품을 선택하거나 이름을 입력해 주세요.' };
    if (!state.symptom.chips.length && !state.symptom.text.trim()) return { ok: false, msg: '증상을 선택하거나 적어 주세요.' };
    if (!state.contact.name.trim()) return { ok: false, msg: '이름을 입력해 주세요.' };
    if (!/^[0-9\-]{9,20}$/.test(state.contact.phone)) return { ok: false, msg: '연락처를 확인해 주세요.' };
    return { ok: true };
  }
  function submitIntake() {
    var v = validateIntake();
    if (!v.ok) { showToast(v.msg); return; }
    var sid = sidValue();
    var body = {
      action: 'as', name: state.contact.name.trim(),
      model: state.product ? state.product.code : state.freeProduct,
      symptom: buildSymptom(), phone: state.contact.phone,
      sessionId: sid, page: 'as'
    };
    if (state.order) body.order = state.order;                       // 주문조회로 확정된 구매정보
    var extra = {};
    if (state.contact.store) extra.store = state.contact.store;
    if (state.contact.purchaseDate) extra.purchaseDate = state.contact.purchaseDate;
    if (state.contact.address) extra.address = state.contact.address;
    for (var k in extra) { body.extra = extra; break; }
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}  // 모바일 키보드 내리기
    var btn = document.querySelector('#sec-submit .as-submit');
    if (btn) { btn.disabled = true; btn.textContent = '접수하는 중…'; }
    api(body).then(function (d) {
      if (d && d.ok && d.id) { onIntakeDone(d.id, sid); }
      else {
        if (btn) { btn.disabled = false; btn.textContent = 'A/S 접수하기'; }
        showToast((d && d.error) || '접수에 실패했어요. 잠시 후 다시 시도해 주세요.');
      }
    }).catch(function () {
      if (btn) { btn.disabled = false; btn.textContent = 'A/S 접수하기'; }
      showToast('연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.');
    });
  }
  function onIntakeDone(id, sid) {
    var phone4 = state.contact.phone.replace(/\D/g, '').slice(-4);
    if (window.asStore) {   // S5 정의 전이면 무해, 후엔 자동 반영
      try {
        asStore.addTicket({
          id: id, phone4: phone4,
          model: (state.product ? state.product.code : ''),
          modelName: (state.product ? state.product.name : state.freeProduct),
          createdAt: new Date().toISOString(), lastStatus: '접수', lastStep: 0, closedAt: null
        });
        asStore.saveProfile({ name: state.contact.name.trim(), phone: state.contact.phone, savedAt: new Date().toISOString() });
      } catch (e) {}
    }
    try { sessionStorage.setItem('asStatus.cred', JSON.stringify({ id: id, phone4: phone4 })); } catch (e) {}  // 조회 자동조회용(as-status 계승)
    if (state.photos.length) { try { uploadPhotos(id, phone4, sid || sidValue()); } catch (e) {} }              // 백그라운드 첨부(비차단)
    renderDone(id);
  }
  function buildStepper(activeIdx) {
    var wrap = el('div', 'done-steps');
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', '진행 상태: ' + AS_STEPS[activeIdx] + ' (' + (activeIdx + 1) + '/' + AS_STEPS.length + ')');
    var i;
    for (i = 0; i < AS_STEPS.length; i++) {
      if (i > 0) wrap.appendChild(el('span', 'done-bar' + (i <= activeIdx ? ' is-done' : '')));
      var cls = 'done-step' + (i < activeIdx ? ' is-done' : (i === activeIdx ? ' is-now' : ''));
      var step = el('div', cls);
      step.appendChild(el('span', 'done-dot'));
      step.appendChild(el('span', 'done-step-l', AS_STEPS[i]));
      wrap.appendChild(step);
    }
    return wrap;
  }
  function renderDone(id) {
    var live = document.getElementById('intake-live');
    var done = document.getElementById('intake-done');
    if (!done) return;
    if (live) live.style.display = 'none';
    var maint = document.getElementById('intake-maint'); if (maint) maint.hidden = true;
    done.hidden = false; done.textContent = '';

    var card = el('div', 'done-card');
    card.appendChild(iconEl('done-check', ICON_CHECK));
    var title = el('div', 'done-title', '접수가 완료됐어요');
    title.setAttribute('role', 'heading'); title.setAttribute('aria-level', '2');
    card.appendChild(title);
    card.appendChild(el('p', 'done-sub', '담당자가 확인 후 순서대로 안내해 드릴게요.'));

    var tno = el('div', 'done-ticket');
    tno.appendChild(el('span', 'done-ticket-k', '접수번호'));
    tno.appendChild(el('span', 'done-ticket-v', id));
    card.appendChild(tno);

    card.appendChild(buildStepper(0));   // '접수' 단계 활성

    card.appendChild(el('p', 'done-save', '이 기기에 저장되어 다음부터는 ‘내 접수 조회’에서 바로 보입니다.'));

    var acts = el('div', 'done-acts');
    var goBtn = el('button', 'done-go', '내 접수 조회로'); goBtn.type = 'button';
    goBtn.addEventListener('click', function () { setTab('status'); });
    acts.appendChild(goBtn);
    var tel = el('a', 'done-tel', '전화 1522-8508'); tel.href = 'tel:1522-8508';
    acts.appendChild(tel);
    card.appendChild(acts);

    var talk = el('a', 'done-talk', '네이버 톡톡으로 문의'); talk.href = AS_TALK;
    talk.target = '_blank'; talk.rel = 'noopener';
    card.appendChild(talk);

    var safe = el('p', 'done-safe');
    safe.appendChild(iconEl('', ICON_LOCK));
    safe.appendChild(el('span', null, '남겨주신 연락처는 A/S 안내에만 사용합니다.'));
    card.appendChild(safe);

    done.appendChild(card);
    try { done.scrollIntoView({ block: 'start' }); } catch (e) {}
    try { goBtn.focus(); } catch (e) {}
  }
  function renderSubmit() {
    var host = document.getElementById('sec-submit');
    if (!host) return;
    host.textContent = '';
    var btn = el('button', 'as-submit', 'A/S 접수하기'); btn.type = 'button';
    btn.addEventListener('click', submitIntake);
    host.appendChild(btn);
    host.appendChild(el('p', 'as-submit-note', '접수 후 이 기기에서는 다음부터 입력 없이 진행 상태를 확인하실 수 있어요.'));
  }

  /* ========================= [S5] 기기 기억(asStore) + 조회 탭 =========================
     소비: el/api/showToast/setTab(S1), ID_QUERY(S1), state·modelByCode·thumbFor·renderAside(S2),
           safeCopy·setNote·ICON_LOCK(S3), state.contact·renderContactSection·AS_STEPS(S4),
           window.ClapaAsMedia(as-media.js), sessionStorage 'asStatus.cred'(S4가 저장).
     이식 원본: as-status.html/as-status.js(스테퍼·말풍선 대화·15초 폴링·asFile 썸네일·관대한 접수번호 파싱).
     원칙: 렌더는 textContent 전용(XSS). 비차단(모달 없음). 폴링은 상세 열람 중 + 조회 탭 표시 + 페이지 visible 일 때만(GAS 쿼터 보호). */

  /* ---- asStore 모듈(기기 기억) — 확정 계약 스키마·키 그대로. S3·S4가 window.asStore 가드로 소비 ---- */
  var STORE_KEYS = { profile: 'clapaAs.v1.profile', tickets: 'clapaAs.v1.tickets' };
  window.asStore = {
    profile: function () { try { return JSON.parse(localStorage.getItem(STORE_KEYS.profile) || 'null'); } catch (e) { return null; } },
    saveProfile: function (p) { try { localStorage.setItem(STORE_KEYS.profile, JSON.stringify({ name: p.name, phone: p.phone, savedAt: Date.now() })); } catch (e) {} },
    tickets: function () { try { var t = JSON.parse(localStorage.getItem(STORE_KEYS.tickets) || '[]'); return Array.isArray(t) ? t : []; } catch (e) { return []; } },
    addTicket: function (t) {
      try {
        var list = this.tickets();
        list = list.filter(function (x) { return x.id !== t.id; });
        list.unshift(t);
        if (list.length > 20) {
          // 최대 20 — 완료(closedAt) 오래된 것부터 정리. 진행 중은 유지, 완료는 최신만 남긴다.
          list.sort(function (a, b) {
            var ac = a.closedAt ? 1 : 0, bc = b.closedAt ? 1 : 0;
            if (ac !== bc) return ac - bc;                         // 진행 중 먼저(완료를 뒤로)
            var av = String(a.createdAt || ''), bv = String(b.createdAt || '');
            return av < bv ? 1 : (av > bv ? -1 : 0);              // 최신 먼저 → 오래된 완료가 맨 뒤에 잘림
          });
          list = list.slice(0, 20);
        }
        localStorage.setItem(STORE_KEYS.tickets, JSON.stringify(list));
      } catch (e) {}
    },
    updateTicket: function (id, patch) {
      try {
        var list = this.tickets();
        for (var i = 0; i < list.length; i++) if (list[i].id === id) { for (var k in patch) list[i][k] = patch[k]; }
        localStorage.setItem(STORE_KEYS.tickets, JSON.stringify(list));
      } catch (e) {}
    },
    clearAll: function () { try { localStorage.removeItem(STORE_KEYS.profile); localStorage.removeItem(STORE_KEYS.tickets); } catch (e) {} }
  };

  /* ---- 조회 탭 상수·상태 ---- */
  var STX_PHONE = '1522-8508';
  var STX_HOURS = '평일 09:00~15:00';
  var STX_LOOKUP_FAIL = '접수 내역을 확인하지 못했어요. 접수번호와 연락처 뒷 4자리를 다시 확인해 주세요.';   // 불일치·미존재 동일 문구(열거 방지)
  var CRED_KEY = 'asStatus.cred';

  var statusBuilt = false;   // 조회 탭 골격 1회 빌드 가드
  var idFocusDone = false;   // ?id= 자동 포커스 1회만
  var detailOpen = false;    // 상세 열람 중(폴링 게이트)
  var detailCred = null;     // 현재 상세의 {id, phone4}
  var topSig = null;         // 재방문 인사·중복 안내 재렌더 서명(키 입력마다 깜빡임 방지)
  var profilePrefilled = false;

  /* 대화 스레드 폴링 상태(as-status.js 이식) */
  var pollTimer = null, msgsSeq = 0, lastTs = '', renderedSig = '', firstLoad = true;
  var fileCache = {};        // fileId → dataURI(세션 내 불변 캐시)
  var baseTitle = (document.title || ''), titleFlagged = false;
  var THREAD = null;         // 현재 상세의 대화 노드 참조 {sec,list,form,input,send,attach,file}

  function nowIso() { try { return new Date().toISOString(); } catch (e) { return ''; } }

  /* 관대한 접수번호 파싱 — 'as 260710 160225'·'AS-260710-160225'·'260710160225' 모두 허용(as-status 이식) */
  function normalizeAsId(raw) {
    var d = String(raw == null ? '' : raw).replace(/\D/g, '');
    if (d.length !== 12) return '';
    return 'AS-' + d.slice(0, 6) + '-' + d.slice(6);
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
  function saveCredSession(id, phone4) { try { sessionStorage.setItem(CRED_KEY, JSON.stringify({ id: id, phone4: phone4 })); } catch (e) {} }
  function ticketKnown(id) {
    if (!window.asStore) return false;
    var list = asStore.tickets(), i;
    for (i = 0; i < list.length; i++) { if (list[i] && list[i].id === id) return true; }
    return false;
  }
  function sameProductInProgress(code) {
    if (!window.asStore || !code) return null;
    var list = asStore.tickets(), i, c = String(code).toUpperCase();
    for (i = 0; i < list.length; i++) {
      if (list[i] && !list[i].closedAt && String(list[i].model || '').toUpperCase() === c) return list[i];
    }
    return null;
  }
  function formatTs(ts) {
    var s = String(ts == null ? '' : ts);
    var m = s.match(/^\d{4}-(\d{2}-\d{2})[T ](\d{2}:\d{2})/);   // 'yyyy-MM-dd HH:mm:ss'·ISO → 'MM-dd HH:mm'
    return m ? (m[1] + ' ' + m[2]) : s;
  }

  /* ---- 자동 목록(기기 기억) ---- */
  function miniSteps(step) {
    var w = el('div', 'tk-steps'), i;
    for (i = 0; i < 4; i++) {
      if (i > 0) w.appendChild(el('span', 'tk-bar' + (i <= step ? ' on' : '')));
      w.appendChild(el('span', 'tk-dot' + (i <= step ? ' on' : '')));
    }
    return w;
  }
  function ticketCard(t) {
    var card = el('button', 'tk-card'); card.type = 'button';
    var name = t.modelName || t.model || t.id;
    card.setAttribute('aria-label', name + ' 접수 상세 보기');
    var thumb = el('span', 'tk-thumb');
    var url = thumbFor(t.model);
    if (url) {
      var img = document.createElement('img');
      img.src = url; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); };
      thumb.appendChild(img);
    }
    card.appendChild(thumb);
    var body = el('div', 'tk-body');
    body.appendChild(el('div', 'tk-title', name));
    body.appendChild(el('div', 'tk-id', t.id));
    if (t.lastStatus === '취소' || t.lastStatus === '보류') {
      body.appendChild(el('span', 'tk-badge ' + (t.lastStatus === '취소' ? 'is-cancel' : 'is-hold'),
        t.lastStatus === '취소' ? '접수 취소' : '처리 보류'));
    } else {
      var step = (typeof t.lastStep === 'number' && t.lastStep >= 0) ? Math.min(t.lastStep, 3) : 0;
      var row = el('div', 'tk-statusrow');
      row.appendChild(miniSteps(step));
      row.appendChild(el('span', 'tk-stlabel', t.lastStatus || AS_STEPS[step]));
      body.appendChild(row);
    }
    card.appendChild(body);
    card.appendChild(el('span', 'tk-go', '보기'));
    card.addEventListener('click', function () { openTicketDetail(t.id, t.phone4); });
    return card;
  }
  function renderTicketList() {
    var host = document.getElementById('ticket-list');
    if (!host) return;
    host.textContent = '';
    var tickets = (window.asStore ? asStore.tickets() : []);
    var active = [], past = [], i;
    for (i = 0; i < tickets.length; i++) { if (!tickets[i]) continue; (tickets[i].closedAt ? past : active).push(tickets[i]); }
    if (!tickets.length) {
      var empty = el('div', 'tk-empty');
      empty.appendChild(el('p', 'tk-empty-t', '이 기기로 접수한 내역이 없습니다.'));
      empty.appendChild(el('p', 'tk-empty-s', '접수하시면 이 기기에서 다음부터 입력 없이 진행 상태를 확인할 수 있어요.'));
      var go = el('button', 'tk-empty-go', '접수하러 가기'); go.type = 'button';
      go.addEventListener('click', function () { setTab('intake'); });
      empty.appendChild(go);
      host.appendChild(empty);
      renderClear();
      return;
    }
    if (active.length) {
      var g = el('div', 'tk-group');
      g.appendChild(el('div', 'tk-group-h', '진행 중인 접수'));
      var al = el('div', 'tk-cards');
      for (i = 0; i < active.length; i++) al.appendChild(ticketCard(active[i]));
      g.appendChild(al);
      host.appendChild(g);
    }
    if (past.length) {
      var pg = el('details', 'tk-past');
      pg.appendChild(el('summary', 'tk-past-h', '지난 접수 ' + past.length + '건'));
      var pl = el('div', 'tk-cards');
      for (i = 0; i < past.length; i++) pl.appendChild(ticketCard(past[i]));
      pg.appendChild(pl);
      host.appendChild(pg);
    }
    renderClear();
  }

  /* ---- 기억 지우기(비모달 인라인 확인) ---- */
  function renderClear() {
    var host = document.getElementById('status-clear');
    if (!host) return;
    host.textContent = '';
    var has = window.asStore && (asStore.profile() || asStore.tickets().length);
    if (!has) return;
    var btn = el('button', 'stx-clear', '이 기기의 기억 지우기'); btn.type = 'button';
    btn.addEventListener('click', function () { confirmClear(host); });
    host.appendChild(btn);
  }
  function confirmClear(host) {
    host.textContent = '';
    var box = el('div', 'stx-confirm');
    box.appendChild(el('p', 'stx-confirm-t', '이 기기에 저장된 접수 목록과 연락처를 지울까요? 접수 자체는 사라지지 않고, 이 기기에서 자동으로 보이지 않게 됩니다.'));
    var row = el('div', 'stx-confirm-row');
    var yes = el('button', 'stx-confirm-yes', '지우기'); yes.type = 'button';
    var no = el('button', 'stx-confirm-no', '그대로 두기'); no.type = 'button';
    yes.addEventListener('click', function () {
      if (window.asStore) asStore.clearAll();
      topSig = null;
      renderTicketList();
      showToast('이 기기의 기억을 지웠어요.');
    });
    no.addEventListener('click', function () { renderClear(); });
    row.appendChild(yes); row.appendChild(no);
    box.appendChild(row);
    host.appendChild(box);
  }

  /* ---- 수동 조회 폼 ---- */
  function renderManualLookup() {
    var host = document.getElementById('manual-lookup');
    if (!host) return;
    host.textContent = '';
    var card = el('div', 'ml-card');
    card.appendChild(el('div', 'ml-title', '접수번호로 조회하기'));
    card.appendChild(el('p', 'ml-sub', '다른 기기에서 접수하셨거나 목록에 없으면, 접수번호와 연락처 뒷 4자리로 확인할 수 있어요.'));
    var f1 = el('div', 'up-field');
    var idIn = document.createElement('input');
    idIn.type = 'text'; idIn.className = 'up-input'; idIn.id = 'ml-id'; idIn.maxLength = 40;
    idIn.placeholder = '예) AS-260710-160225'; idIn.autocomplete = 'off';
    idIn.setAttribute('autocapitalize', 'characters'); idIn.setAttribute('autocorrect', 'off');
    idIn.setAttribute('aria-label', '접수번호');
    f1.appendChild(idIn);
    var f2 = el('div', 'up-field');
    var p4 = document.createElement('input');
    p4.type = 'text'; p4.className = 'up-input'; p4.id = 'ml-p4'; p4.maxLength = 4;
    p4.placeholder = '연락처 뒷 4자리'; p4.autocomplete = 'off';
    p4.setAttribute('inputmode', 'numeric'); p4.setAttribute('pattern', '[0-9]*'); p4.setAttribute('aria-label', '연락처 뒷 4자리');
    var go = el('button', 'up-go', '조회하기'); go.type = 'button';
    f2.appendChild(p4); f2.appendChild(go);
    var note = el('div', 'up-note'); note.hidden = true;
    card.appendChild(f1); card.appendChild(f2); card.appendChild(note);
    card.appendChild(safeCopy('입력하신 정보는 조회 확인에만 사용하고 저장하지 않아요.'));
    host.appendChild(card);

    var cred = loadCred();   // 같은 세션에서 접수 직후 편의(S4가 저장한 asStatus.cred)
    if (cred) { if (cred.id) idIn.value = cred.id; if (cred.phone4) p4.value = cred.phone4; }

    function run() {
      if (go.disabled) return;
      var id = normalizeAsId(idIn.value);
      var pin = String(p4.value || '').replace(/\D/g, '');
      if (!id) { setNote(note, '접수번호를 다시 확인해 주세요. 예) AS-260710-160225'); return; }
      if (pin.length !== 4) { setNote(note, '연락처 뒷 4자리를 숫자로 입력해 주세요.'); return; }
      idIn.value = id; setNote(note, '');
      go.disabled = true; go.textContent = '조회 중…';
      try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}  // 모바일 키보드 내리기
      api({ action: 'asStatus', id: id, phone4: pin }).then(function (d) {
        go.disabled = false; go.textContent = '조회하기';
        if (d && d.ok) { showDetailView(id, pin, d); }
        else { setNote(note, STX_LOOKUP_FAIL); }
      }, function () {
        go.disabled = false; go.textContent = '조회하기';
        setNote(note, '연결이 원활하지 않아요. 잠시 후 다시 시도하시거나 전화(' + STX_PHONE + ', ' + STX_HOURS + ')로 확인해 주세요.', true);
      });
    }
    go.addEventListener('click', run);
    p4.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); run(); } });
    idIn.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); p4.focus(); } });
  }

  /* ---- 상세(스테퍼 + 대화) ---- */
  function showListPane() { var l = document.getElementById('status-list'), d = document.getElementById('ticket-detail'); if (l) l.hidden = false; if (d) d.hidden = true; }
  function showDetailPane() { var l = document.getElementById('status-list'), d = document.getElementById('ticket-detail'); if (l) l.hidden = true; if (d) d.hidden = false; }
  function detailHeader() {
    var back = el('button', 'stx-back', '← 목록으로'); back.type = 'button';
    back.addEventListener('click', closeDetail);
    return back;
  }
  function closeDetail() {
    detailOpen = false; stopPoll(); detailCred = null; THREAD = null;
    clearTitleFlag();
    showListPane();
    renderTicketList();   // 상세에서 갱신한 캐시(lastStatus) 반영
    try { window.scrollTo({ top: 0 }); } catch (e) {}
  }
  function renderStepper(host, step) {
    host.textContent = ''; host.hidden = false;
    host.setAttribute('aria-label', '진행 상태: ' + AS_STEPS[step] + ' (' + (step + 1) + '/' + AS_STEPS.length + ')');
    for (var i = 0; i < AS_STEPS.length; i++) {
      if (i > 0) host.appendChild(el('span', 'stp-bar' + (i <= step ? ' is-done' : '')));
      host.appendChild(el('span', 'stp' + (i < step ? ' is-done' : (i === step ? ' is-now' : '')), AS_STEPS[i]));
    }
  }
  function renderDetailLoading(id) {
    var host = document.getElementById('ticket-detail'); if (!host) return;
    host.textContent = '';
    host.appendChild(detailHeader());
    var card = el('div', 'status-card');
    card.appendChild(el('div', 'st-load', '상태를 확인하고 있어요…'));
    host.appendChild(card);
  }
  function renderDetailError(id, phone4, network) {
    var host = document.getElementById('ticket-detail'); if (!host) return;
    host.textContent = '';
    host.appendChild(detailHeader());
    var card = el('div', 'status-card');
    card.appendChild(el('span', 'st-id', id));
    card.appendChild(el('p', 'st-flag-note', network ? '연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.' : STX_LOOKUP_FAIL));
    var retry = el('button', 'up-go', '다시 시도'); retry.type = 'button';
    retry.addEventListener('click', function () { openTicketDetail(id, phone4); });
    card.appendChild(retry);
    host.appendChild(card);
  }
  function openTicketDetail(id, phone4) {
    id = normalizeAsId(id) || String(id || '').toUpperCase();
    phone4 = String(phone4 || '').replace(/\D/g, '').slice(-4);
    if (phone4.length !== 4) {                                  // 로컬에 phone4 없으면 세션 cred 로 보완
      var cred = loadCred();
      if (cred && cred.id === id && cred.phone4) phone4 = cred.phone4;
    }
    showDetailPane();
    renderDetailLoading(id);
    if (phone4.length !== 4) { renderDetailError(id, phone4, false); return; }
    api({ action: 'asStatus', id: id, phone4: phone4 }).then(function (d) {
      if (d && d.ok) showDetailView(id, phone4, d);
      else renderDetailError(id, phone4, false);
    }, function () { renderDetailError(id, phone4, true); });
  }
  function showDetailView(id, phone4, d) {
    detailCred = { id: id, phone4: phone4 };
    detailOpen = true;
    saveCredSession(id, phone4);
    showDetailPane();
    var host = document.getElementById('ticket-detail'); if (!host) return;
    host.textContent = '';
    host.appendChild(detailHeader());

    var step = (typeof d.step === 'number' && d.step >= 0 && d.step <= 3) ? d.step : 0;
    var known = ticketKnown(id);
    if (known && window.asStore) {   // 알고 있는 티켓이면 캐시 갱신(목록 스테퍼·완료 이동)
      try {
        asStore.updateTicket(id, {
          lastStatus: d.status || AS_STEPS[step],
          lastStep: (typeof d.step === 'number' ? d.step : 0),
          closedAt: (d.step === 3 ? nowIso() : null)
        });
      } catch (e) {}
    }

    var card = el('div', 'status-card');
    var head = el('div', 'st-head');
    head.appendChild(el('span', 'st-id', id));
    var badge = el('span', 'st-badge'); badge.hidden = true; head.appendChild(badge);
    card.appendChild(head);
    var stepper = el('div', 'stepper'); stepper.setAttribute('role', 'img');
    card.appendChild(stepper);
    var flagNote = el('p', 'st-flag-note'); flagNote.hidden = true; card.appendChild(flagNote);

    if (d.flag === 'cancelled' || d.flag === 'held') {
      stepper.hidden = true;
      badge.hidden = false;
      badge.textContent = d.flag === 'cancelled' ? '접수 취소' : '처리 보류';
      badge.className = 'st-badge ' + (d.flag === 'cancelled' ? 'is-cancel' : 'is-hold');
      flagNote.hidden = false;
      flagNote.textContent = d.flag === 'cancelled'
        ? '이 접수는 취소 처리되었습니다. 궁금하신 점은 전화(' + STX_PHONE + ', ' + STX_HOURS + ') 또는 아래 대화로 문의해 주세요.'
        : '이 접수는 잠시 보류 중입니다. 확인이 끝나는 대로 순서대로 연락드리겠습니다.';
    } else {
      renderStepper(stepper, step);
    }

    var meta = el('dl', 'st-meta');
    var m1 = el('div'); m1.appendChild(el('dt', null, '접수일')); m1.appendChild(el('dd', null, d.date ? String(d.date) : '-')); meta.appendChild(m1);
    var m2 = el('div'); m2.appendChild(el('dt', null, '마지막 업데이트')); m2.appendChild(el('dd', null, d.updatedAt ? formatTs(d.updatedAt) : '-')); meta.appendChild(m2);
    card.appendChild(meta);
    host.appendChild(card);

    if (!known) host.appendChild(buildSaveProposal(id, phone4, d, step));   // 수동/?id 조회 → 저장 제안

    host.appendChild(buildThreadSection());   // 상담 대화
    initThread();
  }
  function buildSaveProposal(id, phone4, d, step) {
    var box = el('div', 'stx-save');
    box.appendChild(el('p', 'stx-save-t', '이 기기에 저장할까요? 다음부터 입력 없이 바로 확인할 수 있어요.'));
    var row = el('div', 'stx-save-row');
    var yes = el('button', 'stx-save-yes', '이 기기에 저장'); yes.type = 'button';
    var no = el('button', 'stx-save-no', '아니요'); no.type = 'button';
    yes.addEventListener('click', function () {
      if (window.asStore) {
        try {
          asStore.addTicket({
            id: id, phone4: phone4, model: '', modelName: '',
            createdAt: nowIso(), lastStatus: (d.status || AS_STEPS[step]),
            lastStep: (typeof d.step === 'number' ? d.step : 0), closedAt: (d.step === 3 ? nowIso() : null)
          });
        } catch (e) {}
      }
      if (box.parentNode) box.parentNode.removeChild(box);
      showToast('이 기기에 저장했어요.');
    });
    no.addEventListener('click', function () { if (box.parentNode) box.parentNode.removeChild(box); });
    row.appendChild(yes); row.appendChild(no);
    box.appendChild(row);
    box.appendChild(safeCopy('다음에 더 편하게 오시도록 이 기기에만 살짝 기억해 둘게요. 언제든 지울 수 있어요.'));
    return box;
  }

  /* ---- 상담 대화(as-status.js 이식: 15초 폴링·멱등 렌더·asFile 썸네일) ---- */
  function buildThreadSection() {
    var sec = el('section', 'thread-sec'); sec.setAttribute('aria-label', '접수 상담 대화');
    sec.appendChild(el('h3', 'thread-title', '상담 대화'));
    sec.appendChild(el('p', 'thread-desc', '남겨주신 메시지는 상담 시간(' + STX_HOURS + ')에 순서대로 답변드립니다.'));
    var list = el('div', 'th-list'); list.setAttribute('role', 'log'); list.setAttribute('aria-live', 'polite');
    sec.appendChild(list);
    var form = el('form', 'th-composer');
    var file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
    var attach = el('button', 'th-attach', '사진 첨부'); attach.type = 'button';
    var input = document.createElement('textarea'); input.className = 'th-input'; input.rows = 1; input.maxLength = 1000;
    input.placeholder = '메시지를 입력하세요'; input.setAttribute('aria-label', '메시지 입력');
    var send = el('button', 'th-send', '보내기'); send.type = 'submit';
    form.appendChild(file); form.appendChild(attach); form.appendChild(input); form.appendChild(send);
    sec.appendChild(form);
    THREAD = { sec: sec, list: list, form: form, input: input, send: send, attach: attach, file: file };
    form.addEventListener('submit', onThreadSend);
    attach.addEventListener('click', function () { file.click(); });
    file.addEventListener('change', onThreadAttach);
    return sec;
  }
  function initThread() {
    if (!THREAD) return;
    lastTs = ''; renderedSig = ''; firstLoad = true; msgsSeq++;   // 이전 티켓 스레드 무효화
    THREAD.list.textContent = '';
    fetchMsgs();
    if (!document.hidden) startPoll();   // 백그라운드 탭이면 복귀 때 시작(onVisChange)
  }
  function statusPanelVisible() { var p = document.getElementById('panel-status'); return !!p && !p.hidden; }
  function startPoll() { if (!pollTimer && detailOpen && statusPanelVisible() && !document.hidden) pollTimer = setInterval(fetchMsgs, 15000); }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function onVisChange() {
    // 조회 패널이 화면에 있을 때만 관여 — 접수 탭으로 이동한 상태에서 탭 숨김→복귀 시 폴링이 되살아나지 않도록.
    // (detailOpen 은 유지 — 조회 탭 재진입 시 상세 복원을 위해. 화면-밖 재개는 패널 가시 체크로 차단.)
    if (!detailOpen || !statusPanelVisible()) return;
    if (document.hidden) stopPoll();
    else { clearTitleFlag(); fetchMsgs(); startPoll(); }
  }
  function clearTitleFlag() { if (titleFlagged) { titleFlagged = false; try { document.title = baseTitle; } catch (e) {} } }
  function threadSig(msgs) {
    var last = msgs.length ? msgs[msgs.length - 1] : null;
    return msgs.length + '|' + (last ? String(last.ts) : '') + '|' + (last ? String(last.text == null ? '' : last.text) : '');
  }
  function fetchMsgs(toBottom) {
    if (!detailCred || !THREAD) return;
    var seq = ++msgsSeq, reqId = detailCred.id;
    api({ action: 'asMsgs', id: detailCred.id, phone4: detailCred.phone4 }).then(function (d) {
      if (seq !== msgsSeq || !detailCred || detailCred.id !== reqId || !THREAD) return;   // 늦은/타 접수 응답 무시
      if (!d || !d.ok || !Array.isArray(d.msgs)) return;
      var sig = threadSig(d.msgs);
      if (sig === renderedSig) return;
      renderedSig = sig;
      var csTs = '', i;
      for (i = 0; i < d.msgs.length; i++) { var m = d.msgs[i]; if (m && m.dir === 'cs' && String(m.ts) > csTs) csTs = String(m.ts); }
      var newCs = !firstLoad && csTs !== '' && csTs > lastTs;
      if (csTs > lastTs) lastTs = csTs;
      var listEl = THREAD.list;
      var nearBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 48;
      var prevScroll = listEl.scrollTop;
      listEl.textContent = '';
      for (i = 0; i < d.msgs.length; i++) { if (d.msgs[i]) renderMsg(d.msgs[i]); }
      listEl.scrollTop = prevScroll;
      if (newCs) {
        try { listEl.scrollTo({ top: listEl.scrollHeight, behavior: 'smooth' }); } catch (e) { listEl.scrollTop = listEl.scrollHeight; }
        if (!document.hasFocus()) { titleFlagged = true; try { document.title = '(새 답변) ' + baseTitle; } catch (e) {} }
      } else if (firstLoad || toBottom === true || nearBottom) {
        listEl.scrollTop = listEl.scrollHeight;
      }
      firstLoad = false;
    }, function () { /* 폴링 실패는 조용히 — 다음 주기 재시도 */ });
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
    THREAD.list.appendChild(row);
  }
  function buildThumb(f) {
    var img = document.createElement('img');
    img.className = 'th-thumb'; img.alt = String(f.name || '첨부 사진');
    if (fileCache[f.id]) { img.src = fileCache[f.id]; return img; }
    function fallback() { if (img.parentNode) img.parentNode.replaceChild(el('span', 'th-time', String(f.name || '첨부 사진')), img); }
    api({ action: 'asFile', fileId: f.id, id: detailCred.id, phone4: detailCred.phone4 }).then(function (d) {
      if (d && d.ok && d.data) { var src = 'data:' + String(d.mime || 'image/jpeg') + ';base64,' + String(d.data); fileCache[f.id] = src; img.src = src; }
      else fallback();
    }, fallback);
    return img;
  }
  function onThreadSend(e) {
    e.preventDefault();
    if (!detailCred || !THREAD || THREAD.send.disabled) return;
    var text = String(THREAD.input.value || '').trim().slice(0, 1000);
    if (!text) return;
    THREAD.send.disabled = true;
    api({ action: 'asMsgSend', id: detailCred.id, phone4: detailCred.phone4, text: text }).then(function (d) {
      if (d && d.ok) { if (THREAD) THREAD.input.value = ''; fetchMsgs(true); }
      else showToast('메시지를 보내지 못했어요. 잠시 후 다시 시도해 주세요.');
    }, function () { showToast('연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.'); })
      .then(function () { if (THREAD) THREAD.send.disabled = false; });
  }
  function onThreadAttach() {
    if (!detailCred || !THREAD) return;
    var f = THREAD.file.files && THREAD.file.files[0];
    THREAD.file.value = '';
    if (!f || !/^image\//.test(f.type || '')) return;
    var media = window.ClapaAsMedia;
    if (!media || !media.compressImage || !media.fileToB64) { showToast('사진을 올릴 수 없어요. 네이버 톡톡으로 보내주시면 확인해 드릴게요.'); return; }
    THREAD.attach.disabled = true; THREAD.attach.textContent = '올리는 중…';
    media.compressImage(f, 1600, 0.8).catch(function () {
      if (f.size <= 5 * 1024 * 1024) return { blob: f, name: f.name, mime: f.type || 'image/jpeg' };
      throw new Error('too-big');
    }).then(function (pk) {
      return media.fileToB64(pk.blob).then(function (b64) {
        return api({ action: 'asUpload', id: detailCred.id, phone4: detailCred.phone4, name: pk.name, mime: pk.mime, data: b64 });
      }).then(function (d) {
        if (!d || !d.ok) throw new Error('upload');
        return api({ action: 'asMsgSend', id: detailCred.id, phone4: detailCred.phone4, text: '[사진] ' + pk.name + ' 을(를) 보냈습니다.' });
      });
    }).then(function () { fetchMsgs(true); }).catch(function () {
      showToast('사진을 올리지 못했어요. 크기를 줄여 다시 시도해 주세요.');
    }).then(function () { if (THREAD) { THREAD.attach.disabled = false; THREAD.attach.textContent = '사진 첨부'; } });
  }

  /* ---- ?id= 진입 포커스 ---- */
  function focusTicket(rawId) {
    var id = normalizeAsId(rawId) || String(rawId || '').toUpperCase();
    var list = (window.asStore ? asStore.tickets() : []), i, hit = null;
    for (i = 0; i < list.length; i++) { if (list[i] && list[i].id === id) { hit = list[i]; break; } }
    if (hit && hit.phone4) { openTicketDetail(hit.id, hit.phone4); return; }
    showListPane();
    renderTicketList();
    var idIn = document.getElementById('ml-id'), p4 = document.getElementById('ml-p4');
    if (idIn) idIn.value = id;
    try { if (p4) p4.focus(); } catch (e) {}
    showToast('접수번호를 확인했어요. 연락처 뒷 4자리를 입력해 주세요.');
  }

  /* ---- 재방문 인사 + 같은 제품 진행 중 안내(접수 탭 상단, 비차단 — 스펙 §6-2) ---- */
  function renderIntakeTop() {
    var main = document.querySelector('#intake-live .as-main');
    if (!main) return;
    var host = document.getElementById('intake-top');
    if (!host) { host = el('div'); host.id = 'intake-top'; main.insertBefore(host, main.firstChild); }
    var profile = (window.asStore ? asStore.profile() : null);
    var code = (state.product && state.product.code) ? state.product.code : '';
    var dup = code ? sameProductInProgress(code) : null;
    var sig = (profile && profile.name ? profile.name : '') + '|' + code + '|' + (dup ? dup.id : '');
    if (sig === topSig) return;   // 변화 없으면 재구성 생략(연락처 키 입력마다 깜빡임 방지)
    topSig = sig;
    host.textContent = '';
    if (profile && profile.name) {
      host.appendChild(el('p', 'intake-greet', profile.name + '님, 다시 오셨네요. 이어서 접수를 도와드릴게요.'));
    }
    if (dup) {
      var card = el('div', 'dup-note');
      var tx = el('div', 'dup-note-tx');
      tx.appendChild(el('div', 'dup-note-t', '이 제품으로 진행 중인 접수가 있어요'));
      tx.appendChild(el('div', 'dup-note-s', '접수번호 ' + dup.id + ' — 새 접수도 그대로 진행할 수 있어요.'));
      card.appendChild(tx);
      var go = el('button', 'dup-go', '진행 상황 보기'); go.type = 'button';
      go.addEventListener('click', function () { setTab('status'); openTicketDetail(dup.id, dup.phone4); });
      card.appendChild(go);
      host.appendChild(card);
    }
  }
  function prefillFromProfile() {
    if (profilePrefilled) return;
    profilePrefilled = true;
    var p = (window.asStore ? asStore.profile() : null);
    if (p && !state.contact.name && !state.contact.phone) {
      if (p.name) state.contact.name = p.name;
      if (p.phone) state.contact.phone = p.phone;
      if (typeof renderContactSection === 'function') renderContactSection();
    }
  }

  /* ---- 조회 탭 골격 빌드 + 진입/이탈 훅 ---- */
  function buildStatusUI() {
    if (statusBuilt) return;
    if (!document.getElementById('panel-status')) return;
    renderManualLookup();
    renderClear();
    document.addEventListener('visibilitychange', onVisChange);
    statusBuilt = true;
  }
  function initStatus() { buildStatusUI(); prefillFromProfile(); }
  function onEnterStatus() {
    buildStatusUI();
    if (!idFocusDone && ID_QUERY) { idFocusDone = true; focusTicket(ID_QUERY); return; }
    if (detailOpen && detailCred) { showDetailPane(); if (!document.hidden) { fetchMsgs(); startPoll(); } return; }
    showListPane();
    renderTicketList();
  }
  function onEnterIntake() {
    stopPoll();               // 조회 탭을 떠남 — 폴링 중지(GAS 쿼터 보호)
    renderIntakeTop();
  }

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
