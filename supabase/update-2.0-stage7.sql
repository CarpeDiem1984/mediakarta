-- =====================================================================
--  МЕДИАКАРТА 2.0 · Этап 7: медиапланы (платные размещения в СМИ, у блогеров, в новых медиа).
--  Как применить: Supabase → SQL Editor → New query → вставить файл → Run.
--  Скрипт можно запускать повторно.
-- =====================================================================

create table if not exists public.media_plans (
  id          bigserial primary key,
  title       text not null,
  client_id   bigint references public.clients(id) on delete set null,
  period      text,                                     -- «сентябрь–октябрь 2026»
  status      text not null default 'draft' check (status in ('draft','sent','approved','running','done')),
  budget      numeric,                                  -- бюджет клиента, если известен
  settings    jsonb not null default '{"tax":3,"bank":4,"ak":15,"vat":22,"season":0,"barter_fee":18000}'::jsonb,
  sections    text[] not null default '{}',             -- порядок блоков: «Запуск», «РК»…
  note        text,
  archived    boolean not null default false,
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles(id),
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now()
);

create table if not exists public.media_plan_rows (
  id            bigserial primary key,
  plan_id       bigint not null references public.media_plans(id) on delete cascade,
  section       text,
  sort          int not null default 0,
  calc          text not null default 'full' check (calc in ('full','barter','service')),  -- полный расчёт / бартер / услуга
  outlet_id     bigint references public.outlets(id) on delete set null,
  platform      text,             -- СМИ, Telegram, YouTube, TikTok…
  name          text,             -- Media / KOL
  target        text,             -- ЦА
  tier          text,
  format        text,
  address       text,             -- адрес для семпла
  audience      bigint,           -- посещаемость / подписчики
  reach         bigint,           -- прогноз охвата (для CPV)
  reach_text    text,             -- как написали: «3000–20000»
  client_price  numeric,          -- цена площадки для клиента
  cost_price    numeric,          -- закупочная цена (видна только внутри)
  ak_pct        numeric,          -- своя агентская комиссия для строки, если отличается
  ak_fixed      numeric,          -- фиксированная АК (бартер, услуги)
  logistics     numeric,
  reasoning     text,             -- обоснование
  example       text,             -- пример
  comment       text,             -- комментарий для клиента
  internal_note text,             -- заметка для своих
  status        text not null default 'idea' check (status in ('idea','approved','booked','paid','published','declined')),
  pub_url       text,
  fact_reach    bigint,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id),
  updated_at    timestamptz not null default now()
);
create index if not exists mp_rows_plan_idx on public.media_plan_rows (plan_id, section, sort);
create index if not exists mp_rows_outlet_idx on public.media_plan_rows (outlet_id);

drop trigger if exists mp_touch on public.media_plans;
create trigger mp_touch before update on public.media_plans for each row execute function public.touch();
drop trigger if exists mp_rows_touch on public.media_plan_rows;
create trigger mp_rows_touch before update on public.media_plan_rows for each row execute function public.touch();
drop trigger if exists mp_guard_trash on public.media_plans;
create trigger mp_guard_trash before update on public.media_plans for each row execute function public.guard_trash_owner();

alter table public.media_plans     enable row level security;
alter table public.media_plan_rows enable row level security;
do $$ declare t text; begin
  foreach t in array array['media_plans','media_plan_rows'] loop
    execute format('drop policy if exists "read_all" on public.%I', t);
    execute format('create policy "read_all" on public.%I for select to authenticated using (true)', t);
    execute format('drop policy if exists "write_all" on public.%I', t);
    execute format('create policy "write_all" on public.%I for insert to authenticated with check (true)', t);
    execute format('drop policy if exists "update_all" on public.%I', t);
    execute format('create policy "update_all" on public.%I for update to authenticated using (true) with check (true)', t);
  end loop;
end $$;
drop policy if exists "mp_rows_delete" on public.media_plan_rows;
create policy "mp_rows_delete" on public.media_plan_rows for delete to authenticated using (true);

create or replace function public.purge_trash() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
  delete from contacts      where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from campaigns     where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from mailing_lists where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from events        where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from experts       where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from media_plans   where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from clients       where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from outlets       where deleted_at < now() - interval '30 days'
    and not exists (select 1 from contacts c where c.outlet_id = outlets.id and c.deleted_at is null);
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

insert into public.app_settings (key, value) values ('schema_version', '"2.0.7"')
on conflict (key) do update set value = excluded.value;
