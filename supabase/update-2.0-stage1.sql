-- =====================================================================
--  МЕДИАКАРТА 2.0 · Этап 1: корзина, переходы между изданиями,
--  склейка дублей, массовое редактирование.
--  Как применить: Supabase → SQL Editor → New query → вставить файл → Run.
--  Скрипт можно запускать повторно.
-- =====================================================================

-- ---------- Корзина ----------
alter table public.outlets   add column if not exists deleted_at timestamptz;
alter table public.outlets   add column if not exists deleted_by uuid references public.profiles(id);
alter table public.contacts  add column if not exists deleted_at timestamptz;
alter table public.contacts  add column if not exists deleted_by uuid references public.profiles(id);
alter table public.campaigns add column if not exists deleted_at timestamptz;
alter table public.campaigns add column if not exists deleted_by uuid references public.profiles(id);

-- Отправить в корзину / вернуть могут: контакты и издания — админ, инфоповод — автор или админ
create or replace function public.guard_trash() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is distinct from old.deleted_at then
    if tg_table_name = 'campaigns' then
      if not (public.is_admin() or old.created_by = auth.uid()) then
        raise exception 'Удалить инфоповод может автор или администратор';
      end if;
    elsif not public.is_admin() then
      raise exception 'Удалять может только администратор';
    end if;
    new.deleted_by := case when new.deleted_at is null then null else auth.uid() end;
  end if;
  return new;
end $$;
drop trigger if exists outlets_guard_trash on public.outlets;
create trigger outlets_guard_trash before update on public.outlets for each row execute function public.guard_trash();
drop trigger if exists contacts_guard_trash on public.contacts;
create trigger contacts_guard_trash before update on public.contacts for each row execute function public.guard_trash();
drop trigger if exists campaigns_guard_trash on public.campaigns;
create trigger campaigns_guard_trash before update on public.campaigns for each row execute function public.guard_trash();

-- Окончательно удаляет то, что лежит в корзине дольше 30 дней
create or replace function public.purge_trash() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
  delete from contacts  where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from campaigns where deleted_at < now() - interval '30 days'; get diagnostics k = row_count; n := n + k;
  delete from outlets   where deleted_at < now() - interval '30 days'
    and not exists (select 1 from contacts c where c.outlet_id = outlets.id and c.deleted_at is null);
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;
grant execute on function public.purge_trash() to authenticated;

-- ---------- Переходы журналистов между изданиями ----------
create table if not exists public.contact_moves (
  id              bigserial primary key,
  contact_id      bigint not null references public.contacts(id) on delete cascade,
  from_outlet_id  bigint references public.outlets(id) on delete set null,
  to_outlet_id    bigint references public.outlets(id) on delete set null,
  from_name       text,
  to_name         text,
  from_role       text,
  moved_by        uuid references public.profiles(id) default auth.uid(),
  moved_at        timestamptz not null default now()
);
create index if not exists moves_contact_idx on public.contact_moves (contact_id);
alter table public.contact_moves enable row level security;
drop policy if exists "read_all" on public.contact_moves;
create policy "read_all" on public.contact_moves for select to authenticated using (true);

-- В питче запоминаем, в каком издании журналист работал в момент питча
alter table public.campaign_items add column if not exists outlet_id bigint references public.outlets(id) on delete set null;
update public.campaign_items i set outlet_id = c.outlet_id from public.contacts c where c.id = i.contact_id and i.outlet_id is null;
create or replace function public.item_outlet() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.outlet_id is null then select outlet_id into new.outlet_id from contacts where id = new.contact_id; end if;
  return new;
end $$;
drop trigger if exists items_outlet on public.campaign_items;
create trigger items_outlet before insert on public.campaign_items for each row execute function public.item_outlet();

