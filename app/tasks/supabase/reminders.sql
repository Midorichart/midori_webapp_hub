-- 루틴·시간표 알림: 시작 N분 전에 디스코드로 보내기
-- (바탕화면 위젯은 같은 설정을 읽어서 PC 에서 직접 알림을 띄웁니다)
--
-- 준비:
--   1. discord_daily.sql 을 먼저 실행해서 디스코드 웹훅(Vault 'discord_webhook')이 있어야 합니다.
--   2. 아래 [여기에 이메일] 을 웹에 로그인하는 본인 이메일로 바꾼 뒤 이 파일 전체를 SQL Editor 에서 실행
--      (그 계정의 알림만 디스코드로 보냅니다. 다른 계정이 생겨도 그 사람 일정은 가지 않음)
--   3. 바로 테스트:  select public.send_due_reminders();   -- 지금 보낼 알림 개수를 돌려줌
--
-- 다시 실행해도 안전합니다.

-- 알림 설정 칸
alter table routines add column if not exists remind     boolean not null default false;
alter table routines add column if not exists remind_min int     not null default 10 check (remind_min between 0 and 1440);
alter table blocks   add column if not exists remind     boolean not null default false;
alter table blocks   add column if not exists remind_min int     not null default 10 check (remind_min between 0 and 1440);

-- 디스코드로 알림을 받을 계정 (웹에서는 읽기·쓰기 불가)
create table if not exists discord_recipients (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table discord_recipients enable row level security;
insert into discord_recipients (user_id)
  select id from auth.users where email = '[여기에 이메일]'
  on conflict do nothing;
do $$
begin
  if not exists (select 1 from discord_recipients) then
    raise exception '알림 받을 계정이 없어요. 위의 [여기에 이메일] 을 웹에 로그인하는 이메일로 바꾼 뒤 다시 실행해 주세요.';
  end if;
end $$;

-- 보낸 알림 기록 (같은 알림을 두 번 보내지 않게)
create table if not exists reminder_log (
  kind     text not null,          -- 'r' = 루틴, 'b' = 시간표 블록
  item_id  uuid not null,
  day      date not null,          -- 그 일정이 있는 날짜
  sent_at  timestamptz not null default now()
);
alter table reminder_log enable row level security;
-- 알림 시각(분)도 기록 → 같은 날 시간을 바꾸면 바뀐 시각에 다시 알림
alter table reminder_log add column if not exists due_min int not null default 0;
alter table reminder_log drop constraint if exists reminder_log_pkey;
alter table reminder_log add primary key (kind, item_id, day, due_min);

-- 지금 보낼 때가 된 알림을 디스코드로 전송. 1분마다 실행됨
create or replace function public.send_due_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  now_kst  timestamp := now() at time zone 'Asia/Seoul';
  webhook  text;
  r        record;
  left_min int;
  msg      text;
  sent     int := 0;
begin
  select decrypted_secret into webhook from vault.decrypted_secrets where name = 'discord_webhook';
  if webhook is null or webhook not like 'https://%' then
    return 0;
  end if;

  delete from reminder_log where day < now_kst::date - 7;

  for r in
    with occ as (
      -- 루틴: 오늘·내일 요일에 해당하는 것 (자정 넘어가는 'N분 전' 도 처리)
      select 'r'::text as kind, ro.id, ro.title, ro.start_min, ro.end_min, ro.remind_min, d.day
        from routines ro
        join discord_recipients dr on dr.user_id = ro.user_id
        cross join (values (now_kst::date), (now_kst::date + 1)) as d(day)
       where ro.remind
         and ro.dow = extract(dow from d.day)
         and not exists (select 1 from routine_done rd where rd.routine_id = ro.id and rd.date = d.day)
      union all
      -- 그날만 있는 시간표 블록
      select 'b', b.id, b.title, b.start_min, b.end_min, b.remind_min, b.date
        from blocks b
        join discord_recipients dr on dr.user_id = b.user_id
       where b.remind and not b.done
         and b.date between now_kst::date and now_kst::date + 1
    )
    select occ.*
      from occ
     where occ.day + make_interval(mins => occ.start_min - occ.remind_min) <= now_kst
       and occ.day + make_interval(mins => occ.start_min - occ.remind_min) > now_kst - interval '10 minutes'
       and not exists (select 1 from reminder_log l where l.kind = occ.kind and l.item_id = occ.id and l.day = occ.day
                                                     and l.due_min = occ.start_min - occ.remind_min)
  loop
    insert into reminder_log (kind, item_id, day, due_min) values (r.kind, r.id, r.day, r.start_min - r.remind_min)
      on conflict do nothing;
    left_min := ceil(extract(epoch from (r.day + make_interval(mins => r.start_min)) - now_kst) / 60);
    msg := format(E'🔔 **%s**\n`%s–%s` · %s%s',
                  r.title,
                  to_char(make_interval(mins => r.start_min), 'HH24:MI'),
                  to_char(make_interval(mins => r.end_min), 'HH24:MI'),
                  case when left_min <= 0 then '지금 시작'
                       when left_min % 60 = 0 then (left_min / 60) || '시간 뒤 시작'
                       else left_min || '분 뒤 시작' end,
                  case when r.kind = 'r' then ' · 루틴' else '' end);
    perform net.http_post(
      url     := webhook,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      -- allowed_mentions: 제목에 @everyone 같은 게 있어도 멘션 알림이 가지 않게
      body    := jsonb_build_object('content', left(msg, 1900), 'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb))
    );
    sent := sent + 1;
  end loop;
  return sent;
end $$;

-- 웹(로그인 안 한 사람 포함)에서 이 함수를 직접 호출하지 못하게. 스케줄러만 실행
revoke execute on function public.send_due_reminders() from public, anon, authenticated;

-- 1분마다 실행
select cron.unschedule(jobid) from cron.job where jobname = 'reminders';
select cron.schedule('reminders', '* * * * *', $$select public.send_due_reminders()$$);
