# 학습 대시보드

일본어 · 영어 · 수학 · 물리 · 화학 공부 앱을 모은 곳. 빌드 단계 없는 순수 HTML/JS이고, https://midorichart.com/app/study/ 로 열립니다.
데이터는 Task Manager 와 같은 Supabase 프로젝트에 계정별로 저장되어 PC · 폰 어디서나 같은 내용을 씁니다.

## 파일
- `index.html`, `dashboard.js`, `dashboard.css` — 대시보드 (로그인 · 동기화 상태 · 전체 백업/복원)
- `japanese/` — 일본어 (단어장 · 문법 · 상용한자 · 시험지)
- `english/` — 영어 (단어장 · 시험지, Writing · Speaking 의 풀이 노트 · 폴더 트리 템플릿 · 따라적기)
- `science/` — 수학 · 물리 · 화학 (개념 · 오답노트 · 수식 · 암기, 화학은 주기율표). `?subject=math|physics|chemistry`
- `shared/sync.js` — Supabase 동기화 (아래 참고)
- `config.js` — Supabase URL / Publishable key
- `supabase/schema.sql` — Supabase에 만들 테이블 · 이미지 저장소
- `scripts/import-units.mjs` — Obsidian 진도 체크리스트(md) → `science/data/units-*.json` 단원 트리. 허브 폴더에서 `node app/study/scripts/import-units.mjs`

## Supabase 연결
1. Supabase 대시보드 → **SQL Editor** → `supabase/schema.sql` 내용을 붙여넣고 Run (여러 번 실행해도 안전)
2. `config.js` 에는 Task Manager 와 같은 URL · 키가 들어 있습니다
3. https://midorichart.com/app/study/ 에서 Task Manager 계정으로 로그인 (같은 주소라 한쪽에서 로그인하면 다른 쪽도 로그인돼 있습니다)

`config.js` 를 비우면 예전처럼 브라우저 localStorage 에만 저장하는 로컬 모드로 동작합니다.

## 동기화 방식
- 과목 앱의 저장소(`*/js/store.js`)는 그대로 localStorage 를 쓰고, 쓸 때마다 바뀐 항목만 `study_items` 테이블에 올립니다 (`app`, `col`, `id`, `data`).
- 인터넷이 끊겨도 바뀐 내용은 대기열에 남았다가 연결되면 올라갑니다. 대시보드 오른쪽 위에 상태가 보입니다.
- 다른 기기에서 바꾼 내용은 실시간(Realtime)으로 받아 화면에 바로 반영됩니다.
- 오답노트 · 개념 이미지는 Storage 버킷 `study-images` 의 `<user id>/<과목>/<이미지 id>` 에 올라가고, 이 기기에 없으면 받아 옵니다.
- 로그인 전에 이 브라우저에 저장해 둔 데이터가 있으면 처음 로그인할 때 계정에 합칠지 묻습니다. 로그아웃하면 이 브라우저의 학습 데이터 사본은 지웁니다.

## 로컬에서 보기
허브 폴더에서 `python -m http.server` 후 http://localhost:8000/app/study/ (ES 모듈이라 파일을 바로 열면 안 됩니다).
