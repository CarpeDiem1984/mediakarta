-- =====================================================================
--  МЕДИАКАРТА 2.0 · Этап 5: база экспертов.
--  Как применить: Supabase → SQL Editor → New query → вставить файл → Run.
--  Скрипт можно запускать повторно.
-- =====================================================================

create table if not exists public.experts (
  id           bigserial primary key,
  name         text not null,
  position     text,                                   -- специализация, регалии, должность
  topics       text[] not null default '{}',           -- тематики из общего справочника
  phones       text[] not null default '{}',
  emails       text[] not null default '{}',
  telegram     text,
  contact_via  text,                                   -- «через PR-службу …», «через пресс-секретаря …»
  owner_note   text,                                   -- чей контакт: проект, менеджер
  client_id    bigint references public.clients(id) on delete set null,  -- если это спикер клиента
  note         text,                                   -- нюансы общения
  examples     text[] not null default '{}',           -- ссылки на выходы
  deleted_at   timestamptz,
  deleted_by   uuid references public.profiles(id),
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id),
  updated_at   timestamptz not null default now()
);
create index if not exists experts_name_idx on public.experts (lower(name));

-- Где и для кого использовали эксперта
create table if not exists public.expert_uses (
  id           bigserial primary key,
  expert_id    bigint not null references public.experts(id) on delete cascade,
  contact_id   bigint references public.contacts(id) on delete set null,   -- журналист, если он есть в базе
  outlet       text,                                                      -- издание
  campaign_id  bigint references public.campaigns(id) on delete set null,
  url          text,
  note         text,
  used_at      date not null default current_date,
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists expert_uses_expert_idx on public.expert_uses (expert_id, used_at desc);
create index if not exists expert_uses_contact_idx on public.expert_uses (contact_id);

drop trigger if exists experts_touch on public.experts;
create trigger experts_touch before update on public.experts for each row execute function public.touch();
drop trigger if exists experts_guard_trash on public.experts;
create trigger experts_guard_trash before update on public.experts for each row execute function public.guard_trash_owner();

alter table public.experts     enable row level security;
alter table public.expert_uses enable row level security;
do $$ declare t text; begin
  foreach t in array array['experts','expert_uses'] loop
    execute format('drop policy if exists "read_all" on public.%I', t);
    execute format('create policy "read_all" on public.%I for select to authenticated using (true)', t);
    execute format('drop policy if exists "write_all" on public.%I', t);
    execute format('create policy "write_all" on public.%I for insert to authenticated with check (true)', t);
    execute format('drop policy if exists "update_all" on public.%I', t);
    execute format('create policy "update_all" on public.%I for update to authenticated using (true) with check (true)', t);
  end loop;
end $$;
drop policy if exists "uses_delete" on public.expert_uses;
create policy "uses_delete" on public.expert_uses for delete to authenticated using (created_by = auth.uid() or public.is_admin());

create or replace function public.purge_trash() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
  delete from contacts      where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from campaigns     where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from mailing_lists where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from events        where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from experts       where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from clients       where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from outlets       where deleted_at < now() - interval '30 days'
    and not exists (select 1 from contacts c where c.outlet_id = outlets.id and c.deleted_at is null);
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

insert into public.app_settings (key, value) values ('schema_version', '"2.0.5"')
on conflict (key) do update set value = excluded.value;
