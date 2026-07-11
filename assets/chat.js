/* =========================================================================
   CLAPA 고객지원 채팅 위젯 (chat.js)
   - IIFE, 외부 의존성 0, ES2018 이하 문법(옵셔널 체이닝/널병합 미사용)
   - 보안: 모델/카탈로그 출력은 절대 innerHTML로 넣지 않고 textContent/createElement로만 구성
   - 세션: sessionStorage 기반(탭 단위) — 사이트 내 페이지 이동 시 대화 유지, 탭 닫으면 소멸
   - 공개 API: window.ClapaChat = { open, close, toggle, isOpen, __mounted }
   - 커스텀 이벤트: document 에 'clapachat:open' / 'clapachat:close' 디스패치
   ========================================================================= */
(function () {
  'use strict';

  /* 중복 로드 방지 */
  if (window.ClapaChat && window.ClapaChat.__mounted) return;

  /* ------------------------------------------------------------------ *
   * 상수
   * ------------------------------------------------------------------ */
  var SID_KEY = 'clapaChat.sid';
  var LOG_KEY = 'clapaChat.log';
  var MAX_TURNS = 12;         // 서버로 보내는 history 최대 턴 수
  var MAX_LOG = 80;           // sessionStorage에 보관할 최대 로그 항목 수
  var PHONE = '1522-8508';
  var HOURS = '평일 09:00~15:00';
  var STORE = 'https://smartstore.naver.com/skillfulbrother';
  var SVGNS = 'http://www.w3.org/2000/svg';

  var DEFAULT_CONFIG = {
    endpoint: '',
    enabled: true,
    model: null,
    welcome: '안녕하세요! 클래파 고객지원 AI예요.\n궁금한 점을 편하게 입력하시거나, 아래 메뉴에서 골라 주세요.'
  };

  /* 카탈로그 기본 카테고리(카탈로그에 categories가 없을 때 폴백) */
  var DEFAULT_CATEGORIES = [
    { id: 'clean', label: '청소기' },
    { id: 'season', label: '계절가전' },
    { id: 'living', label: '주방·생활' }
  ];

  /* ------------------------------------------------------------------ *
   * 경로(사이트 루트) 계산 — currentScript는 최상위에서 동기 캡처해야 함
   * ------------------------------------------------------------------ */
  function resolveRoot() {
    var src = '';
    var cur = document.currentScript;
    if (cur && cur.src) {
      src = cur.src;
    } else {
      // 폴백: chat.js 를 포함하는 script 태그 탐색
      var list = document.getElementsByTagName('script');
      for (var i = list.length - 1; i >= 0; i--) {
        if (list[i].src && /chat\.js(\?|#|$)/.test(list[i].src)) { src = list[i].src; break; }
      }
    }
    src = src.split('#')[0].split('?')[0];
    // assets/chat.js → 상위(사이트 루트, 끝에 '/')
    var root = src.replace(/assets\/[^\/]*$/, '');
    if (!root) root = location.href.replace(/[^\/]*$/, '');
    return root;
  }

  var ROOT = resolveRoot();
  var ROOT_ORIGIN = location.origin;
  try { ROOT_ORIGIN = new URL(ROOT, location.href).origin; } catch (e) {}

  /* ------------------------------------------------------------------ *
   * 상태
   * ------------------------------------------------------------------ */
  var config = assign({}, DEFAULT_CONFIG);
  var configLoaded = false;    // chat-config.json 로드 성공 여부(실패 시 전송 시점에 1회 재시도)
  var catalog = null;          // { categories:[{id,label}], models:[{model,name,category,page,manual,parts}] }
  var log = [];                // [{ role:'user'|'model', text, chips?, local?, meta? }]
  var sid = '';
  var isOpen = false;
  var sending = false;
  var lastUserMessage = '';
  var lastMatchedCode = '';    // 서버 응답 matched의 마지막 값(A/S 폼 프리필용)
  var disabled = false;        // config.enabled === false
  var lastFocus = null;
  var asWait = false;          // A/S 접수 조회 입력 대기 상태
  var asWaitId = '';           // 조회 대기 중 확보한 접수번호
  var asWaitP4 = '';           // 조회 대기 중 먼저 받은 연락처 뒷 4자리
  var savedScrollY = 0;        // 모바일 배경 스크롤 잠금 복원용
  var scrollLocked = false;

  /* DOM 참조 */
  var fabEl, panelEl, scrimEl, msgEl, chipsEl, taEl, sendBtn;
  var triggerEls = [];         // 페이지에 이미 있는 [data-clapa-chat-trigger] 버튼들

  /* ------------------------------------------------------------------ *
   * 유틸
   * ------------------------------------------------------------------ */
  function assign(t) {
    for (var i = 1; i < arguments.length; i++) {
      var s = arguments[i];
      if (!s) continue;
      for (var k in s) { if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k]; }
    }
    return t;
  }

  /* 요소 생성 헬퍼 — html 주입 경로 없음(보안) */
  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v == null) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v);
      }
    }
    if (kids) {
      var arr = Array.isArray(kids) ? kids : [kids];
      for (var i = 0; i < arr.length; i++) {
        var c = arr[i];
        if (c == null) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  /* 인라인 SVG 아이콘 생성 */
  function svg(viewBox, shapes, w) {
    var s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', viewBox);
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', w || '1.7');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < shapes.length; i++) {
      var sh = shapes[i];
      var e = document.createElementNS(SVGNS, sh.t);
      for (var k in sh) { if (k !== 't' && Object.prototype.hasOwnProperty.call(sh, k)) e.setAttribute(k, sh[k]); }
      s.appendChild(e);
    }
    return s;
  }

  /* 문자열 \n → 텍스트노드 + <br> (innerHTML 미사용) */
  function textToNodes(parent, text) {
    var parts = String(text == null ? '' : text).split('\n');
    for (var i = 0; i < parts.length; i++) {
      if (i > 0) parent.appendChild(el('br'));
      parent.appendChild(document.createTextNode(parts[i]));
    }
  }

  function removeNode(n) { if (n && n.parentNode) n.parentNode.removeChild(n); }
  function scrollBottom() { if (msgEl) msgEl.scrollTop = msgEl.scrollHeight; }

  /* 모바일(터치/시트 모드) 판정 — 자동 포커스로 화면 키보드가 튀어나오는 것 방지용.
     chat.css 시트 브레이크포인트(640px)와 동일 기준 + 터치 포인터. 호출 시점마다 평가. */
  function isTouchLike() {
    try {
      if (window.matchMedia) {
        if (matchMedia('(max-width: 640px)').matches) return true;
        if (matchMedia('(pointer: coarse)').matches) return true;
      }
    } catch (e) {}
    return false;
  }

  /* UUID v4 (crypto.randomUUID 우선, 폴백 구현) */
  function uuid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    var bytes = null;
    try {
      if (window.crypto && crypto.getRandomValues) {
        bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
      }
    } catch (e2) { bytes = null; }
    function rnd(i) { return bytes ? bytes[i] : Math.floor(Math.random() * 256); }
    var b = [];
    for (var i = 0; i < 16; i++) b.push(rnd(i));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = [];
    for (var j = 0; j < 16; j++) h.push((b[j] + 0x100).toString(16).slice(1));
    return h[0] + h[1] + h[2] + h[3] + '-' + h[4] + h[5] + '-' + h[6] + h[7] + '-' +
           h[8] + h[9] + '-' + h[10] + h[11] + h[12] + h[13] + h[14] + h[15];
  }

  /* ------------------------------------------------------------------ *
   * URL 허용 목록 검증
   *  - 상대경로(사이트 동일 오리진), https://smartstore.naver.com/, https://clapa.kr, tel: 만 허용
   *  - 그 외는 null → 링크 버튼을 아예 만들지 않음
   * ------------------------------------------------------------------ */
  function safeHref(raw) {
    if (typeof raw !== 'string') return null;
    var s = raw.trim();
    if (!s) return null;
    if (/^tel:/i.test(s)) return /^tel:[0-9+\-() ]+$/i.test(s) ? s : null;

    var u;
    try { u = new URL(s, ROOT); } catch (e) { return null; }
    var proto = u.protocol.toLowerCase();
    var host = u.host.toLowerCase();

    // 상대경로가 절대화된 경우 → 사이트와 동일 오리진만 허용 (http/https/file 모두 포함)
    if (u.origin === ROOT_ORIGIN) return u.href;

    if (proto === 'https:') {
      if (host === 'smartstore.naver.com') return u.href;
      if (host === 'clapa.kr' || host === 'www.clapa.kr') return u.href;
    }
    return null;
  }

  function isExternal(href) {
    if (!/^https?:/i.test(href)) return false;
    try { return new URL(href).origin !== ROOT_ORIGIN; } catch (e) { return false; }
  }

  /* ------------------------------------------------------------------ *
   * 세션(sessionStorage)
   * ------------------------------------------------------------------ */
  function store() { try { return window.sessionStorage; } catch (e) { return null; } }

  function loadSession() {
    var s = store();
    if (s) {
      try {
        sid = s.getItem(SID_KEY) || '';
        var raw = s.getItem(LOG_KEY);
        log = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(log)) log = [];
      } catch (e) { log = []; }
    }
    if (!sid) { sid = uuid(); persistSession(); }
  }

  function persistSession() {
    var s = store();
    if (!s) return;
    try {
      s.setItem(SID_KEY, sid);
      s.setItem(LOG_KEY, JSON.stringify(log));
    } catch (e) {}
  }

  /* ------------------------------------------------------------------ *
   * 설정/카탈로그 로드
   * ------------------------------------------------------------------ */
  function loadConfig() {
    return fetch(ROOT + 'data/chat-config.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && typeof j === 'object') {
          config = assign({}, DEFAULT_CONFIG, j);
          configLoaded = true;   // 로드 성공 — endpoint가 비어 있다면 '의도적 미설정'
        }
      })
      .catch(function () { /* 기본값 유지 — configLoaded=false 로 남아 전송 시 1회 재시도 */ });
  }

  function loadCatalog() {
    return fetch(ROOT + 'data/chat-catalog.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { catalog = normalizeCatalog(j); })
      .catch(function () { catalog = null; });
  }

  /* 카탈로그 정규화 — models 는 배열 또는 {모델코드:{...}} 맵 모두 허용 */
  function normalizeCatalog(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var models = raw.models;
    if (models && !Array.isArray(models)) {
      var arr = [];
      for (var key in models) {
        if (Object.prototype.hasOwnProperty.call(models, key)) {
          arr.push(assign({ model: key }, models[key]));
        }
      }
      models = arr;
    }
    if (!Array.isArray(models)) models = [];

    models = models.map(function (m) {
      m = m || {};
      return {
        model: m.model || m.id || m.code || '',
        name: m.name || m.displayName || m.title || '',
        category: m.category || m.cat || '',
        page: m.page || m.url || '',
        manual: m.manual || m.manualUrl || m.pdf || '',
        parts: m.parts || m.partsUrl || ''
      };
    }).filter(function (m) { return m.model; });

    var categories = raw.categories;
    if (!Array.isArray(categories) && raw.cats && typeof raw.cats === 'object') {
      // chat-catalog.json 형식: cats = { id: label } 객체 맵
      categories = [];
      for (var ck in raw.cats) {
        if (Object.prototype.hasOwnProperty.call(raw.cats, ck) && raw.cats[ck]) {
          categories.push({ id: ck, label: String(raw.cats[ck]) });
        }
      }
    }
    if (!Array.isArray(categories) || !categories.length) {
      categories = DEFAULT_CATEGORIES.slice();
    } else {
      categories = categories.map(function (c) {
        c = c || {};
        return { id: c.id || c.cat || c.key || '', label: c.label || c.name || c.title || '' };
      }).filter(function (c) { return c.id && c.label; });
      if (!categories.length) categories = DEFAULT_CATEGORIES.slice();
    }
    return { categories: categories, models: models };
  }

  function catalogReady() { return !!(catalog && catalog.models && catalog.models.length); }

  function findModel(code) {
    if (!catalogReady() || !code) return null;
    var up = String(code).toUpperCase();
    for (var i = 0; i < catalog.models.length; i++) {
      if (String(catalog.models[i].model).toUpperCase() === up) return catalog.models[i];
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 컨텍스트(제품/페이지)
   * ------------------------------------------------------------------ */
  function productContext() {
    var p = window.CLAPA_CHAT_PRODUCT;
    if (typeof p === 'string' && p.trim()) return p.trim();
    // 상세 페이지에서는 URL을 카탈로그 page와 대조해 자동 감지
    if (catalog && catalog.models) {
      var page = currentPageId();
      if (page !== 'index') {
        for (var i = 0; i < catalog.models.length; i++) {
          if (catalog.models[i].page === page) return catalog.models[i].model;
        }
      }
    }
    return null;
  }

  function currentPageId() {
    var m = location.pathname.match(/\/products\/([^\/]+\.html)$/i);
    return m ? ('products/' + m[1]) : 'index';
  }

  /* ------------------------------------------------------------------ *
   * UI 구성
   * ------------------------------------------------------------------ */
  function buildUI() {
    /* FAB */
    fabEl = el('button', {
      'class': 'cchat-fab',
      type: 'button',
      'aria-label': 'CLAPA 상담 열기',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      hidden: 'hidden'  // config 로드 후 enabled면 노출(깜빡임 방지)
    });
    var fabIc = el('span', { 'class': 'cchat-fab-ic', 'aria-hidden': 'true' });
    fabIc.appendChild(svg('0 0 24 24', [
      { t: 'path', d: 'M20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.2V17H6.5A2.5 2.5 0 0 1 4 14.5v-8A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5z' },
      { t: 'path', d: 'M8.5 10h7M8.5 13h4.5' }
    ]));
    fabEl.appendChild(fabIc);
    fabEl.appendChild(el('span', { 'class': 'cchat-fab-label', text: '상담' }));
    fabEl.addEventListener('click', toggle);

    /* 스크림(모바일 시트 배경) */
    scrimEl = el('div', { 'class': 'cchat-scrim', hidden: 'hidden' });
    scrimEl.addEventListener('click', close);

    /* 패널 */
    panelEl = el('div', {
      'class': 'cchat-panel',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'CLAPA 상담',
      hidden: 'hidden'
    });

    /* 헤더 */
    var head = el('div', { 'class': 'cchat-head' });
    var title = el('div', { 'class': 'cchat-title' }, [
      el('span', { 'class': 'cchat-title-tx', text: 'CLAPA 상담' }),
      el('span', { 'class': 'cchat-badge', text: 'AI' })
    ]);
    var resetBtn = el('button', { 'class': 'cchat-iconbtn', type: 'button', 'aria-label': '대화 초기화', text: '↺' });
    resetBtn.addEventListener('click', resetConversation);
    var closeBtn = el('button', { 'class': 'cchat-iconbtn', type: 'button', 'aria-label': '상담 닫기', text: '×' });
    closeBtn.addEventListener('click', close);
    head.appendChild(title);
    head.appendChild(el('div', { 'class': 'cchat-head-actions' }, [resetBtn, closeBtn]));

    /* 메시지 영역 */
    msgEl = el('div', { 'class': 'cchat-msgs', role: 'log', 'aria-live': 'polite', 'aria-atomic': 'false' });

    /* 하단 칩 바(루트 빠른 메뉴) */
    chipsEl = el('div', { 'class': 'cchat-chips', role: 'group', 'aria-label': '빠른 메뉴' });

    /* 컴포저 */
    var form = el('form', { 'class': 'cchat-composer' });
    taEl = el('textarea', {
      'class': 'cchat-input', rows: '1', 'aria-label': '메시지 입력',
      placeholder: '메시지를 입력하세요', autocomplete: 'off'
    });
    sendBtn = el('button', { 'class': 'cchat-send', type: 'submit', 'aria-label': '전송' });
    sendBtn.appendChild(svg('0 0 24 24', [{ t: 'path', d: 'M4.4 11.9 19.5 5l-6.8 15.1-2.3-6.2-6-2z' }], '1.5'));
    form.appendChild(taEl);
    form.appendChild(sendBtn);
    form.addEventListener('submit', onSubmit);
    taEl.addEventListener('input', autoGrow);
    taEl.addEventListener('keydown', onKey);

    panelEl.appendChild(head);
    panelEl.appendChild(msgEl);
    panelEl.appendChild(chipsEl);
    panelEl.appendChild(form);
    panelEl.addEventListener('keydown', trapTab);

    document.body.appendChild(fabEl);
    document.body.appendChild(scrimEl);
    document.body.appendChild(panelEl);
  }

  /* ------------------------------------------------------------------ *
   * 칩 렌더링
   *  - 저장/전송 계약 칩: { label, send } / { label, url }
   *  - 내부 메뉴 칩(직렬화 가능): { label, cmd, arg }
   * ------------------------------------------------------------------ */
  /* 이동 안내 메시지 — 링크 칩이 어디로 가는지에 따라 토스트 문구 결정 */
  function navMessage(href) {
    if (/\.pdf(#|\?|$)/i.test(href)) return null;  // PDF는 새 탭이라 안내 불필요
    if (href.indexOf('#faq') !== -1) return '자주 묻는 질문으로 이동했어요';
    if (href.indexOf('#spec-title') !== -1) return '주요 사양으로 이동했어요';
    if (href.indexOf('#as-title') !== -1) return 'A/S 접수로 이동했어요';
    if (/products\//.test(href)) return '제품 페이지로 이동했어요';
    return '페이지를 이동했어요';
  }

  /* 떴다 사라지는 이동 안내 토스트 */
  function showToast(text) {
    var t = el('div', { 'class': 'cchat-toast', role: 'status', text: text });
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('is-on'); }, 20);
    setTimeout(function () {
      t.classList.remove('is-on');
      setTimeout(function () { removeNode(t); }, 300);
    }, 2600);
  }

  /* ------------------------------------------------------------------ *
   * 챗 → A/S 접수 폼 컨텍스트 전달 (재입력 방지)
   *  - 저장: A/S 폼 링크 칩 클릭 시 모델·최근 증상 서술·sid 를 sessionStorage에
   *  - 소비: index.html 도착(boot) 또는 같은 페이지 즉시(fillAsForm) — 빈 칸만 채움
   * ------------------------------------------------------------------ */
  function saveAsDraft() {
    try {
      var code = lastMatchedCode || productContext() || '';
      var model = '';
      if (code) {
        var m = findModel(code);
        model = m ? m.model : String(code);
      }
      var texts = [];
      for (var i = log.length - 1; i >= 0 && texts.length < 2; i--) {
        var e = log[i];
        if (e.role === 'user' && e.text && String(e.text).trim()) texts.unshift(String(e.text).trim());
      }
      sessionStorage.setItem('clapaChat.asDraft', JSON.stringify({
        model: model, symptom: texts.join('\n').slice(0, 900), sid: sid
      }));
    } catch (e) {}
  }

  function fillAsForm() {
    var raw = null;
    try { raw = sessionStorage.getItem('clapaChat.asDraft'); } catch (e) {}
    if (!raw) return false;
    var modelEl = document.getElementById('as-model');
    var sympEl = document.getElementById('as-symptom');
    if (!modelEl && !sympEl) return false;   // A/S 폼이 없는 페이지 — 이동 후 boot에서 소비
    var draft = null;
    try { draft = JSON.parse(raw); } catch (e) { draft = null; }
    try { sessionStorage.removeItem('clapaChat.asDraft'); } catch (e) {}
    if (!draft) return false;
    var filled = false;
    if (modelEl && !modelEl.value && draft.model) { modelEl.value = String(draft.model).slice(0, 80); filled = true; }
    if (sympEl && !sympEl.value && draft.symptom) { sympEl.value = String(draft.symptom); filled = true; }
    if (!filled) return false;
    // 모바일에서는 폼이 접혀 있으므로 펼쳐서 채워진 값이 보이게
    var wrap = document.getElementById('as-form-wrap');
    if (wrap) wrap.setAttribute('open', '');
    showToast('대화 내용을 미리 담아뒀어요. 확인 후 접수해 주세요.');
    return true;
  }

  function buildChip(spec) {
    if (!spec || !spec.label) return null;

    if (spec.url) {
      var href = safeHref(spec.url);
      if (!href) return null;                 // 허용되지 않은 url → 버튼 자체를 만들지 않음
      var a = el('a', { 'class': 'cchat-chip cchat-chip-link', href: href });
      var ext = isExternal(href);
      var isPdf = /\.pdf(#|\?|$)/i.test(href);
      // PDF는 동일 오리진이라도 새 탭 — 현재 탭(챗·사이트)이 PDF 뷰어로 덮이지 않게
      if (ext || isPdf) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
      a.appendChild(document.createTextNode(spec.label));
      if (ext) a.appendChild(el('span', { 'class': 'cchat-chip-ext', 'aria-hidden': 'true', text: '↗' }));
      if (!ext && !isPdf && !/^tel:/i.test(href)) {
        a.addEventListener('click', function () {
          var toAsForm = href.indexOf('#as-title') !== -1;
          if (toAsForm) saveAsDraft();   // 챗에서 파악한 모델·증상을 A/S 폼으로 전달
          var msg = navMessage(href);
          if (!msg) return;
          var samePage = false;
          try { samePage = (new URL(href, location.href).pathname === location.pathname); } catch (e) {}
          if (samePage) {
            close();          // 패널을 닫아 이동한 위치가 보이게
            var filled = toAsForm ? fillAsForm() : false;  // 리로드가 없으므로 즉시 프리필
            if (!filled) showToast(msg);
          } else {
            try { sessionStorage.setItem('clapaChat.nav', msg); } catch (e) {}
          }
        });
      }
      return a;
    }

    if (spec.cmd) {
      var b = el('button', { 'class': 'cchat-chip', type: 'button' }, spec.label);
      b.addEventListener('click', function () { dispatch(spec.cmd, spec.arg); });
      return b;
    }

    if (spec.send) {
      var sb = el('button', { 'class': 'cchat-chip', type: 'button' }, spec.label);
      sb.addEventListener('click', function () { sendUserMessage(spec.send); });
      return sb;
    }
    return null;
  }

  /* 루트 빠른 메뉴 칩 목록 — 상세 페이지에서는 해당 제품 메뉴를 앞에 배치 */
  function rootChips() {
    var code = productContext();
    if (code) {
      var m = findModel(code);
      var chips = [
        { label: '이 제품 설명서', cmd: 'pmanual' },
        { label: '이 제품 FAQ', cmd: 'pfaq' }
      ];
      if (m && m.page) chips.push({ label: '이 제품 스펙', url: m.page + '#spec-title' });
      chips.push({ label: '부품 구매', cmd: 'cats', arg: 'parts' });
      chips.push({ label: 'A/S 신청', cmd: 'as' });
      return chips;
    }
    return [
      { label: '설명서 찾기', cmd: 'cats', arg: 'manual' },
      { label: '부품 구매', cmd: 'cats', arg: 'parts' },
      { label: 'A/S 신청', cmd: 'as' }
    ];
  }

  function renderRootBar() {
    chipsEl.textContent = '';
    var chips = rootChips();
    for (var i = 0; i < chips.length; i++) {
      var node = buildChip(chips[i]);
      if (node) chipsEl.appendChild(node);
    }
  }

  /* ------------------------------------------------------------------ *
   * 메시지 렌더 / 로그
   * ------------------------------------------------------------------ */
  /* 봇 답변 표시용 문장 줄바꿈 — 저장 텍스트는 그대로, 화면에서만 분리 */
  function botDisplayText(t) {
    t = String(t == null ? '' : t);
    if (t.indexOf('\n') !== -1 || t.length < 90) return t;
    return t.replace(/([다요죠])\.\s+(?=[가-힣A-Za-z0-9"'(~])/g, '$1.\n');
  }

  function renderEntry(entry) {
    var isUser = entry.role === 'user';
    var wrap = el('div', { 'class': 'cchat-msg ' + (isUser ? 'cchat-user' : 'cchat-bot') });
    var bubble = el('div', { 'class': 'cchat-bubble' });
    textToNodes(bubble, isUser ? entry.text : botDisplayText(entry.text));
    wrap.appendChild(bubble);
    if (entry.chips && entry.chips.length) {
      var cr = el('div', { 'class': 'cchat-chips-inline' });
      for (var i = 0; i < entry.chips.length; i++) {
        var node = buildChip(entry.chips[i]);
        if (node) cr.appendChild(node);
      }
      if (cr.childNodes.length) wrap.appendChild(cr);
    }
    // 답변 출처 캡션 — 학습자료가 실제 프롬프트에 실렸을 때만(약한 표현 유지)
    if (!isUser && entry.meta && entry.meta.grounded && entry.meta.codes && entry.meta.codes.length) {
      wrap.appendChild(el('div', {
        'class': 'cchat-src',
        text: entry.meta.codes.join(', ') + ' 공식 자료를 참고한 답변이에요'
      }));
    }
    // 접수 상태 스테퍼(접수 조회 결과 메시지에만) — 비차단 시각 표시
    if (!isUser && typeof entry.steps === 'number') {
      wrap.appendChild(buildSteps(entry.steps));
    }
    // (답변 피드백 버튼은 2026-07-11 사장님 지시로 제거 — 재도입 금지)
    msgEl.appendChild(wrap);
  }

  /* 접수됨 → 확인중 → 처리완료 3단계 스테퍼. idx = 현재 단계(0~2). */
  function buildSteps(idx) {
    var names = ['접수됨', '확인중', '처리완료'];
    var box = el('div', { 'class': 'cchat-steps', role: 'img',
      'aria-label': '진행 상태: ' + names[idx] });
    for (var i = 0; i < names.length; i++) {
      if (i > 0) {
        box.appendChild(el('span', { 'class': 'cchat-step-bar' + (i <= idx ? ' is-done' : '') }));
      }
      var cls = 'cchat-step' + (i < idx ? ' is-done' : (i === idx ? ' is-now' : ''));
      box.appendChild(el('span', { 'class': cls, text: names[i] }));
    }
    return box;
  }

  function renderAll() {
    msgEl.textContent = '';
    for (var i = 0; i < log.length; i++) renderEntry(log[i]);
    scrollBottom();
  }

  function pushMessage(role, text, chips, extra) {
    var entry = { role: role, text: String(text == null ? '' : text) };
    if (chips && chips.length) entry.chips = chips;
    if (extra) assign(entry, extra);   // local(히스토리 제외)·meta(msgId/출처) 등
    log.push(entry);
    if (log.length > MAX_LOG) log = log.slice(log.length - MAX_LOG);
    persistSession();
    renderEntry(entry);
    scrollBottom();
    return entry;
  }

  function seedWelcome() {
    var text = config.welcome || DEFAULT_CONFIG.welcome;
    var m = findModel(productContext());
    if (m) {
      // 제품 페이지 첫 인사 — 모델명이 히스토리에 남아 서버 매칭에도 도움되므로 local 아님
      text += '\n지금 보고 계신 ' + m.name + '(' + m.model + ') 관련 질문은 모델명 없이 바로 답해드릴 수 있어요.';
      pushMessage('model', text);
    } else {
      pushMessage('model', text, null, { local: 1 });
    }
  }

  /* 메뉴 안내 메시지 — 직전 메시지와 텍스트·칩이 모두 같을 때만 스킵(카드 반복 클릭 대비).
     칩이 다르면 새로 쌓는다('더보기' 등 같은 문구·다른 목록 케이스).
     기본은 local(AI 히스토리 제외) — 모델코드가 담겨 매칭에 쓰이는 안내만 keepHistory=true. */
  function pushMenu(text, chips, keepHistory) {
    var last = log[log.length - 1];
    var sameChips = false;
    if (last && last.role === 'model' && last.text === text) {
      try { sameChips = JSON.stringify(last.chips || []) === JSON.stringify(chips || []); } catch (e) {}
      if (sameChips) { scrollBottom(); return last; }
    }
    return pushMessage('model', text, chips, keepHistory ? null : { local: 1 });
  }

  /* ------------------------------------------------------------------ *
   * 결정적 메뉴 흐름 (API 불필요, 카탈로그 기반)
   * ------------------------------------------------------------------ */
  function dispatch(cmd, arg) {
    switch (cmd) {
      case 'root':    pushMenu('원하시는 메뉴를 선택해 주세요.', rootChips()); break;
      case 'cats':    botCategories(arg); break;
      case 'models':  botModels(arg); break;
      case 'pick':    botPick(arg); break;
      case 'as':      botAS(); break;
      case 'ask':     botAsk(); break;
      case 'asstatus': botAsStatus(); break;
      case 'pmanual': botProductManual(); break;
      case 'pfaq':    botProductFaq(); break;
      case 'retry':   retry(arg); break;
      default: break;
    }
  }

  function botCategories(mode) {
    if (!catalogReady()) {
      pushMenu('제품 목록을 불러오지 못했어요.\n잠시 후 다시 시도하시거나 아래에서 이어서 문의해 주세요.', [
        { label: 'AI 상담에 물어보기', cmd: 'ask' },
        { label: '전화 걸기', url: 'tel:' + PHONE }
      ]);
      return;
    }
    // 자료(설명서/부품) 없는 카테고리도 숨기지 않고 노출 — 선택 시 botModels가 대안을 안내
    var cats = catalog.categories.filter(function (c) {
      return catalog.models.some(function (m) { return m.category === c.id; });
    });
    if (!cats.length) {
      pushMenu((mode === 'parts' ? '부품' : '설명서') + ' 정보를 찾지 못했어요.\n스토어 톡톡으로 문의하시거나 AI 상담에게 물어봐 주세요.', [
        { label: '스토어 톡톡 문의', url: STORE },
        { label: 'AI 상담에 물어보기', cmd: 'ask' }
      ]);
      return;
    }
    var chips = cats.map(function (c) { return { label: c.label, cmd: 'models', arg: mode + '|' + c.id }; });
    pushMenu(mode === 'parts'
      ? '부품 구매를 도와드릴게요.\n어떤 종류의 제품인지 골라 주세요.'
      : '설명서를 찾아드릴게요.\n어떤 종류의 제품인지 골라 주세요.', chips);
  }

  function botModels(arg) {
    var p = String(arg || '').split('|');
    var mode = p[0], cat = p[1], all = p[2] === 'all';
    var items = catalog ? catalog.models.filter(function (m) { return m.category === cat && m[mode]; }) : [];
    var catLabel = '제품';
    if (catalog) {
      for (var i = 0; i < catalog.categories.length; i++) {
        if (catalog.categories[i].id === cat) { catLabel = catalog.categories[i].label; break; }
      }
    }
    if (!items.length) {
      // 막다른 길이 아니라 대안 제시 — 톡톡·AI 상담으로 잇는다
      pushMenu('죄송해요, ' + catLabel + ' 종류는 아직 ' +
        (mode === 'parts' ? '등록된 부품 상품이 없어요' : '등록된 설명서가 없어요') +
        '.\n스토어 톡톡으로 문의하시거나 AI 상담에게 편하게 물어봐 주세요.', [
        { label: '스토어 톡톡 문의', url: STORE },
        { label: 'AI 상담에 물어보기', cmd: 'ask' }
      ]);
      return;
    }
    var show = items, extra = false;
    if (!all && items.length > 8) { show = items.slice(0, 8); extra = true; }
    var chips = show.map(function (m) { return { label: m.model, cmd: 'pick', arg: mode + '|' + m.model }; });
    if (extra) chips.push({ label: '더보기 (+' + (items.length - 8) + ')', cmd: 'models', arg: mode + '|' + cat + '|all' });
    pushMenu('네, ' + catLabel + ' 제품이군요.\n쓰고 계신 모델을 선택해 주시면 바로 안내해 드릴게요.', chips);
  }

  function botPick(arg) {
    var p = String(arg || '').split('|');
    var mode = p[0], code = p[1];
    var m = findModel(code);
    if (!m || !m[mode]) {
      pushMenu('해당 자료를 찾지 못했어요.\nAI 상담에게 물어보시거나 고객센터(' + PHONE + ')로 문의해 주세요.', [
        { label: 'AI 상담에 물어보기', cmd: 'ask' },
        { label: '전화 걸기', url: 'tel:' + PHONE }
      ]);
      return;
    }
    if (mode === 'manual') {
      var mc = [{ label: '설명서 PDF 열기', url: m.manual }];
      if (m.page) mc.push({ label: '제품 페이지', url: m.page });
      mc.push({ label: '사용법 물어보기', send: m.model + ' 사용법이 궁금해요' });
      // 모델코드가 담긴 확인 메시지 — 서버 매칭 근거가 되므로 히스토리에 유지
      pushMenu(m.model + (m.name ? ' ' + m.name : '') + ' 사용설명서를 찾았어요.\n아래 버튼을 누르시면 PDF로 바로 열려요.', mc, true);
    } else {
      pushMenu(m.model + ' 부품·구성품 구매 페이지로 안내해 드릴게요.\n필요한 부품이 보이지 않으면 편하게 물어봐 주세요.', [
        { label: '부품 구매 페이지', url: m.parts },
        { label: '스토어 홈', url: STORE },
        { label: '부품 문의하기', send: m.model + ' 부품이 궁금해요' }
      ], true);
    }
  }

  function botAS() {
    pushMenu(
      'A/S 접수를 도와드릴게요.\n증상과 모델명을 함께 알려주시면 접수가 훨씬 빨라요.\n전화 ' + PHONE + ' · ' + HOURS + ' (주말·공휴일 휴무)',
      [
        { label: 'A/S 접수 폼 바로가기', url: 'index.html#as-title' },
        { label: '접수 조회', cmd: 'asstatus' },
        { label: '전화 걸기', url: 'tel:' + PHONE },
        { label: '스토어 톡톡 문의', url: STORE }
      ]
    );
  }

  /* A/S 접수 상태 조회 — 접수번호+연락처 뒷 4자리를 받아 서버 조회(AI 미경유) */
  function botAsStatus() {
    asWait = true;
    asWaitId = '';
    asWaitP4 = '';
    pushMenu('접수 조회를 도와드릴게요.\n접수번호와 연락처 뒷 4자리를 알려주시면 바로 확인해 드릴게요.\n예) AS-260710-160225, 0000');
    focusInput(true);   // 직접 입력 의사가 명확한 흐름
  }

  function botAsk() {
    pushMenu('네, 편하게 물어봐 주세요!\n예) 필터는 어떻게 청소하나요?');
    focusInput(true);   // '질문하기'를 직접 눌렀을 때만 모바일에서도 키보드를 올림
  }

  function botProductManual() {
    var code = productContext();
    var m = findModel(code);
    if (m && m.manual) {
      var mc = [{ label: '설명서 PDF 열기', url: m.manual }];
      if (m.page) mc.push({ label: '제품 페이지', url: m.page });
      mc.push({ label: '사용법 물어보기', send: m.model + ' 사용법이 궁금해요' });
      // 모델코드가 담긴 확인 메시지 — 서버 매칭 근거가 되므로 히스토리에 유지
      pushMenu(m.model + ' 사용설명서를 찾았어요.\n아래 버튼을 누르시면 PDF로 바로 열려요.', mc, true);
    } else if (config.endpoint) {
      sendUserMessage((code || '이 제품') + ' 설명서를 알려주세요');
    } else {
      pushMenu('해당 제품 설명서를 찾지 못했어요.\n고객센터(' + PHONE + ')로 문의해 주시면 확인해 드릴게요.', [{ label: '전화 걸기', url: 'tel:' + PHONE }]);
    }
  }

  function botProductFaq() {
    var code = productContext();
    var m = findModel(code);
    if (m && m.page) {
      var url = m.page + (m.page.indexOf('#') >= 0 ? '' : '#faq');
      pushMenu((m.model || '이 제품') + '에 대해 자주 묻는 질문을 모아뒀어요.\n아래 버튼에서 확인해 보세요.', [{ label: '제품 FAQ 보기', url: url }], true);
    } else if (config.endpoint) {
      sendUserMessage((code || '이 제품') + ' 자주 묻는 질문을 알려주세요');
    } else {
      pushMenu((code || '해당 제품') + ' 관련 궁금한 점을 아래에 편하게 입력해 주세요.');
      focusInput();
    }
  }

  /* ------------------------------------------------------------------ *
   * 자유 입력 → 서버 호출
   * ------------------------------------------------------------------ */
  function onSubmit(e) {
    if (e) e.preventDefault();
    var v = taEl.value.trim();
    if (!v) return;
    sendUserMessage(v);
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(e); }
  }

  function autoGrow() {
    taEl.style.height = 'auto';
    var full = taEl.scrollHeight;
    taEl.style.height = Math.min(full, 120) + 'px';
    taEl.style.overflowY = full > 120 ? 'auto' : 'hidden';
  }

  function sendUserMessage(text) {
    text = String(text == null ? '' : text).trim();
    if (!text || sending) return;
    taEl.value = '';
    autoGrow();
    dropKeyboard();           // 모바일: 전송하면 키보드를 내려 답변이 보이게
    var entry = pushMessage('user', text);
    lastUserMessage = text;

    // A/S 접수 조회 흐름은 AI를 거치지 않고 서버 조회로 처리.
    // 가로챈 발화(접수번호·연락처 뒷 4자리)는 AI 히스토리에서 제외(개인정보 미전송).
    if (interceptAsStatus(text)) {
      entry.local = 1;
      persistSession();
      return;
    }

    if (!config.endpoint) {
      if (configLoaded) {
        // 정상 로드됐지만 endpoint 미설정(배포 전) — 정당한 안내
        pushMenu('아직 AI 상담 연결을 준비 중이에요.\n아래 메뉴로 설명서·부품·A/S를 안내해 드릴게요.', rootChips());
      } else {
        // 설정 로드가 실패했던 경우 — 1회 재시도 후 진행/안내
        setBusy(true);
        loadConfig().then(function () {
          setBusy(false);
          if (config.endpoint) {
            callApi(text);
          } else {
            pushMenu('연결이 원활하지 않아요.\n잠시 후 다시 시도하시거나 고객센터(' + PHONE + ', ' + HOURS + ')로 문의해 주세요.', [
              { label: '전화 걸기', url: 'tel:' + PHONE },
              { label: '스토어 톡톡 문의', url: STORE }
            ]);
          }
        });
      }
      return;
    }
    callApi(text);
  }

  /* A/S 접수번호 조회 가로채기 — 접수번호 패턴 감지 또는 조회 대기 상태의 뒷 4자리 */
  function interceptAsStatus(text) {
    var idM = text.match(/AS-?\s?\d{6}-?\s?\d{6}/i);
    if (idM) {
      var norm = 'AS-' + idM[0].replace(/\D/g, '').slice(0, 12).replace(/(\d{6})(\d{6})/, '$1-$2');
      var rest4 = text.replace(idM[0], '').replace(/\D/g, '').slice(-4);
      if (rest4.length !== 4 && asWaitP4) rest4 = asWaitP4;
      if (rest4.length === 4) {
        asWait = false; asWaitId = ''; asWaitP4 = '';
        callAsStatus(norm, rest4);
        return true;
      }
      asWait = true;
      asWaitId = norm;
      pushMenu('접수번호를 확인했어요.\n본인 확인을 위해 연락처 뒷 4자리를 알려주시겠어요?');
      return true;
    }
    if (asWait) {
      if (/^\D*\d{4}\D*$/.test(text)) {
        var l4 = text.replace(/\D/g, '');
        if (asWaitId) {
          var savedId = asWaitId;
          asWait = false; asWaitId = ''; asWaitP4 = '';
          callAsStatus(savedId, l4);
        } else {
          asWaitP4 = l4;
          pushMenu('확인 감사해요.\n접수번호(예: AS-260710-160225)도 알려주시면 바로 조회해 드릴게요.');
        }
        return true;
      }
      // 조회 흐름에서 벗어난 일반 질문 — 대기 해제 후 평소대로 처리
      asWait = false; asWaitId = ''; asWaitP4 = '';
      return false;
    }
    return false;
  }

  function callAsStatus(id, last4) {
    if (!config.endpoint) {
      pushMenu('지금은 온라인 조회가 어려워요.\n전화(' + PHONE + ', ' + HOURS + ')로 확인 부탁드려요.', [{ label: '전화 걸기', url: 'tel:' + PHONE }]);
      return;
    }
    setBusy(true);
    var typing = showTyping();
    fetch(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ action: 'asStatus', sessionId: sid, id: id, phone4: last4 })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        removeNode(typing);
        if (data && data.ok) {
          var st = String(data.status || '접수');
          // 시트 상태값 → 스테퍼 단계(운영자가 다른 표현을 써도 포함 매칭으로 흡수)
          var stepIdx = st.indexOf('완료') !== -1 ? 2 : (st.indexOf('확인') !== -1 || st.indexOf('처리') !== -1 ? 1 : 0);
          pushMessage('model', '접수번호 ' + id + ' 건은 지금 "' + st + '" 상태예요.' +
            (data.date ? '\n(접수일 ' + String(data.date) + ')' : '') +
            '\n처리되는 대로 순서대로 연락드릴게요.', null, { local: 1, steps: stepIdx });
        } else {
          pushMenu((data && data.error) ? String(data.error)
            : '접수 내역을 확인하지 못했어요. 접수번호와 연락처 뒷 4자리를 다시 확인해 주세요.',
            [{ label: '전화 걸기', url: 'tel:' + PHONE }]);
        }
      })
      .catch(function () {
        removeNode(typing);
        pushMenu('연결이 원활하지 않아요.\n잠시 후 다시 시도하시거나 전화(' + PHONE + ', ' + HOURS + ')로 확인 부탁드려요.', [{ label: '전화 걸기', url: 'tel:' + PHONE }]);
      })
      .then(function () { setBusy(false); });
  }

  /* 서버로 보낼 history — 로컬 안내(메뉴·오류·환영)는 제외해 12턴 창 오염 방지.
     current(방금 보낸 메시지)와 같은 마지막 user 항목만 제외 — 재시도 시에도 정합. */
  function buildHistory(current) {
    var turns = [];
    for (var i = 0; i < log.length; i++) {
      var e = log[i];
      if (e.local) continue;
      if ((e.role === 'user' || e.role === 'model') && e.text && String(e.text).trim()) {
        turns.push({ role: e.role, text: String(e.text) });
      }
    }
    if (turns.length && turns[turns.length - 1].role === 'user' &&
        turns[turns.length - 1].text === current) {
      turns.pop();
    }
    return turns.slice(-MAX_TURNS);
  }

  function callApi(text) {
    sending = true;
    setBusy(true);
    var typing = showTyping();

    var payload = {
      action: 'chat',
      sessionId: sid,
      message: text,
      history: buildHistory(text),
      product: productContext(),
      page: currentPageId()
    };

    // 30초 타임아웃 — GAS 콜드스타트 등 무응답 시 busy 상태 고착 방지.
    // abort 콜백에서 플래그를 세워 일반 네트워크 오류와 문구를 구분한다.
    var timedOut = false;
    var controller = (typeof AbortController === 'function') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { timedOut = true; controller.abort(); }, 30000) : null;

    // 대기 단계 안내 — 점 3개 옆에 2.5초 간격으로 문구 로테이션(마지막 문구 유지)
    var stages = ['질문을 확인하고 있어요', '제품 자료를 찾고 있어요', '답변을 정리하고 있어요'];
    var stageIdx = 0;
    var stageTimer = setInterval(function () {
      if (stageIdx >= stages.length) { clearInterval(stageTimer); return; }
      setTypingText(typing, stages[stageIdx]);
      stageIdx++;
    }, 2500);

    fetch(config.endpoint, {
      method: 'POST',
      // text/plain → CORS preflight 회피 (body는 JSON 문자열)
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    })
      .then(function (r) { return r.json().catch(function () { throw new Error('bad-json'); }); })
      .then(function (data) {
        removeNode(typing);
        if (data && data.ok) {
          if (data.matched && data.matched.length) {
            lastMatchedCode = String(data.matched[data.matched.length - 1]);
          }
          var meta = { msgId: (typeof data.msgId === 'string' ? data.msgId : ''), q: text };
          // 출처 캡션은 되묻기(ambiguous) 답변에는 붙이지 않는다 — 확인 질문에 '자료 참고' 표기는 오인
          if (data.grounded && data.groundedCodes && data.groundedCodes.length && !data.ambiguous) {
            meta.grounded = true;
            meta.codes = data.groundedCodes.slice(0, 2).map(function (c) { return String(c); });
          }
          pushMessage('model', data.reply || '답변을 준비했어요.', sanitizeChips(data.chips), { meta: meta });
        } else {
          var msg = (data && data.error) ? data.error : '답변을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.';
          pushMessage('model', msg, errorChips(data, text), { local: 1 });
        }
      })
      .catch(function (err) {
        removeNode(typing);
        if (timedOut || (err && err.name === 'AbortError')) {
          // 30초 타임아웃 — 오래 기다린 고객에게 정직한 설명 + 대안 경로
          pushMessage('model',
            '답변 준비가 오래 걸리고 있어요. 잠시 후 다시 시도해 주시겠어요?\n급하시면 아래에서 바로 접수·문의하실 수 있어요.',
            [
              { label: '다시 시도', cmd: 'retry', arg: text.slice(0, 1000) },
              { label: 'A/S 접수 폼 바로가기', url: 'index.html#as-title' },
              { label: '스토어 톡톡 문의', url: STORE }
            ], { local: 1 });
        } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          pushMessage('model',
            '인터넷 연결을 확인해 주세요.\n연결된 뒤 다시 시도하시면 바로 도와드릴게요.',
            [{ label: '다시 시도', cmd: 'retry', arg: text.slice(0, 1000) }], { local: 1 });
        } else {
          pushMessage('model',
            '연결이 원활하지 않아요. 잠시 후 다시 시도하시거나 고객센터(' + PHONE + ', ' + HOURS + ')로 문의해 주세요.',
            [
              { label: '다시 시도', cmd: 'retry', arg: text.slice(0, 1000) },
              { label: '전화 걸기', url: 'tel:' + PHONE }
            ], { local: 1 });
        }
      })
      .then(function () {
        if (timer) clearTimeout(timer);
        clearInterval(stageTimer);
        sending = false;
        setBusy(false);
        focusInput();
      });
  }

  /* 서버 ok:false 응답의 대안 칩 — 전화·톡톡 상시, retryable일 때만 '다시 시도' */
  function errorChips(data, text) {
    var chips = [
      { label: '전화 걸기', url: 'tel:' + PHONE },
      { label: '스토어 톡톡 문의', url: STORE }
    ];
    var retryable = !(data && data.retryable === false);
    if (retryable && text) chips.push({ label: '다시 시도', cmd: 'retry', arg: text.slice(0, 1000) });
    return chips;
  }

  /* 서버 chips 위생 처리 — 계약 형태만 통과, url은 허용 목록 검증 */
  function sanitizeChips(chips) {
    if (!Array.isArray(chips)) return [];
    var out = [];
    for (var i = 0; i < chips.length && out.length < 4; i++) {
      var c = chips[i];
      if (!c || typeof c !== 'object') continue;
      var label = typeof c.label === 'string' ? c.label.slice(0, 60) : '';
      if (!label) continue;
      if (typeof c.url === 'string') {
        if (safeHref(c.url)) out.push({ label: label, url: c.url });
      } else if (typeof c.send === 'string' && c.send.trim()) {
        out.push({ label: label, send: c.send.slice(0, 300) });
      }
    }
    return out;
  }

  /* 재시도 — 칩에 내장된 실패 질문(arg) 우선, 없으면 메모리 변수 → 로그 역순 탐색.
     페이지 이동 후에도 칩이 정확히 '실패했던 그 질문'을 재전송한다. */
  function retry(arg) {
    if (!config.endpoint || sending) return;
    var text = (typeof arg === 'string' && arg.trim()) ? arg.trim() : '';
    if (!text) text = lastUserMessage;
    if (!text) {
      for (var i = log.length - 1; i >= 0; i--) {
        var e = log[i];
        if (e.role === 'user' && e.text && String(e.text).trim()) { text = String(e.text).trim(); break; }
      }
    }
    if (!text) {
      pushMenu('다시 시도할 문의를 찾지 못했어요.\n궁금하신 내용을 아래에 다시 입력해 주세요.');
      focusInput();
      return;
    }
    lastUserMessage = text;
    callApi(text);
  }

  /* 로딩 점 3개 + 스크린리더용 숨김 텍스트 + 단계 문구 자리 (로그에 남기지 않음) */
  function showTyping() {
    var wrap = el('div', { 'class': 'cchat-msg cchat-bot' });
    var bubble = el('div', { 'class': 'cchat-bubble cchat-typing' });
    var dots = el('span', { 'class': 'cchat-dots', 'aria-hidden': 'true' });
    for (var i = 0; i < 3; i++) dots.appendChild(el('span', { 'class': 'cchat-dot' }));
    bubble.appendChild(dots);
    // role=log(msgEl) 라이브 영역이 낭독하는 실제 텍스트 — 시각적으로만 숨김
    bubble.appendChild(el('span', { 'class': 'cchat-sr', text: '답변을 작성하고 있어요' }));
    bubble.appendChild(el('span', { 'class': 'cchat-typing-tx', 'aria-hidden': 'true' }));
    wrap.appendChild(bubble);
    msgEl.appendChild(wrap);
    scrollBottom();
    return wrap;
  }

  /* 대기 단계 문구 갱신 — showTyping이 만든 자리에만 기록(로그 미저장) */
  function setTypingText(wrap, text) {
    try {
      var tx = wrap.querySelector('.cchat-typing-tx');
      if (tx) { tx.textContent = text; scrollBottom(); }
    } catch (e) {}
  }

  function setBusy(b) {
    sending = b;
    if (sendBtn) sendBtn.disabled = b;
    // msgEl(aria-live) 에 aria-busy를 걸면 일부 보조기술이 답변 낭독까지 보류하므로 걸지 않는다
  }

  /* ------------------------------------------------------------------ *
   * 초기화(리셋)
   * ------------------------------------------------------------------ */
  function resetConversation() {
    sid = uuid();          // 새 세션 ID
    log = [];
    persistSession();
    msgEl.textContent = '';
    lastUserMessage = '';
    lastMatchedCode = '';  // 폐기된 대화의 모델이 A/S 폼에 프리필되지 않게
    asWait = false;        // A/S 조회 대기 상태도 함께 초기화
    asWaitId = '';
    asWaitP4 = '';
    seedWelcome();
    renderRootBar();
    focusInput();
  }

  /* ------------------------------------------------------------------ *
   * 열기/닫기/접근성
   * ------------------------------------------------------------------ */
  /* 모바일 시트가 열린 동안 배경 페이지 스크롤 잠금(닫으면 보던 위치 복원) */
  function lockScroll() {
    if (scrollLocked) return;
    if (!window.matchMedia || !matchMedia('(max-width: 640px)').matches) return;
    savedScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    var bs = document.body.style;
    bs.position = 'fixed';
    bs.top = (-savedScrollY) + 'px';
    bs.left = '0';
    bs.right = '0';
    bs.width = '100%';
    scrollLocked = true;
  }

  function unlockScroll() {
    if (!scrollLocked) return;
    scrollLocked = false;
    var bs = document.body.style;
    bs.position = '';
    bs.top = '';
    bs.left = '';
    bs.right = '';
    bs.width = '';
    window.scrollTo(0, savedScrollY);
  }

  /* 페이지 이동으로 제품 컨텍스트가 바뀐 채 패널을 열면 한 줄 안내(#30).
     최초 저장은 finishInit — 같은 페이지 첫 오픈은 환영 인사가 담당하므로 중복 없음 */
  function contextNotice() {
    if (!initDone || disabled) return;
    var cur = productContext() || '';
    var stored = null;
    try { stored = sessionStorage.getItem('clapaChat.prod'); } catch (e) { return; }
    if (stored === null || cur === stored) return;
    try { sessionStorage.setItem('clapaChat.prod', cur); } catch (e) {}
    if (!cur) return;                  // 홈으로 이동(컨텍스트 해제)은 조용히 갱신만
    var hasUserTurn = false;           // 실제 대화가 있어야 안내(환영 인사와 중복 방지)
    for (var i = 0; i < log.length; i++) {
      if (log[i].role === 'user') { hasUserTurn = true; break; }
    }
    if (!hasUserTurn) return;
    var m = findModel(cur);
    if (!m) return;
    // 제품명이 히스토리에 실려 서버 매칭에도 신호가 되므로 keepHistory
    pushMenu('지금은 ' + m.name + '(' + m.model + ') 페이지를 보고 계시네요.\n이 제품 기준으로 이어서 도와드릴게요.', null, true);
  }

  function open() {
    if (disabled || isOpen || !panelEl) return;
    isOpen = true;
    lastFocus = document.activeElement;
    scrimEl.hidden = false;
    panelEl.hidden = false;
    // reflow 후 클래스 부여(트랜지션 발동)
    void panelEl.offsetWidth;
    scrimEl.classList.add('is-open');
    panelEl.classList.add('is-open');
    fabEl.classList.add('cchat-hidden');
    fabEl.setAttribute('aria-expanded', 'true');
    syncTriggers(true);
    lockScroll();
    try { localStorage.setItem('clapaChat.hint', '1'); } catch (e) {}  // 챗을 연 사용자는 힌트 영구 미노출
    contextNotice();
    document.addEventListener('keydown', onEsc, true);
    autoGrow();                 // 패널이 보이는 상태에서 입력창 높이 보정(빈 스크롤바 방지)
    setTimeout(focusInput, 30);
    scrollBottom();
    dispatchEvt('clapachat:open');
  }

  function close() {
    if (!isOpen || !panelEl) return;
    isOpen = false;
    scrimEl.classList.remove('is-open');
    panelEl.classList.remove('is-open');
    scrimEl.hidden = true;
    panelEl.hidden = true;
    panelEl.style.height = '';   // visualViewport 보정 해제
    fabEl.classList.remove('cchat-hidden');
    fabEl.setAttribute('aria-expanded', 'false');
    syncTriggers(false);
    unlockScroll();
    document.removeEventListener('keydown', onEsc, true);
    try { (lastFocus && lastFocus.focus) ? lastFocus.focus() : fabEl.focus(); } catch (e) { try { fabEl.focus(); } catch (e2) {} }
    dispatchEvt('clapachat:close');
  }

  /* 모바일 키보드가 올라오면(visualViewport 축소) 패널 높이를 보정해 입력창이 가려지지 않게 */
  function onVvResize() {
    if (!isOpen || !panelEl) return;
    if (!window.matchMedia || !matchMedia('(max-width: 640px)').matches) return;
    try {
      var vv = window.visualViewport;
      if (!vv || !vv.height) return;
      panelEl.style.height = Math.round(vv.height * 0.88) + 'px';
      scrollBottom();
    } catch (e) {}
  }

  function toggle() { isOpen ? close() : open(); }

  function onEsc(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }

  /* 입력창 포커스 — 모바일에서는 화면 키보드가 저절로 올라오면 안 되므로
     기본적으로 PC(물리 키보드)에서만 동작. force=true 는 사용자가 '직접 입력하겠다'는
     명시적 행동(예: '질문하기' 칩)일 때만 사용. */
  function focusInput(force) {
    if (!taEl || !isOpen) return;
    if (!force && isTouchLike()) return;
    try { taEl.focus(); } catch (e) {}
  }

  /* 모바일 화면 키보드 내리기 — 메시지 전송 직후 답변을 가리지 않도록 */
  function dropKeyboard() {
    if (!isTouchLike()) return;
    try { if (taEl && document.activeElement === taEl) taEl.blur(); } catch (e) {}
  }

  /* 패널 내부 Tab 포커스 트랩(aria-modal) */
  function trapTab(e) {
    if (e.key !== 'Tab') return;
    var nodes = panelEl.querySelectorAll('button, a[href], textarea, input, [tabindex]:not([tabindex="-1"])');
    var list = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n.disabled && n.offsetParent !== null) list.push(n);
    }
    if (!list.length) return;
    var first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function dispatchEvt(name) {
    try {
      var ev;
      if (typeof CustomEvent === 'function') ev = new CustomEvent(name, { detail: { sid: sid } });
      else { ev = document.createEvent('CustomEvent'); ev.initCustomEvent(name, false, false, { sid: sid }); }
      document.dispatchEvent(ev);
    } catch (e) {}
  }

  /* ------------------------------------------------------------------ *
   * 부팅
   * ------------------------------------------------------------------ */
  /* 페이지 자체의 '채팅 상담' 버튼([data-clapa-chat-trigger])이 있으면
     위젯 FAB 대신 그 버튼을 트리거로 사용(중복 FAB 방지) */
  function bindTriggers() {
    var nodes = document.querySelectorAll('[data-clapa-chat-trigger]');
    triggerEls = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      n.addEventListener('click', toggle);
      n.setAttribute('aria-haspopup', 'dialog');
      n.setAttribute('aria-expanded', 'false');
      triggerEls.push(n);
    }
    if (triggerEls.length && fabEl) fabEl.classList.add('cchat-replaced');
  }

  /* 검색창 등에서 질문을 그대로 넘겨받아 AI 상담 시작 — ClapaChat.ask(text) */
  var pendingAsk = null;
  function ask(text) {
    text = String(text == null ? '' : text).trim();
    if (!text || disabled) return false;
    open();
    if (!initDone) { pendingAsk = text; return true; }  // 로드 완료 후 finishInit에서 전송
    sendUserMessage(text);
    return true;
  }

  /* 페이지 요소에서 챗 플로우 바로 실행 — [data-clapa-chat-action="as|manual|parts|ask"] */
  var actionEls = [];
  var pendingAction = null;   // config/카탈로그 로드 전 클릭 → 로드 완료 후 실행

  function doAction(name) {
    switch (name) {
      case 'manual': dispatch('cats', 'manual'); return true;
      case 'parts':  dispatch('cats', 'parts'); return true;
      case 'as':     dispatch('as'); return true;
      case 'ask':    dispatch('ask'); return true;
      case 'asstatus': dispatch('asstatus'); return true;  // 접수 조회 (홈 퀵메뉴)
      default: return false;
    }
  }

  function runAction(name) {
    if (disabled) return false;
    open();
    if (!initDone) { pendingAction = name; return true; }  // 로드 완료 후 finishInit에서 실행
    return doAction(name);
  }

  function bindActions() {
    var nodes = document.querySelectorAll('[data-clapa-chat-action]');
    actionEls = [];
    for (var i = 0; i < nodes.length; i++) {
      (function (n) {
        n.setAttribute('aria-haspopup', 'dialog');
        n.setAttribute('aria-expanded', 'false');
        n.addEventListener('click', function (e) {
          var name = n.getAttribute('data-clapa-chat-action');
          if (disabled) return; // 챗 비활성 시 원래 링크(href 폴백)로 동작
          e.preventDefault();
          runAction(name);
        });
        actionEls.push(n);
      })(nodes[i]);
    }
  }

  function syncTriggers(openState) {
    for (var i = 0; i < triggerEls.length; i++) {
      triggerEls[i].setAttribute('aria-expanded', openState ? 'true' : 'false');
      if (openState) triggerEls[i].classList.add('cchat-trigger-hidden');
      else triggerEls[i].classList.remove('cchat-trigger-hidden');
    }
    // 액션 요소(토픽 카드 등)는 숨기지 않고 상태만 갱신
    for (var j = 0; j < actionEls.length; j++) {
      actionEls[j].setAttribute('aria-expanded', openState ? 'true' : 'false');
    }
  }

  function boot() {
    buildUI();
    bindTriggers();
    bindActions();
    loadSession();

    // 공개 API 노출 (기존 '채팅 상담' 버튼과 연결용)
    window.ClapaChat = {
      open: open,
      close: close,
      toggle: toggle,
      action: runAction,
      ask: ask,
      isOpen: function () { return isOpen; },
      __mounted: true
    };

    // 챗에서 A/S 폼으로 넘어온 초안이 있으면 폼 프리필(홈에서만 동작)
    var filledDraft = fillAsForm();

    // 챗 링크로 페이지를 이동해 왔다면 안내 토스트 표시(프리필 토스트와 중복 방지)
    var nav = null;
    try { nav = sessionStorage.getItem('clapaChat.nav'); } catch (e) {}
    if (nav) {
      try { sessionStorage.removeItem('clapaChat.nav'); } catch (e) {}
      if (!filledDraft) showToast(nav);
    }

    // 모바일 화면 키보드 대응(열림 시 패널 높이 보정)
    if (window.visualViewport) {
      try { window.visualViewport.addEventListener('resize', onVvResize); } catch (e) {}
    }

    loadConfig()
      .then(loadCatalog)
      .then(finishInit)
      .catch(finishInit);
  }

  var initDone = false;
  function finishInit() {
    if (initDone) return;   // then/catch 양쪽에서 중복 호출 방지
    initDone = true;
    disabled = (config.enabled === false);
    if (disabled) {
      // 비활성 시 위젯 미노출 — 페이지 자체 CSS가 [hidden]을 이길 수 있어 display도 직접 차단
      if (fabEl) fabEl.hidden = true;
      for (var i = 0; i < triggerEls.length; i++) {
        triggerEls[i].hidden = true;
        triggerEls[i].style.display = 'none';
      }
      pendingAction = null;
      return;
    }
    if (fabEl) fabEl.hidden = false;
    renderRootBar();
    if (log && log.length) renderAll();
    else seedWelcome();
    // 제품 컨텍스트 키 최초 저장 — 이후 페이지 이동 감지(contextNotice)의 기준값
    try {
      if (sessionStorage.getItem('clapaChat.prod') === null) {
        sessionStorage.setItem('clapaChat.prod', productContext() || '');
      }
    } catch (e) {}
    maybeShowHint();
    if (pendingAction) {           // 로드 완료 전 눌린 토픽 카드 액션 지연 실행
      var act = pendingAction;
      pendingAction = null;
      doAction(act);
    }
    if (pendingAsk) {              // 로드 완료 전 넘겨받은 질문 지연 전송
      var q = pendingAsk;
      pendingAsk = null;
      sendUserMessage(q);
    }
  }

  /* 모바일 첫 방문자용 1회성 힌트 — FAB가 아이콘만 보이는 소형 화면에서
     'AI가 바로 답해드려요' 말풍선을 4초 표시 후 자동 소멸(진행 비차단) */
  function maybeShowHint() {
    if (disabled || isOpen) return;
    var seen = null;
    try { seen = localStorage.getItem('clapaChat.hint'); } catch (e) { return; }  // 프라이빗 모드 등
    if (seen) return;
    if (!window.matchMedia || !matchMedia('(max-width: 480px)').matches) return;
    try { localStorage.setItem('clapaChat.hint', '1'); } catch (e) {}
    var t = el('div', { 'class': 'cchat-toast cchat-toast--fab', role: 'status', text: 'AI가 바로 답해드려요' });
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('is-on'); }, 20);
    setTimeout(function () {
      t.classList.remove('is-on');
      setTimeout(function () { removeNode(t); }, 300);
    }, 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
