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
    welcome: '안녕하세요, 클래파 AI 상담이에요.\n궁금한 점을 입력하시거나 아래 메뉴를 눌러 주세요.'
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
  var catalog = null;          // { categories:[{id,label}], models:[{model,name,category,page,manual,parts}] }
  var log = [];                // [{ role:'user'|'model', text:string, chips?:[] }]
  var sid = '';
  var isOpen = false;
  var sending = false;
  var lastUserMessage = '';
  var disabled = false;        // config.enabled === false
  var lastFocus = null;

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
      .then(function (j) { if (j && typeof j === 'object') config = assign({}, DEFAULT_CONFIG, j); })
      .catch(function () { /* 기본값 유지 */ });
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
  function buildChip(spec) {
    if (!spec || !spec.label) return null;

    if (spec.url) {
      var href = safeHref(spec.url);
      if (!href) return null;                 // 허용되지 않은 url → 버튼 자체를 만들지 않음
      var a = el('a', { 'class': 'cchat-chip cchat-chip-link', href: href });
      var ext = isExternal(href);
      if (ext) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
      a.appendChild(document.createTextNode(spec.label));
      if (ext) a.appendChild(el('span', { 'class': 'cchat-chip-ext', 'aria-hidden': 'true', text: '↗' }));
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
    if (productContext()) {
      return [
        { label: '이 제품 설명서', cmd: 'pmanual' },
        { label: '이 제품 FAQ', cmd: 'pfaq' },
        { label: '부품 구매', cmd: 'cats', arg: 'parts' },
        { label: 'A/S 신청', cmd: 'as' }
      ];
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
    msgEl.appendChild(wrap);
  }

  function renderAll() {
    msgEl.textContent = '';
    for (var i = 0; i < log.length; i++) renderEntry(log[i]);
    scrollBottom();
  }

  function pushMessage(role, text, chips) {
    var entry = { role: role, text: String(text == null ? '' : text) };
    if (chips && chips.length) entry.chips = chips;
    log.push(entry);
    if (log.length > MAX_LOG) log = log.slice(log.length - MAX_LOG);
    persistSession();
    renderEntry(entry);
    scrollBottom();
    return entry;
  }

  function seedWelcome() {
    pushMessage('model', config.welcome || DEFAULT_CONFIG.welcome);
  }

  /* 메뉴 안내 메시지 — 직전 메시지와 텍스트·칩이 모두 같을 때만 스킵(카드 반복 클릭 대비).
     칩이 다르면 새로 쌓는다('더보기' 등 같은 문구·다른 목록 케이스). */
  function pushMenu(text, chips) {
    var last = log[log.length - 1];
    var sameChips = false;
    if (last && last.role === 'model' && last.text === text) {
      try { sameChips = JSON.stringify(last.chips || []) === JSON.stringify(chips || []); } catch (e) {}
      if (sameChips) { scrollBottom(); return last; }
    }
    return pushMessage('model', text, chips);
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
      case 'pmanual': botProductManual(); break;
      case 'pfaq':    botProductFaq(); break;
      case 'retry':   retry(); break;
      default: break;
    }
  }

  function botCategories(mode) {
    if (!catalogReady()) {
      pushMenu('제품 목록을 불러오지 못했어요.\n잠시 후 다시 시도하시거나 고객센터(' + PHONE + ', ' + HOURS + ')로 문의해 주세요.', [{ label: '전화 걸기', url: 'tel:' + PHONE }]);
      return;
    }
    var cats = catalog.categories.filter(function (c) {
      return catalog.models.some(function (m) { return m.category === c.id && m[mode]; });
    });
    if (!cats.length) {
      pushMenu((mode === 'parts' ? '부품' : '설명서') + ' 정보를 찾지 못했어요. 고객센터(' + PHONE + ')로 문의해 주세요.');
      return;
    }
    var chips = cats.map(function (c) { return { label: c.label, cmd: 'models', arg: mode + '|' + c.id }; });
    pushMenu(mode === 'parts' ? '어떤 제품의 부품이 필요하세요?' : '어떤 제품의 설명서가 필요하세요?', chips);
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
      pushMenu(catLabel + ' 카테고리에서 해당 자료를 찾지 못했어요.');
      return;
    }
    var show = items, extra = false;
    if (!all && items.length > 8) { show = items.slice(0, 8); extra = true; }
    var chips = show.map(function (m) { return { label: m.model, cmd: 'pick', arg: mode + '|' + m.model }; });
    if (extra) chips.push({ label: '더보기 (+' + (items.length - 8) + ')', cmd: 'models', arg: mode + '|' + cat + '|all' });
    pushMenu(catLabel + ' 모델을 선택해 주세요.', chips);
  }

  function botPick(arg) {
    var p = String(arg || '').split('|');
    var mode = p[0], code = p[1];
    var m = findModel(code);
    if (!m || !m[mode]) {
      pushMenu('해당 자료를 찾지 못했어요. 고객센터(' + PHONE + ')로 문의해 주세요.', [{ label: '전화 걸기', url: 'tel:' + PHONE }]);
      return;
    }
    if (mode === 'manual') {
      var mc = [{ label: '설명서 PDF 열기', url: m.manual }];
      if (m.page) mc.push({ label: '제품 페이지', url: m.page });
      pushMenu(m.model + (m.name ? ' ' + m.name : '') + ' 설명서예요.', mc);
    } else {
      pushMenu(m.model + ' 부품·구성품 구매 페이지예요.', [
        { label: '부품 구매 페이지', url: m.parts },
        { label: '스토어 홈', url: STORE }
      ]);
    }
  }

  function botAS() {
    pushMenu(
      '증상과 모델명을 알려주시면 접수가 빨라요.\n전화 ' + PHONE + ' · ' + HOURS + ' (주말·공휴일 휴무)',
      [{ label: '전화 걸기', url: 'tel:' + PHONE }, { label: '스토어 톡톡 문의', url: STORE }]
    );
  }

  function botAsk() {
    pushMenu('궁금한 점을 아래에 편하게 적어 주세요.\n예) 필터는 어떻게 청소하나요?');
    focusInput();
  }

  function botProductManual() {
    var code = productContext();
    var m = findModel(code);
    if (m && m.manual) {
      var mc = [{ label: '설명서 PDF 열기', url: m.manual }];
      if (m.page) mc.push({ label: '제품 페이지', url: m.page });
      pushMenu(m.model + ' 설명서예요.', mc);
    } else if (config.endpoint) {
      sendUserMessage((code || '이 제품') + ' 설명서를 알려주세요');
    } else {
      pushMenu('해당 제품 설명서를 찾지 못했어요. 고객센터(' + PHONE + ')로 문의해 주세요.', [{ label: '전화 걸기', url: 'tel:' + PHONE }]);
    }
  }

  function botProductFaq() {
    var code = productContext();
    var m = findModel(code);
    if (m && m.page) {
      var url = m.page + (m.page.indexOf('#') >= 0 ? '' : '#faq');
      pushMenu((m.model || '이 제품') + ' 자주 묻는 질문이에요.', [{ label: '제품 FAQ 보기', url: url }]);
    } else if (config.endpoint) {
      sendUserMessage((code || '이 제품') + ' 자주 묻는 질문을 알려주세요');
    } else {
      pushMenu((code || '해당 제품') + ' 관련 궁금한 점을 아래에 입력해 주세요.');
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
    pushMessage('user', text);
    lastUserMessage = text;

    if (!config.endpoint) {
      pushMenu('아직 AI 상담 연결을 준비 중이에요.\n아래 메뉴로 설명서·부품·A/S를 안내해 드릴게요.', rootChips());
      return;
    }
    callApi(text);
  }

  /* 서버로 보낼 history — 마지막(현재) 사용자 메시지는 제외, 최근 MAX_TURNS 턴 */
  function buildHistory() {
    var turns = [];
    for (var i = 0; i < log.length; i++) {
      var e = log[i];
      if ((e.role === 'user' || e.role === 'model') && e.text && String(e.text).trim()) {
        turns.push({ role: e.role, text: String(e.text) });
      }
    }
    if (turns.length) turns = turns.slice(0, turns.length - 1); // 현재 사용자 발화 제외
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
      history: buildHistory(),
      product: productContext(),
      page: currentPageId()
    };

    // 30초 타임아웃 — GAS 콜드스타트 등 무응답 시 busy 상태 고착 방지
    var controller = (typeof AbortController === 'function') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 30000) : null;

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
          pushMessage('model', data.reply || '답변을 준비했어요.', sanitizeChips(data.chips));
        } else {
          var msg = (data && data.error) ? data.error : '답변을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.';
          pushMessage('model', msg, [{ label: '다시 시도', cmd: 'retry' }]);
        }
      })
      .catch(function () {
        removeNode(typing);
        pushMessage('model',
          '연결이 원활하지 않아요. 잠시 후 다시 시도하시거나 고객센터(' + PHONE + ', ' + HOURS + ')로 문의해 주세요.',
          [{ label: '다시 시도', cmd: 'retry' }]);
      })
      .then(function () {
        if (timer) clearTimeout(timer);
        sending = false;
        setBusy(false);
        focusInput();
      });
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

  function retry() {
    if (!config.endpoint || !lastUserMessage || sending) return;
    callApi(lastUserMessage);
  }

  /* 로딩 점 3개 (로그에 남기지 않음) */
  function showTyping() {
    var wrap = el('div', { 'class': 'cchat-msg cchat-bot' });
    var bubble = el('div', { 'class': 'cchat-bubble cchat-typing', 'aria-label': '답변 작성 중' });
    for (var i = 0; i < 3; i++) bubble.appendChild(el('span', { 'class': 'cchat-dot' }));
    wrap.appendChild(bubble);
    msgEl.appendChild(wrap);
    scrollBottom();
    return wrap;
  }

  function setBusy(b) {
    sending = b;
    if (sendBtn) sendBtn.disabled = b;
    if (msgEl) msgEl.setAttribute('aria-busy', b ? 'true' : 'false');
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
    seedWelcome();
    renderRootBar();
    focusInput();
  }

  /* ------------------------------------------------------------------ *
   * 열기/닫기/접근성
   * ------------------------------------------------------------------ */
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
    fabEl.classList.remove('cchat-hidden');
    fabEl.setAttribute('aria-expanded', 'false');
    syncTriggers(false);
    document.removeEventListener('keydown', onEsc, true);
    try { (lastFocus && lastFocus.focus) ? lastFocus.focus() : fabEl.focus(); } catch (e) { try { fabEl.focus(); } catch (e2) {} }
    dispatchEvt('clapachat:close');
  }

  function toggle() { isOpen ? close() : open(); }

  function onEsc(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }

  function focusInput() { if (taEl && isOpen) { try { taEl.focus(); } catch (e) {} } }

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

  /* 페이지 요소에서 챗 플로우 바로 실행 — [data-clapa-chat-action="as|manual|parts|ask"] */
  var actionEls = [];
  var pendingAction = null;   // config/카탈로그 로드 전 클릭 → 로드 완료 후 실행

  function doAction(name) {
    switch (name) {
      case 'manual': dispatch('cats', 'manual'); return true;
      case 'parts':  dispatch('cats', 'parts'); return true;
      case 'as':     dispatch('as'); return true;
      case 'ask':    dispatch('ask'); return true;
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
      isOpen: function () { return isOpen; },
      __mounted: true
    };

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
    if (pendingAction) {           // 로드 완료 전 눌린 토픽 카드 액션 지연 실행
      var act = pendingAction;
      pendingAction = null;
      doAction(act);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
