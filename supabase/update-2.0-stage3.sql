-- =====================================================================
--  МЕДИАКАРТА 2.0 · Этап 3: мероприятия и аккредитации.
--  (Отчёты для клиента и аналитика отзывчивости считаются на лету
--   из уже накопленных данных, новых таблиц для них не нужно.)
--  Как применить: Supabase → SQL Editor → New query → вставить файл → Run.
--  Скрипт можно запускать повторно.
-- =====================================================================

create table if not exists public.events (
  id           bigserial primary key,
  title        text not null,
  client_id    bigint references public.clients(id) on delete set null,
  event_at     timestamptz,
  place        text,
  description  text,
  archived     boolean not null default false,
  deleted_at   timestamptz,
  deleted_by   uuid references public.profiles(id),
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);

create table if not exists public.event_guests (
  id          bigserial primary key,
  event_id    bigint not null references public.events(id) on delete cascade,
  contact_id  bigint not null references public.contacts(id) on delete cascade,
  owner       uuid references public.profiles(id) default auth.uid(),
  status      text not null default 'planned'
              check (status in ('planned','invited','confirmed','declined','attended','no_show')),
  note        text,
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now(),
  unique (event_id, contact_id)
);
create index if not exists guests_contact_idx on public.event_guests (contact_id);
drop trigger if exists guests_touch on public.event_guests;
create trigger guests_touch before update on public.event_guests for each row execute function public.touch();

alter table public.events       enable row level security;
alter table public.event_guests enable row level security;
do $$ declare t text; begin
  foreach t in array array['events','event_guests'] loop
    execute format('drop policy if exists "read_all" on public.%I', t);
    execute format('create policy "read_all" on public.%I for select to authenticated using (true)', t);
    execute format('drop policy if exists "write_all" on public.%I', t);
    execute format('create policy "write_all" on public.%I for insert to authenticated with check (true)', t);
    execute format('drop policy if exists "update_all" on public.%I', t);
    execute format('create policy "update_all" on public.%I for update to authenticated using (true) with check (true)', t);
  end loop;
end $$;
drop policy if exists "guests_delete" on public.event_guests;
create policy "guests_delete" on public.event_guests for delete to authenticated using (true);

drop trigger if exists events_guard_trash on public.events;
create trigger events_guard_trash before update on public.events for each row execute function public.guard_trash_owner();

create or replace function public.purge_trash() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
  delete from contacts      where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from campaigns     where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from mailing_lists where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from events        where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from clients       where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from outlets       where deleted_at < now() - interval '30 days'
    and not exists (select 1 from contacts c where c.outlet_id = outlets.id and c.deleted_at is null);
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

insert into public.app_settings (key, value) values ('schema_version', '"2.0.3"')
on conflict (key) do update set value = excluded.value;
