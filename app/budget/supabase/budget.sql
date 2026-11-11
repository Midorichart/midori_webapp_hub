-- 가계부(/app/budget/) — 카드 결제 직접 등록 · 월별 결제예정 · 결제 체크 · 수입 · 남는 돈
--
-- 모든 표는 로그인한 본인 데이터만 읽고 쓸 수 있어요 (RLS: user_id = 로그인한 사람).
-- 다른 앱(Task Manager · 수익 통계 · 메시지함 · 포트폴리오)의 표는 건드리지 않아요.
--
-- 준비: 이 파일 전체를 Supabase → SQL Editor 에서 실행
-- 다시 실행해도 안전합니다 (이미 있는 표 · 데이터는 그대로 두고, 정책만 새로 씀).

-- 예전 엑셀 방식 표(budget_tx · budget_rules)는 비어 있을 때만 지운다 (내용이 있으면 그대로 둠)
do $$
begin
  if to_regclass('public.budget_tx') is not null and not exists (select 1 from public.budget_tx) then
    drop table public.budget_tx;
  end if;
  if to_regclass('public.budget_rules') is not null and not exists (select 1 from public.budget_rules) then
    drop table public.budget_rules;
  end if;
end $$;

-- 카드 결제 한 건 (직접 등록). 할부면 months 개월로 나눠서 first_month 부터 매달 청구된다고 봄
create table if not exists budget_purchases (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  card         text not null check (card in ('hyundai', 'samsung', 'shinhan')),
  date         date not null,                                  -- 산 날
  merchant     text not null default '',                       -- 어디서 / 무엇을
  amount       bigint not null check (amount > 0),             -- 총 금액 (원)
  months       int not null default 1 check (months between 1 and 60), -- 1 = 일시불, 2 이상 = N개월 할부
  first_month  date not null,                                  -- 첫 결제 달 (그 달 1일로 저장)
  memo         text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists budget_purchases_user on budget_purchases (user_id, first_month);

-- 달마다 카드별 「결제했음」 체크
create table if not exists budget_paid (
  user_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month    date not null,                                      -- 결제 달 (1일)
  card     text not null check (card in ('hyundai', 'samsung', 'shinhan')),
  paid_at  timestamptz not null default now(),
  primary key (user_id, month, card)
);

-- 달마다 수입 (여러 줄 가능: 월급 · 부수입 …)
create table if not exists budget_income (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month       date not null,                                   -- 그 달 1일
  label       text not null default '',
  amount      bigint not null check (amount >= 0),
  created_at  timestamptz not null default now()
);
create index if not exists budget_income_user on budget_income (user_id, month);

-- 카드별 설정: 매달 며칠까지 쓴 것이 다음 달에 결제되는지 (31 = 말일까지 = 그냥 다음 달)
create table if not exists budget_cards (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  card        text not null check (card in ('hyundai', 'samsung', 'shinhan')),
  cutoff_day  int not null default 31 check (cutoff_day between 1 and 31),
  primary key (user_id, card)
);

alter table budget_purchases enable row level security;
alter table budget_paid      enable row level security;
alter table budget_income    enable row level security;
alter table budget_cards     enable row level security;

drop policy if exists "본인만" on budget_purchases;
drop policy if exists "본인만" on budget_paid;
drop policy if exists "본인만" on budget_income;
drop policy if exists "본인만" on budget_cards;
create policy "본인만" on budget_purchases for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "본인만" on budget_paid for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "본인만" on budget_income for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "본인만" on budget_cards for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 로그인 안 한 방문자(공개 키)는 아예 못 건드리게
revoke all on budget_purchases, budget_paid, budget_income, budget_cards from anon;
