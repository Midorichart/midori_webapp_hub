-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- 모든 테이블은 로그인한 본인 데이터만 읽고 쓸 수 있도록 RLS가 걸려 있습니다.

-- 달력 일정 (월 보기)
create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,
  time        text not null default '',
  title       text not null,
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- 루틴 (매주 반복되는 시간표 블록)
create table if not exists routines (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  dow         int  not null check (dow between 0 and 6),   -- 0=일 ... 6=토
  start_min   int  not null check (start_min between 0 and 1440),
  end_min     int  not null check (end_min between 0 and 1440),
  title       text not null,
  created_at  timestamptz not null default now()
);

-- 특정 주에만 있는 시간표 블록
create table if not exists blocks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,
  start_min   int  not null check (start_min between 0 and 1440),
  end_min     int  not null check (end_min between 0 and 1440),
  title       text not null,
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- 루틴의 날짜별 완료 체크
create table if not exists routine_done (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  routine_id  uuid not null references routines(id) on delete cascade,
  date        date not null,
  unique (routine_id, date)
);

-- 아이디어 보드 (status: idea=아이디어, doing=진행 중, done=완료)
create table if not exists ideas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null,
  note        text not null default '',
  tags        text[] not null default '{}',
  status      text not null default 'idea' check (status in ('idea', 'doing', 'done')),
  position    int  not null default 0,
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- 날짜별 자유 메모 (하루에 하나)
create table if not exists daily_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,
  content     text not null default '',
  updated_at  timestamptz not null default now(),
  unique (user_id, date)
);

create index if not exists events_user_date on events(user_id, date);
create index if not exists blocks_user_date on blocks(user_id, date);

alter table events       enable row level security;
alter table routines     enable row level security;
alter table blocks       enable row level security;
alter table routine_done enable row level security;
alter table ideas        enable row level security;
alter table daily_notes  enable row level security;

drop policy if exists "own ideas"        on ideas;
create policy "own ideas"        on ideas        for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own daily_notes" on daily_notes;
create policy "own daily_notes" on daily_notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own events"       on events;
drop policy if exists "own routines"     on routines;
drop policy if exists "own blocks"       on blocks;
drop policy if exists "own routine_done" on routine_done;

create policy "own events"       on events       for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own routines"     on routines     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own blocks"       on blocks       for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own routine_done" on routine_done for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
