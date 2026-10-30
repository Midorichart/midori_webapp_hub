# Task Manager

서버 코드 없이 브라우저에서 동작하는 개인 캘린더 + 주간 시간표. 데이터는 Supabase(무료)에 저장하거나, 설정이 없으면 브라우저 로컬에 저장됩니다.
midorichart 허브 저장소의 `tasks/` 폴더에 있고, https://midorichart.com/tasks/ 로 열립니다. (예전 주소 midorichart.github.io/TaskManager 는 이 주소로 넘어옵니다)

## 파일
- `index.html` — 앱 전체 (공통 스타일은 허브의 `assets/site.css`)
- `config.js` — Supabase URL / anon key 설정
- `supabase/schema.sql` — Supabase에 만들 테이블
- `supabase/discord_daily.sql` — 매일 00:00 디스코드 요약
- `supabase/reminders.sql` — 일정 알림 (시작 N분 전 디스코드)

## 기능
| 탭 | 설명 |
|---|---|
| **달력** | 월 단위 일정. 지난 미완료는 따로 모아 보여주고, 하루 안에서는 완료한 일정을 아래에 정렬합니다. 날짜를 누르면 일정 추가/완료/삭제. |
| **시간표** | 오늘이 속한 주의 월~일 × 00~24시 격자. 빈 칸을 누르면 그 시간에 블록 추가, 블록을 누르면 수정/완료/삭제. |
| **오늘의 메모** | 날짜별 자유 메모. 이전·다음 날짜로 이동해 매일의 기록을 다시 볼 수 있습니다. |
| **루틴** | 매주 반복할 일을 요일·시작·종료 시간으로 등록. 시간표에 매주 자동 표시되고, 날짜별로 완료 체크할 수 있습니다. ✎ 버튼으로 수정. |
| **아이디어** | 하고 싶은 것들을 카드로 적어 두는 보드. 태그를 달고 ▲▼로 우선순위를 정하며, "시작"을 누르면 진행 중 열로 올라갑니다. 완료하면 접힌 목록으로 내려갑니다. |

달력 일정은 날짜를 눌러 열리는 목록에서 ✎ 버튼으로 시간·내용을 수정할 수 있습니다.

파란 블록 = 그 주에만 있는 일, 초록 블록 = 매주 루틴. 오늘 열에는 빨간 현재 시각 선이 보입니다.

## Supabase 연결 (무료)
1. https://supabase.com 에서 프로젝트 생성 (Free 플랜)
2. 대시보드 → **SQL Editor** → `supabase/schema.sql` 내용을 붙여넣고 Run (테이블이 추가될 때마다 같은 파일을 다시 실행하면 됩니다. 여러 번 실행해도 안전합니다)
3. 대시보드 → **Authentication → Providers → Email** 에서 *Confirm email* 을 끄면 회원가입 직후 바로 로그인됩니다 (개인용이면 꺼도 무방)
4. 프로젝트 홈의 **Copy** 버튼(또는 Project Settings → API Keys)에서 `Project URL` 과 `Publishable key`(`sb_publishable_...`, 예전 이름은 anon key)를 복사해 `config.js` 에 입력
5. 앱을 열면 로그인 창이 뜹니다. 처음이면 **회원가입** 후 로그인

Publishable(anon) 키는 공개되어도 되는 키입니다. 실제 접근 권한은 로그인 + RLS(행 단위 보안)로 제한되어 본인 데이터만 읽고 쓸 수 있습니다.

## 디스코드 알림 (매일 00:00, 무료)
봇을 만들 필요 없이 디스코드 웹훅 + Supabase 내장 스케줄러(pg_cron)로 처리합니다.

1. 디스코드에서 알림 받을 채널 → 채널 편집(톱니) → **연동 → 웹후크 → 새 웹후크** → **웹후크 URL 복사**
2. `supabase/discord_daily.sql` 을 열어 `[여기에 웹훅 URL]` 두 군데를 복사한 URL로 바꿉니다
3. 파일 전체를 Supabase **SQL Editor**에 붙여넣고 Run
4. 바로 테스트하려면 SQL Editor에서 `select public.discord_daily_digest();` 실행 → 디스코드에 메시지가 오면 성공

이후 매일 한국 시간 00:00에 그날의 루틴·시간표 블록·달력 일정이 메시지로 옵니다.
실행 기록은 SQL Editor에서 `select * from cron.job_run_details order by start_time desc limit 10;` 로 볼 수 있습니다.

## 일정 알림 (시작 N분 전)
루틴을 추가할 때, 또는 시간표 블록을 만들거나 수정할 때 **알림**을 체크하고 시점(시작할 때 / 5·10·15·30분 전 / 1시간 전)을 고르면,
그때 디스코드로 메시지가 옵니다. 알림이 켜진 항목에는 🔔 표시가 붙습니다. 이미 완료 체크한 항목은 알리지 않습니다.

1. 위의 디스코드 알림(`discord_daily.sql`)을 먼저 설정해 두세요. 같은 웹훅을 씁니다.
2. `supabase/reminders.sql` 을 열어 `[여기에 이메일]` 을 웹에 로그인하는 이메일로 바꿉니다 (그 계정의 알림만 보냄)
3. 파일 전체를 **SQL Editor**에 붙여넣고 Run. 이후 1분마다 확인해서 보냅니다.

## 배포 (무료)
허브 저장소(`midori_webapp_hub`)를 push 하면 GitHub Pages 로 함께 배포됩니다. 별도 저장소는 필요 없습니다.
`index.html`, `config.js` 와 허브의 `assets/site.css` 가 함께 있어야 화면이 제대로 나옵니다.

폰 브라우저에서 접속 후 "홈 화면에 추가"를 하면 앱처럼 씁니다.

## 로컬 모드
`config.js`를 비워 두면 localStorage에 저장됩니다. 기기·브라우저마다 따로 저장되므로 PC와 폰이 동기화되지 않습니다. 루틴 탭 하단의 내보내기/가져오기로 옮길 수 있고, 로컬에서 쓰던 데이터를 Supabase 계정에 넣을 때도 같은 가져오기 버튼을 쓰면 됩니다.