create or replace function public.move_contact(p_contact bigint, p_to bigint, p_role text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c contacts%rowtype;
begin
  if auth.uid() is null then raise exception 'Нужен вход'; end if;
  select * into c from contacts where id = p_contact;
  if not found then raise exception 'Контакт не найден'; end if;
  insert into contact_moves (contact_id, from_outlet_id, to_outlet_id, from_name, to_name, from_role)
  values (p_contact, c.outlet_id, p_to,
          (select name from outlets where id = c.outlet_id), (select name from outlets where id = p_to), c.role);
  update contacts set outlet_id = p_to, role = coalesce(nullif(p_role, ''), role) where id = p_contact;
end $$;
grant execute on function public.move_contact(bigint, bigint, text) to authenticated;

-- ---------- Склейка дублей (только админ) ----------
create table if not exists public.dup_ignores (
  kind  text not null default 'contact' check (kind in ('contact','outlet')),
  a     bigint not null,
  b     bigint not null,
  created_by uuid references public.profiles(id) default auth.uid(),
  primary key (kind, a, b)
);
alter table public.dup_ignores enable row level security;
drop policy if exists "read_all" on public.dup_ignores;
create policy "read_all" on public.dup_ignores for select to authenticated using (true);
drop policy if exists "dup_admin" on public.dup_ignores;
create policy "dup_admin" on public.dup_ignores for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.uniq(a text[]) returns text[]
language sql immutable as $$
  select coalesce(array_agg(x order by o), '{}') from (
    select distinct on (lower(x)) x, o from unnest(a) with ordinality as t(x, o) where coalesce(x, '') <> '' order by lower(x), o
  ) s;
$$;

create or replace function public.merge_contacts(p_keep bigint, p_drop bigint) returns void
language plpgsql security definer set search_path = public as $$
declare k contacts%rowtype; d contacts%rowtype;
begin
  if not public.is_admin() then raise exception 'Только администратор'; end if;
  if p_keep = p_drop then return; end if;
  select * into k from contacts where id = p_keep; select * into d from contacts where id = p_drop;
  if k.id is null or d.id is null then raise exception 'Контакт не найден'; end if;
  update contacts set
    emails   = uniq(k.emails || d.emails),   phones = uniq(k.phones || d.phones),
    telegram = uniq(k.telegram || d.telegram), socials = uniq(k.socials || d.socials),
    topics   = uniq(k.topics || d.topics),   tags = uniq(k.tags || d.tags), sources = uniq(k.sources || d.sources),
    role = coalesce(k.role, d.role), dept = coalesce(k.dept, d.dept), address = coalesce(k.address, d.address),
    birthday_day = coalesce(k.birthday_day, d.birthday_day), birthday_month = coalesce(k.birthday_month, d.birthday_month),
    birthday_year = coalesce(k.birthday_year, d.birthday_year),
    last_pub_url = coalesce(k.last_pub_url, d.last_pub_url), last_pub_date = coalesce(k.last_pub_date, d.last_pub_date),
    verified_at = greatest(k.verified_at, d.verified_at), verified_note = coalesce(k.verified_note, d.verified_note),
    relation = case when k.relation = 'neutral' then d.relation else k.relation end,
    comment = nullif(concat_ws(E'\n\n', k.comment, case when d.comment is distinct from k.comment then d.comment end), '')
  where id = p_keep;
  update notes set contact_id = p_keep where contact_id = p_drop;
  update contact_moves set contact_id = p_keep where contact_id = p_drop;
  insert into favorites (user_id, contact_id) select user_id, p_keep from favorites where contact_id = p_drop on conflict do nothing;
  -- питчи: если оба были в одном инфоповоде, оставляем более продвинутый статус
  delete from campaign_items i using campaign_items j
   where i.contact_id = p_drop and j.contact_id = p_keep and i.campaign_id = j.campaign_id
     and array_position(array['not_sent','sent','no_reply','declined','interest','published'], i.status)
      <= array_position(array['not_sent','sent','no_reply','declined','interest','published'], j.status);
  delete from campaign_items j using campaign_items i
   where i.contact_id = p_drop and j.contact_id = p_keep and i.campaign_id = j.campaign_id;
  update campaign_items set contact_id = p_keep where contact_id = p_drop;
  insert into audit_log (table_name, row_id, action, diff)
  values ('contacts', p_keep, 'merge', jsonb_build_object('merged', jsonb_build_object('old', to_jsonb(d), 'new', p_keep)));
  delete from contacts where id = p_drop;
end $$;
grant execute on function public.merge_contacts(bigint, bigint) to authenticated;

create or replace function public.merge_outlets(p_keep bigint, p_drop bigint) returns void
language plpgsql security definer set search_path = public as $$
declare k outlets%rowtype; d outlets%rowtype;
begin
  if not public.is_admin() then raise exception 'Только администратор'; end if;
  if p_keep = p_drop then return; end if;
  select * into k from outlets where id = p_keep; select * into d from outlets where id = p_drop;
  if k.id is null or d.id is null then raise exception 'Издание не найдено'; end if;
  update outlets set topics = uniq(k.topics || d.topics), geo = uniq(k.geo || d.geo), sources = uniq(k.sources || d.sources),
    tier = coalesce(least(k.tier, d.tier), k.tier, d.tier), website = coalesce(k.website, d.website), reach = coalesce(k.reach, d.reach),
    format = coalesce(k.format, d.format), note = nullif(concat_ws(E'\n\n', k.note, d.note), '')
  where id = p_keep;
  update contacts set outlet_id = p_keep where outlet_id = p_drop;
  update campaign_items set outlet_id = p_keep where outlet_id = p_drop;
  update contact_moves set from_outlet_id = p_keep where from_outlet_id = p_drop;
  update contact_moves set to_outlet_id = p_keep where to_outlet_id = p_drop;
  insert into audit_log (table_name, row_id, action, diff)
  values ('outlets', p_keep, 'merge', jsonb_build_object('merged', jsonb_build_object('old', to_jsonb(d), 'new', p_keep)));
  delete from outlets where id = p_drop;
end $$;
grant execute on function public.merge_outlets(bigint, bigint) to authenticated;

-- ---------- Массовое редактирование ----------
-- ops: {"topics_add":[], "topics_remove":[], "tags_add":[], "tags_remove":[], "relation":"warm", "outlet_id": 5}
create or replace function public.bulk_edit_contacts(p_ids bigint[], ops jsonb) returns int
language plpgsql security invoker set search_path = public as $$
declare n int;
  ta text[] := coalesce(array(select jsonb_array_elements_text(ops->'topics_add')), '{}');
  tr text[] := coalesce(array(select jsonb_array_elements_text(ops->'topics_remove')), '{}');
  ga text[] := coalesce(array(select jsonb_array_elements_text(ops->'tags_add')), '{}');
  gr text[] := coalesce(array(select jsonb_array_elements_text(ops->'tags_remove')), '{}');
begin
  update contacts set
    topics = array(select x from unnest(uniq(topics || ta)) x where x <> all(tr)),
    tags   = array(select x from unnest(uniq(tags || ga)) x where x <> all(gr)),
    relation = coalesce(ops->>'relation', relation),
    outlet_id = coalesce((ops->>'outlet_id')::bigint, outlet_id)
  where id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.bulk_edit_contacts(bigint[], jsonb) to authenticated;

-- ops: {"type":"СМИ", "tier":1, "geo_set":["Москва"], "topics_add":[], "topics_remove":[]}
create or replace function public.bulk_edit_outlets(p_ids bigint[], ops jsonb) returns int
language plpgsql security invoker set search_path = public as $$
declare n int;
  ta text[] := coalesce(array(select jsonb_array_elements_text(ops->'topics_add')), '{}');
  tr text[] := coalesce(array(select jsonb_array_elements_text(ops->'topics_remove')), '{}');
begin
  update outlets set
    topics = array(select x from unnest(uniq(topics || ta)) x where x <> all(tr)),
    type = coalesce(ops->>'type', type),
    tier = case when ops ? 'tier' then nullif(ops->>'tier', '')::smallint else tier end,
    geo  = case when ops ? 'geo_set' then array(select jsonb_array_elements_text(ops->'geo_set')) else geo end
  where id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.bulk_edit_outlets(bigint[], jsonb) to authenticated;

-- версия схемы, чтобы приложение понимало, что обновление применено
insert into public.app_settings (key, value) values ('schema_version', '"2.0.1"')
on conflict (key) do update set value = excluded.value;
