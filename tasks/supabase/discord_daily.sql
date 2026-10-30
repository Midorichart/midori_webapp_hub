-- 매일 00:00 (한국 시간) 오늘 할 일을 디스코드로 보내기
-- 봇 없이 디스코드 "웹훅" + Supabase 내장 스케줄러(pg_cron)만 사용합니다.
--
-- 준비:
--   1. 디스코드 채널 → 채널 편집(톱니) → 연동 → 웹후크 → 새 웹후크 → 웹후크 URL 복사
--   2. 아래 [여기에 웹훅 URL] 부분을 복사한 URL로 바꾼 뒤 이 파일 전체를 SQL Editor에서 실행
--   3. 바로 테스트:  select public.discord_daily_digest();
--
-- 다시 실행해도 안전합니다 (웹훅 URL 교체, 함수 갱신, 스케줄 재등록).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 웹훅 URL은 Vault(암호화 저장소)에 보관
do $$
declare sid uuid;
begin
  select id into sid from vault.secrets where name = 'discord_webhook';
  if sid is null then
    perform vault.create_secret('[여기에 웹훅 URL]', 'discord_webhook');
  else
    perform vault.update_secret(sid, '[여기에 웹훅 URL]');
  end if;
end $$;

-- 오늘 할 일을 모아서 디스코드로 전송하는 함수
create or replace function public.discord_daily_digest()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  today   date := (now() at time zone 'Asia/Seoul')::date;
  d       int  := extract(dow from today);
  dow_ko  text := (array['일','월','화','수','목','금','토'])[d + 1];
  webhook text;
  tt      text;
  ev      text;
  dg      text;
  msg     text;
begin
  select decrypted_secret into webhook from vault.decrypted_secrets where name = 'discord_webhook';
  if webhook is null or webhook not like 'https://%' then
    raise exception 'discord_webhook 이 설정되지 않았습니다';
  end if;

  -- 시간표: 오늘 요일의 루틴 + 오늘 날짜의 블록
  select string_agg(line, E'\n' order by s) into tt from (
    select start_min as s,
           format('`%s–%s`  %s', to_char(make_interval(mins => start_min), 'HH24:MI'), to_char(make_interval(mins => end_min), 'HH24:MI'), title) as line
      from routines where dow = d
    union all
    select start_min,
           format('`%s–%s`  %s', to_char(make_interval(mins => start_min), 'HH24:MI'), to_char(make_interval(mins => end_min), 'HH24:MI'), title)
      from blocks where date = today
  ) x;

  -- 달력 일정 (완료 안 된 것만)
  select string_agg(format('%s%s', case when time <> '' then '`' || time || '`  ' else '' end, title), E'\n' order by nullif(time, ''))
    into ev from events where date = today and not done;

  -- 아이디어 보드에서 진행 중인 것
  select string_agg('• ' || title, E'\n' order by position) into dg from ideas where status = 'doing';

  msg := format(E'📅 **%s (%s)**\n\n**시간표**\n%s\n\n**일정**\n%s\n\n**진행 중**\n%s',
                to_char(today, 'YYYY-MM-DD'), dow_ko,
                coalesce(tt, '없음'), coalesce(ev, '없음'), coalesce(dg, '없음'));

  perform net.http_post(
    url     := webhook,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object('content', left(msg, 1900))
  );
end $$;

-- 매일 00:00 KST = 15:00 UTC 에 실행
select cron.unschedule(jobid) from cron.job where jobname = 'discord-daily';
select cron.schedule('discord-daily', '0 15 * * *', $$select public.discord_daily_digest()$$);
