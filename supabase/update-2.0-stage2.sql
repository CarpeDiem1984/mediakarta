-- =====================================================================
--  МЕДИАКАРТА 2.0 · Этап 2: клиенты, рассылки, фоллоу-апы,
--  упоминания коллег, актуализация базы.
--  Как применить: Supabase → SQL Editor → New query → вставить файл → Run.
--  Скрипт можно запускать повторно.
-- =====================================================================

-- ---------- Клиенты ----------
create table if not exists public.clients (
  id          bigserial primary key,
  name        text not null,
  note        text,
  archived    boolean not null default false,
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles(id),
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create unique index if not exists clients_name_uidx on public.clients (lower(name)) where deleted_at is null;
alter table public.campaigns add column if not exists client_id bigint references public.clients(id) on delete set null;

-- переносим клиентов из текстового поля инфоповодов
insert into public.clients (name, created_by)
select distinct on (lower(trim(client))) trim(client), created_by from public.campaigns
where coalesce(trim(client), '') <> '' and not exists (select 1 from public.clients c where lower(c.name) = lower(trim(campaigns.client)))
order by lower(trim(client));
update public.campaigns c set client_id = cl.id from public.clients cl
where c.client_id is null and coalesce(trim(c.client), '') <> '' and lower(cl.name) = lower(trim(c.client));

-- ---------- Рассылки ----------
create table if not exists public.mailing_lists (
  id          bigserial primary key,
  name        text not null,
  client_id   bigint references public.clients(id) on delete set null,
  kind        text not null default 'static' check (kind in ('static','dynamic')),
  filter      jsonb not null default '{}'::jsonb,   -- для «живых» списков
  note        text,
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles(id),
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create table if not exists public.mailing_members (
  list_id     bigint not null references public.mailing_lists(id) on delete cascade,
  contact_id  bigint not null references public.contacts(id) on delete cascade,
  added_by    uuid references public.profiles(id) default auth.uid(),
  added_at    timestamptz not null default now(),
  primary key (list_id, contact_id)
);
create table if not exists public.mailing_sends (
  id           bigserial primary key,
  list_id      bigint references public.mailing_lists(id) on delete set null,
  list_name    text,
  campaign_id  bigint references public.campaigns(id) on delete set null,
  contact_ids  bigint[] not null default '{}',
  sent_by      uuid references public.profiles(id) default auth.uid(),
  sent_at      timestamptz not null default now()
);
create index if not exists sends_contacts_gin on public.mailing_sends using gin (contact_ids);

alter table public.contacts add column if not exists unsubscribed boolean not null default false;  -- отписался от рассылок
alter table public.contacts add column if not exists inactive boolean not null default false;      -- «кажется, больше не работает»

-- ---------- Фоллоу-апы ----------
alter table public.campaign_items add column if not exists followup_at timestamptz;

-- ---------- Уведомления (упоминания коллег) ----------
create table if not exists public.notifications (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null default 'mention',
  contact_id  bigint references public.contacts(id) on delete cascade,
  note_id     bigint references public.notes(id) on delete cascade,
  text        text,
  read_at     timestamptz,
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists notif_user_idx on public.notifications (user_id, read_at);

-- ---------- Актуализация ----------
create table if not exists public.verify_tasks (
  id          bigserial primary key,
  contact_id  bigint not null references public.contacts(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  week_start  date not null,
  result      text check (result in ('ok','changed','inactive','skipped')),
  done_at     timestamptz,
  unique (contact_id, week_start)
);
create index if not exists verify_user_week_idx on public.verify_tasks (user_id, week_start);
insert into public.app_settings (key, value) values ('verify_per_week', '20') on conflict do nothing;

-- Выдаёт сотруднику пачку контактов на проверку на текущую неделю (если ещё не выдана)
create or replace function public.assign_verify_tasks() returns int
language plpgsql security definer set search_path = public as $$
declare wk date := date_trunc('week', now())::date; n int; per int;
begin
  if auth.uid() is null then raise exception 'Нужен вход'; end if;
  select count(*) into n from verify_tasks where user_id = auth.uid() and week_start = wk;
  if n > 0 then return n; end if;
  select coalesce((value)::text::int, 20) into per from app_settings where key = 'verify_per_week';
  insert into verify_tasks (contact_id, user_id, week_start)
  select c.id, auth.uid(), wk
  from contacts c
  left join outlets o on o.id = c.outlet_id
  where c.deleted_at is null and not c.is_desk and not c.inactive
    and (c.verified_at is null or c.verified_at < now() - interval '1 year')
    and not exists (select 1 from verify_tasks t where t.contact_id = c.id and t.week_start > wk - 56)
  order by
    (exists (select 1 from favorites f where f.contact_id = c.id)) desc,
    (exists (select 1 from campaign_items i where i.contact_id = c.id)) desc,
    coalesce(o.tier, 9), c.id
  limit coalesce(per, 20);
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.assign_verify_tasks() to authenticated;

-- ---------- Права ----------
alter table public.clients          enable row level security;
alter table public.mailing_lists    enable row level security;
alter table public.mailing_members  enable row level security;
alter table public.mailing_sends    enable row level security;
alter table public.notifications    enable row level security;
alter table public.verify_tasks     enable row level security;

do $$ declare t text; begin
  foreach t in array array['clients','mailing_lists','mailing_members','mailing_sends','verify_tasks'] loop
    execute format('drop policy if exists "read_all" on public.%I', t);
    execute format('create policy "read_all" on public.%I for select to authenticated using (true)', t);
    execute format('drop policy if exists "write_all" on public.%I', t);
    execute format('create policy "write_all" on public.%I for insert to authenticated with check (true)', t);
    execute format('drop policy if exists "update_all" on public.%I', t);
    execute format('create policy "update_all" on public.%I for update to authenticated using (true) with check (true)', t);
  end loop;
end $$;
drop policy if exists "members_delete" on public.mailing_members;
create policy "members_delete" on public.mailing_members for delete to authenticated using (true);
drop policy if exists "verify_delete" on public.verify_tasks;
create policy "verify_delete" on public.verify_tasks for delete to authenticated using (public.is_admin());

-- уведомления: видишь и отмечаешь прочитанными только свои, создать может любой (упоминание коллеги)
drop policy if exists "notif_read" on public.notifications;
create policy "notif_read" on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists "notif_insert" on public.notifications;
create policy "notif_insert" on public.notifications for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "notif_update" on public.notifications;
create policy "notif_update" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- корзина для клиентов и рассылок: удаляет автор или админ
create or replace function public.guard_trash_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is distinct from old.deleted_at then
    if not (public.is_admin() or old.created_by = auth.uid()) then
      raise exception 'Удалить может автор или администратор';
    end if;
    new.deleted_by := case when new.deleted_at is null then null else auth.uid() end;
  end if;
  return new;
end $$;
drop trigger if exists clients_guard_trash on public.clients;
create trigger clients_guard_trash before update on public.clients for each row execute function public.guard_trash_owner();
drop trigger if exists lists_guard_trash on public.mailing_lists;
create trigger lists_guard_trash before update on public.mailing_lists for each row execute function public.guard_trash_owner();

create or replace function public.purge_trash() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
  delete from contacts      where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from campaigns     where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from mailing_lists where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from clients       where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from outlets       where deleted_at < now() - interval '30 days'
    and not exists (select 1 from contacts c where c.outlet_id = outlets.id and c.deleted_at is null);
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

insert into public.app_settings (key, value) values ('schema_version', '"2.0.2"')
on conflict (key) do update set value = excluded.value;
