-- midorichart.com 메시지 창 → 메시지함(/app/inbox/) · 디스코드 알림 · 메일(선택)
--
-- 포트폴리오 첫 화면의 메시지 창은 send_message() 함수만 부를 수 있고, 표를 직접 읽거나 쓸 수는 없습니다.
-- 받은 메시지는 아래 [여기에 이메일] 계정으로 /app/ 에 로그인해야만 볼 수 있습니다.
--
-- 준비:
--   1. 아래 [여기에 이메일] 을 /app/ 에 로그인하는 이메일로 바꾼다
--   2. (선택) 디스코드를 다른 채널로 받으려면 [메시지용 웹훅 URL] 을 그 채널 웹훅으로 바꾼다.
--      그대로 두면 Task Manager 알림에 쓰는 웹훅(Vault 'discord_webhook')으로 온다.
--   3. (선택) 메일: resend.com 에 midorichart@gmail.com 으로 가입 → API Keys → Create → 키를 [Resend API 키] 자리에.
--      그대로 두면 메일은 안 보내고 디스코드 · 메시지함에만 남는다.
--   4. 이 파일 전체를 Supabase → SQL Editor 에서 실행
--   5. 테스트:  select public.send_message('테스트', '메시지 창 테스트예요', 'ko', null);
--
-- 다시 실행해도 안전합니다 (표 · 정책 · 함수 갱신, 키 교체).

create extension if not exists pg_net;

-- 키 보관 (Vault). [ ] 그대로면 건너뜀
do $$
declare
  v record;
  sid uuid;
begin
  for v in select * from (values
    ('discord_contact_webhook', '[메시지용 웹훅 URL]'),
    ('resend_api_key', '[Resend API 키]')
  ) as t(name, val) loop
    continue when v.val like '[%';
    select id into sid from vault.secrets where name = v.name;
    if sid is null then
      perform vault.create_secret(v.val, v.name);
    else
      perform vault.update_secret(sid, v.val);
    end if;
  end loop;
end $$;

-- 받은 메시지
create table if not exists contact_messages (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name       text,                    -- null = 익명
  body       text not null,
  lang       text,                    -- 보낸 페이지 언어 (ko / ja / en)
  ip_hash    text,                    -- 도배 막기용 (IP 그대로는 저장하지 않음)
  read       boolean not null default false
);
create index if not exists contact_messages_created on contact_messages (created_at desc);
alter table contact_messages enable row level security;

-- 메시지를 읽을 수 있는 계정
create table if not exists inbox_owners (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table inbox_owners enable row level security;
drop policy if exists "본인 확인" on inbox_owners;
create policy "본인 확인" on inbox_owners for select to authenticated using (user_id = auth.uid());

insert into inbox_owners (user_id)
  select id from auth.users where email = '[여기에 이메일]'
  on conflict do nothing;
do $$
begin
  if not exists (select 1 from inbox_owners) then
    raise exception '메시지를 볼 계정이 없어요. 위의 [여기에 이메일] 을 /app/ 에 로그인하는 이메일로 바꾼 뒤 다시 실행해 주세요.';
  end if;
end $$;

drop policy if exists "주인만 읽기" on contact_messages;
drop policy if exists "주인만 고치기" on contact_messages;
drop policy if exists "주인만 지우기" on contact_messages;
create policy "주인만 읽기" on contact_messages for select to authenticated
  using (exists (select 1 from inbox_owners o where o.user_id = auth.uid()));
create policy "주인만 고치기" on contact_messages for update to authenticated
  using (exists (select 1 from inbox_owners o where o.user_id = auth.uid()));
create policy "주인만 지우기" on contact_messages for delete to authenticated
  using (exists (select 1 from inbox_owners o where o.user_id = auth.uid()));
revoke insert on contact_messages from anon, authenticated; -- 새 메시지는 send_message() 로만

-- 메시지 보내기 (포트폴리오 페이지가 부름)
--   p_hp: 사람 눈에는 안 보이는 칸. 채워져 있으면 스팸 로봇으로 보고 조용히 버린다
create or replace function public.send_message(p_name text, p_body text, p_lang text default null, p_hp text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  nm      text := nullif(left(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'), 40), '');
  bd      text := btrim(coalesce(p_body, ''));
  lg      text := left(coalesce(p_lang, ''), 5);
  ip      text := btrim(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1));
  ih      text := case when ip = '' then null else md5(ip || ':midorichart') end;
  hook    text;
  rkey    text;
  who     text;
begin
  nm := btrim(nm);
  if nm = '' then nm := null; end if;
  if coalesce(p_hp, '') <> '' then return json_build_object('ok', true); end if;
  if bd = '' then raise exception 'empty'; end if;
  if length(bd) > 2000 then raise exception 'too_long'; end if;
  -- 도배 막기: 같은 곳에서 10분에 5개, 전체 1시간에 40개까지
  if ih is not null and (select count(*) from contact_messages where ip_hash = ih and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'slow_down';
  end if;
  if (select count(*) from contact_messages where created_at > now() - interval '1 hour') >= 40 then
    raise exception 'slow_down';
  end if;

  insert into contact_messages (name, body, lang, ip_hash) values (nm, bd, nullif(lg, ''), ih);
  who := coalesce(nm, '익명');

  -- 디스코드 (메시지용 웹훅이 없으면 기존 웹훅). 본문 속 @everyone 같은 호출은 막는다
  select decrypted_secret into hook from vault.decrypted_secrets where name = 'discord_contact_webhook';
  if hook is null then
    select decrypted_secret into hook from vault.decrypted_secrets where name = 'discord_webhook';
  end if;
  if hook like 'https://%' then
    perform net.http_post(
      url     := hook,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := jsonb_build_object(
        'username', 'midorichart.com',
        'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb),
        'embeds', jsonb_build_array(jsonb_build_object(
          'title', '📮 새 메시지',
          'url', 'https://midorichart.com/app/inbox/',
          'description', left(bd, 3500),
          'color', 4372425,
          'fields', jsonb_build_array(
            jsonb_build_object('name', '보낸 사람', 'value', who, 'inline', true),
            jsonb_build_object('name', '페이지', 'value', coalesce(nullif(lg, ''), '-'), 'inline', true)
          ),
          'timestamp', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        ))
      )
    );
  end if;

  -- 메일 (Resend 키가 있을 때만). onboarding@resend.dev 는 Resend 가입 메일 주소로만 보낼 수 있다
  select decrypted_secret into rkey from vault.decrypted_secrets where name = 'resend_api_key';
  if rkey is not null and rkey <> '' then
    perform net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || rkey),
      body    := jsonb_build_object(
        'from', 'midorichart.com <onboarding@resend.dev>',
        'to', jsonb_build_array('midorichart@gmail.com'),
        'subject', '[midorichart] 새 메시지 · ' || who,
        'text', bd || E'\n\n— ' || who || coalesce(' · ' || nullif(lg, ''), '') || E'\nhttps://midorichart.com/app/inbox/'
      )
    );
  end if;

  return json_build_object('ok', true);
end $$;

revoke all on function public.send_message(text, text, text, text) from public;
grant execute on function public.send_message(text, text, text, text) to anon, authenticated;
