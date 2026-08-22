-- Photo contest theme + Supabase Storage for contest photos
-- Paste into the Supabase SQL editor if not applied via CLI

-- Allow theme = photo
alter table public.contests drop constraint if exists contests_theme_check;
alter table public.contests
  add constraint contests_theme_check
  check (theme in ('generic', 'song', 'photo'));

-- Patch create_contest / update_contest_settings theme validation in place
do $patch$
declare
  r record;
  def text;
  v_old text := 'v_theme not in (''generic'', ''song'')';
  v_new text := 'v_theme not in (''generic'', ''song'', ''photo'')';
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_contest', 'update_contest_settings')
  loop
    def := pg_get_functiondef(r.oid);
    def := regexp_replace(def, '^CREATE (OR REPLACE )?FUNCTION', 'CREATE OR REPLACE FUNCTION');
    if position(v_old in def) > 0 then
      def := replace(def, v_old, v_new);
      execute def;
    end if;
  end loop;
end $patch$;

-- Public-read bucket for nominated photos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contest-photos',
  'contest-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path layout: {contest_id}/{user_id}/{filename}
drop policy if exists "contest_photos_public_read" on storage.objects;
create policy "contest_photos_public_read"
  on storage.objects
  for select
  to public
  using (bucket_id = 'contest-photos');

drop policy if exists "contest_photos_authenticated_insert" on storage.objects;
create policy "contest_photos_authenticated_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'contest-photos'
    and (storage.foldername(name))[1] is not null
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "contest_photos_authenticated_update" on storage.objects;
create policy "contest_photos_authenticated_update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'contest-photos'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'contest-photos'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "contest_photos_authenticated_delete" on storage.objects;
create policy "contest_photos_authenticated_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'contest-photos'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
