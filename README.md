# CLAPA 고객지원센터 — 디자인 시안

CLAPA·신일 소형가전 D2C 고객지원센터의 **고객 홈 화면 정적 시안 8종**. 코드/백엔드 없음, 순수 HTML+CSS 목업.

## 미리보기

- **라이브 갤러리 (GitHub Pages):** https://heejun1114.github.io/clapa-support/design-mockups/
- **로컬:** 저장소 루트에서 `python -m http.server 8000` → http://localhost:8000/design-mockups/

## 시안 매트릭스

| ID | 무드 | 히어로 | 제품 그리드 | 시그니처 |
|----|------|--------|-------------|----------|
| [a1](design-mockups/a1.html) | A 커머스 warm neutral | 풀블리드 | 큰누끼 2열 | 히어로 오버랩 검색바 |
| [a2](design-mockups/a2.html) | A 커머스 warm neutral | 넓은여백 | 정렬 3열 | 밑줄(border-bottom) 검색바 |
| [a3](design-mockups/a3.html) | A 커머스 warm neutral | 검색중심 | 썸네일+리스트 | 인기 검색어 롤링 |
| [a4](design-mockups/a4.html) | A 커머스 warm neutral | 카테고리 모자이크 | 매거진형 | 타일 크기 = 이용 빈도 |
| [b1](design-mockups/b1.html) | B Apple 지원센터 구조 | 검색중심 | 정렬 3열 | teal 모노라인 퀵링크 행 |
| [b2](design-mockups/b2.html) | B Apple 지원센터 구조 | 토픽 카드 | 썸네일+리스트 | hover 빠른 링크 |
| [b3](design-mockups/b3.html) | B Apple 지원센터 구조 | 넓은여백 | 큰누끼 2열 | 모델넘버 뱃지 타일 |
| [b4](design-mockups/b4.html) | B Apple 지원센터 구조 | 풀블리드 딥 teal | 매거진형 | 라이브 상태 스트립 |

> **정보구조 보강판 (2026-07-09):** **a1**·**b1**은 고객센터 IA 5요소가 추가된 개선판 — ① 제품 유형 탭(선풍기·청소기·주방가전·환경가전, 브랜드 탭과 교차 필터) ② FAQ 4탭 분류(사용법/A·S·보증/배송·교환/소모품·부품) ③ A/S 정책·교환·반품 규정 링크(푸터+지원 메뉴) ④ 메인 동선 AI 상담 블록("먼저 AI가 답하고, 해결되지 않으면 상담원 연결") ⑤ 상단 dismiss 공지 스트립.

## 공통 규칙 (전 시안)

- 히어로 검색바 + 추천 검색어 태그
- "브랜드·상품 찾기" 누끼 썸네일 그리드 (제품 8종 더미 → 실서비스 47개 모델)
- FAQ 6종 · 브랜드 4종(클래파/신일/리브온/모던홈) · 챗봇 진입점
- 팔레트: CLAPA teal(#0E6F66) + warm neutral(#FAF8F4/#EFE9E1) · 폰트: Pretendard
- 금지: Inter, 기본 파랑 버튼, 그림자 남발, 촘촘한 그리드
- 누끼 썸네일은 인라인 SVG 실루엣 자리표시자 — 확정 후 실제 컷으로 교체

## 다음 단계 (참고)

시안 확정 → FastAPI + Jinja2/HTMX 프론트 구현 → RAG 챗봇(pgvector) → 관리자 백오피스.
