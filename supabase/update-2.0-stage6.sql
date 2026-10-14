-- =====================================================================
--  МЕДИАКАРТА 2.0 · Этап 6: приоритет (волна приглашения) у гостей мероприятий.
--  Как применить: Supabase → SQL Editor → New query → вставить файл → Run.
--  Скрипт можно запускать повторно.
-- =====================================================================

alter table public.event_guests add column if not exists priority smallint check (priority between 1 and 3);  -- 1 и 2 волна, 3 — резерв
create index if not exists guests_event_prio_idx on public.event_guests (event_id, priority);

insert into public.app_settings (key, value) values ('schema_version', '"2.0.6"')
on conflict (key) do update set value = excluded.value;
