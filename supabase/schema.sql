-- =====================================================================
--  МЕДИАКАРТА — схема базы данных для Supabase
--  Как применить: Supabase → SQL Editor → New query → вставить весь файл → Run.
--  Скрипт можно запускать повторно: он ничего не удаляет из данных.
-- =====================================================================

-- ---------- Профили пользователей ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'member' check (role in ('admin','member')),
  theme       text not null default 'calm' check (theme in ('paper','console','calm')),
  created_at  timestamptz not null default now()
);

-- Первый пользователь в системе автоматически становится админом
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when (select count(*) from public.profiles) = 0 then 'admin' else 'member' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- профили для пользователей, созданных до запуска скрипта
insert into public.profiles (id, email, full_name, role)
select u.id, u.email, split_part(u.email, '@', 1),
       case when row_number() over (order by u.created_at) = 1
                 and not exists (select 1 from public.profiles) then 'admin' else 'member' end
from auth.users u
on conflict (id) do nothing;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Сотрудник не может сам себе выдать роль админа
create or replace function public.protect_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Менять роль может только администратор';
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role before update on public.profiles
  for each row execute function public.protect_role();

-- ---------- Служебное: updated_at / updated_by ----------
create or replace function public.touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- ---------- Издания ----------
create table if not exists public.outlets (
  id          bigserial primary key,
  name        text not null,
  type        text not null default 'СМИ' check (type in ('СМИ','Новые медиа','Блогеры')),
  format      text,                       -- ТВ / Радио / Информагентство / Печать / Онлайн
  topics      text[] not null default '{}',
  geo         text[] not null default '{}',
  tier        smallint check (tier between 1 and 3),
  website     text,
  reach       text,
  note        text,
  sources     text[] not null default '{}',
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now()
);
create index if not exists outlets_name_idx on public.outlets (lower(name));

-- ---------- Контакты (журналисты и общие ящики редакций) ----------
create table if not exists public.contacts (
  id             bigserial primary key,
  outlet_id      bigint references public.outlets(id) on delete set null,
  is_desk        boolean not null default false,     -- общий ящик редакции
  name           text not null,
  role           text,
  dept           text,
  topics         text[] not null default '{}',
  emails         text[] not null default '{}',
  phones         text[] not null default '{}',
  telegram       text[] not null default '{}',
  socials        text[] not null default '{}',
  birthday_day   smallint check (birthday_day between 1 and 31),
  birthday_month smallint check (birthday_month between 1 and 12),
  birthday_year  smallint,
  address        text,
  relation       text not null default 'neutral' check (relation in ('warm','neutral','cold')),
  tags           text[] not null default '{}',
  comment        text,
  last_pub_url   text,
  last_pub_date  date,
  verified_at    date,
  verified_by    uuid references public.profiles(id),
  verified_note  text,                                -- «актуально март 2024» из старых баз
  sources        text[] not null default '{}',
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id),
  updated_at     timestamptz not null default now()
);
create index if not exists contacts_outlet_idx on public.contacts (outlet_id);

drop trigger if exists outlets_touch on public.outlets;
create trigger outlets_touch before update on public.outlets for each row execute function public.touch();
drop trigger if exists contacts_touch on public.contacts;
create trigger contacts_touch before update on public.contacts for each row execute function public.touch();

