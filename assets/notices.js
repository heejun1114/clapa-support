/* 클래파 고객지원센터 — 공지 렌더러 v2
 * data/notices.json 을 읽어 두 곳에 표시한다:
 *  1) 최상단 배너(banner=true 공지 1건) — 페이지 맨 위 띠, X로 닫으면 그 공지는 다시 안 뜸(localStorage)
 *  2) 홈 공지 목록(#notices) — 검색창 아래, 게시 중 공지 전체
 * 공지가 없으면 아무것도 나타나지 않는다. XSS 차단: textContent 전용, 링크는 허용 목록만.
 * 편집은 백오피스(클래파 관리자)에서. */
(function () {
  'use strict';

  var MAX_SHOWN = 4;
  var ALLOWED_HOSTS = [
    'clapa.kr', 'www.clapa.kr',
    'smartstore.naver.com', 'brand.naver.com',
    'heejun1114.github.io'
  ];

  function todayKst() {
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
    if (url.indexOf('//') === -1 && url.indexOf(':') === -1) return url; // 내부 상대경로
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

  /* ---------- 최상단 배너 ----------
   * 배너는 index.html 에 직접 구워져(scripts/render_notices.py) 즉시·항상 뜬다.
   * 여기서는 (1) 구워진 배너의 닫기 버튼을 바로 연결하고, (2) fetch 로 최신값과
   * 대조해 서명이 다르면 갱신, 게시가 사라졌으면 제거한다. fetch 가 실패해도
   * 구워진 배너는 그대로 남아 '떴다 안 떴다'가 생기지 않는다.
   * 닫기 기억은 sessionStorage(세션 한정) — 다음 방문 때 다시 보인다. */
  function bannerSig(n) {
    return [n.id || '', n.title || '', n.link || '', n.bannerColor || '', n.type || ''].join('|');
  }
  function dismissKeyFromSig(sig) { return 'clapa-banner-closed:' + sig; }
  function isDismissed(sig) {
    try { return !!sessionStorage.getItem(dismissKeyFromSig(sig)); } catch (e) { return false; }
  }
  function wireClose(bar, sig) {
    var btn = bar.querySelector('.sb-close');
    if (!btn || btn.getAttribute('data-wired')) return;
    btn.setAttribute('data-wired', '1');
    btn.addEventListener('click', function () {
      bar.remove();
      try { sessionStorage.setItem(dismissKeyFromSig(sig), '1'); } catch (e) {}
    });
  }

  function buildBanner(n) {
    var bar = document.createElement('div');
    bar.className = 'site-banner';
    var COLORS = ['charcoal', 'amber', 'red', 'ivory'];
    if (COLORS.indexOf(n.bannerColor) !== -1) bar.className += ' sb-c-' + n.bannerColor;
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', '공지 배너');
    bar.setAttribute('data-sig', bannerSig(n));

    var inner = document.createElement('div');
    inner.className = 'site-banner-in';
    var pill = document.createElement('span');
    pill.className = 'sb-pill';
    pill.textContent = (typeof n.type === 'string' && n.type.trim()) ? n.type.trim() : '안내';
    var href = safeHref(n.link);
    var t;
    if (href) {
      t = document.createElement('a');
      t.href = href;
      if (href.indexOf('https://') === 0) { t.target = '_blank'; t.rel = 'noopener'; }
    } else {
      t = document.createElement('span');
    }
    t.className = 'sb-t';
    t.textContent = String(n.title || '');
    if (href) {
      var arrow = document.createElement('span');
      arrow.className = 'sb-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = ' →';
      t.appendChild(arrow);
    }
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'sb-close';
    close.setAttribute('aria-label', '공지 배너 닫기');
    close.textContent = '×';
    inner.appendChild(pill);
    inner.appendChild(t);
    bar.appendChild(inner);
    bar.appendChild(close);
    return bar;
  }

  /* 페이지 로드 즉시: 구워진 배너의 닫기 버튼을 연결(팬딩 fetch 와 무관하게 바로 작동) */
  function wireBakedBannerNow() {
    var baked = document.querySelector('.site-banner');
    if (!baked) return;
    var sig = baked.getAttribute('data-sig') || '';
    if (isDismissed(sig)) { baked.remove(); return; }
    wireClose(baked, sig);
  }

  /* fetch 결과로 배너 보강(안전): 구워진 배너는 절대 지우거나 바꾸지 않고,
   * 아직 안 구워진 경우(예: 재빌드 전 notices.json 만 바뀜)에만 새로 삽입.
   * → 오래된 CDN 캐시가 멀쩡히 구워진 배너를 지우는 사고를 원천 차단. */
  function reconcileBanner(n) {
    if (!n) return;                                               // fetch에 배너 없음 → 구워진 것 유지(권위는 HTML)
    var existing = document.querySelector('.site-banner');
    var sig = bannerSig(n);
    if (existing) { wireClose(existing, sig); return; }           // 이미 배너 있음 → 유지, 닫기만 연결
    if (isDismissed(sig)) return;
    var fresh = buildBanner(n);                                   // 구워진 게 없을 때만 삽입
    wireClose(fresh, sig);
    document.body.insertBefore(fresh, document.body.firstChild);
  }

  /* ---------- A/S 영역 안내(place='as') ---------- */
  function renderAs(n) {
    var slot = document.getElementById('notice-as-slot');
    if (!slot) return;
    var pill = document.createElement('span');
    pill.className = 'an-pill';
    pill.textContent = (typeof n.type === 'string' && n.type.trim()) ? n.type.trim() : '안내';

    var tx = document.createElement('div');
    tx.className = 'an-tx';
    var t = document.createElement('div');
    t.className = 'an-t';
    t.textContent = String(n.title || '');
    tx.appendChild(t);
    if (n.body) {
      var b = document.createElement('div');
      b.className = 'an-b';
      b.textContent = String(n.body || '');
      tx.appendChild(b);
    }
    var href = safeHref(n.link);
    if (href) {
      var a = document.createElement('a');
      a.href = href;
      if (href.indexOf('https://') === 0) { a.target = '_blank'; a.rel = 'noopener'; }
      a.textContent = (typeof n.linkLabel === 'string' && n.linkLabel.trim()) ? n.linkLabel.trim() : '자세히 보기 →';
      tx.appendChild(a);
    }
    slot.appendChild(pill);
    slot.appendChild(tx);
    slot.hidden = false;
  }

  /* 표시 위치: place 필드 우선, 없으면 예전 banner 필드로 판별 */
  function placeOf(n) {
    if (n.place === 'banner' || n.place === 'list' || n.place === 'as') return n.place;
    return n.banner === true ? 'banner' : 'list';
  }

  /* ---------- 홈 공지 목록 ---------- */
  function renderList(list) {
    var section = document.getElementById('notices');
    var box = document.getElementById('notice-list');
    if (!section || !box || !list.length) return;

    list.slice(0, MAX_SHOWN).forEach(function (n) {
      var item = document.createElement('details');
      item.className = 'notice-item';

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

      sum.appendChild(pill); sum.appendChild(t); sum.appendChild(d); sum.appendChild(chev);
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

  // GitHub Pages가 notices.json을 10분(max-age=600) 캐시해 공지가 늦게/불규칙하게 반영되던 문제 →
  // 캐시버스터(?t)+no-store로 항상 최신을 받고, 순간 실패 시 1회 재시도(조용한 미표시 방지).
  function loadNotices(attempt) {
    fetch('data/notices.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
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
        var banner = visible.filter(function (n) { return placeOf(n) === 'banner'; })[0];
        reconcileBanner(banner);
        var asNotice = visible.filter(function (n) { return placeOf(n) === 'as'; })[0];
        if (asNotice) renderAs(asNotice);
        renderList(visible.filter(function (n) { return placeOf(n) === 'list'; }));
      })
      .catch(function () {
        if (!attempt) setTimeout(function () { loadNotices(1); }, 1500);
      });
  }
  wireBakedBannerNow();  // 구워진 배너 즉시 활성(닫기 버튼·닫힘 기억) — fetch 실패해도 배너 유지
  loadNotices(0);
})();
