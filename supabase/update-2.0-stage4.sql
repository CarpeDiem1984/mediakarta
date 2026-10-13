-- =====================================================================
--  МЕДИАКАРТА 2.0 · Этап 4: статистика площадок и автопоиск публикаций.
--  Как применить: Supabase → SQL Editor → New query → вставить файл → Run.
--  Скрипт можно запускать повторно.
-- =====================================================================

-- ---------- Подписчики и визиты ----------
alter table public.outlets add column if not exists platform         text;        -- telegram / youtube / vk / instagram / web
alter table public.outlets add column if not exists platform_handle  text;
alter table public.outlets add column if not exists subscribers      bigint;      -- для TG, YouTube, VK, Instagram
alter table public.outlets add column if not exists subscribers_at   timestamptz;
alter table public.outlets add column if not exists visits           bigint;      -- визиты в месяц (SimilarWeb) для сайтов
alter table public.outlets add column if not exists visits_at        timestamptz;
alter table public.outlets add column if not exists stats_source     text;        -- auto / chrome / manual / mediakit
alter table public.outlets add column if not exists stats_error      text;        -- почему не удалось обновить

create table if not exists public.outlet_stats (
  id         bigserial primary key,
  outlet_id  bigint not null references public.outlets(id) on delete cascade,
  metric     text not null check (metric in ('subscribers','visits')),
  value      bigint not null,
  source     text,
  at         timestamptz not null default now()
);
create index if not exists outlet_stats_idx on public.outlet_stats (outlet_id, metric, at desc);
alter table public.outlet_stats enable row level security;
drop policy if exists "read_all" on public.outlet_stats;
create policy "read_all" on public.outlet_stats for select to authenticated using (true);
drop policy if exists "write_all" on public.outlet_stats;
create policy "write_all" on public.outlet_stats for insert to authenticated with check (true);

-- Записать новое значение (из интерфейса или через Chrome): обновляет издание и пишет историю
create or replace function public.set_outlet_stat(p_outlet bigint, p_metric text, p_value bigint, p_source text default 'manual') returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Нужен вход'; end if;
  if p_metric = 'subscribers' then
    update outlets set subscribers = p_value, subscribers_at = now(), stats_source = p_source, stats_error = null where id = p_outlet;
  elsif p_metric = 'visits' then
    update outlets set visits = p_value, visits_at = now(), stats_source = p_source, stats_error = null where id = p_outlet;
  else raise exception 'Неизвестная метрика'; end if;
  insert into outlet_stats (outlet_id, metric, value, source) values (p_outlet, p_metric, p_value, p_source);
end $$;
grant execute on function public.set_outlet_stat(bigint, text, bigint, text) to authenticated;

-- Определяем площадку по ссылке
update public.outlets set platform = case
    when website ~* '(t\.me|telegram\.me)/' then 'telegram'
    when website ~* 'youtube\.com|youtu\.be' then 'youtube'
    when website ~* 'vk\.com/' then 'vk'
    when website ~* 'instagram\.com/' then 'instagram'
    when coalesce(website, '') <> '' then 'web'
  end
where platform is null;

-- ---------- Бэкап и очистка старых «охватов» ----------
create table if not exists public.outlets_reach_backup as
  select id as outlet_id, name, reach, now() as saved_at from public.outlets where false;
insert into public.outlets_reach_backup (outlet_id, name, reach, saved_at)
  select id, name, reach, now() from public.outlets
  where coalesce(reach, '') <> '' and not exists (select 1 from public.outlets_reach_backup b where b.outlet_id = outlets.id);
alter table public.outlets_reach_backup enable row level security;
drop policy if exists "read_admin" on public.outlets_reach_backup;
create policy "read_admin" on public.outlets_reach_backup for select to authenticated using (public.is_admin());
update public.outlets set reach = null where reach is not null;

-- ---------- Автопоиск публикаций журналистов ----------
create table if not exists public.contact_pubs (
  id            bigserial primary key,
  contact_id    bigint not null references public.contacts(id) on delete cascade,
  url           text not null,
  title         text,
  published_at  timestamptz,
  source        text default 'news',
  found_at      timestamptz not null default now(),
  hidden        boolean not null default false,       -- «это не он» — скрыть
  unique (contact_id, url)
);
create index if not exists contact_pubs_idx on public.contact_pubs (contact_id, published_at desc);
alter table public.contact_pubs enable row level security;
drop policy if exists "read_all" on public.contact_pubs;
create policy "read_all" on public.contact_pubs for select to authenticated using (true);
drop policy if exists "update_all" on public.contact_pubs;
create policy "update_all" on public.contact_pubs for update to authenticated using (true) with check (true);

-- служебные отметки о запусках скрипта (пишет GitHub Actions)
insert into public.app_settings (key, value) values ('stats_last_run', 'null'), ('pubs_last_run', 'null') on conflict do nothing;

insert into public.app_settings (key, value) values ('schema_version', '"2.0.4"')
on conflict (key) do update set value = excluded.value;
