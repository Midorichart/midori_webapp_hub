-- 가계부(/app/budget/) — 카드 이용내역 · 분류 규칙
--
-- 모든 표는 로그인한 본인 데이터만 읽고 쓸 수 있어요 (RLS: user_id = 로그인한 사람).
-- 다른 앱(Task Manager · 수익 통계 · 메시지함 · 포트폴리오)의 표는 건드리지 않아요. 새 표 2개만 만들어요.
--
-- 준비: 이 파일 전체를 Supabase → SQL Editor 에서 실행
-- 다시 실행해도 안전합니다 (이미 있는 표 · 데이터는 그대로 두고, 정책만 새로 씀).

-- 이용내역 한 줄 = 카드 결제(또는 취소) 한 건, 또는 직접 입력한 지출 한 건
create table if not exists budget_tx (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date         date not null,                          -- 이용일
  card         text not null default 'manual'          -- hyundai / shinhan / samsung / manual(직접 입력) / 기타
                 check (length(card) between 1 and 30),
  card_last4   text,                                   -- 카드 끝자리 (있을 때만)
  merchant     text not null default '',               -- 가맹점명
  amount       bigint not null,                        -- 원 단위. 취소는 음수
  installment  int not null default 0                  -- 0 = 일시불, 2 이상 = N개월 할부
                 check (installment between 0 and 60),
  approval_no  text,                                   -- 승인번호 (있을 때만)
  is_cancel    boolean not null default false,
  is_overseas  boolean not null default false,
  category     text not null default '',               -- 식비 · 카페 · 교통 … (빈칸 = 미분류)
  category_auto boolean not null default true,         -- true = 규칙이 정한 분류 (규칙 다시 적용 때 바뀔 수 있음)
  memo         text not null default '',               -- 산 물건 등 (카드사는 모름)
  excluded     boolean not null default false,         -- true = 합계에서 빼기 (회사 경비 · 나눠 낸 돈 등)
  source       text not null default 'manual'          -- excel / manual
                 check (source in ('excel', 'manual')),
  dedup_key    text,                                   -- 엑셀에서 온 줄의 지문. 같은 줄을 다시 올려도 한 번만 들어감
  created_at   timestamptz not null default now(),
  constraint budget_tx_dedup unique (user_id, dedup_key) -- 직접 입력(null)은 제한 없음
);
create index if not exists budget_tx_user_date on budget_tx (user_id, date desc);

-- 자동 분류 규칙: 가맹점명에 keyword 가 들어 있으면 category 로 분류
create table if not exists budget_rules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  keyword     text not null check (length(btrim(keyword)) between 1 and 60),
  category    text not null check (length(btrim(category)) between 1 and 30),
  created_at  timestamptz not null default now(),
  unique (user_id, keyword)
);

alter table budget_tx    enable row level security;
alter table budget_rules enable row level security;

drop policy if exists "본인만" on budget_tx;
drop policy if exists "본인만" on budget_rules;
create policy "본인만" on budget_tx for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "본인만" on budget_rules for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 로그인 안 한 방문자(공개 키)는 아예 못 건드리게
revoke all on budget_tx, budget_rules from anon;
