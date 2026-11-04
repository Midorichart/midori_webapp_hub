-- 학습 대시보드용 테이블. Supabase 대시보드 → SQL Editor 에 붙여넣고 Run 하세요.
-- Task Manager 와 같은 프로젝트를 쓰고, 여러 번 실행해도 안전합니다.
-- 로그인한 본인 데이터만 읽고 쓸 수 있도록 RLS 가 걸려 있습니다.

-- 과목 앱의 데이터 한 건 = 한 줄.
--   app: japanese | english | math | physics | chemistry
--   col: 그 앱 안의 목록 (vocab, known, templates, answers, concepts, notes …)
--   id : 앱이 만든 항목 id,  data: 항목 전체(JSON)
create table if not exists study_items (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  app         text not null,
  col         text not null,
  id          text not null,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, app, col, id)
);

alter table study_items enable row level security;

drop policy if exists "own study items" on study_items;
create policy "own study items" on study_items
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 다른 기기에서 고친 내용이 바로 반영되도록 실시간 알림에 추가
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'study_items'
  ) then
    alter publication supabase_realtime add table study_items;
  end if;
end $$;

-- 오답노트 · 개념 이미지 (Storage). 경로: <user id>/<과목>/<이미지 id>
insert into storage.buckets (id, name, public)
values ('study-images', 'study-images', false)
on conflict (id) do nothing;

drop policy if exists "own study images read"   on storage.objects;
drop policy if exists "own study images insert" on storage.objects;
drop policy if exists "own study images update" on storage.objects;
drop policy if exists "own study images delete" on storage.objects;

create policy "own study images read" on storage.objects
  for select to authenticated
  using (bucket_id = 'study-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own study images insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'study-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own study images update" on storage.objects
  for update to authenticated
  using (bucket_id = 'study-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own study images delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'study-images' and (storage.foldername(name))[1] = auth.uid()::text);
