-- midorichart.com 포트폴리오(연표의 배경 · 그 밖의 작업)와 사진 → 관리자 페이지(/app/portfolio/)에서 고친다
--
-- 첫 화면은 이 표를 누구나 읽을 수 있고(공개 키로 읽기만), 쓰기 · 사진 올리기는 관리자 계정만 됩니다.
-- 관리자 = 메시지함과 같은 계정 (inbox_owners). 표가 비어 있으면 첫 화면은 예전처럼 assets/portfolio/works.js 를 씁니다.
--
-- 준비:
--   1. app/inbox/supabase/messages.sql 을 먼저 실행해 둔다 (관리자 계정이 거기서 정해짐)
--   2. 이 파일 전체를 Supabase → SQL Editor 에서 실행
--   3. /app/portfolio/ 를 열고 「works.js 에서 가져오기」 를 한 번 누르면 지금 내용이 그대로 옮겨진다
--
-- 다시 실행해도 안전합니다.

do $$
begin
  if to_regclass('public.inbox_owners') is null or not exists (select 1 from public.inbox_owners) then
    raise exception '관리자 계정이 없어요. app/inbox/supabase/messages.sql 을 먼저 실행해 주세요.';
  end if;
end $$;

-- 항목 하나 = 배경 하나 또는 작업 하나. data 는 works.js 항목과 같은 모양
--   배경 data:  { name, sub, booth, desc, qpost, imgs: [{ src, thumb?, w, h, post?, video? }], i18n: { ja: {...}, en: {...} } }
--   작업 data:  { title, desc, post, imgs: [...], i18n }
create table if not exists portfolio_items (
  id         text primary key,                                   -- 배경: 영문 key (예: salt) / 작업: X 글 번호 등
  kind       text not null check (kind in ('bg', 'etc')),
  date       date not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists portfolio_items_date on portfolio_items (date desc);
alter table portfolio_items enable row level security;

drop policy if exists "누구나 읽기" on portfolio_items;
drop policy if exists "관리자만 쓰기" on portfolio_items;
create policy "누구나 읽기" on portfolio_items for select to anon, authenticated using (true);
create policy "관리자만 쓰기" on portfolio_items for all to authenticated
  using (exists (select 1 from public.inbox_owners o where o.user_id = auth.uid()))
  with check (exists (select 1 from public.inbox_owners o where o.user_id = auth.uid()));

-- 사진 저장소: 누구나 볼 수 있고(공개 주소), 올리기 · 바꾸기 · 지우기는 관리자만. 한 장 5MB 까지
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portfolio', 'portfolio', true, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "portfolio 관리자 보기" on storage.objects;
drop policy if exists "portfolio 관리자 올리기" on storage.objects;
drop policy if exists "portfolio 관리자 바꾸기" on storage.objects;
drop policy if exists "portfolio 관리자 지우기" on storage.objects;
create policy "portfolio 관리자 보기" on storage.objects for select to authenticated
  using (bucket_id = 'portfolio' and exists (select 1 from public.inbox_owners o where o.user_id = auth.uid()));
create policy "portfolio 관리자 올리기" on storage.objects for insert to authenticated
  with check (bucket_id = 'portfolio' and exists (select 1 from public.inbox_owners o where o.user_id = auth.uid()));
create policy "portfolio 관리자 바꾸기" on storage.objects for update to authenticated
  using (bucket_id = 'portfolio' and exists (select 1 from public.inbox_owners o where o.user_id = auth.uid()));
create policy "portfolio 관리자 지우기" on storage.objects for delete to authenticated
  using (bucket_id = 'portfolio' and exists (select 1 from public.inbox_owners o where o.user_id = auth.uid()));
