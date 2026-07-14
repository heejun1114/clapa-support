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
    if (sectionState.product === 'done') {
      main.appendChild(el('div', 'sec-done-line', sectionSummary.product));
      head.appendChild(main);
      var editBtn = el('button', 'sec-edit', '변경'); editBtn.type = 'button';
      editBtn.addEventListener('click', function (e) { e.stopPropagation(); reopenSection('product'); });
      head.appendChild(editBtn);
      head.addEventListener('click', function () { reopenSection('product'); });
    } else {
      main.appendChild(el('span', 'sec-title', '제품'));
      head.appendChild(main);
    }
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