-- ---------- Заметки (лента с автором) ----------
create table if not exists public.notes (
  id          bigserial primary key,
  contact_id  bigint not null references public.contacts(id) on delete cascade,
  author      uuid not null references public.profiles(id) default auth.uid(),
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists notes_contact_idx on public.notes (contact_id);

-- ---------- Личный пул (избранное) ----------
create table if not exists public.favorites (
  user_id     uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  contact_id  bigint not null references public.contacts(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, contact_id)
);

-- ---------- Инфоповоды и медиалисты ----------
create table if not exists public.campaigns (
  id            bigserial primary key,
  title         text not null,
  client        text,
  pitch_date    date,
  description   text,
  materials_url text,
  archived      boolean not null default false,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now()
);

create table if not exists public.campaign_items (
  id              bigserial primary key,
  campaign_id     bigint not null references public.campaigns(id) on delete cascade,
  contact_id      bigint not null references public.contacts(id) on delete cascade,
  owner           uuid references public.profiles(id) default auth.uid(),
  status          text not null default 'not_sent'
                  check (status in ('not_sent','sent','no_reply','declined','interest','published')),
  channel         text check (channel in ('email','telegram','phone','meeting','other')),
  sent_at         timestamptz,
  publication_url text,
  note            text,
  updated_by      uuid references public.profiles(id),
  updated_at      timestamptz not null default now(),
  unique (campaign_id, contact_id)
);
create index if not exists items_contact_idx on public.campaign_items (contact_id);
drop trigger if exists items_touch on public.campaign_items;
create trigger items_touch before update on public.campaign_items for each row execute function public.touch();

-- ---------- Справочники и настройки ----------
create table if not exists public.dictionaries (
  kind   text not null check (kind in ('topic','tag')),
  value  text not null,
  sort   int not null default 100,
  primary key (kind, value)
);
create table if not exists public.app_settings (
  key    text primary key,
  value  jsonb not null
);

insert into public.app_settings (key, value) values ('collision_days', '7') on conflict do nothing;

insert into public.dictionaries (kind, value, sort) values
 ('topic','Общество и новости',1),('topic','Бизнес и экономика',2),('topic','Финансы и банки',3),('topic','IT и технологии',4),
 ('topic','Кибербезопасность',5),('topic','Наука',6),('topic','Ритейл и e-com',7),('topic','Маркетинг и реклама',8),
 ('topic','Lifestyle и мода',9),('topic','Еда и HoReCa',10),('topic','Путешествия',11),('topic','Авто и транспорт',12),
 ('topic','Логистика',13),('topic','Недвижимость и стройка',14),('topic','Культура и кино',15),('topic','Игры и развлечения',16),
 ('topic','Спорт',17),('topic','Медицина и фарма',18),('topic','Образование и HR',19),('topic','Семья и дети',20),
 ('topic','Промышленность и энергетика',21),('topic','Агро',22),('topic','ESG и благотворительность',23),
 ('tag','берёт эксклюзивы',1),('tag','берёт комментарии',2),('tag','пишет колонки',3),('tag','только TG',4),
 ('tag','не любит звонки',5),('tag','не любит рассылки',6),('tag','отвечает быстро',7),('tag','игнорирует',8),
 ('tag','коммерция / платно',9),('tag','любит цифры и данные',10)
on conflict do nothing;

-- ---------- Журнал изменений ----------
create table if not exists public.audit_log (
  id          bigserial primary key,
  table_name  text not null,
  row_id      bigint not null,
  action      text not null,
  changed_by  uuid default auth.uid(),
  changed_at  timestamptz not null default now(),
  diff        jsonb
);
create index if not exists audit_row_idx on public.audit_log (table_name, row_id);

create or replace function public.audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare d jsonb := '{}'::jsonb; k text;
begin
  if current_setting('app.bulk_import', true) = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      if k not in ('updated_at','updated_by') and (to_jsonb(new)->k) is distinct from (to_jsonb(old)->k) then
        d := d || jsonb_build_object(k, jsonb_build_object('old', to_jsonb(old)->k, 'new', to_jsonb(new)->k));
      end if;
    end loop;
    if d = '{}'::jsonb then return new; end if;
    insert into audit_log (table_name, row_id, action, diff) values (tg_table_name, new.id, 'update', d);
    return new;
  elsif tg_op = 'INSERT' then
    insert into audit_log (table_name, row_id, action) values (tg_table_name, new.id, 'insert');
    return new;
  else
    insert into audit_log (table_name, row_id, action, diff) values (tg_table_name, old.id, 'delete', to_jsonb(old));
    return old;
  end if;
end $$;

drop trigger if exists contacts_audit on public.contacts;
create trigger contacts_audit after insert or update or delete on public.contacts for each row execute function public.audit();
drop trigger if exists outlets_audit on public.outlets;
create trigger outlets_audit after insert or update or delete on public.outlets for each row execute function public.audit();

-- ---------- Права доступа (Row Level Security) ----------
alter table public.profiles       enable row level security;
alter table public.outlets        enable row level security;
alter table public.contacts       enable row level security;
alter table public.notes          enable row level security;
alter table public.favorites      enable row level security;
alter table public.campaigns      enable row level security;
alter table public.campaign_items enable row level security;
alter table public.dictionaries   enable row level security;
alter table public.app_settings   enable row level security;
alter table public.audit_log      enable row level security;

do $$ declare t text; begin
  foreach t in array array['profiles','outlets','contacts','notes','favorites','campaigns','campaign_items','dictionaries','app_settings','audit_log'] loop
    execute format('drop policy if exists "read_all" on public.%I', t);
    execute format('create policy "read_all" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

-- профили: свой профиль правит сам (имя, тема), чужой — только админ
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

-- издания и контакты: создают и правят все, удаляет только админ
drop policy if exists "outlets_insert" on public.outlets;
create policy "outlets_insert" on public.outlets for insert to authenticated with check (true);
drop policy if exists "outlets_update" on public.outlets;
create policy "outlets_update" on public.outlets for update to authenticated using (true) with check (true);
drop policy if exists "outlets_delete" on public.outlets;
create policy "outlets_delete" on public.outlets for delete to authenticated using (public.is_admin());

drop policy if exists "contacts_insert" on public.contacts;
create policy "contacts_insert" on public.contacts for insert to authenticated with check (true);
drop policy if exists "contacts_update" on public.contacts;
create policy "contacts_update" on public.contacts for update to authenticated using (true) with check (true);
drop policy if exists "contacts_delete" on public.contacts;
create policy "contacts_delete" on public.contacts for delete to authenticated using (public.is_admin());

-- заметки: пишет любой от своего имени, удаляет автор или админ
drop policy if exists "notes_insert" on public.notes;
create policy "notes_insert" on public.notes for insert to authenticated with check (author = auth.uid());
drop policy if exists "notes_delete" on public.notes;
create policy "notes_delete" on public.notes for delete to authenticated using (author = auth.uid() or public.is_admin());

-- пул: только свой (видят все — чтобы понимать, кто с кем работает)
drop policy if exists "fav_insert" on public.favorites;
create policy "fav_insert" on public.favorites for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "fav_delete" on public.favorites;
create policy "fav_delete" on public.favorites for delete to authenticated using (user_id = auth.uid());

-- инфоповоды
drop policy if exists "camp_insert" on public.campaigns;
create policy "camp_insert" on public.campaigns for insert to authenticated with check (true);
drop policy if exists "camp_update" on public.campaigns;
create policy "camp_update" on public.campaigns for update to authenticated using (true) with check (true);
drop policy if exists "camp_delete" on public.campaigns;
create policy "camp_delete" on public.campaigns for delete to authenticated using (created_by = auth.uid() or public.is_admin());

drop policy if exists "items_insert" on public.campaign_items;
create policy "items_insert" on public.campaign_items for insert to authenticated with check (true);
drop policy if exists "items_update" on public.campaign_items;
create policy "items_update" on public.campaign_items for update to authenticated using (true) with check (true);
drop policy if exists "items_delete" on public.campaign_items;
create policy "items_delete" on public.campaign_items for delete to authenticated using (true);

-- справочники и настройки — только админ
drop policy if exists "dict_admin" on public.dictionaries;
create policy "dict_admin" on public.dictionaries for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "settings_admin" on public.app_settings;
create policy "settings_admin" on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- Массовая загрузка исходной базы (только админ) ----------
-- Принимает пачку изданий с вложенными контактами, возвращает число вставленных строк.
create or replace function public.bulk_import(batch jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare o jsonb; c jsonb; oid bigint; n int := 0;
begin
  if not public.is_admin() then raise exception 'Только администратор'; end if;
  perform set_config('app.bulk_import', 'on', true);
  for o in select * from jsonb_array_elements(batch) loop
    insert into outlets (name, type, format, topics, geo, tier, website, reach, sources)
    values (o->>'name', coalesce(o->>'type','СМИ'), o->>'format',
            coalesce(array(select jsonb_array_elements_text(o->'topics')), '{}'),
            coalesce(array(select jsonb_array_elements_text(o->'geo')), '{}'),
            nullif(o->>'tier','')::smallint, o->>'website', o->>'reach',
            coalesce(array(select jsonb_array_elements_text(o->'sources')), '{}'))
    returning id into oid;
    for c in select * from jsonb_array_elements(coalesce(o->'contacts','[]'::jsonb)) loop
      insert into contacts (outlet_id, is_desk, name, role, dept, topics, emails, phones, telegram, socials,
                            birthday_day, birthday_month, birthday_year, address, comment, last_pub_url, verified_note, sources)
      values (oid, coalesce((c->>'is_desk')::boolean,false), c->>'name', c->>'role', c->>'dept',
              coalesce(array(select jsonb_array_elements_text(c->'topics')), '{}'),
              coalesce(array(select jsonb_array_elements_text(c->'emails')), '{}'),
              coalesce(array(select jsonb_array_elements_text(c->'phones')), '{}'),
              coalesce(array(select jsonb_array_elements_text(c->'telegram')), '{}'),
              coalesce(array(select jsonb_array_elements_text(c->'socials')), '{}'),
              nullif(c->>'bd','')::smallint, nullif(c->>'bm','')::smallint, nullif(c->>'by','')::smallint,
              c->>'address', c->>'comment', c->>'last_pub_url', c->>'verified_note',
              coalesce(array(select jsonb_array_elements_text(c->'sources')), '{}'));
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
grant execute on function public.bulk_import(jsonb) to authenticated;
