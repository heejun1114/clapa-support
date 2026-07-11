/* CLAPA 제품 상세 — 정보 밀도 완화 로직.
 * ① 문항 많은 FAQ에 카테고리 필터 칩(항목 6개+ · 카테고리 2종+ 일 때만)
 * ② 사양 많은 표는 6행만 노출 + '전체 사양 보기'(9행+ 일 때만)
 * 비차단 원칙: 콘텐츠를 영구 숨기지 않고 '전체'로 항상 복원. 모달·강제응답 없음. */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    try { initSpecToggle(); } catch (e) {}
  });

  /* FAQ 주제 분류(카테고리 필터 칩)는 사장님 지시로 제거됨 — 재도입 금지.
     각 문항의 주제 라벨(.faq-cat)은 density.css에서 숨김. */

  /* ── 주요 사양 접기 ── */
  function initSpecToggle() {
    var grid = document.querySelector('.spec-grid');
    if (!grid) return;
    var rows = [].slice.call(grid.querySelectorAll('.spec-row'));
    if (rows.length < 9) return;   // 8행 이하는 접지 않음

    var hidden = rows.slice(6);
    hidden.forEach(function (r) { r.hidden = true; });

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'spec-toggle';
    btn.setAttribute('aria-expanded', 'false');
    setLabel(false);
    grid.parentNode.insertBefore(btn, grid.nextSibling);

    btn.addEventListener('click', function () {
      var expand = btn.getAttribute('aria-expanded') === 'false';
      hidden.forEach(function (r) { r.hidden = !expand; });
      btn.setAttribute('aria-expanded', expand ? 'true' : 'false');
      setLabel(expand);
    });

    function setLabel(expanded) {
      btn.textContent = expanded ? '사양 접기' : ('전체 사양 보기 (+' + hidden.length + ')');
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8');
      svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('aria-hidden', 'true');
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M6 9l6 6 6-6');
      svg.appendChild(path);
      btn.appendChild(svg);
    }
  }
})();
