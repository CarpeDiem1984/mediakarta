/* Медиакарта — приложение (Vue 3 без сборки). */
(function () {
  const { createApp, reactive, computed, ref, watch, onMounted, nextTick, h, markRaw } = Vue;
  const api = window.MK_API;

  // ====================== справочники UI ======================
  const TYPES = ['СМИ', 'Новые медиа', 'Блогеры'];
  const REL = { warm: '● Тёплый', neutral: '○ Нейтральный', cold: '● Негатив' };
  const STATUS = { not_sent: 'Не отправлено', sent: 'Отправлено', no_reply: 'Нет ответа', declined: 'Отказ', interest: 'Интерес', published: 'Вышла публикация' };
  const STATUS_ORDER = ['not_sent', 'sent', 'no_reply', 'declined', 'interest', 'published'];
  const CHANNEL = { email: 'Почта', telegram: 'Telegram', phone: 'Звонок', meeting: 'Встреча', other: 'Другое' };
  const THEMES = [
    { id: 'calm', name: 'Тишина', bg: '#FFFFFF', side: '#F6F6F4', ink: '#1D1D1F', acc: '#2F4BC4', line: '#ECECEA' },
    { id: 'paper', name: 'Газета', bg: '#F3F2EE', side: '#F3F2EE', ink: '#16161A', acc: '#C42D17', line: '#16161A' },
    { id: 'console', name: 'Пульт', bg: '#0F1013', side: '#0B0C0E', ink: '#E8E9EC', acc: '#C6F432', line: '#22242A' },
  ];
  const FIELD_RU = { name: 'имя', role: 'должность', dept: 'отдел', topics: 'тематики', emails: 'почта', phones: 'телефон', telegram: 'телеграм', socials: 'соцсети',
    birthday_day: 'ДР (день)', birthday_month: 'ДР (месяц)', birthday_year: 'ДР (год)', address: 'адрес', relation: 'отношение', tags: 'теги', comment: 'комментарий',
    last_pub_url: 'последняя публикация', last_pub_date: 'дата публикации', verified_at: 'проверен', verified_by: 'кем проверен', outlet_id: 'издание', is_desk: 'общий ящик',
    type: 'тип', format: 'формат', geo: 'география', tier: 'tier', website: 'сайт', reach: 'охват', note: 'заметка' };
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  // ====================== хранилище ======================
  const S = reactive({
    mode: api.mode, booting: true, tick: Date.now(), stage2: false, clientId: null, listId: null, user: null, me: null, loadingPct: 0, loadError: '',
    view: 'map', campaignId: null, drawer: null, modal: null, toast: '', rev: 0,
  });
  const D = { outlets: [], contacts: [], campaigns: [], items: [], profiles: [], favorites: new Set(), dict: { topic: [], tag: [] }, settings: { collision_days: 7 }, moves: [], ignores: [], clients: [], lists: [], members: [], sends: [], notifs: [], tasks: [] };
  let IX = {};
  const bump = () => { S.rev++; };

  const norm = s => (s || '').toString().toLowerCase().replace(/ё/g, 'е');
  function contactIndexString(c) {
    return norm([c.name, c.role, c.dept, (c.emails || []).join(' '), (c.telegram || []).join(' '), (c.phones || []).join(' ').replace(/\D/g, ''),
      (c.tags || []).join(' '), (c.topics || []).join(' '), c.comment].join(' '));
  }
  function rebuildIndex() {
    const outletById = new Map(), contactById = new Map(), byOutlet = new Map(), itemsByContact = new Map(), itemsByCampaign = new Map();
    const lastPitch = new Map(), profileById = new Map();
    for (const p of D.profiles) profileById.set(p.id, p);
    for (const o of D.outlets) { outletById.set(o.id, o); byOutlet.set(o.id, []); o._s = norm(o.name + ' ' + (o.website || '')); }
    const orphan = [];
    for (const c of D.contacts) {
      contactById.set(c.id, c);
      c._s = contactIndexString(c);
      (byOutlet.get(c.outlet_id) || orphan).push(c);
    }
    for (const it of D.items) {
      if (!itemsByContact.has(it.contact_id)) itemsByContact.set(it.contact_id, []);
      itemsByContact.get(it.contact_id).push(it);
      if (!itemsByCampaign.has(it.campaign_id)) itemsByCampaign.set(it.campaign_id, []);
      itemsByCampaign.get(it.campaign_id).push(it);
      if (it.sent_at && it.status !== 'not_sent') {
        const prev = lastPitch.get(it.contact_id);
        if (!prev || prev.sent_at < it.sent_at) lastPitch.set(it.contact_id, it);
      }
    }
    const lastPitchOutlet = new Map();
    for (const [cid, it] of lastPitch) {
      const c = contactById.get(cid); if (!c) continue;
      const prev = lastPitchOutlet.get(c.outlet_id);
      if (!prev || prev.sent_at < it.sent_at) lastPitchOutlet.set(c.outlet_id, it);
    }
    for (const [, arr] of byOutlet) arr.sort((a, b) => (b.is_desk - a.is_desk) || a.name.localeCompare(b.name, 'ru'));
    const movesByContact = new Map(), movedFromOutlet = new Map();
    for (const m of D.moves) {
      if (!movesByContact.has(m.contact_id)) movesByContact.set(m.contact_id, []);
      movesByContact.get(m.contact_id).push(m);
      if (m.from_outlet_id) { if (!movedFromOutlet.has(m.from_outlet_id)) movedFromOutlet.set(m.from_outlet_id, []); movedFromOutlet.get(m.from_outlet_id).push(m); }
    }
    for (const [, arr] of movesByContact) arr.sort((a, b) => a.moved_at.localeCompare(b.moved_at));
    const clientById = new Map(D.clients.map(c => [c.id, c]));
    const membersByList = new Map();
    for (const m of D.members) { if (!membersByList.has(m.list_id)) membersByList.set(m.list_id, []); membersByList.get(m.list_id).push(m.contact_id); }
    const sendsByContact = new Map();
    for (const s of D.sends) for (const cid of s.contact_ids || []) { if (!sendsByContact.has(cid)) sendsByContact.set(cid, []); sendsByContact.get(cid).push(s); }
    IX = { outletById, contactById, byOutlet, orphan, itemsByContact, itemsByCampaign, lastPitch, lastPitchOutlet, profileById, movesByContact, movedFromOutlet, clientById, membersByList, sendsByContact };
  }
  const ix = () => (S.rev, IX);

  // ====================== утилиты ======================
  const pad = n => String(n).padStart(2, '0');
  const fmtDate = d => { if (!d) return ''; const x = new Date(d); return pad(x.getDate()) + '.' + pad(x.getMonth() + 1) + '.' + x.getFullYear(); };
  const fmtShort = d => { if (!d) return ''; const x = new Date(d); return x.getDate() + ' ' + MONTHS[x.getMonth()].slice(0, 3); };
  const daysAgo = d => Math.floor((Date.now() - new Date(d).getTime()) / 864e5);
  function agoText(d) {
    if (!d) return '—';
    const n = daysAgo(d);
    if (n <= 0) return 'сегодня'; if (n === 1) return 'вчера';
    if (n < 30) return n + ' ' + plural(n, 'день', 'дня', 'дней') + ' назад';
    const m = Math.round(n / 30); if (m < 12) return m + ' мес. назад';
    return Math.round(n / 365) + ' г. назад';
  }
  function plural(n, a, b, c) { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; }
  const initials = s => (s || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const pname = id => { const p = ix().profileById.get(id); return p ? (p.full_name || p.email) : '—'; };
  const safeUrl = u => { if (!u) return null; u = String(u).trim(); if (/^https?:\/\//i.test(u)) return u; if (/^[\w.-]+\.[a-z]{2,}/i.test(u)) return 'https://' + u; return null; };
  const tgUrl = t => 'https://t.me/' + String(t).replace(/^@/, '');
  const splitList = s => (s || '').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
  function toast(msg) { S.toast = msg; clearTimeout(toast.t); toast.t = setTimeout(() => S.toast = '', 2600); }
  async function copy(text, label) {
    try { await navigator.clipboard.writeText(text); toast((label || 'Скопировано') + ' ✓'); }
    catch (e) { window.prompt('Скопируйте вручную:', text); }
  }
  function applyTheme(t) { document.documentElement.dataset.theme = t || 'calm'; try { localStorage.setItem('mk-theme', t); } catch (e) {} }
  try { applyTheme(localStorage.getItem('mk-theme') || 'calm'); } catch (e) { applyTheme('calm'); }
  async function safe(fn, okMsg) {
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
    catch (e) { console.error(e); toast('Ошибка: ' + (e.message || e)); throw e; }
  }
  const isAdmin = () => S.me && S.me.role === 'admin';
  function collisions(contactId, exceptItemId) {
    const days = +(D.settings.collision_days || 7);
    const a = (ix().itemsByContact.get(contactId) || [])
      .filter(it => it.id !== exceptItemId && it.sent_at && it.status !== 'not_sent' && daysAgo(it.sent_at) <= days)
      .map(it => ({ it, camp: D.campaigns.find(c => c.id === it.campaign_id), who: pname(it.owner), ago: agoText(it.sent_at) }));
    const b = (ix().sendsByContact.get(contactId) || []).filter(s => daysAgo(s.sent_at) <= days && !s.campaign_id)
      .map(s => ({ it: { id: 's' + s.id, owner: s.sent_by, status: 'sent', campaign_id: null }, camp: { title: 'рассылка «' + (s.list_name || '') + '»' }, who: pname(s.sent_by), ago: agoText(s.sent_at) }));
    return a.concat(b);
  }
  function followText(at) {
    const d = new Date(at), now = new Date();
    const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (d.toDateString() === now.toDateString()) return 'сегодня в ' + hm;
    const tm = new Date(now.getTime() + 864e5);
    if (d.toDateString() === tm.toDateString()) return 'завтра в ' + hm;
    return fmtShort(d) + ' в ' + hm;
  }
  function askNotifyPermission() {
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
  }
  function birthdayText(c) {
    if (!c.birthday_day || !c.birthday_month) return '';
    return c.birthday_day + ' ' + MONTHS[c.birthday_month - 1] + (c.birthday_year ? ' ' + c.birthday_year : '');
  }
  function daysToBirthday(c) {
    if (!c.birthday_day || !c.birthday_month) return null;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    let b = new Date(t.getFullYear(), c.birthday_month - 1, c.birthday_day);
    if (b < t) b = new Date(t.getFullYear() + 1, c.birthday_month - 1, c.birthday_day);
    return Math.round((b - t) / 864e5);
  }
  let xlsxLoading = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    return xlsxLoading || (xlsxLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = res; s.onerror = () => rej(new Error('Не удалось загрузить модуль Excel'));
      document.head.appendChild(s);
    }));
  }
  async function exportXlsx(fileName, sheets) {
    await loadXlsx();
    const wb = XLSX.utils.book_new();
    for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
    XLSX.writeFile(wb, fileName);
  }
  const contactRow = c => {
    const o = ix().outletById.get(c.outlet_id) || {};
    const lp = ix().lastPitch.get(c.id);
    return {
      'Издание': o.name || '', 'Тип': o.type || '', 'ФИО': c.name, 'Должность': c.role || '', 'Отдел': c.dept || '',
      'Почта': (c.emails || []).join(', '), 'Телефон': (c.phones || []).join(', '), 'Telegram': (c.telegram || []).join(', '),
      'Тематики': (c.topics || []).join(', '), 'Отношение': (REL[c.relation] || '').replace(/[●○] /, ''), 'Теги': (c.tags || []).join(', '),
      'ДР': birthdayText(c), 'Комментарий': c.comment || '', 'Последняя публикация': c.last_pub_url || '',
      'Последний питч': lp ? fmtDate(lp.sent_at) : '', 'Проверен': c.verified_at ? fmtDate(c.verified_at) : (c.verified_note || ''),
    };
  };

  // ====================== загрузка ======================
  async function boot() {
    S.booting = true;
    try {
      S.user = await api.session();
      if (S.user) await loadData();
    } finally { S.booting = false; }
  }
  async function loadData() {
    S.loadingPct = 0; S.loadError = '';
    try {
      const r = await api.loadAll(p => S.loadingPct = p);
      D.outlets = markRaw(r.outlets); D.contacts = markRaw(r.contacts); D.campaigns = markRaw(r.campaigns); D.items = markRaw(r.items);
      D.profiles = markRaw(r.profiles); D.favorites = new Set(r.favorites);
      D.dict = { topic: r.dictionaries.filter(d => d.kind === 'topic').map(d => d.value), tag: r.dictionaries.filter(d => d.kind === 'tag').map(d => d.value) };
      D.settings = Object.assign({ collision_days: 7 }, r.settings);
      D.moves = markRaw(r.moves || []); D.ignores = markRaw(r.ignores || []);
      S.stage2 = !!r.stage2;
      D.clients = markRaw(r.clients || []); D.lists = markRaw(r.lists || []); D.members = markRaw(r.members || []);
      D.sends = markRaw(r.sends || []); D.notifs = markRaw(r.notifs || []); D.tasks = markRaw(r.tasks || []);
      { const cids = new Set(D.contacts.map(c => c.id)), kids = new Set(D.campaigns.map(c => c.id)); D.items = markRaw(D.items.filter(i => cids.has(i.contact_id) && kids.has(i.campaign_id))); }
      S.me = r.me; applyTheme(S.me.theme);
      rebuildIndex(); bump();
      if (S.view === 'map' && !D.contacts.length && isAdmin()) S.view = 'admin';
      S.needsUpdate = r.needsUpdate || '';
      if (isAdmin() && !r.needsUpdate) api.purgeTrash().catch(() => {});
    } catch (e) { console.error(e); S.loadError = e.message || String(e); }
  }
  // локальные мутации после ответа сервера
  function upsertLocal(list, row) {
    const i = D[list].findIndex(x => x.id === row.id);
    if (i >= 0) D[list][i] = row; else D[list].push(row);
    rebuildIndex(); bump();
  }
  function removeLocal(list, id) {
    D[list] = markRaw(D[list].filter(x => x.id !== id));
    if (list === 'contacts') D.items = markRaw(D.items.filter(i => i.contact_id !== id));
    if (list === 'campaigns') D.items = markRaw(D.items.filter(i => i.campaign_id !== id));
    if (list === 'outlets') D.contacts.forEach(c => { if (c.outlet_id === id) c.outlet_id = null; });
    rebuildIndex(); bump();
  }
  const actions = {
    async saveContact(id, patch) {
      const row = id ? await api.update('contacts', id, patch) : await api.insert('contacts', patch);
      upsertLocal('contacts', row); return row;
    },
    async saveOutlet(id, patch) {
      const row = id ? await api.update('outlets', id, patch) : await api.insert('outlets', patch);
      upsertLocal('outlets', row); return row;
    },
    async saveCampaign(id, patch) {
      const row = id ? await api.update('campaigns', id, patch) : await api.insert('campaigns', patch);
      upsertLocal('campaigns', row); return row;
    },
    async saveItem(id, patch) { const row = await api.update('campaign_items', id, patch); upsertLocal('items', row); return row; },
    async addToCampaign(campaignId, contactIds) {
      const existing = new Set((ix().itemsByCampaign.get(campaignId) || []).map(i => i.contact_id));
      const rows = contactIds.filter(id => !existing.has(id)).map(id => ({ campaign_id: campaignId, contact_id: id, owner: S.me.id, status: 'not_sent' }));
      const res = await api.insertMany('campaign_items', rows);
      for (const r of res) D.items.push(r);
      rebuildIndex(); bump();
      return { added: res.length, skipped: contactIds.length - res.length };
    },
    async addToList(listId, ids) {
      const have = new Set(ix().membersByList.get(listId) || []);
      const rows = ids.filter(id => !have.has(id)).map(id => ({ list_id: listId, contact_id: id }));
      const res = await api.insertMany('mailing_members', rows, 'list_id,contact_id');
      D.members = markRaw(D.members.concat(res.length ? res : rows)); rebuildIndex(); bump();
      return { added: rows.length };
    },
    async refreshRows(list, table, ids) {
      const rows = await api.rowsByIds(table, ids);
      const map = new Map(rows.map(r => [r.id, r]));
      D[list] = markRaw(D[list].map(r => map.get(r.id) || r));
      rebuildIndex(); bump();
    },
    async trashRow(list, table, id, label) {
      await api.softDelete(table, id); removeLocal(list, id);
      toast(label + ' в корзине. Восстановить можно 30 дней: Управление → Корзина');
    },
    async toggleFav(cid) {
      if (D.favorites.has(cid)) { await api.removeFavorite(cid, S.me.id); D.favorites.delete(cid); toast('Убрано из пула'); }
      else { await api.addFavorite(cid, S.me.id); D.favorites.add(cid); toast('Добавлено в мой пул ★'); }
      bump();
    },
  };
  function openContact(id) { S.drawer = { kind: 'contact', id }; }
  function openOutlet(id) { S.drawer = { kind: 'outlet', id }; }
  function go(view, extra) { S.view = view; S.drawer = null; if (extra) Object.assign(S, extra); window.scrollTo(0, 0); }

  // ====================== иконки ======================
  const ICONS = {
    search: ['M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z', 'M20 20l-3.5-3.5'],
    star: ['M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z'],
    chev: ['M9 6l6 6-6 6'], close: ['M6 6l12 12', 'M18 6L6 18'], plus: ['M12 5v14', 'M5 12h14'],
    edit: ['M4 20h4L19 9l-4-4L4 16z', 'M14 6l4 4'], trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
    copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'], send: ['M21 3L10 14', 'M21 3l-7 18-4-7-7-4z'],
    globe: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3c3 3.2 3 14.8 0 18', 'M12 3c-3 3.2-3 14.8 0 18'],
    alert: ['M12 3l10 18H2z', 'M12 10v5', 'M12 18v.5'], check: ['M5 12l5 5L20 7'], ext: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'],
    gift: ['M4 11h16v9H4z', 'M3 7h18v4H3z', 'M12 7v13', 'M12 7c-2-4-6-3-5 0', 'M12 7c2-4 6-3 5 0'],
    clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3 2'], down: ['M12 4v12', 'M6 12l6 6 6-6', 'M4 20h16'],
  };
  const Ic = {
    props: { n: String, s: { type: Number, default: 16 }, fill: { type: String, default: 'none' }, w: { type: Number, default: 1.8 } },
    setup(p) {
      return () => h('svg', { width: p.s, height: p.s, viewBox: '0 0 24 24', fill: p.fill, stroke: 'currentColor', 'stroke-width': p.w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'ic' },
        (ICONS[p.n] || []).map(d => h('path', { d })));
    }
  };

  // общий миксин с хелперами для шаблонов
  const helpers = {
    methods: {
      fmtDate, fmtShort, agoText, initials, pname, safeUrl, tgUrl, birthdayText, copy, openContact, openOutlet, go,
      relLabel: r => REL[r] || REL.neutral, statusLabel: s => STATUS[s] || s, channelLabel: c => CHANNEL[c] || '—',
      outletName(id) { const o = ix().outletById.get(id); return o ? o.name : 'Без издания'; },
      outletOf(c) { return ix().outletById.get(c.outlet_id); },
      typeChip(t) { return t === 'Новые медиа' ? 'chip tg' : t === 'Блогеры' ? 'chip blog' : 'chip'; },
      typeLabel(o) { if (!o) return ''; if (o.type === 'Новые медиа') return /t\.me|telegram/i.test(o.website || '') ? 'TG-канал' : 'Новые медиа'; if (o.type === 'Блогеры') return 'Блогер'; return o.format || 'СМИ'; },
      isFav(id) { return S.rev >= 0 && D.favorites.has(id); },
      isAdmin,
    }
  };

  // ====================== ВХОД ======================
  const Login = {
    mixins: [helpers],
    data: () => ({ email: '', password: '', err: '', busy: false, demo: api.mode === 'demo', resetSent: false }),
    template: `
<div class="login"><form class="card" @submit.prevent="submit">
  <div class="brand" style="padding:0"><div class="brand-mark">М</div>Медиакарта</div>
  <h1>Вход</h1>
  <div v-if="demo" class="banner info">Демо-режим: база ещё не подключена. Данные тестовые и живут только в этой вкладке. Нажмите «Войти», чтобы посмотреть интерфейс.</div>
  <template v-else>
    <label class="field"><span>Почта</span><input class="input" type="email" v-model="email" autocomplete="username" required></label>
    <label class="field"><span>Пароль</span><input class="input" type="password" v-model="password" autocomplete="current-password" required></label>
  </template>
  <div v-if="err" class="banner">{{ err }}</div>
  <button class="btn primary" :disabled="busy">{{ busy ? 'Входим…' : 'Войти' }}</button>
  <button v-if="!demo" type="button" class="btn ghost sm" @click="reset">{{ resetSent ? 'Письмо отправлено' : 'Забыли пароль?' }}</button>
</form></div>`,
    methods: {
      async submit() {
        this.err = ''; this.busy = true;
        try { await api.signIn(this.email.trim(), this.password); S.user = await api.session(); await loadData(); }
        catch (e) { this.err = /invalid/i.test(e.message) ? 'Неверная почта или пароль' : e.message; }
        finally { this.busy = false; }
      },
      async reset() {
        if (!this.email) { this.err = 'Введите почту, на неё придёт ссылка для сброса'; return; }
        try { await api.resetPassword(this.email.trim()); this.resetSent = true; } catch (e) { this.err = e.message; }
      }
    }
  };

  // ====================== НАВИГАЦИЯ ======================
  const Nav = {
    mixins: [helpers], components: { Ic },
    computed: {
      s: () => S, me: () => S.me,
      counts() {
        S.rev; const mine = D.tasks.filter(t => S.me && t.user_id === S.me.id);
        return { outlets: D.outlets.length, pool: D.favorites.size, camps: D.campaigns.filter(c => !c.archived).length, clients: D.clients.filter(c => !c.archived).length, lists: D.lists.length,
          verify: mine.length ? mine.filter(t => !t.result).length || '✓' : '' };
      },
    },
    template: `
<nav class="nav" aria-label="Разделы">
  <div class="brand"><div class="brand-mark">М</div><span class="grow">Медиакарта</span><Bell v-if="s.stage2" /></div>
  <a :class="{active: s.view==='dash'}" @click="go('dash')">Сводка</a>
  <a :class="{active: s.view==='map'}" @click="go('map')">Медиакарта <span class="count">{{ counts.outlets.toLocaleString('ru') }}</span></a>
  <a :class="{active: s.view==='campaigns' || s.view==='campaign'}" @click="go('campaigns')">Инфоповоды <span class="count">{{ counts.camps }}</span></a>
  <a :class="{active: s.view==='pool'}" @click="go('pool')">Мой пул <span class="count">{{ counts.pool }}</span></a>
  <template v-if="s.stage2">
    <a :class="{active: s.view==='clients' || s.view==='client'}" @click="go('clients')">Клиенты <span class="count">{{ counts.clients }}</span></a>
    <a :class="{active: s.view==='mailings' || s.view==='mailing'}" @click="go('mailings')">Рассылки <span class="count">{{ counts.lists }}</span></a>
    <a :class="{active: s.view==='verify'}" @click="go('verify')">Актуализация <span class="count">{{ counts.verify }}</span></a>
  </template>
  <a :class="{active: s.view==='settings'}" @click="go('settings')">Настройки</a>
  <template v-if="isAdmin()">
    <div class="group label">Администратор</div>
    <a :class="{active: s.view==='admin'}" @click="go('admin')">Управление</a>
  </template>
  <div class="me">
    <div class="avatar">{{ initials(me.full_name) }}</div>
    <div class="grow"><div class="ellipsis">{{ me.full_name }}</div><div class="small muted">{{ me.role==='admin' ? 'админ' : 'сотрудник' }}{{ s.mode==='demo' ? ' · демо' : '' }}</div></div>
    <button class="icon-btn" title="Выйти" aria-label="Выйти" @click="logout"><Ic n="ext" /></button>
  </div>
</nav>`,
    methods: { async logout() { await api.signOut(); S.user = null; S.me = null; S.drawer = null; } }
  };

  // ====================== МЕДИАКАРТА ======================
  const PAGE = 60;
  const MapView = {
    mixins: [helpers], components: { Ic },
    data: () => ({
      q: '', qd: '', type: '', topic: '', geo: '', tier: '', relation: '', pool: false, stale: '', verified: '', sort: 'tier',
      limit: PAGE, open: {}, selected: new Set(), selRev: 0,
    }),
    created() {
      try { const f = JSON.parse(sessionStorage.getItem('mk-map') || 'null'); if (f) Object.assign(this, f, { open: {}, selected: new Set() }); } catch (e) {}
      this.qd = this.q;
    },
    watch: {
      q(v) { clearTimeout(this._t); this._t = setTimeout(() => { this.qd = v; this.limit = PAGE; }, 160); },
      filtersKey() { this.limit = PAGE; try { sessionStorage.setItem('mk-map', JSON.stringify({ q: this.q, type: this.type, topic: this.topic, geo: this.geo, tier: this.tier, relation: this.relation, pool: this.pool, stale: this.stale, verified: this.verified, sort: this.sort })); } catch (e) {} },
    },
    computed: {
      s: () => S,
      filtersKey() { return [this.q, this.type, this.topic, this.geo, this.tier, this.relation, this.pool, this.stale, this.verified, this.sort].join('|'); },
      topics() { S.rev; return D.dict.topic; },
      geos() {
        S.rev; const c = new Map();
        for (const o of D.outlets) for (const g of o.geo || []) c.set(g, (c.get(g) || 0) + 1);
        return [...c.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
      },
      typeCounts() { S.rev; const c = { '': D.outlets.length }; for (const o of D.outlets) c[o.type] = (c[o.type] || 0) + 1; return c; },
      contactFilterOn() { return !!(this.relation || this.pool || this.stale || this.verified); },
      hasInactive() { S.rev; return D.contacts.some(c => c.inactive); },
      result() {
        const X = ix();
        const q = norm(this.qd.trim()); const words = q ? q.split(/\s+/) : [];
        const match = s => words.every(w => s.includes(w));
        const now = Date.now(), staleDays = this.stale && this.stale !== 'never' ? +this.stale : 0;
        const cPass = c => {
          if (this.relation && c.relation !== this.relation) return false;
          if (this.pool && !D.favorites.has(c.id)) return false;
          if (this.stale) {
            const lp = X.lastPitch.get(c.id);
            if (this.stale === 'never') { if (lp) return false; }
            else if (!lp || (now - new Date(lp.sent_at)) / 864e5 < staleDays) return false;
          }
          if (this.verified === 'fresh' && !(c.verified_at && (now - new Date(c.verified_at)) / 864e5 <= 365)) return false;
          if (this.verified === 'old' && c.verified_at && (now - new Date(c.verified_at)) / 864e5 <= 365) return false;
          if (this.verified === 'inactive' ? !c.inactive : (c.inactive && !words.length)) return false;
          return true;
        };
        const out = [];
        let totalContacts = 0;
        const list = D.outlets.concat(X.orphan.length ? [{ id: null, name: 'Без издания', type: 'СМИ', topics: [], geo: [], tier: null, _s: 'без издания', _virtual: true }] : []);
        for (const o of list) {
          if (this.type && o.type !== this.type) continue;
          if (this.geo && !(o.geo || []).includes(this.geo)) continue;
          if (this.tier && String(o.tier) !== this.tier) continue;
          const people = o.id === null ? X.orphan : (X.byOutlet.get(o.id) || []);
          const outletTopic = !this.topic || (o.topics || []).includes(this.topic);
          const oMatch = words.length && match(o._s);
          let shown = people, expand = false;
          const needC = this.contactFilterOn || !outletTopic || (words.length && !oMatch);
          if (needC) {
            shown = people.filter(c => cPass(c) && (outletTopic || (c.topics || []).includes(this.topic)) && (!words.length || oMatch || match(c._s)));
            if (!shown.length) continue;
            expand = true;
          } else if (words.length && !oMatch) continue;
          totalContacts += shown.length;
          out.push({ o, people: shown, total: people.length, expand, last: o.id === null ? null : X.lastPitchOutlet.get(o.id) });
        }
        if (this.sort === 'name') out.sort((a, b) => a.o.name.localeCompare(b.o.name, 'ru'));
        else if (this.sort === 'recent') out.sort((a, b) => ((b.last && b.last.sent_at) || '').localeCompare((a.last && a.last.sent_at) || ''));
        else if (this.sort === 'people') out.sort((a, b) => b.total - a.total);
        else out.sort((a, b) => ((a.o.tier || 9) - (b.o.tier || 9)) || (b.total - a.total));
        return { rows: out, totalContacts };
      },
      visible() { return this.result.rows.slice(0, this.limit); },
      selCount() { this.selRev; return this.selected.size; },
      activeFilters() { return [this.type, this.topic, this.geo, this.tier, this.relation, this.pool, this.stale, this.verified].filter(Boolean).length; },
      chips() {
        const c = [], L = { warm: 'Тёплые', neutral: 'Нейтральные', cold: 'Негатив' }, St = { 30: 'Не трогали 30+ дней', 60: 'Не трогали 60+ дней', 90: 'Не трогали 90+ дней', never: 'Ещё не питчили' };
        if (this.q) c.push({ k: 'q', l: 'Поиск: «' + this.q + '»' });
        if (this.type) c.push({ k: 'type', l: this.type });
        if (this.topic) c.push({ k: 'topic', l: 'Тематика: ' + this.topic });
        if (this.geo) c.push({ k: 'geo', l: 'География: ' + this.geo });
        if (this.tier) c.push({ k: 'tier', l: 'Tier ' + this.tier });
        if (this.relation) c.push({ k: 'relation', l: L[this.relation] });
        if (this.stale) c.push({ k: 'stale', l: St[this.stale] });
        if (this.verified) c.push({ k: 'verified', l: { fresh: 'Проверены за год', old: 'Не проверены', inactive: 'Помечены «не работает»' }[this.verified] });
        if (this.pool) c.push({ k: 'pool', l: 'Мой пул' });
        return c;
      },
    },
    methods: {
      isOpen(r) { const k = r.o.id ?? 'none'; return this.open[k] !== undefined ? this.open[k] : r.expand; },
      toggle(r) { const k = r.o.id ?? 'none'; this.open = Object.assign({}, this.open, { [k]: !this.isOpen(r) }); },
      lastText(it) { return it ? agoText(it.sent_at) + ' · ' + pname(it.owner) : '—'; },
      lastPitchOf(c) { const it = ix().lastPitch.get(c.id); return it ? agoText(it.sent_at) + ' · ' + STATUS[it.status] : '—'; },
      hl(text) {
        const q = norm(this.qd.trim()); if (!q || !text) return [{ t: text || '', m: false }];
        const ws = q.split(/\s+/).filter(w => w.length > 1); if (!ws.length) return [{ t: text, m: false }];
        const re = new RegExp('(' + ws.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/е/g, '[её]')).join('|') + ')', 'ig');
        return String(text).split(re).filter(x => x !== '').map(t => ({ t, m: re.test(t) && !(re.lastIndex = 0) }));
      },
      isSel(id) { this.selRev; return this.selected.has(id); },
      sel(id, on) { on ? this.selected.add(id) : this.selected.delete(id); this.selRev++; },
      selOutlet(r, on) { for (const c of r.people) this.sel(c.id, on); },
      outletSel(r) { this.selRev; return r.people.length > 0 && r.people.every(c => this.selected.has(c.id)); },
      clearSel() { this.selected = new Set(); this.selRev++; },
      clearChip(k) { if (k === 'q') { this.q = ''; this.qd = ''; } else this[k] = k === 'pool' ? false : ''; },
      bulk() { S.modal = { kind: 'bulk', ids: [...this.selected], done: () => this.clearSel() }; },
      toList() { S.modal = { kind: 'addToList', ids: [...this.selected], done: () => this.clearSel() }; },
      reset() { Object.assign(this, { q: '', qd: '', type: '', topic: '', geo: '', tier: '', relation: '', pool: false, stale: '', verified: '' }); },
      toCampaign() { S.modal = { kind: 'addToCampaign', ids: [...this.selected], done: () => this.clearSel() }; },
      copyEmails() {
        const ems = [...this.selected].map(id => ix().contactById.get(id)).filter(Boolean).map(c => (c.emails || [])[0]).filter(Boolean);
        copy([...new Set(ems)].join(', '), ems.length + ' ' + plural(ems.length, 'адрес', 'адреса', 'адресов'));
      },
      async exportSel() {
        const rows = [...this.selected].map(id => ix().contactById.get(id)).filter(Boolean).map(contactRow);
        await exportXlsx('Медиалист.xlsx', [['Медиалист', rows]]);
      },
      newContact(outletId) { S.modal = { kind: 'contactForm', id: null, outletId: outletId || null }; },
      newOutlet() { S.modal = { kind: 'outletForm', id: null }; },
    },
    template: `
<div>
  <div class="page-head">
    <div>
      <h1>Медиакарта</h1>
      <div class="muted small mono" style="margin-top:6px">{{ result.rows.length.toLocaleString('ru') }} {{ plural(result.rows.length) }} · {{ result.totalContacts.toLocaleString('ru') }} контактов</div>
    </div>
    <div class="row">
      <button class="btn" @click="newOutlet"><Ic n="plus"/> Издание</button>
      <button class="btn primary" @click="newContact()"><Ic n="plus"/> Журналист</button>
    </div>
  </div>
  <label class="search"><Ic n="search" :s="18"/><span class="sr">Поиск</span>
    <input type="search" v-model="q" placeholder="Имя, издание, почта, @телеграм, телефон или слово из заметок"></label>
  <div class="filters">
    <div class="seg" role="group" aria-label="Тип">
      <button :class="{on: !type}" @click="type=''">Все</button>
      <button v-for="t in ['СМИ','Новые медиа','Блогеры']" :key="t" :class="{on: type===t}" @click="type=t">{{ t }} <span class="muted small">{{ typeCounts[t] || 0 }}</span></button>
    </div>
    <select class="fselect" :class="{set: topic}" v-model="topic" aria-label="Тематика"><option value="">Тематика</option><option v-for="t in topics" :key="t" :value="t">{{ t }}</option></select>
    <select class="fselect" :class="{set: geo}" v-model="geo" aria-label="География"><option value="">География</option><option v-for="g in geos" :key="g" :value="g">{{ g }}</option></select>
    <select class="fselect" :class="{set: tier}" v-model="tier" aria-label="Tier"><option value="">Tier</option><option value="1">Tier 1</option><option value="2">Tier 2</option><option value="3">Tier 3</option></select>
    <select class="fselect" :class="{set: relation}" v-model="relation" aria-label="Отношение"><option value="">Отношение</option><option value="warm">Тёплые</option><option value="neutral">Нейтральные</option><option value="cold">Негатив</option></select>
    <select class="fselect" :class="{set: stale}" v-model="stale" aria-label="Последний контакт"><option value="">Последний питч</option><option value="30">Не трогали 30+ дней</option><option value="60">Не трогали 60+ дней</option><option value="90">Не трогали 90+ дней</option><option value="never">Ещё не питчили</option></select>
    <select class="fselect" :class="{set: verified}" v-model="verified" aria-label="Актуальность"><option value="">Актуальность</option><option value="fresh">Проверены за год</option><option value="old">Не проверены</option><option value="inactive">Помечены «не работает»</option></select>
    <label class="toggle"><input type="checkbox" v-model="pool"> Мой пул</label>
    <select class="fselect" v-model="sort" aria-label="Сортировка"><option value="tier">Сначала Tier 1</option><option value="people">Больше контактов</option><option value="recent">Недавно питчили</option><option value="name">По алфавиту</option></select>
  </div>
  <div v-if="chips.length" class="row wrap" style="margin:-4px 0 14px">
    <span v-for="ch in chips" :key="ch.k" class="chip x on" role="button" tabindex="0" @click="clearChip(ch.k)" @keydown.enter="clearChip(ch.k)" :title="'Убрать фильтр'">{{ ch.l }} ✕</span>
    <button class="btn ghost sm" @click="reset">Сбросить всё</button>
  </div>

  <div class="table">
    <div class="thead ogrid"><span></span><span>Издание</span><span>Тип</span><span>Тематики</span><span>Tier</span><span>Люди</span><span>Последний питч</span></div>
    <div v-if="!result.rows.length" class="empty">Ничего не нашлось. Попробуйте убрать фильтры или <a href="#" @click.prevent="newContact()">добавьте журналиста</a>.</div>
    <div v-for="r in visible" :key="r.o.id ?? 'none'" class="ogroup" :class="{open: isOpen(r)}">
      <div class="orow ogrid" @click="toggle(r)">
        <button class="icon-btn" :aria-label="(isOpen(r)?'Свернуть ':'Раскрыть ') + r.o.name" @click.stop="toggle(r)"><Ic n="chev" class="chev"/></button>
        <div class="row" style="min-width:0">
          <div class="omark">{{ r.o.name.slice(0,1).toUpperCase() }}</div>
          <div style="min-width:0">
            <div class="oname ellipsis"><template v-for="(p,i) in hl(r.o.name)" :key="i"><mark v-if="p.m">{{ p.t }}</mark><template v-else>{{ p.t }}</template></template></div>
            <div class="small muted ellipsis">{{ (r.o.geo||[]).join(', ') || '—' }}<template v-if="r.o.reach"> · {{ r.o.reach }}</template></div>
          </div>
        </div>
        <div><span :class="typeChip(r.o.type)">{{ typeLabel(r.o) }}</span></div>
        <div class="small ellipsis" style="color:var(--text-2)">{{ (r.o.topics||[]).slice(0,3).join(', ') }}</div>
        <div class="mono small">{{ r.o.tier || '—' }}</div>
        <div class="mono small">{{ r.expand && r.people.length !== r.total ? r.people.length + '/' + r.total : r.total }}</div>
        <div class="small ellipsis" style="color:var(--text-2)">{{ lastText(r.last) }}</div>
      </div>
      <div v-if="isOpen(r)" class="people">
        <div class="jrow" style="cursor:default; grid-template-columns: 32px 1fr auto; padding-top:6px; padding-bottom:6px">
          <input type="checkbox" :checked="outletSel(r)" @change="selOutlet(r, $event.target.checked)" :aria-label="'Выбрать всех из ' + r.o.name" style="margin-left:8px">
          <span class="small muted">{{ r.people.length }} {{ r.people.length===1 ? 'контакт' : 'контактов' }}</span>
          <span class="row">
            <button v-if="!r.o._virtual" class="btn ghost sm" @click="openOutlet(r.o.id)">Карточка издания</button>
            <button v-if="!r.o._virtual" class="btn ghost sm" @click="newContact(r.o.id)"><Ic n="plus"/> Контакт</button>
          </span>
        </div>
        <div v-for="c in r.people" :key="c.id" class="jrow jgrid" :class="{active: s.drawer && s.drawer.kind==='contact' && s.drawer.id===c.id}" @click="openContact(c.id)">
          <span class="row" @click.stop style="gap:2px">
            <input type="checkbox" :checked="isSel(c.id)" @change="sel(c.id, $event.target.checked)" :aria-label="'Выбрать ' + c.name" style="margin-left:8px">
          </span>
          <div style="min-width:0">
            <div class="jname ellipsis"><Ic v-if="isFav(c.id)" n="star" :s="13" fill="var(--star)" style="color:var(--star);margin-right:4px;vertical-align:-1px"/><template v-for="(p,i) in hl(c.name)" :key="i"><mark v-if="p.m">{{ p.t }}</mark><template v-else>{{ p.t }}</template></template></div>
            <div class="small muted ellipsis">{{ c.is_desk ? (c.role || 'общий ящик') + ' · ' + ((c.emails||[])[0] || (c.phones||[])[0] || '') : (c.role || '—') }}</div>
          </div>
          <div class="rel" :class="c.relation">{{ c.is_desk ? '' : relLabel(c.relation) }}</div>
          <div style="min-width:0; overflow:hidden; max-height:48px"><span v-for="t in (c.tags||[]).slice(0,3)" :key="t" class="chip">{{ t }}</span></div>
          <div class="small ellipsis" style="color:var(--text-2)">{{ lastPitchOf(c) }}</div>
          <button class="icon-btn" :aria-label="isFav(c.id) ? 'Убрать из пула' : 'В мой пул'" @click.stop="toggleFav(c.id)"><Ic n="star" :fill="isFav(c.id) ? 'var(--star)' : 'none'" :style="{color: isFav(c.id) ? 'var(--star)' : ''}"/></button>
        </div>
      </div>
    </div>
    <div v-if="result.rows.length > limit" class="more"><button class="btn" @click="limit += 60">Показать ещё ({{ result.rows.length - limit }})</button></div>
  </div>

  <div v-if="selCount" class="card row wrap" style="position:sticky; bottom:16px; margin-top:16px; box-shadow:var(--shadow); z-index:5">
    <b>Выбрано: {{ selCount }}</b>
    <span class="grow"></span>
    <button class="btn primary" @click="toCampaign"><Ic n="send"/> В инфоповод</button>
    <button v-if="s.stage2" class="btn" @click="toList"><Ic n="plus"/> В рассылку</button>
    <button class="btn" @click="bulk"><Ic n="edit"/> Изменить разом</button>
    <button class="btn" @click="copyEmails"><Ic n="copy"/> Скопировать почты</button>
    <button class="btn" @click="exportSel"><Ic n="down"/> Excel</button>
    <button class="btn ghost" @click="clearSel">Снять выделение</button>
  </div>
</div>`,
  };
  MapView.methods.plural = n => plural(n, 'издание', 'издания', 'изданий');
  MapView.methods.toggleFav = id => safe(() => actions.toggleFav(id));

  // ====================== КАРТОЧКА ЖУРНАЛИСТА ======================
  const ContactDrawer = {
    mixins: [helpers], components: { Ic },
    props: { id: Number },
    data: () => ({ notes: [], noteText: '', editComment: false, commentDraft: '', audit: null, showAudit: false, busy: false, mq: null }),
    computed: {
      c() { S.rev; return ix().contactById.get(this.id); },
      o() { return this.c && ix().outletById.get(this.c.outlet_id); },
      coll() { S.rev; return this.c ? collisions(this.c.id) : []; },
      pitches() {
        S.rev; return (ix().itemsByContact.get(this.id) || []).slice().sort((a, b) => (b.sent_at || b.updated_at || '').localeCompare(a.sent_at || a.updated_at || ''))
          .map(it => ({ it, camp: D.campaigns.find(x => x.id === it.campaign_id) || {} }));
      },
      tagOptions() { S.rev; return D.dict.tag; },
      career() { S.rev; return ix().movesByContact.get(this.id) || []; },
      mailings() { S.rev; return (ix().sendsByContact.get(this.id) || []).slice().sort((a, b) => b.sent_at.localeCompare(a.sent_at)); },
      stage2: () => S.stage2,
    },
    watch: { id: { immediate: true, handler() { this.load(); } } },
    methods: {
      async load() {
        this.notes = []; this.editComment = false; this.audit = null; this.showAudit = false;
        if (!this.id) return;
        try { this.notes = await api.notes(this.id); } catch (e) { console.error(e); }
      },
      close() { S.drawer = null; },
      async setRel(r) { await safe(() => actions.saveContact(this.c.id, { relation: r })); },
      async toggleTag(t) {
        const tags = (this.c.tags || []).includes(t) ? this.c.tags.filter(x => x !== t) : (this.c.tags || []).concat(t);
        await safe(() => actions.saveContact(this.c.id, { tags }));
      },
      async verify() {
        await safe(() => actions.saveContact(this.c.id, { verified_at: new Date().toISOString().slice(0, 10), verified_by: S.me.id }), 'Отмечено: контакт актуален');
      },
      startComment() { this.commentDraft = this.c.comment || ''; this.editComment = true; },
      async saveComment() { await safe(() => actions.saveContact(this.c.id, { comment: this.commentDraft.trim() || null }), 'Комментарий сохранён'); this.editComment = false; },
      async addNote() {
        const body = this.noteText.trim(); if (!body) return;
        this.busy = true;
        try {
          const n = await safe(() => api.insert('notes', { contact_id: this.c.id, body, author: S.me.id }));
          this.notes.unshift(n); this.noteText = ''; this.mq = null;
          if (S.stage2) {
            const low = body.toLowerCase();
            const who = D.profiles.filter(p => p.id !== S.me.id && p.full_name && low.includes('@' + p.full_name.toLowerCase()));
            for (const p of who) await api.notify({ user_id: p.id, kind: 'mention', contact_id: this.c.id, note_id: n.id, text: body.slice(0, 300), created_by: S.me.id }).catch(e => console.error(e));
            if (who.length) toast('Уведомили: ' + who.map(p => p.full_name).join(', '));
          }
        } finally { this.busy = false; }
      },
      onNoteInput(e) {
        const v = e.target.value, pos = e.target.selectionStart;
        const m = v.slice(0, pos).match(/@([^@\n]{0,20})$/);
        this.mq = m ? m[1].toLowerCase() : null;
      },
      mentionList() {
        if (this.mq === null || !S.stage2) return [];
        return D.profiles.filter(p => p.id !== S.me.id && (p.full_name || '').toLowerCase().startsWith(this.mq)).slice(0, 6);
      },
      pickMention(p) {
        const ta = this.$refs.noteTa; const pos = ta.selectionStart; const v = this.noteText;
        const start = v.slice(0, pos).lastIndexOf('@');
        this.noteText = v.slice(0, start) + '@' + p.full_name + ' ' + v.slice(pos);
        this.mq = null; this.$nextTick(() => ta.focus());
      },
      noteParts(body) {
        const names = D.profiles.map(p => p.full_name).filter(Boolean).sort((a, b) => b.length - a.length);
        if (!names.length) return [{ t: body }];
        const re = new RegExp('(' + names.map(n => '@' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
        return body.split(re).filter(Boolean).map(t => ({ t, m: /^@/.test(t) && names.some(n => ('@' + n).toLowerCase() === t.toLowerCase()) }));
      },
      async toggleUnsub() { await safe(() => actions.saveContact(this.c.id, { unsubscribed: !this.c.unsubscribed }), this.c.unsubscribed ? 'Снова получает рассылки' : 'Больше не попадёт в рассылки'); },
      async toggleInactive() { await safe(() => actions.saveContact(this.c.id, { inactive: !this.c.inactive }), this.c.inactive ? 'Контакт снова активен' : 'Помечен «не работает» и скрыт из медиакарты'); },
      async delNote(n) {
        if (!confirm('Удалить заметку?')) return;
        await safe(() => api.remove('notes', n.id)); this.notes = this.notes.filter(x => x.id !== n.id);
      },
      canDelNote(n) { return n.author === S.me.id || isAdmin(); },
      async loadAudit() {
        this.showAudit = !this.showAudit;
        if (this.showAudit && !this.audit) this.audit = await safe(() => api.audit('contacts', this.c.id));
      },
      diffText(d) {
        if (!d) return '';
        return Object.keys(d).map(k => FIELD_RU[k] || k).join(', ');
      },
      edit() { S.modal = { kind: 'contactForm', id: this.c.id }; },
      toCampaign() { S.modal = { kind: 'addToCampaign', ids: [this.c.id] }; },
      fav() { safe(() => actions.toggleFav(this.c.id)); },
      move() { S.modal = { kind: 'move', id: this.c.id }; },
      async del() {
        if (!confirm('Убрать контакт «' + this.c.name + '» в корзину?')) return;
        await safe(() => actions.trashRow('contacts', 'contacts', this.c.id, 'Контакт')); S.drawer = null;
      },
      openCampaign(id) { go('campaign', { campaignId: id }); },
    },
    template: `
<aside class="drawer" aria-label="Карточка журналиста" v-if="c">
  <div class="row" style="align-items:flex-start">
    <div class="grow">
      <div class="label"><a href="#" @click.prevent="o && openOutlet(o.id)">{{ o ? o.name : 'Без издания' }}</a><template v-if="c.dept"> · {{ c.dept }}</template></div>
      <h2 style="margin-top:6px">{{ c.name }}</h2>
      <div class="muted" style="margin-top:3px">{{ c.role || (c.is_desk ? 'общий ящик редакции' : '') }}</div>
    </div>
    <button class="icon-btn" aria-label="Закрыть карточку" @click="close"><Ic n="close" :s="18"/></button>
  </div>
  <div class="row wrap">
    <button class="btn primary sm" @click="toCampaign"><Ic n="send"/> В инфоповод</button>
    <button class="btn sm" @click="fav"><Ic n="star" :fill="isFav(c.id) ? 'var(--star)' : 'none'" :style="{color: isFav(c.id) ? 'var(--star)' : ''}"/> {{ isFav(c.id) ? 'В моём пуле' : 'В мой пул' }}</button>
    <button class="btn sm" @click="edit"><Ic n="edit"/> Изменить</button>
    <button v-if="!c.is_desk" class="btn sm" @click="move">Перешёл в другое издание</button>
    <button v-if="isAdmin()" class="btn ghost sm" style="color:var(--danger)" @click="del" aria-label="В корзину"><Ic n="trash"/></button>
  </div>
  <div v-if="career.length" class="small"><span class="label">Карьера:&nbsp;</span>
    <template v-for="m in career" :key="m.id"> {{ m.from_name || 'без издания' }}<template v-if="m.from_role"> ({{ m.from_role }})</template> → </template>
    <b>{{ o ? o.name : 'без издания' }}</b> <span class="muted">· с {{ fmtDate(career[career.length-1].moved_at) }}</span></div>
  <div v-if="c.inactive" class="banner">Помечен как «больше не работает» и скрыт из медиакарты. <a href="#" @click.prevent="toggleInactive">Вернуть в активные</a></div>
  <div v-for="x in coll" :key="x.it.id" class="banner"><Ic n="alert" :s="14"/> {{ x.who }} {{ x.it.owner===s.me.id ? '(вы)' : '' }} писал(а) {{ x.ago }} по инфоповоду «{{ x.camp ? x.camp.title : '—' }}». Статус: {{ statusLabel(x.it.status).toLowerCase() }}.</div>

  <div class="kv">
    <template v-if="(c.emails||[]).length"><span class="k">Почта</span><span class="v"><span v-for="(e,i) in c.emails" :key="e"><span class="copy" @click="copy(e)" :title="'Скопировать ' + e">{{ e }}</span><br v-if="i < c.emails.length-1"></span></span></template>
    <template v-if="(c.telegram||[]).length"><span class="k">Телеграм</span><span class="v"><template v-for="(t,i) in c.telegram" :key="t"><a :href="tgUrl(t)" target="_blank" rel="noopener">{{ t }}</a><template v-if="i < c.telegram.length-1">, </template></template></span></template>
    <template v-if="(c.phones||[]).length"><span class="k">Телефон</span><span class="v mono"><span v-for="(p,i) in c.phones" :key="p"><span class="copy" @click="copy(p)">{{ p }}</span><br v-if="i < c.phones.length-1"></span></span></template>
    <template v-if="(c.socials||[]).length"><span class="k">Соцсети</span><span class="v"><template v-for="(u,i) in c.socials" :key="u"><a v-if="safeUrl(u)" :href="safeUrl(u)" target="_blank" rel="noopener">{{ u.replace(/^https?:\\/\\/(www\\.)?/,'').slice(0,40) }}</a><br></template></span></template>
    <template v-if="birthdayText(c)"><span class="k">ДР</span><span class="v">{{ birthdayText(c) }}</span></template>
    <template v-if="c.address"><span class="k">Адрес</span><span class="v">{{ c.address }}</span></template>
    <template v-if="!c.is_desk"><span class="k">Отношение</span>
      <span class="v"><span class="seg"><button v-for="r in ['warm','neutral','cold']" :key="r" :class="{on: c.relation===r}" @click="setRel(r)"><span class="rel" :class="r">{{ relLabel(r) }}</span></button></span></span></template>
    <span class="k">Публикация</span>
    <span class="v"><template v-if="c.last_pub_url"><a :href="safeUrl(c.last_pub_url)" target="_blank" rel="noopener">{{ c.last_pub_date ? fmtDate(c.last_pub_date) : 'ссылка' }} ↗</a></template><span v-else class="muted">не указана · <a href="#" @click.prevent="edit">добавить</a></span></span>
    <template v-if="stage2 && !c.is_desk"><span class="k">Рассылки</span>
      <span class="v"><template v-if="mailings.length">получил {{ mailings.length }}, последняя {{ fmtDate(mailings[0].sent_at) }} · </template>
        <a href="#" @click.prevent="toggleUnsub">{{ c.unsubscribed ? 'отписался — вернуть' : 'отписать' }}</a></span></template>
    <span class="k">Проверен</span>
    <span class="v"><template v-if="c.verified_at">{{ fmtDate(c.verified_at) }} · {{ pname(c.verified_by) }}</template><template v-else-if="c.verified_note">{{ c.verified_note }} <span class="muted small">(из старой базы)</span></template><span v-else class="muted">ещё нет</span>
      · <a href="#" @click.prevent="verify">подтверждаю, актуален</a><template v-if="stage2 && !c.is_desk && !c.inactive"> · <a href="#" @click.prevent="toggleInactive">не работает</a></template></span>
  </div>

  <div v-if="!c.is_desk">
    <span v-for="t in (c.tags||[])" :key="t" class="chip x on" @click="toggleTag(t)" :title="'Убрать тег ' + t">{{ t }} ✕</span>
    <span v-for="t in tagOptions.filter(t => !(c.tags||[]).includes(t))" :key="t" class="chip x" style="opacity:.6" @click="toggleTag(t)">+ {{ t }}</span>
  </div>

  <section>
    <div class="row" style="justify-content:space-between"><h3 class="section-title">Комментарий</h3><a v-if="!editComment" href="#" class="small" @click.prevent="startComment">{{ c.comment ? 'изменить' : 'добавить' }}</a></div>
    <template v-if="editComment">
      <textarea class="textarea" v-model="commentDraft" rows="5" placeholder="Досье в свободной форме: о чём пишет, как с ним работать, что любит и не любит"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn primary sm" @click="saveComment">Сохранить</button><button class="btn ghost sm" @click="editComment=false">Отмена</button></div>
    </template>
    <div v-else-if="c.comment" class="comment-box">{{ c.comment }}</div>
    <div v-else class="muted small">Пока пусто.</div>
    <div v-if="c.updated_by" class="small muted" style="margin-top:6px">карточку правил(а) {{ pname(c.updated_by) }}, {{ fmtDate(c.updated_at) }}</div>
  </section>

  <section>
    <h3 class="section-title">Заметки</h3>
    <div class="row" style="align-items:flex-end; margin-bottom:6px">
      <textarea ref="noteTa" class="textarea grow" style="min-height:44px" rows="2" v-model="noteText" :placeholder="stage2 ? 'Например: созвонились, ждёт данные к пятнице. @Имя — упомянуть коллегу' : 'Например: созвонились, ждёт данные к пятнице'" @input="onNoteInput" @keydown.ctrl.enter="addNote" @keydown.meta.enter="addNote"></textarea>
      <button class="btn primary sm" :disabled="busy || !noteText.trim()" @click="addNote">Добавить</button>
    </div>
    <div v-if="mentionList().length" class="card" style="padding:6px; margin-bottom:6px">
      <button v-for="p in mentionList()" :key="p.id" class="btn ghost sm" @mousedown.prevent="pickMention(p)">@{{ p.full_name }}</button>
    </div>
    <div v-for="n in notes" :key="n.id" class="note">
      <div class="row"><b>{{ pname(n.author) }}</b><span class="meta">{{ fmtDate(n.created_at) }}</span><span class="grow"></span>
        <button v-if="canDelNote(n)" class="icon-btn" style="width:24px;height:24px" aria-label="Удалить заметку" @click="delNote(n)"><Ic n="trash" :s="13"/></button></div>
      <div style="white-space:pre-line"><template v-for="(p,i) in noteParts(n.body)" :key="i"><b v-if="p.m" style="color:var(--accent-text)">{{ p.t }}</b><template v-else>{{ p.t }}</template></template></div>
    </div>
    <div v-if="!notes.length" class="muted small">Заметок нет.</div>
  </section>

  <section>
    <h3 class="section-title">Питчи</h3>
    <div v-for="p in pitches" :key="p.it.id" class="note row" style="cursor:pointer" @click="openCampaign(p.camp.id)">
      <div class="grow"><div>{{ p.camp.title }}</div><div class="meta">{{ p.it.sent_at ? fmtDate(p.it.sent_at) : 'не отправлено' }} · {{ pname(p.it.owner) }}<template v-if="p.camp.client"> · {{ p.camp.client }}</template></div></div>
      <span class="status" :class="p.it.status">{{ statusLabel(p.it.status) }}</span>
    </div>
    <div v-if="!pitches.length" class="muted small">Этому контакту ещё не питчили.</div>
  </section>

  <section>
    <a href="#" class="small" @click.prevent="loadAudit">{{ showAudit ? 'Скрыть историю изменений' : 'История изменений' }}</a>
    <div v-if="showAudit && audit" style="margin-top:6px">
      <div v-for="a in audit" :key="a.id" class="note small"><b>{{ pname(a.changed_by) }}</b> <span class="meta">{{ fmtDate(a.changed_at) }}</span> — {{ a.action==='insert' ? 'создал(а) карточку' : 'изменил(а): ' + diffText(a.diff) }}</div>
      <div v-if="!audit.length" class="muted small">Изменений пока не было.</div>
    </div>
  </section>
  <div class="small muted">Источник: {{ (c.sources||[]).join(', ') || 'добавлен вручную' }}</div>
</aside>`,
  };
  ContactDrawer.computed.s = () => S;

  // ====================== КАРТОЧКА ИЗДАНИЯ ======================
  const OutletDrawer = {
    mixins: [helpers], components: { Ic },
    props: { id: Number },
    computed: {
      o() { S.rev; return ix().outletById.get(this.id); },
      people() { S.rev; return ix().byOutlet.get(this.id) || []; },
      former() {
        S.rev; return (ix().movedFromOutlet.get(this.id) || []).map(m => ({ m, c: ix().contactById.get(m.contact_id) })).filter(x => x.c && x.c.outlet_id !== this.id);
      },
      pitches() {
        S.rev; const ids = new Set(this.people.map(c => c.id));
        return D.items.filter(i => (i.outlet_id ? i.outlet_id === this.id : ids.has(i.contact_id)) && i.status !== 'not_sent').sort((a, b) => (b.sent_at || '').localeCompare(a.sent_at || '')).slice(0, 15)
          .map(it => ({ it, c: ix().contactById.get(it.contact_id), camp: D.campaigns.find(x => x.id === it.campaign_id) || {} }));
      },
    },
    methods: {
      close() { S.drawer = null; },
      edit() { S.modal = { kind: 'outletForm', id: this.o.id }; },
      add() { S.modal = { kind: 'contactForm', id: null, outletId: this.o.id }; },
      async del() {
        if (!confirm('Убрать издание «' + this.o.name + '» в корзину? Его контакты останутся в разделе «Без издания».')) return;
        await safe(() => actions.trashRow('outlets', 'outlets', this.o.id, 'Издание')); S.drawer = null;
      },
      toCampaign() { S.modal = { kind: 'addToCampaign', ids: this.people.map(c => c.id) }; },
    },

    template: `
<aside class="drawer" aria-label="Карточка издания" v-if="o">
  <div class="row" style="align-items:flex-start">
    <div class="grow">
      <div class="label">{{ typeLabel(o) }}<template v-if="o.tier"> · Tier {{ o.tier }}</template></div>
      <h2 style="margin-top:6px">{{ o.name }}</h2>
      <div class="muted" style="margin-top:3px">{{ (o.geo||[]).join(', ') }}</div>
    </div>
    <button class="icon-btn" aria-label="Закрыть" @click="close"><Ic n="close" :s="18"/></button>
  </div>
  <div class="row wrap">
    <button class="btn primary sm" @click="add"><Ic n="plus"/> Контакт</button>
    <button class="btn sm" @click="toCampaign"><Ic n="send"/> Всех в инфоповод</button>
    <button class="btn sm" @click="edit"><Ic n="edit"/> Изменить</button>
    <button v-if="isAdmin()" class="btn ghost sm" style="color:var(--danger)" aria-label="Удалить издание" @click="del"><Ic n="trash"/></button>
  </div>
  <div class="kv">
    <span class="k">Сайт</span><span class="v"><a v-if="safeUrl(o.website)" :href="safeUrl(o.website)" target="_blank" rel="noopener">{{ o.website }}</a><span v-else class="muted">—</span></span>
    <span class="k">Охват</span><span class="v">{{ o.reach || '—' }}</span>
    <span class="k">Тематики</span><span class="v">{{ (o.topics||[]).join(', ') || '—' }}</span>
    <span class="k">Источники</span><span class="v small">{{ (o.sources||[]).join(', ') || 'добавлено вручную' }}</span>
  </div>
  <div v-if="o.note" class="comment-box">{{ o.note }}</div>
  <section>
    <h3 class="section-title">Люди · {{ people.length }}</h3>
    <div v-for="c in people" :key="c.id" class="note row" style="cursor:pointer" @click="openContact(c.id)">
      <div class="grow"><div><b>{{ c.name }}</b></div><div class="meta">{{ c.role || '' }}</div></div>
      <span v-if="!c.is_desk" class="rel" :class="c.relation">{{ relLabel(c.relation) }}</span>
    </div>
  </section>
  <section v-if="former.length">
    <h3 class="section-title">Ушли из издания · {{ former.length }}</h3>
    <div v-for="x in former" :key="x.m.id" class="note row" style="cursor:pointer" @click="openContact(x.c.id)">
      <div class="grow"><b>{{ x.c.name }}</b><div class="meta">теперь {{ outletName(x.c.outlet_id) }} · с {{ fmtDate(x.m.moved_at) }}</div></div>
    </div>
  </section>
  <section>
    <h3 class="section-title">Последние питчи</h3>
    <div v-for="p in pitches" :key="p.it.id" class="note row">
      <div class="grow"><div>{{ p.camp.title }}</div><div class="meta">{{ fmtDate(p.it.sent_at) }} · {{ p.c ? p.c.name : '' }} · {{ pname(p.it.owner) }}</div></div>
      <span class="status" :class="p.it.status">{{ statusLabel(p.it.status) }}</span>
    </div>
    <div v-if="!pitches.length" class="muted small">Сюда ещё не питчили.</div>
  </section>
</aside>`,
  };

  // ====================== ФОРМЫ ======================
  const ContactForm = {
    mixins: [helpers], components: { Ic },
    props: { m: Object },
    data() {
      const c = this.m.id ? ix().contactById.get(this.m.id) : null;
      const o = c ? ix().outletById.get(c.outlet_id) : (this.m.outletId ? ix().outletById.get(this.m.outletId) : null);
      return {
        f: {
          name: c ? c.name : '', outletName: o ? o.name : '', is_desk: c ? c.is_desk : false, role: c ? c.role || '' : '', dept: c ? c.dept || '' : '',
          topics: c ? (c.topics || []).slice() : (o ? (o.topics || []).slice(0, 1) : []),
          emails: c ? (c.emails || []).join('\n') : '', phones: c ? (c.phones || []).join('\n') : '', telegram: c ? (c.telegram || []).join(', ') : '',
          socials: c ? (c.socials || []).join('\n') : '', bd: c ? c.birthday_day || '' : '', bm: c ? c.birthday_month || '' : '', by: c ? c.birthday_year || '' : '',
          address: c ? c.address || '' : '', relation: c ? c.relation : 'neutral', tags: c ? (c.tags || []).slice() : [], newTag: '',
          last_pub_url: c ? c.last_pub_url || '' : '', last_pub_date: c ? c.last_pub_date || '' : '', comment: c ? c.comment || '' : '',
        },
        err: '', busy: false, months: MONTHS,
      };
    },
    computed: {
      outletNames() { S.rev; return D.outlets.map(o => o.name); },
      topicsAll() { S.rev; return D.dict.topic; },
      tagsAll() { S.rev; return D.dict.tag; },
      dup() {
        S.rev; const ems = splitList(this.f.emails).map(x => x.toLowerCase());
        const n = norm(this.f.name.trim());
        if (!ems.length && n.length < 5) return null;
        return D.contacts.find(c => c.id !== this.m.id && ((ems.length && (c.emails || []).some(e => ems.includes(e.toLowerCase()))) || (n.length >= 5 && norm(c.name) === n)));
      },
    },
    methods: {
      tog(arr, v) { const i = this.f[arr].indexOf(v); i >= 0 ? this.f[arr].splice(i, 1) : this.f[arr].push(v); },
      addTag() { const t = this.f.newTag.trim(); if (t && !this.f.tags.includes(t)) this.f.tags.push(t); this.f.newTag = ''; },
      close() { S.modal = null; },
      async save() {
        this.err = '';
        if (!this.f.name.trim()) { this.err = 'Укажите имя (для общего ящика — «Редакция»)'; return; }
        this.busy = true;
        try {
          let outlet_id = null; const on = this.f.outletName.trim();
          if (on) {
            let o = D.outlets.find(x => norm(x.name) === norm(on));
            if (!o) { if (!confirm('Издания «' + on + '» нет в базе. Создать его?')) { this.busy = false; return; } o = await actions.saveOutlet(null, { name: on, type: 'СМИ', topics: this.f.topics.slice(0, 2), geo: ['Федеральные'] }); }
            outlet_id = o.id;
          }
          const tg = splitList(this.f.telegram).map(t => t.replace(/^https?:\/\/t\.me\//, '').replace(/^@?/, '@'));
          const patch = {
            name: this.f.name.trim(), outlet_id, is_desk: this.f.is_desk, role: this.f.role.trim() || null, dept: this.f.dept.trim() || null,
            topics: this.f.topics, emails: splitList(this.f.emails).map(x => x.toLowerCase()), phones: splitList(this.f.phones), telegram: tg,
            socials: splitList(this.f.socials), birthday_day: +this.f.bd || null, birthday_month: +this.f.bm || null, birthday_year: +this.f.by || null,
            address: this.f.address.trim() || null, relation: this.f.relation, tags: this.f.tags,
            last_pub_url: this.f.last_pub_url.trim() || null, last_pub_date: this.f.last_pub_date || null, comment: this.f.comment.trim() || null,
          };
          const row = await actions.saveContact(this.m.id, patch);
          toast(this.m.id ? 'Сохранено' : 'Контакт добавлен');
          S.modal = null; openContact(row.id);
        } catch (e) { this.err = e.message; } finally { this.busy = false; }
      },
    },
    template: `
<div class="modal-back" @click.self="close"><form class="modal wide" @submit.prevent="save">
  <h3>{{ m.id ? 'Редактировать контакт' : 'Новый контакт' }}</h3>
  <div v-if="dup" class="banner">Похоже, такой контакт уже есть: <a href="#" @click.prevent="openContact(dup.id); close()">{{ dup.name }} · {{ outletName(dup.outlet_id) }}</a></div>
  <div class="grid2">
    <label class="field"><span>Имя и фамилия *</span><input class="input" v-model="f.name" required></label>
    <label class="field"><span>Издание</span><input class="input" v-model="f.outletName" list="mk-outlets" placeholder="Начните вводить название"></label>
    <datalist id="mk-outlets"><option v-for="n in outletNames" :key="n" :value="n"></option></datalist>
    <label class="field"><span>Должность</span><input class="input" v-model="f.role"></label>
    <label class="field"><span>Отдел / о чём пишет</span><input class="input" v-model="f.dept"></label>
  </div>
  <label class="toggle"><input type="checkbox" v-model="f.is_desk"> Это общий ящик редакции, а не конкретный человек</label>
  <div class="grid3">
    <label class="field"><span>Почта (по одной в строке)</span><textarea class="textarea" style="min-height:64px" v-model="f.emails"></textarea></label>
    <label class="field"><span>Телефон (по одному в строке)</span><textarea class="textarea" style="min-height:64px" v-model="f.phones"></textarea></label>
    <label class="field"><span>Телеграм</span><textarea class="textarea" style="min-height:64px" v-model="f.telegram" placeholder="@username"></textarea></label>
  </div>
  <div class="field"><span>Тематики</span><div><span v-for="t in topicsAll" :key="t" class="chip x" :class="{on: f.topics.includes(t)}" @click="tog('topics', t)">{{ t }}</span></div></div>
  <div class="grid2">
    <div class="field"><span>Отношение</span><div class="seg"><button type="button" v-for="r in ['warm','neutral','cold']" :key="r" :class="{on: f.relation===r}" @click="f.relation=r"><span class="rel" :class="r">{{ relLabel(r) }}</span></button></div></div>
    <div class="field"><span>День рождения</span><div class="row">
      <input class="input" style="width:70px" type="number" min="1" max="31" v-model="f.bd" placeholder="день" aria-label="День">
      <select class="select" v-model="f.bm" aria-label="Месяц"><option value="">месяц</option><option v-for="(mn,i) in months" :key="i" :value="i+1">{{ mn }}</option></select>
      <input class="input" style="width:90px" type="number" min="1930" max="2015" v-model="f.by" placeholder="год" aria-label="Год"></div></div>
  </div>
  <div class="field"><span>Теги</span><div>
    <span v-for="t in tagsAll" :key="t" class="chip x" :class="{on: f.tags.includes(t)}" @click="tog('tags', t)">{{ t }}</span>
    <span v-for="t in f.tags.filter(t => !tagsAll.includes(t))" :key="t" class="chip x on" @click="tog('tags', t)">{{ t }} ✕</span>
    <input class="input" style="width:180px; height:28px; display:inline-block" v-model="f.newTag" placeholder="свой тег + Enter" @keydown.enter.prevent="addTag"></div></div>
  <div class="grid3">
    <label class="field"><span>Последняя публикация (ссылка)</span><input class="input" v-model="f.last_pub_url" placeholder="https://"></label>
    <label class="field"><span>Дата публикации</span><input class="input" type="date" v-model="f.last_pub_date"></label>
    <label class="field"><span>Соцсети (ссылки)</span><input class="input" v-model="f.socials"></label>
  </div>
  <label class="field"><span>Адрес для подарков</span><input class="input" v-model="f.address"></label>
  <label class="field"><span>Комментарий (досье)</span><textarea class="textarea" v-model="f.comment" rows="4"></textarea></label>
  <div v-if="err" class="banner">{{ err }}</div>
  <div class="foot"><button type="button" class="btn ghost" @click="close">Отмена</button><button class="btn primary" :disabled="busy">{{ busy ? 'Сохраняем…' : 'Сохранить' }}</button></div>
</form></div>`,
  };

  const OutletForm = {
    mixins: [helpers], props: { m: Object },
    data() {
      const o = this.m.id ? ix().outletById.get(this.m.id) : null;
      return {
        f: { name: o ? o.name : '', type: o ? o.type : 'СМИ', format: o ? o.format || '' : '', topics: o ? (o.topics || []).slice() : [], geo: o ? (o.geo || []).join(', ') : 'Федеральные',
          tier: o ? o.tier || '' : '', website: o ? o.website || '' : '', reach: o ? o.reach || '' : '', note: o ? o.note || '' : '' },
        err: '', busy: false,
      };
    },
    computed: {
      topicsAll() { S.rev; return D.dict.topic; },
      dup() { S.rev; const n = norm(this.f.name.trim()); return n && D.outlets.find(o => o.id !== this.m.id && norm(o.name) === n); },
    },
    methods: {
      tog(v) { const i = this.f.topics.indexOf(v); i >= 0 ? this.f.topics.splice(i, 1) : this.f.topics.push(v); },
      close() { S.modal = null; },
      async save() {
        if (!this.f.name.trim()) { this.err = 'Укажите название'; return; }
        if (this.dup && !this.m.id && !confirm('Издание с таким названием уже есть. Всё равно создать?')) return;
        this.busy = true;
        try {
          const row = await actions.saveOutlet(this.m.id, { name: this.f.name.trim(), type: this.f.type, format: this.f.format || null, topics: this.f.topics,
            geo: splitList(this.f.geo), tier: +this.f.tier || null, website: this.f.website.trim() || null, reach: this.f.reach.trim() || null, note: this.f.note.trim() || null });
          toast('Сохранено'); S.modal = null; openOutlet(row.id);
        } catch (e) { this.err = e.message; } finally { this.busy = false; }
      },
    },
    template: `
<div class="modal-back" @click.self="close"><form class="modal" @submit.prevent="save">
  <h3>{{ m.id ? 'Редактировать издание' : 'Новое издание' }}</h3>
  <div v-if="dup" class="banner">Уже есть издание «{{ dup.name }}». <a href="#" @click.prevent="openOutlet(dup.id); close()">Открыть</a></div>
  <label class="field"><span>Название *</span><input class="input" v-model="f.name" required></label>
  <div class="grid3">
    <label class="field"><span>Тип</span><select class="select" v-model="f.type"><option>СМИ</option><option>Новые медиа</option><option>Блогеры</option></select></label>
    <label class="field"><span>Формат</span><select class="select" v-model="f.format"><option value="">—</option><option>Онлайн</option><option>Печать</option><option>ТВ</option><option>Радио</option><option>Информагентство</option><option>Telegram</option><option>YouTube</option></select></label>
    <label class="field"><span>Tier</span><select class="select" v-model="f.tier"><option value="">—</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
  </div>
  <div class="field"><span>Тематики</span><div><span v-for="t in topicsAll" :key="t" class="chip x" :class="{on: f.topics.includes(t)}" @click="tog(t)">{{ t }}</span></div></div>
  <div class="grid2">
    <label class="field"><span>География (через запятую)</span><input class="input" v-model="f.geo"></label>
    <label class="field"><span>Сайт / ссылка на канал</span><input class="input" v-model="f.website"></label>
  </div>
  <label class="field"><span>Охват</span><input class="input" v-model="f.reach" placeholder="например, 300 тыс. в день"></label>
  <label class="field"><span>Заметка об издании</span><textarea class="textarea" v-model="f.note"></textarea></label>
  <div v-if="err" class="banner">{{ err }}</div>
  <div class="foot"><button type="button" class="btn ghost" @click="close">Отмена</button><button class="btn primary" :disabled="busy">Сохранить</button></div>
</form></div>`,
  };

  const CampaignForm = {
    props: { m: Object },
    data() {
      const c = this.m.id ? D.campaigns.find(x => x.id === this.m.id) : null;
      const cl = c && c.client_id ? D.clients.find(x => x.id === c.client_id) : null;
      return { clients: D.clients.map(x => x.name), f: { title: c ? c.title : '', client: cl ? cl.name : (c ? c.client || '' : (this.m.clientName || '')), pitch_date: c ? c.pitch_date || '' : new Date().toISOString().slice(0, 10),
        description: c ? c.description || '' : '', materials_url: c ? c.materials_url || '' : '' }, err: '', busy: false };
    },
    methods: {
      close() { S.modal = null; },
      async save() {
        if (!this.f.title.trim()) { this.err = 'Назовите инфоповод'; return; }
        this.busy = true;
        try {
          const clientName = this.f.client.trim(); let client_id;
          if (S.stage2) {
            let cl = clientName ? D.clients.find(x => norm(x.name) === norm(clientName)) : null;
            if (clientName && !cl) { cl = await api.insert('clients', { name: clientName }); D.clients.push(cl); rebuildIndex(); bump(); }
            client_id = cl ? cl.id : null;
          }
          const row = await actions.saveCampaign(this.m.id, Object.assign(S.stage2 ? { client_id } : {}, { title: this.f.title.trim(), client: clientName || null, pitch_date: this.f.pitch_date || null,
            description: this.f.description.trim() || null, materials_url: this.f.materials_url.trim() || null }));
          S.modal = null; go('campaign', { campaignId: row.id }); toast(this.m.id ? 'Сохранено' : 'Инфоповод создан');
          if (this.m.thenAdd) { await actions.addToCampaign(row.id, this.m.thenAdd); toast('Инфоповод создан, контакты добавлены'); }
        } catch (e) { this.err = e.message; } finally { this.busy = false; }
      },
    },
    template: `
<div class="modal-back" @click.self="close"><form class="modal" @submit.prevent="save">
  <h3>{{ m.id ? 'Инфоповод' : 'Новый инфоповод' }}</h3>
  <label class="field"><span>Название *</span><input class="input" v-model="f.title" required placeholder="Например: исследование рынка BNPL"></label>
  <div class="grid2">
    <label class="field"><span>Клиент</span><input class="input" v-model="f.client" list="mk-clients" placeholder="Выберите или впишите нового"></label>
    <datalist id="mk-clients"><option v-for="n in clients" :key="n" :value="n"></option></datalist>
    <label class="field"><span>Дата рассылки</span><input class="input" type="date" v-model="f.pitch_date"></label>
  </div>
  <label class="field"><span>Суть / текст питча</span><textarea class="textarea" rows="5" v-model="f.description"></textarea></label>
  <label class="field"><span>Ссылка на материалы (релиз, папка)</span><input class="input" v-model="f.materials_url" placeholder="https://"></label>
  <div v-if="err" class="banner">{{ err }}</div>
  <div class="foot"><button type="button" class="btn ghost" @click="close">Отмена</button><button class="btn primary" :disabled="busy">Сохранить</button></div>
</form></div>`,
  };

  const AddToCampaign = {
    mixins: [helpers], props: { m: Object },
    data: () => ({ cid: '', busy: false }),
    computed: {
      camps() { S.rev; return D.campaigns.filter(c => !c.archived).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')); },
      warn() { S.rev; return this.m.ids.filter(id => collisions(id).length).length; },
    },
    created() { if (this.camps.length) this.cid = this.camps[0].id; },
    methods: {
      close() { S.modal = null; },
      async add() {
        this.busy = true;
        try {
          const r = await actions.addToCampaign(+this.cid, this.m.ids);
          toast('Добавлено: ' + r.added + (r.skipped ? ', уже были в списке: ' + r.skipped : ''));
          this.m.done && this.m.done(); S.modal = null;
        } catch (e) { toast('Ошибка: ' + e.message); } finally { this.busy = false; }
      },
      create() { S.modal = { kind: 'campaignForm', id: null, thenAdd: this.m.ids.slice() }; },
    },
    template: `
<div class="modal-back" @click.self="close"><div class="modal">
  <h3>Добавить в инфоповод</h3>
  <div class="muted">Контактов: {{ m.ids.length }}</div>
  <div v-if="warn" class="banner">{{ warn }} из них уже получали питч за последние {{ $options.days() }} дн. Проверьте, чтобы не писать дважды.</div>
  <label v-if="camps.length" class="field"><span>Инфоповод</span><select class="select" v-model="cid"><option v-for="c in camps" :key="c.id" :value="c.id">{{ c.title }}{{ c.client ? ' · ' + c.client : '' }}</option></select></label>
  <div v-else class="muted">Активных инфоповодов пока нет.</div>
  <div class="foot"><button class="btn" @click="create">+ Новый инфоповод</button><span class="grow"></span><button class="btn ghost" @click="close">Отмена</button><button class="btn primary" :disabled="!cid || busy" @click="add">Добавить</button></div>
</div></div>`,
    days: () => D.settings.collision_days || 7,
  };

  // подбор журналистов прямо из инфоповода
  const Picker = {
    mixins: [helpers], components: { Ic }, props: { m: Object },
    data: () => ({ q: '', type: '', topic: '', tier: '', relation: '', pool: false, sel: new Set(), rev: 0, busy: false, deskToo: false }),
    computed: {
      topics() { S.rev; return D.dict.topic; },
      inCamp() { S.rev; return new Set(this.m.listId ? (ix().membersByList.get(this.m.listId) || []) : (ix().itemsByCampaign.get(this.m.campaignId) || []).map(i => i.contact_id)); },
      list() {
        S.rev; const X = ix(); const ws = norm(this.q.trim()).split(/\s+/).filter(Boolean);
        const out = [];
        for (const c of D.contacts) {
          if (c.is_desk && !this.deskToo) continue;
          const o = X.outletById.get(c.outlet_id);
          if (this.type && (!o || o.type !== this.type)) continue;
          if (this.tier && (!o || String(o.tier) !== this.tier)) continue;
          if (this.relation && c.relation !== this.relation) continue;
          if (this.pool && !D.favorites.has(c.id)) continue;
          if (this.topic && !((c.topics || []).includes(this.topic) || (o && (o.topics || []).includes(this.topic)))) continue;
          if (ws.length) { const s = c._s + ' ' + (o ? o._s : ''); if (!ws.every(w => s.includes(w))) continue; }
          out.push({ c, o, coll: collisions(c.id).length, inside: this.inCamp.has(c.id) });
          if (out.length >= 300) break;
        }
        return out;
      },
      selCount() { this.rev; return this.sel.size; },
    },
    methods: {
      isSel(id) { this.rev; return this.sel.has(id); },
      t(id) { this.sel.has(id) ? this.sel.delete(id) : this.sel.add(id); this.rev++; },
      all() { for (const r of this.list) if (!r.inside) this.sel.add(r.c.id); this.rev++; },
      close() { S.modal = null; },
      async add() {
        this.busy = true;
        try {
          const r = this.m.listId ? await actions.addToList(this.m.listId, [...this.sel]) : await actions.addToCampaign(this.m.campaignId, [...this.sel]);
          toast('Добавлено: ' + r.added); S.modal = null;
        }
        catch (e) { toast('Ошибка: ' + e.message); } finally { this.busy = false; }
      },
    },
    template: `
<div class="modal-back" @click.self="close"><div class="modal wide">
  <h3>Подобрать журналистов</h3>
  <label class="search"><Ic n="search" :s="18"/><input type="search" v-model="q" placeholder="Имя, издание, тема, слово из заметок" aria-label="Поиск"></label>
  <div class="row wrap">
    <select class="fselect" :class="{set: type}" v-model="type" aria-label="Тип"><option value="">Все типы</option><option>СМИ</option><option>Новые медиа</option><option>Блогеры</option></select>
    <select class="fselect" :class="{set: topic}" v-model="topic" aria-label="Тематика"><option value="">Тематика</option><option v-for="t in topics" :key="t">{{ t }}</option></select>
    <select class="fselect" :class="{set: tier}" v-model="tier" aria-label="Tier"><option value="">Tier</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select>
    <select class="fselect" :class="{set: relation}" v-model="relation" aria-label="Отношение"><option value="">Отношение</option><option value="warm">Тёплые</option><option value="neutral">Нейтральные</option><option value="cold">Негатив</option></select>
    <label class="toggle"><input type="checkbox" v-model="pool"> Мой пул</label>
    <label class="toggle"><input type="checkbox" v-model="deskToo"> С общими ящиками</label>
    <span class="grow"></span><button class="btn sm" @click="all">Выбрать всех найденных</button>
  </div>
  <div style="max-height:52vh; overflow-y:auto; border-top:1px solid var(--line)">
    <table class="tbl"><tbody>
      <tr v-for="r in list" :key="r.c.id" class="click" @click="!r.inside && t(r.c.id)" :style="r.inside ? 'opacity:.5' : ''">
        <td style="width:32px"><input type="checkbox" :checked="r.inside || isSel(r.c.id)" :disabled="r.inside" @click.stop @change="t(r.c.id)" :aria-label="'Выбрать ' + r.c.name"></td>
        <td><b>{{ r.c.name }}</b> <span class="muted small">{{ r.c.role }}</span></td>
        <td>{{ r.o ? r.o.name : '—' }}</td>
        <td><span class="rel" :class="r.c.relation">{{ r.c.is_desk ? '' : relLabel(r.c.relation) }}</span></td>
        <td class="small">{{ r.inside ? 'уже в списке' : '' }}<span v-if="r.coll" style="color:var(--warn-ink)" title="Недавно уже питчили"><Ic n="alert" :s="13"/> недавно писали</span></td>
      </tr>
    </tbody></table>
    <div v-if="!list.length" class="empty">Никого не нашли</div>
    <div v-if="list.length >= 300" class="small muted" style="padding:8px">Показаны первые 300. Уточните поиск.</div>
  </div>
  <div class="foot"><span class="muted" style="margin-right:auto">Выбрано: {{ selCount }}</span><button class="btn ghost" @click="close">Отмена</button><button class="btn primary" :disabled="!selCount || busy" @click="add">{{ m.listId ? 'Добавить в рассылку' : 'Добавить в медиалист' }}</button></div>
</div></div>`,
  };

  // ====================== ИНФОПОВОДЫ ======================
  function funnel(items) {
    const f = { total: items.length }; for (const k of STATUS_ORDER) f[k] = 0;
    for (const i of items) f[i.status]++;
    f.sentAll = items.filter(i => i.status !== 'not_sent').length;
    f.replied = f.interest + f.published + f.declined;
    return f;
  }
  const CampaignsView = {
    mixins: [helpers], components: { Ic },
    data: () => ({ archived: false, client: '' }),
    computed: {
      clients() { S.rev; return D.clients; },
      stage2: () => S.stage2,
      list() {
        S.rev; return D.campaigns.filter(c => !!c.archived === this.archived && (!this.client || String(c.client_id) === this.client)).sort((a, b) => (b.pitch_date || b.created_at || '').localeCompare(a.pitch_date || a.created_at || ''))
          .map(c => ({ c, f: funnel(ix().itemsByCampaign.get(c.id) || []) }));
      },
    },
    methods: { create() { S.modal = { kind: 'campaignForm', id: null }; }, open(id) { go('campaign', { campaignId: id }); } },
    template: `
<div>
  <div class="page-head"><div><h1>Инфоповоды</h1><div class="muted small" style="margin-top:6px">Каждый инфоповод — это медиалист и статус питчинга по каждому журналисту</div></div>
    <button class="btn primary" @click="create"><Ic n="plus"/> Инфоповод</button></div>
  <div class="row wrap" style="margin-bottom:14px"><div class="seg"><button :class="{on: !archived}" @click="archived=false">Активные</button><button :class="{on: archived}" @click="archived=true">Архив</button></div>
    <select v-if="stage2" class="fselect" :class="{set: client}" v-model="client" aria-label="Клиент"><option value="">Все клиенты</option><option v-for="c in clients" :key="c.id" :value="String(c.id)">{{ c.name }}</option></select></div>
  <div v-if="!list.length" class="empty">{{ archived ? 'В архиве пусто' : 'Создайте первый инфоповод и соберите под него медиалист' }}</div>
  <div class="stack">
    <div v-for="x in list" :key="x.c.id" class="card row wrap" style="cursor:pointer; gap:18px" @click="open(x.c.id)">
      <div class="grow" style="min-width:220px">
        <div class="h2" style="margin:0">{{ x.c.title }}</div>
        <div class="small muted">{{ x.c.client || 'без клиента' }} · {{ fmtDate(x.c.pitch_date || x.c.created_at) }} · {{ pname(x.c.created_by) }}</div>
      </div>
      <div class="funnel" style="flex:2 1 420px">
        <div class="f"><b>{{ x.f.total }}</b><span>в списке</span></div>
        <div class="f"><b>{{ x.f.sentAll }}</b><span>отправлено</span></div>
        <div class="f"><b>{{ x.f.interest }}</b><span>интерес</span></div>
        <div class="f"><b>{{ x.f.published }}</b><span>вышло</span></div>
      </div>
    </div>
  </div>
</div>`,
  };

  const CampaignView = {
    mixins: [helpers], components: { Ic },
    data: () => ({ fStatus: '', fOwner: '', q: '' }),
    computed: {
      camp() { S.rev; return D.campaigns.find(c => c.id === S.campaignId); },
      items() {
        S.rev; const X = ix(); const qq = norm(this.q);
        return (X.itemsByCampaign.get(S.campaignId) || []).map(it => {
          const c = X.contactById.get(it.contact_id) || { name: '—' }; const o = X.outletById.get(c.outlet_id);
          return { it, c, o, coll: collisions(it.contact_id, it.id).filter(x => x.it.campaign_id !== it.campaign_id) };
        }).filter(r => (!this.fStatus || r.it.status === this.fStatus) && (!this.fOwner || r.it.owner === this.fOwner) && (!qq || norm(r.c.name + ' ' + (r.o ? r.o.name : '')).includes(qq)))
          .sort((a, b) => (a.o ? a.o.name : 'я').localeCompare(b.o ? b.o.name : 'я', 'ru') || a.c.name.localeCompare(b.c.name, 'ru'));
      },
      f() { S.rev; return funnel(ix().itemsByCampaign.get(S.campaignId) || []); },
      profiles() { S.rev; return D.profiles; },
      stage2: () => S.stage2,
      statuses: () => STATUS, channels: () => CHANNEL,
    },
    methods: {
      async upd(r, key, val) {
        const patch = { [key]: val || null };
        if (key === 'status' && val !== 'not_sent' && !r.it.sent_at) patch.sent_at = new Date().toISOString();
        if (key === 'status' && val === 'not_sent') patch.sent_at = null;
        if (S.stage2 && key === 'status' && !['sent', 'no_reply'].includes(val) && r.it.followup_at) patch.followup_at = null;
        if (key === 'sent_at') patch.sent_at = val ? new Date(val + 'T12:00:00').toISOString() : null;
        await safe(() => actions.saveItem(r.it.id, patch));
        if (key === 'status' && val === 'published' && !r.it.publication_url) toast('Добавьте ссылку на публикацию в строке');
        if (key === 'publication_url' && val && r.c.id) {
          await safe(() => actions.saveContact(r.c.id, { last_pub_url: val, last_pub_date: new Date().toISOString().slice(0, 10) }));
        }
      },
      async remove(r) {
        if (!confirm('Убрать ' + r.c.name + ' из медиалиста?')) return;
        await safe(() => api.remove('campaign_items', r.it.id)); removeLocal('items', r.it.id);
      },
      pick() { S.modal = { kind: 'picker', campaignId: S.campaignId }; },
      edit() { S.modal = { kind: 'campaignForm', id: this.camp.id }; },
      async archive() { await safe(() => actions.saveCampaign(this.camp.id, { archived: !this.camp.archived }), this.camp.archived ? 'Вернули из архива' : 'Перенесено в архив'); },
      async del() {
        if (!confirm('Убрать инфоповод «' + this.camp.title + '» в корзину?')) return;
        await safe(() => actions.trashRow('campaigns', 'campaigns', this.camp.id, 'Инфоповод')); go('campaigns');
      },
      canDel() { return isAdmin() || (this.camp && this.camp.created_by === S.me.id); },
      copyEmails(onlyNotSent) {
        const ems = this.items.filter(r => !onlyNotSent || r.it.status === 'not_sent').map(r => (r.c.emails || [])[0]).filter(Boolean);
        copy([...new Set(ems)].join(', '), ems.length + ' ' + plural(ems.length, 'адрес', 'адреса', 'адресов'));
      },
      async exportX() {
        const rows = this.items.map(r => Object.assign(contactRow(r.c), { 'Статус': STATUS[r.it.status], 'Канал': CHANNEL[r.it.channel] || '', 'Отправлено': fmtDate(r.it.sent_at), 'Ведёт': pname(r.it.owner), 'Публикация': r.it.publication_url || '', 'Заметка по питчу': r.it.note || '' }));
        await exportXlsx('Медиалист — ' + this.camp.title.replace(/[\\/:*?"<>|]/g, '') + '.xlsx', [['Медиалист', rows]]);
      },
      dateVal(d) { return d ? new Date(d).toISOString().slice(0, 10) : ''; },
      async setFollow(r, v) {
        if (!v) return;
        const at = v === 'off' ? null : new Date(Date.now() + (+v) * 3600e3).toISOString();
        await safe(() => actions.saveItem(r.it.id, { followup_at: at }), at ? 'Напомню ' + followText(at) : 'Напоминание снято');
        if (at) askNotifyPermission();
      },
      followText,
      collText(r) { return r.coll.map(x => x.who + ' — «' + (x.camp ? x.camp.title : '') + '», ' + x.ago).join('\n'); },
    },
    template: `
<div v-if="camp">
  <div class="page-head">
    <div class="grow">
      <a href="#" class="small" @click.prevent="go('campaigns')">← Все инфоповоды</a>
      <h1 style="margin-top:6px">{{ camp.title }}</h1>
      <div class="muted small" style="margin-top:6px">{{ camp.client || 'без клиента' }} · {{ fmtDate(camp.pitch_date) }} · создал(а) {{ pname(camp.created_by) }}<template v-if="camp.archived"> · в архиве</template>
        <template v-if="safeUrl(camp.materials_url)"> · <a :href="safeUrl(camp.materials_url)" target="_blank" rel="noopener">материалы ↗</a></template></div>
    </div>
    <div class="row wrap">
      <button class="btn primary" @click="pick"><Ic n="plus"/> Журналисты</button>
      <button class="btn" @click="edit"><Ic n="edit"/> Изменить</button>
      <button class="btn" @click="archive">{{ camp.archived ? 'Из архива' : 'В архив' }}</button>
      <button v-if="canDel()" class="btn ghost" style="color:var(--danger)" aria-label="Удалить инфоповод" @click="del"><Ic n="trash"/></button>
    </div>
  </div>
  <div v-if="camp.description" class="comment-box" style="margin-bottom:16px">{{ camp.description }}</div>
  <div class="funnel" style="margin-bottom:16px">
    <div class="f"><b>{{ f.total }}</b><span>в медиалисте</span></div>
    <div class="f"><b>{{ f.not_sent }}</b><span>не отправлено</span></div>
    <div class="f"><b>{{ f.sent + f.no_reply }}</b><span>ждут ответа</span></div>
    <div class="f"><b>{{ f.declined }}</b><span>отказ</span></div>
    <div class="f"><b>{{ f.interest }}</b><span>интерес</span></div>
    <div class="f"><b>{{ f.published }}</b><span>вышло</span></div>
    <div class="f"><b>{{ f.sentAll ? Math.round(f.replied / f.sentAll * 100) : 0 }}%</b><span>ответили</span></div>
  </div>
  <div class="row wrap" style="margin-bottom:10px">
    <input class="input" style="max-width:260px; height:34px" v-model="q" placeholder="Найти в медиалисте" aria-label="Найти в медиалисте">
    <select class="fselect" :class="{set: fStatus}" v-model="fStatus" aria-label="Статус"><option value="">Все статусы</option><option v-for="(l,k) in statuses" :key="k" :value="k">{{ l }}</option></select>
    <select class="fselect" :class="{set: fOwner}" v-model="fOwner" aria-label="Кто ведёт"><option value="">Все сотрудники</option><option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.full_name }}</option></select>
    <span class="grow"></span>
    <button class="btn sm" @click="copyEmails(true)"><Ic n="copy"/> Почты неотправленных</button>
    <button class="btn sm" @click="copyEmails(false)"><Ic n="copy"/> Все почты</button>
    <button class="btn sm" @click="exportX"><Ic n="down"/> Excel</button>
  </div>
  <div class="scroll-x card" style="padding:0">
    <table class="tbl" style="min-width:1080px">
      <thead><tr><th>Журналист</th><th>Издание</th><th>Ведёт</th><th>Канал</th><th>Статус</th><th>Отправлено</th><th v-if="stage2">Напомнить</th><th>Публикация / заметка</th><th></th></tr></thead>
      <tbody>
        <tr v-for="r in items" :key="r.it.id">
          <td><a href="#" @click.prevent="openContact(r.c.id)"><b>{{ r.c.name }}</b></a>
            <span v-if="r.coll.length" :title="'Недавно уже писали:\\n' + collText(r)" style="color:var(--warn-ink); margin-left:4px; cursor:help"><Ic n="alert" :s="14"/></span>
            <div class="small muted">{{ (r.c.emails||[])[0] || (r.c.telegram||[])[0] || '' }}</div></td>
          <td class="small">{{ r.o ? r.o.name : '—' }}</td>
          <td><select class="select" style="width:130px" :value="r.it.owner" @change="upd(r, 'owner', $event.target.value)" aria-label="Кто ведёт"><option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.full_name }}</option></select></td>
          <td><select class="select" style="width:120px" :value="r.it.channel || ''" @change="upd(r, 'channel', $event.target.value)" aria-label="Канал"><option value="">—</option><option v-for="(l,k) in channels" :key="k" :value="k">{{ l }}</option></select></td>
          <td><select class="select" :class="'st-' + r.it.status" style="width:170px" :value="r.it.status" @change="upd(r, 'status', $event.target.value)" aria-label="Статус"><option v-for="(l,k) in statuses" :key="k" :value="k">{{ l }}</option></select></td>
          <td><input class="input" type="date" :value="dateVal(r.it.sent_at)" @change="upd(r, 'sent_at', $event.target.value)" aria-label="Дата отправки" style="width:140px"></td>
          <td v-if="stage2"><select class="select" style="width:130px" :value="''" @change="setFollow(r, $event.target.value); $event.target.value=''" aria-label="Напомнить о фоллоу-апе">
              <option value="">{{ r.it.followup_at ? '⏰ ' + followText(r.it.followup_at) : '—' }}</option>
              <option value="1">через 1 час</option><option value="2">через 2 часа</option><option value="5">через 5 часов</option><option value="24">через 24 часа</option><option value="72">через 3 дня</option>
              <option v-if="r.it.followup_at" value="off">убрать</option></select></td>
          <td><input v-if="r.it.status==='published'" class="input" :value="r.it.publication_url" placeholder="ссылка на публикацию" @change="upd(r, 'publication_url', $event.target.value.trim())" aria-label="Ссылка на публикацию">
              <input v-else class="input" :value="r.it.note" placeholder="заметка" @change="upd(r, 'note', $event.target.value.trim())" aria-label="Заметка"></td>
          <td><button class="icon-btn" aria-label="Убрать из медиалиста" @click="remove(r)"><Ic n="close"/></button></td>
        </tr>
      </tbody>
    </table>
    <div v-if="!items.length" class="empty">Медиалист пуст. <a href="#" @click.prevent="pick">Подберите журналистов</a> или отметьте их галочками на Медиакарте.</div>
  </div>
</div>
<div v-else class="empty">Инфоповод не найден. <a href="#" @click.prevent="go('campaigns')">К списку</a></div>`,
  };

  // ====================== МОЙ ПУЛ ======================
  const PoolView = {
    mixins: [helpers], components: { Ic },
    computed: {
      list() {
        S.rev; return [...D.favorites].map(id => ix().contactById.get(id)).filter(Boolean)
          .map(c => ({ c, o: ix().outletById.get(c.outlet_id), lp: ix().lastPitch.get(c.id) }))
          .sort((a, b) => a.c.name.localeCompare(b.c.name, 'ru'));
      },
    },
    methods: {
      all() { S.modal = { kind: 'addToCampaign', ids: this.list.map(r => r.c.id) }; },
      async exportX() { await exportXlsx('Мой пул.xlsx', [['Мой пул', this.list.map(r => contactRow(r.c))]]); },
      unfav(id) { safe(() => actions.toggleFav(id)); },
    },
    template: `
<div>
  <div class="page-head"><div><h1>Мой пул</h1><div class="muted small" style="margin-top:6px">Ваши журналисты. У каждого сотрудника свой список, отмечается звёздочкой.</div></div>
    <div class="row"><button class="btn" @click="exportX" :disabled="!list.length"><Ic n="down"/> Excel</button><button class="btn primary" @click="all" :disabled="!list.length"><Ic n="send"/> Всех в инфоповод</button></div></div>
  <div v-if="!list.length" class="empty">Пул пуст. Нажмите ☆ у журналиста на Медиакарте или в его карточке.</div>
  <div v-else class="card scroll-x" style="padding:0"><table class="tbl" style="min-width:760px">
    <thead><tr><th>Журналист</th><th>Издание</th><th>Отношение</th><th>Теги</th><th>Последний питч</th><th></th></tr></thead>
    <tbody><tr v-for="r in list" :key="r.c.id" class="click" @click="openContact(r.c.id)">
      <td><b>{{ r.c.name }}</b><div class="small muted">{{ r.c.role }}</div></td>
      <td>{{ r.o ? r.o.name : '—' }}</td>
      <td><span class="rel" :class="r.c.relation">{{ relLabel(r.c.relation) }}</span></td>
      <td><span v-for="t in (r.c.tags||[]).slice(0,3)" :key="t" class="chip">{{ t }}</span></td>
      <td class="small">{{ r.lp ? agoText(r.lp.sent_at) + ' · ' + statusLabel(r.lp.status) : '—' }}</td>
      <td><button class="icon-btn" aria-label="Убрать из пула" @click.stop="unfav(r.c.id)"><Ic n="star" fill="var(--star)" style="color:var(--star)"/></button></td>
    </tr></tbody></table></div>
</div>`,
  };

  // ====================== СВОДКА ======================
  const DashView = {
    mixins: [helpers], components: { Ic },
    data: () => ({ notes: [] }),
    async created() { try { this.notes = await api.recentNotes(12); } catch (e) { console.error(e); } },
    computed: {
      me: () => S.me,
      stats() { S.rev; return { contacts: D.contacts.filter(c => !c.is_desk).length, outlets: D.outlets.length, pool: D.favorites.size }; },
      birthdays() {
        S.rev; return D.contacts.map(c => ({ c, d: daysToBirthday(c) })).filter(x => x.d !== null && x.d <= 7)
          .sort((a, b) => a.d - b.d).slice(0, 15).map(x => Object.assign(x, { o: ix().outletById.get(x.c.outlet_id) }));
      },
      waiting() {
        S.rev; return D.items.filter(i => (i.status === 'sent' || i.status === 'no_reply') && i.sent_at && daysAgo(i.sent_at) >= 5)
          .sort((a, b) => (a.owner === S.me.id ? 0 : 1) - (b.owner === S.me.id ? 0 : 1) || a.sent_at.localeCompare(b.sent_at)).slice(0, 12)
          .map(it => ({ it, c: ix().contactById.get(it.contact_id), camp: D.campaigns.find(c => c.id === it.campaign_id) })).filter(x => x.c && x.camp);
      },
      camps() {
        S.rev; return D.campaigns.filter(c => !c.archived).slice(0, 5).map(c => ({ c, f: funnel(ix().itemsByCampaign.get(c.id) || []) }));
      },
      hello() { const h = new Date().getHours(); return h < 6 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'; },
    },
    methods: {
      contactName(id) { const c = ix().contactById.get(id); return c ? c.name : '—'; },
      bdText(d) { return d === 0 ? 'сегодня' : d === 1 ? 'завтра' : 'через ' + d + ' ' + plural(d, 'день', 'дня', 'дней'); },
    },
    template: `
<div>
  <div class="page-head"><div><h1>{{ hello }}, {{ (me.full_name || '').split(' ')[0] }}</h1>
    <div class="muted small mono" style="margin-top:6px">{{ stats.contacts.toLocaleString('ru') }} журналистов · {{ stats.outlets.toLocaleString('ru') }} изданий · в вашем пуле {{ stats.pool }}</div></div>
    <button class="btn primary" @click="go('map')">Открыть медиакарту</button></div>
  <div class="dash">
    <div class="card">
      <h2 class="h2"><Ic n="gift"/> Дни рождения на неделе</h2>
      <div v-for="x in birthdays" :key="x.c.id" class="note row" style="cursor:pointer" @click="openContact(x.c.id)">
        <div class="grow"><b>{{ x.c.name }}</b><div class="meta">{{ x.o ? x.o.name : '' }} · {{ birthdayText(x.c) }}</div></div>
        <span class="status" :class="x.d===0 ? 'interest' : ''">{{ bdText(x.d) }}</span>
      </div>
      <div v-if="!birthdays.length" class="muted small">На этой неделе дней рождения нет.</div>
    </div>
    <div class="card">
      <h2 class="h2"><Ic n="clock"/> Ждут ответа больше 5 дней</h2>
      <div v-for="x in waiting" :key="x.it.id" class="note row" style="cursor:pointer" @click="openContact(x.c.id)">
        <div class="grow"><b>{{ x.c.name }}</b><div class="meta">«{{ x.camp.title }}» · {{ pname(x.it.owner) }} · {{ agoText(x.it.sent_at) }}</div></div>
        <span class="status" :class="x.it.status">{{ statusLabel(x.it.status) }}</span>
      </div>
      <div v-if="!waiting.length" class="muted small">Висящих питчей нет. Отличная работа.</div>
    </div>
    <div class="card">
      <h2 class="h2">Свежие заметки коллег</h2>
      <div v-for="n in notes" :key="n.id" class="note" style="cursor:pointer" @click="openContact(n.contact_id)">
        <div><b>{{ pname(n.author) }}</b> → {{ contactName(n.contact_id) }} <span class="meta">{{ fmtShort(n.created_at) }}</span></div>
        <div style="white-space:pre-line">{{ n.body }}</div>
      </div>
      <div v-if="!notes.length" class="muted small">Заметок пока нет.</div>
    </div>
    <div class="card">
      <h2 class="h2">Активные инфоповоды</h2>
      <div v-for="x in camps" :key="x.c.id" class="note" style="cursor:pointer" @click="go('campaign', {campaignId: x.c.id})">
        <div class="row"><b class="grow">{{ x.c.title }}</b><span class="small muted">{{ x.f.published }} вышло · {{ x.f.interest }} интерес</span></div>
        <div class="progress" style="margin-top:6px"><i :style="{width: (x.f.total ? x.f.sentAll / x.f.total * 100 : 0) + '%'}"></i></div>
        <div class="meta" style="margin-top:4px">отправлено {{ x.f.sentAll }} из {{ x.f.total }}</div>
      </div>
      <div v-if="!camps.length" class="muted small">Нет активных инфоповодов. <a href="#" @click.prevent="go('campaigns')">Создать</a></div>
    </div>
  </div>
</div>`,
  };

  // ====================== НАСТРОЙКИ ======================
  const SettingsView = {
    mixins: [helpers],
    data: () => ({ name: S.me.full_name || '', pw: '', pw2: '', themes: THEMES }),
    computed: { me: () => S.me, mode: () => S.mode },
    methods: {
      async setTheme(t) {
        applyTheme(t); S.me.theme = t;
        await safe(() => api.updateProfile(S.me.id, { theme: t }), 'Тема сохранена');
        const p = D.profiles.find(p => p.id === S.me.id); if (p) p.theme = t;
      },
      async saveName() {
        if (!this.name.trim()) return;
        await safe(() => api.updateProfile(S.me.id, { full_name: this.name.trim() }), 'Имя сохранено');
        S.me.full_name = this.name.trim(); const p = D.profiles.find(p => p.id === S.me.id); if (p) p.full_name = S.me.full_name; bump();
      },
      async savePw() {
        if (this.pw.length < 8) { toast('Пароль — минимум 8 символов'); return; }
        if (this.pw !== this.pw2) { toast('Пароли не совпадают'); return; }
        await safe(() => api.updatePassword(this.pw), 'Пароль изменён'); this.pw = this.pw2 = '';
      },
    },
    template: `
<div style="max-width:860px">
  <div class="page-head"><h1>Настройки</h1></div>
  <div class="stack" style="gap:16px">
    <div class="card stack">
      <h2 class="h2">Оформление</h2>
      <div class="muted small">Тема сохраняется в вашем профиле и работает на любом компьютере. У коллег может быть своя.</div>
      <div class="themes">
        <button v-for="t in themes" :key="t.id" class="theme-card" :class="{on: me.theme===t.id}" @click="setTheme(t.id)" :aria-pressed="me.theme===t.id">
          <div class="pv" :style="{background: t.bg}">
            <div class="s" :style="{background: t.side, borderRight: '1px solid ' + t.line}"></div>
            <div class="m"><i :style="{background: t.ink, width: '55%', height: '10px'}"></i><i :style="{background: t.line, width: '90%'}"></i><i :style="{background: t.line, width: '80%'}"></i><i :style="{background: t.acc, width: '30%', height: '14px', marginTop: 'auto'}"></i></div>
          </div>
          <div class="cap">{{ t.name }}{{ me.theme===t.id ? ' ✓' : '' }}</div>
        </button>
      </div>
    </div>
    <div class="card stack">
      <h2 class="h2">Профиль</h2>
      <div class="grid2"><label class="field"><span>Как вас подписывать</span><input class="input" v-model="name"></label><label class="field"><span>Почта</span><input class="input" :value="me.email" disabled></label></div>
      <div><button class="btn" @click="saveName">Сохранить имя</button></div>
    </div>
    <div v-if="mode!=='demo'" class="card stack">
      <h2 class="h2">Смена пароля</h2>
      <div class="grid2"><label class="field"><span>Новый пароль</span><input class="input" type="password" v-model="pw" autocomplete="new-password"></label><label class="field"><span>Ещё раз</span><input class="input" type="password" v-model="pw2" autocomplete="new-password"></label></div>
      <div><button class="btn" @click="savePw">Изменить пароль</button></div>
    </div>
  </div>
</div>`,
  };

  // ====================== 2.0 · ПЕРЕХОД В ДРУГОЕ ИЗДАНИЕ ======================
  const MoveModal = {
    mixins: [helpers], props: { m: Object },
    data() { return { outlet: '', role: '', busy: false, err: '' }; },
    computed: {
      c() { S.rev; return ix().contactById.get(this.m.id); },
      outletNames() { S.rev; return D.outlets.map(o => o.name); },
    },
    methods: {
      close() { S.modal = null; },
      async save() {
        const name = this.outlet.trim(); if (!name) { this.err = 'Укажите новое издание'; return; }
        this.busy = true; this.err = '';
        try {
          let o = D.outlets.find(x => norm(x.name) === norm(name));
          if (!o) { if (!confirm('Издания «' + name + '» нет в базе. Создать?')) { this.busy = false; return; } o = await actions.saveOutlet(null, { name, type: 'СМИ', topics: [], geo: ['Федеральные'] }); }
          if (o.id === this.c.outlet_id) { this.err = 'Журналист уже в этом издании'; this.busy = false; return; }
          await api.moveContact(this.c.id, o.id, this.role.trim());
          const moves = await api.movesFor(this.c.id);
          D.moves = markRaw(D.moves.filter(x => x.contact_id !== this.c.id).concat(moves));
          await actions.refreshRows('contacts', 'contacts', [this.c.id]);
          toast(this.c.name + ' теперь в «' + o.name + '». История сохранена');
          S.modal = null;
        } catch (e) { this.err = e.message; } finally { this.busy = false; }
      },
    },
    template: `
<div class="modal-back" @click.self="close"><form class="modal" @submit.prevent="save">
  <h3>{{ c.name }} перешёл(а) в другое издание</h3>
  <div class="muted">Сейчас: {{ outletName(c.outlet_id) }}{{ c.role ? ' · ' + c.role : '' }}. Заметки, питчи, отношение и теги переедут вместе с человеком, а в карточке появится строка «Карьера».</div>
  <label class="field"><span>Новое издание</span><input class="input" v-model="outlet" list="mk-move-outlets" placeholder="Начните вводить название" required></label>
  <datalist id="mk-move-outlets"><option v-for="n in outletNames" :key="n" :value="n"></option></datalist>
  <label class="field"><span>Новая должность (если знаете)</span><input class="input" v-model="role"></label>
  <div v-if="err" class="banner">{{ err }}</div>
  <div class="foot"><button type="button" class="btn ghost" @click="close">Отмена</button><button class="btn primary" :disabled="busy">Перенести</button></div>
</form></div>`,
  };

  // ====================== 2.0 · МАССОВОЕ РЕДАКТИРОВАНИЕ ======================
  const BulkEdit = {
    mixins: [helpers], props: { m: Object },
    data: () => ({ ct: {}, tg: {}, ot: {}, newTag: '', relation: '', outlet: '', oType: '', oTier: '', oGeo: '', busy: false, err: '' }),
    computed: {
      topics() { S.rev; return D.dict.topic; },
      tags() { S.rev; return D.dict.tag.concat(Object.keys(this.tg).filter(t => !D.dict.tag.includes(t))); },
      outletIds() { S.rev; return [...new Set(this.m.ids.map(id => (ix().contactById.get(id) || {}).outlet_id).filter(Boolean))]; },
      outletNames() { S.rev; return D.outlets.map(o => o.name); },
    },
    methods: {
      cyc(map, k) { const v = map[k]; const n = v === 'add' ? 'remove' : v === 'remove' ? undefined : 'add'; const c = Object.assign({}, map); if (n) c[k] = n; else delete c[k]; return c; },
      chipCls(v) { return v === 'add' ? 'chip x on' : v === 'remove' ? 'chip x' : 'chip x'; },
      chipStyle(v) { return v === 'remove' ? 'text-decoration: line-through; color: var(--danger); border-color: var(--danger)' : (v ? '' : 'opacity:.65'); },
      pre(v) { return v === 'add' ? '+ ' : v === 'remove' ? '− ' : ''; },
      addTag() { const t = this.newTag.trim(); if (t) this.tg = Object.assign({}, this.tg, { [t]: 'add' }); this.newTag = ''; },
      pick(map, v) { return Object.keys(map).filter(k => map[k] === v); },
      close() { S.modal = null; },
      async apply() {
        this.err = ''; this.busy = true;
        try {
          const cops = {}, oops = {};
          if (this.pick(this.ct, 'add').length) cops.topics_add = this.pick(this.ct, 'add');
          if (this.pick(this.ct, 'remove').length) cops.topics_remove = this.pick(this.ct, 'remove');
          if (this.pick(this.tg, 'add').length) cops.tags_add = this.pick(this.tg, 'add');
          if (this.pick(this.tg, 'remove').length) cops.tags_remove = this.pick(this.tg, 'remove');
          if (this.relation) cops.relation = this.relation;
          if (this.outlet.trim()) {
            const o = D.outlets.find(x => norm(x.name) === norm(this.outlet.trim()));
            if (!o) { this.err = 'Издание «' + this.outlet + '» не найдено. Создайте его сначала.'; this.busy = false; return; }
            cops.outlet_id = o.id;
          }
          if (this.pick(this.ot, 'add').length) oops.topics_add = this.pick(this.ot, 'add');
          if (this.pick(this.ot, 'remove').length) oops.topics_remove = this.pick(this.ot, 'remove');
          if (this.oType) oops.type = this.oType;
          if (this.oTier) oops.tier = this.oTier === 'none' ? '' : this.oTier;
          if (this.oGeo.trim()) oops.geo_set = splitList(this.oGeo);
          if (!Object.keys(cops).length && !Object.keys(oops).length) { this.err = 'Ничего не выбрано'; this.busy = false; return; }
          if (Object.keys(cops).length) { await api.bulkEditContacts(this.m.ids, cops); await actions.refreshRows('contacts', 'contacts', this.m.ids); }
          if (Object.keys(oops).length && this.outletIds.length) { await api.bulkEditOutlets(this.outletIds, oops); await actions.refreshRows('outlets', 'outlets', this.outletIds); }
          toast('Готово: изменено ' + this.m.ids.length + ' ' + plural(this.m.ids.length, 'контакт', 'контакта', 'контактов'));
          this.m.done && this.m.done(); S.modal = null;
        } catch (e) { this.err = e.message; } finally { this.busy = false; }
      },
    },
    template: `
<div class="modal-back" @click.self="close"><div class="modal wide">
  <h3>Изменить разом</h3>
  <div class="muted">Выбрано контактов: {{ m.ids.length }} (из {{ outletIds.length }} {{ outletIds.length === 1 ? 'издания' : 'изданий' }}). Клик по метке: <b>+ добавить</b> → <b style="color:var(--danger)">− убрать</b> → не трогать.</div>
  <div class="card stack">
    <h2 class="h2" style="margin:0">Контакты</h2>
    <div class="field"><span>Тематики</span><div><span v-for="t in topics" :key="t" :class="chipCls(ct[t])" :style="chipStyle(ct[t])" @click="ct = cyc(ct, t)">{{ pre(ct[t]) }}{{ t }}</span></div></div>
    <div class="field"><span>Теги</span><div><span v-for="t in tags" :key="t" :class="chipCls(tg[t])" :style="chipStyle(tg[t])" @click="tg = cyc(tg, t)">{{ pre(tg[t]) }}{{ t }}</span>
      <input class="input" style="width:180px; height:28px; display:inline-block" v-model="newTag" placeholder="свой тег + Enter" @keydown.enter.prevent="addTag" aria-label="Новый тег"></div></div>
    <div class="grid2">
      <label class="field"><span>Отношение</span><select class="select" v-model="relation"><option value="">не менять</option><option value="warm">Тёплый</option><option value="neutral">Нейтральный</option><option value="cold">Негатив</option></select></label>
      <label class="field"><span>Перенести в издание</span><input class="input" v-model="outlet" list="mk-bulk-outlets" placeholder="не менять"></label>
      <datalist id="mk-bulk-outlets"><option v-for="n in outletNames" :key="n" :value="n"></option></datalist>
    </div>
  </div>
  <div class="card stack">
    <h2 class="h2" style="margin:0">Их издания ({{ outletIds.length }})</h2>
    <div class="grid3">
      <label class="field"><span>Тип</span><select class="select" v-model="oType"><option value="">не менять</option><option>СМИ</option><option>Новые медиа</option><option>Блогеры</option></select></label>
      <label class="field"><span>Tier</span><select class="select" v-model="oTier"><option value="">не менять</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="none">убрать</option></select></label>
      <label class="field"><span>География (заменит текущую)</span><input class="input" v-model="oGeo" placeholder="не менять"></label>
    </div>
    <div class="field"><span>Тематики изданий</span><div><span v-for="t in topics" :key="t" :class="chipCls(ot[t])" :style="chipStyle(ot[t])" @click="ot = cyc(ot, t)">{{ pre(ot[t]) }}{{ t }}</span></div></div>
  </div>
  <div v-if="err" class="banner">{{ err }}</div>
  <div class="foot"><button class="btn ghost" @click="close">Отмена</button><button class="btn primary" :disabled="busy" @click="apply">{{ busy ? 'Применяем…' : 'Применить' }}</button></div>
</div></div>`,
  };

  // ====================== 2.0 · ДУБЛИ ======================
  const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  const latKey = s => norm(s).replace(/[а-яё]/g, ch => TR[ch] ?? ch).replace(/^(https?:\/\/)?(www\.)?/, '').replace(/[^a-z0-9]/g, '').replace(/(ru|com|rf)$/, '');
  const personKey = s => norm(s).replace(/[^а-яa-z\s-]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !/(вич|вна|ична|инична)$/.test(w)).sort().join(' ');
  const GENERIC_MAIL = /^(info|main|news|editor|editors|redaktor|redakciya|redaction|press|pr|office|mail|red|hello|reklama|adv|ads|support|post|letter|letters|newsroom|glav|glavred|smi)[\d._-]*@/i;
  function namesCompatible(a, b) {
    const ta = personKey(a).split(' ').filter(w => w.length > 2), tb = personKey(b).split(' ').filter(w => w.length > 2);
    if (ta.length < 2 || tb.length < 2) return true;          // у одного только имя — проверить глазами
    return ta.some(w => tb.includes(w)) && ta.filter(w => tb.includes(w)).length >= Math.min(ta.length, tb.length) - 0;
  }
  function findDupGroups(kind) {
    const ign = new Set(D.ignores.filter(x => x.kind === kind).map(x => x.a + ':' + x.b));
    const ignored = (a, b) => ign.has(Math.min(a, b) + ':' + Math.max(a, b));
    const strongB = new Map(), weakB = new Map();
    const add = (m, k, id, why) => { if (!m.has(k)) m.set(k, { ids: [], why }); m.get(k).ids.push(id); };
    const ids = [];
    if (kind === 'contact') {
      for (const c of D.contacts) {
        if (c.is_desk) continue; ids.push(c.id);
        for (const e of c.emails || []) if (!GENERIC_MAIL.test(e)) add(strongB, 'e:' + e.toLowerCase(), c.id, 'одинаковая почта');
        for (const p of c.phones || []) { const d = p.replace(/\D/g, ''); if (d.length >= 10) add(strongB, 'p:' + d.slice(-10), c.id, 'одинаковый телефон'); }
        for (const tg of c.telegram || []) add(strongB, 't:' + tg.toLowerCase(), c.id, 'одинаковый телеграм');
        const nk = personKey(c.name); if (nk.split(' ').length >= 2) add(weakB, 'n:' + nk, c.id, 'одинаковое имя');
      }
    } else {
      for (const o of D.outlets) {
        if (norm(o.name) === 'без издания') continue; ids.push(o.id);
        const w = safeUrl(o.website); if (w && !/t\.me|vk\.com|youtube|instagram|telegram/.test(w)) add(strongB, 'w:' + w.replace(/^https?:\/\/(www\.)?/, '').split('/')[0].toLowerCase(), o.id, 'один сайт');
        const k = latKey(o.name); if (k.length >= 3) add(weakB, 'n:' + k, o.id, 'похожее название');
      }
    }
    function build(buckets, maxSize) {
      const parent = new Map(ids.map(i => [i, i]));
      const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
      const why = new Map();
      for (const [, b] of buckets) {
        if (b.ids.length < 2 || b.ids.length > maxSize) continue; // общий ящик / коммутатор редакции — не дубль
        const [first, ...rest] = b.ids;
        for (const id of rest) {
          if (id === first || ignored(first, id)) continue;
          if (kind === 'contact' && b.why !== 'одинаковое имя' && !namesCompatible(ix().contactById.get(first).name, ix().contactById.get(id).name)) continue;
          const a = find(first), c = find(id); if (a !== c) parent.set(c, a);
          (why.get(first) || why.set(first, new Set()).get(first)).add(b.why);
        }
      }
      const groups = new Map();
      for (const id of ids) { const r = find(id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(id); }
      return [...groups.values()].filter(g => g.length > 1).map(g => {
        const w = new Set(); g.forEach(id => (why.get(id) || []).forEach(x => w.add(x)));
        return { ids: [...new Set(g)].sort((a, b) => a - b), why: [...w] };
      });
    }
    const strong = build(strongB, 3).map(g => Object.assign(g, { strong: true }));
    const inStrong = new Map(); strong.forEach((g, i) => g.ids.forEach(id => inStrong.set(id, i)));
    // совпадения только по имени: показываем, если люди ещё не попали в одну «точную» группу
    const weak = build(weakB, kind === 'contact' ? 4 : 6).filter(g => !(g.ids.every(id => inStrong.has(id) && inStrong.get(id) === inStrong.get(g.ids[0]))))
      .map(g => Object.assign(g, { strong: false }));
    return strong.concat(weak).sort((a, b) => (b.strong - a.strong) || (b.ids.length - a.ids.length));
  }

  const DupsView = {
    mixins: [helpers], components: { Ic },
    data: () => ({ kind: 'contact', limit: 20, keep: {}, off: {}, busy: false, rev: 0, bulkDone: 0, bulkTotal: 0 }),
    computed: {
      groups() { S.rev; this.rev; return findDupGroups(this.kind); },
      shown() { return this.groups.slice(0, this.limit); },
    },
    watch: { kind() { this.limit = 20; this.keep = {}; } },
    methods: {
      row(id) { return this.kind === 'contact' ? ix().contactById.get(id) : ix().outletById.get(id); },
      gk(g) { return g.ids.join('-'); },
      keepOf(g) {
        if (this.keep[this.gk(g)]) return this.keep[this.gk(g)];
        // по умолчанию главная — самая заполненная карточка
        const score = id => { const r = this.row(id) || {}; return this.kind === 'contact'
          ? (r.emails || []).length + (r.phones || []).length + (r.telegram || []).length + (r.comment ? 2 : 0) + ((ix().itemsByContact.get(id) || []).length * 3) + (r.relation !== 'neutral' ? 2 : 0)
          : (ix().byOutlet.get(id) || []).length; };
        return g.ids.slice().sort((a, b) => score(b) - score(a))[0];
      },
      setKeep(g, id) { this.keep = Object.assign({}, this.keep, { [this.gk(g)]: id }); const o = Object.assign({}, this.off); delete o[id]; this.off = o; },
      inc(id) { return !this.off[id]; },
      toggleInc(id) { this.off = Object.assign({}, this.off, { [id]: !this.off[id] }); },
      pitches(id) { return (ix().itemsByContact.get(id) || []).length; },
      async mergeAll() {
        const list = this.groups.filter(g => g.strong);
        if (!confirm('Объединить все точные дубли: ' + list.length + ' групп? Главной в каждой станет самая заполненная карточка. Совпадения только по имени останутся для ручной проверки.')) return;
        this.bulkDone = 0; this.bulkTotal = list.length;
        // фиксируем, кого вливать, до начала (список групп пересчитается только в конце)
        const plan = list.map(g => ({ ids: g.ids, keep: this.keepOf(g) }));
        for (const g of plan) { this.keep[g.ids.join('-')] = g.keep; await this.merge(g, true); this.bulkDone++; }
        await loadData();
        this.bulkTotal = 0; toast('Готово: объединено ' + list.length + ' групп');
      },
      async merge(g, quiet) {
        const keep = this.keepOf(g), drops = g.ids.filter(id => id !== keep && this.inc(id));
        if (!drops.length) { toast('Отметьте хотя бы одну карточку для объединения'); return; }
        this.busy = true;
        try {
          if (quiet) {
            for (const d of drops) await (this.kind === 'contact' ? api.mergeContacts(keep, d) : api.mergeOutlets(keep, d));
          } else if (this.kind === 'contact') {
            for (const d of drops) await api.mergeContacts(keep, d);
            const items = await api.itemsFor(keep);
            D.items = markRaw(D.items.filter(i => i.contact_id !== keep && !drops.includes(i.contact_id)).concat(items));
            D.moves.forEach(m => { if (drops.includes(m.contact_id)) m.contact_id = keep; });
            if (drops.some(d => D.favorites.has(d))) { drops.forEach(d => D.favorites.delete(d)); D.favorites.add(keep); }
            D.contacts = markRaw(D.contacts.filter(c => !drops.includes(c.id)));
            await actions.refreshRows('contacts', 'contacts', [keep]);
          } else {
            for (const d of drops) await api.mergeOutlets(keep, d);
            D.contacts.forEach(c => { if (drops.includes(c.outlet_id)) c.outlet_id = keep; });
            D.items.forEach(i => { if (drops.includes(i.outlet_id)) i.outlet_id = keep; });
            D.outlets = markRaw(D.outlets.filter(o => !drops.includes(o.id)));
            await actions.refreshRows('outlets', 'outlets', [keep]);
          }
          if (!quiet) toast('Объединено');
        } catch (e) { toast('Ошибка: ' + e.message); } finally { this.busy = false; }
      },
      async notDup(g) {
        this.busy = true;
        try {
          for (const a of g.ids) for (const b of g.ids) if (a < b) { await api.dupIgnore(this.kind, a, b); D.ignores.push({ kind: this.kind, a, b }); }
          this.rev++; toast('Больше не будем предлагать эту группу');
        } catch (e) { toast('Ошибка: ' + e.message); } finally { this.busy = false; }
      },
    },
    template: `
<div class="stack" style="gap:14px">
  <div class="row wrap">
    <div class="seg"><button :class="{on: kind==='contact'}" @click="kind='contact'">Журналисты</button><button :class="{on: kind==='outlet'}" @click="kind='outlet'">Издания</button></div>
    <span class="muted grow">Найдено групп: {{ groups.length }}, из них точных: {{ groups.filter(g => g.strong).length }}. Сначала идут точные совпадения (почта, телефон, телеграм, сайт), потом совпадения только по имени.</span>
    <button v-if="groups.some(g => g.strong)" class="btn" :disabled="busy || bulkTotal" @click="mergeAll">Объединить все точные</button>
  </div>
  <div v-if="bulkTotal" class="card stack"><div>Объединяем… {{ bulkDone }} из {{ bulkTotal }}. Не закрывайте вкладку.</div><div class="progress"><i :style="{width: (bulkDone / bulkTotal * 100) + '%'}"></i></div></div>
  <div v-if="!groups.length" class="empty">Дублей не найдено 🎉</div>
  <div v-for="g in shown" :key="gk(g)" class="card stack">
    <div class="row wrap"><span class="status" :class="g.strong ? 'interest' : ''">{{ g.strong ? 'точно дубль' : 'возможно' }}</span><span class="small muted">{{ g.why.join(', ') }}</span></div>
    <div class="scroll-x"><table class="tbl">
      <tbody>
        <tr v-for="id in g.ids" :key="id" :style="keepOf(g)===id ? 'background:var(--row-active)' : ''">
          <td style="width:30px" title="Главная карточка"><input type="radio" :name="'k' + gk(g)" :checked="keepOf(g)===id" @change="setKeep(g, id)" aria-label="Оставить главной"></td>
          <td style="width:30px" title="Участвует в объединении"><input type="checkbox" :checked="keepOf(g)===id || inc(id)" :disabled="keepOf(g)===id" @change="toggleInc(id)" aria-label="Включить в объединение"></td>
          <template v-if="kind==='contact'">
            <td><a href="#" @click.prevent="openContact(id)"><b>{{ row(id).name }}</b></a><div class="small muted">{{ row(id).role }}</div></td>
            <td>{{ outletName(row(id).outlet_id) }}</td>
            <td class="small">{{ (row(id).emails||[]).join(', ') }}<div>{{ (row(id).phones||[]).join(', ') }} {{ (row(id).telegram||[]).join(', ') }}</div></td>
            <td class="small muted">питчей: {{ pitches(id) }}<div>{{ (row(id).sources||[]).join(', ') }}</div></td>
          </template>
          <template v-else>
            <td><a href="#" @click.prevent="openOutlet(id)"><b>{{ row(id).name }}</b></a><div class="small muted">{{ row(id).website }}</div></td>
            <td>{{ typeLabel(row(id)) }}</td>
            <td class="small">{{ (row(id).geo||[]).join(', ') }}</td>
            <td class="small muted">контактов: {{ (ix().byOutlet.get(id)||[]).length }}</td>
          </template>
        </tr>
      </tbody>
    </table></div>
    <div class="row"><span class="small muted grow">● — главная карточка, в неё переедут заметки, питчи, контакты и всё недостающее. ☑ — кого вливаем (снимите галочку, если это другой человек).</span>
      <button class="btn" :disabled="busy" @click="notDup(g)">Это разные</button>
      <button class="btn primary" :disabled="busy" @click="merge(g)">Объединить</button></div>
  </div>
  <div v-if="groups.length > limit" class="more"><button class="btn" @click="limit += 20">Показать ещё ({{ groups.length - limit }})</button></div>
</div>`,
  };
  DupsView.methods.ix = () => ix();

  // ====================== 2.0 · КОРЗИНА ======================
  const TrashView = {
    mixins: [helpers], components: { Ic },
    data: () => ({ data: null, busy: false }),
    async created() { this.load(); },
    computed: {
      rows() {
        if (!this.data) return [];
        const L = { outlets: 'Издание', contacts: 'Контакт', campaigns: 'Инфоповод', clients: 'Клиент', mailing_lists: 'Рассылка' };
        return ['contacts', 'outlets', 'campaigns', 'clients', 'mailing_lists'].flatMap(t => (this.data[t] || []).map(r => ({ t, label: L[t], r, name: r.name || r.title, left: 30 - daysAgo(r.deleted_at) })))
          .sort((a, b) => b.r.deleted_at.localeCompare(a.r.deleted_at));
      },
    },
    methods: {
      async load() { this.data = await safe(() => api.trash()); },
      async restore(x) {
        this.busy = true;
        try {
          const row = await api.restore(x.t, x.r.id);
          if (x.t === 'contacts') { upsertLocal('contacts', row); const items = await api.itemsFor(row.id); D.items = markRaw(D.items.filter(i => i.contact_id !== row.id).concat(items)); rebuildIndex(); bump(); }
          else if (x.t === 'outlets') upsertLocal('outlets', row);
          else await loadData();
          toast('Восстановлено'); await this.load();
        } catch (e) { toast('Ошибка: ' + e.message); } finally { this.busy = false; }
      },
      async purge(x) {
        if (!confirm('Удалить «' + x.name + '» навсегда? Это нельзя отменить.')) return;
        await safe(() => api.remove(x.t, x.r.id), 'Удалено навсегда'); await this.load();
      },
    },
    template: `
<div class="stack" style="gap:14px">
  <div class="muted">Удалённое хранится здесь 30 дней, потом стирается автоматически.</div>
  <div v-if="!data" class="loading">Загружаем…</div>
  <div v-else-if="!rows.length" class="empty">Корзина пуста</div>
  <div v-else class="card scroll-x" style="padding:0"><table class="tbl">
    <thead><tr><th>Что</th><th>Название</th><th>Удалил(а)</th><th>Когда</th><th>Осталось</th><th></th></tr></thead>
    <tbody><tr v-for="x in rows" :key="x.t + x.r.id">
      <td class="small">{{ x.label }}</td><td><b>{{ x.name }}</b></td><td>{{ pname(x.r.deleted_by) }}</td><td>{{ fmtDate(x.r.deleted_at) }}</td>
      <td class="small">{{ x.left }} дн.</td>
      <td class="nowrap"><button class="btn sm" :disabled="busy" @click="restore(x)">Восстановить</button>
        <button class="btn ghost sm" style="color:var(--danger)" :disabled="busy" @click="purge(x)" aria-label="Удалить навсегда"><Ic n="trash"/></button></td>
    </tr></tbody></table></div>
</div>`,
  };

  // ====================== 2.0 · УВЕДОМЛЕНИЯ (колокольчик) ======================
  function dueFollowups() {
    S.tick; S.rev;
    const now = Date.now();
    return D.items.filter(i => i.owner === (S.me && S.me.id) && i.followup_at && ['sent', 'no_reply'].includes(i.status))
      .map(i => ({ i, due: new Date(i.followup_at).getTime() <= now }))
      .sort((a, b) => a.i.followup_at.localeCompare(b.i.followup_at));
  }
  const Bell = {
    mixins: [helpers], components: { Ic },
    data: () => ({ open: false }),
    computed: {
      fol() { return dueFollowups(); },
      due() { return this.fol.filter(x => x.due); },
      soon() { return this.fol.filter(x => !x.due).slice(0, 8); },
      ment() { S.rev; return D.notifs.filter(n => n.kind === 'mention').slice(0, 30); },
      unread() { S.rev; return D.notifs.filter(n => !n.read_at).length; },
      count() { return this.due.length + this.unread; },
      perm() { S.tick; try { return 'Notification' in window ? Notification.permission : 'unsupported'; } catch (e) { return 'unsupported'; } },
    },
    methods: {
      cname(id) { const c = ix().contactById.get(id); return c ? c.name : '—'; },
      camp(id) { const c = D.campaigns.find(x => x.id === id); return c ? c.title : ''; },
      async later(x, h) { await safe(() => actions.saveItem(x.i.id, { followup_at: h ? new Date(Date.now() + h * 3600e3).toISOString() : null }), h ? 'Напомню ' + followText(new Date(Date.now() + h * 3600e3)) : 'Готово'); },
      async openMention(n) {
        if (!n.read_at) { await api.markRead([n.id]).catch(() => {}); n.read_at = new Date().toISOString(); bump(); }
        this.open = false; if (n.contact_id) openContact(n.contact_id);
      },
      async readAll() { const ids = D.notifs.filter(n => !n.read_at).map(n => n.id); await safe(() => api.markRead(ids)); D.notifs.forEach(n => { n.read_at = n.read_at || new Date().toISOString(); }); bump(); },
      openC(id) { this.open = false; openContact(id); },
      ask() { try { Notification.requestPermission().then(() => { S.tick = Date.now(); }); } catch (e) {} },
    },
    template: `
<div style="position:relative">
  <button class="icon-btn" :aria-label="'Уведомления: ' + count" @click="open = !open" style="position:relative">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>
    <span v-if="count" style="position:absolute; top:2px; right:2px; min-width:16px; height:16px; border-radius:8px; background:var(--accent); color:var(--accent-ink); font-size:10px; line-height:16px; text-align:center; padding:0 4px; font-weight:600">{{ count }}</span>
  </button>
  <div v-if="open" class="card" style="position:absolute; left:0; top:38px; width:360px; max-height:70vh; overflow-y:auto; z-index:40; box-shadow:var(--shadow); padding:14px">
    <div class="row" style="margin-bottom:8px"><b class="grow">Уведомления</b><button class="icon-btn" aria-label="Закрыть" @click="open=false"><Ic n="close"/></button></div>
    <div v-if="perm==='default'" class="banner info small" style="margin-bottom:8px">Включите уведомления браузера, чтобы напоминания всплывали, даже когда вкладка свёрнута. <a href="#" @click.prevent="ask">Включить</a></div>
    <div class="section-title">Пора дожать</div>
    <div v-for="x in due" :key="x.i.id" class="note">
      <a href="#" @click.prevent="openC(x.i.contact_id)"><b>{{ cname(x.i.contact_id) }}</b></a>
      <div class="meta">«{{ camp(x.i.campaign_id) }}» · отправлено {{ agoText(x.i.sent_at) }}</div>
      <div class="row" style="margin-top:4px"><button class="btn sm" @click="later(x, 0)">Готово</button><button class="btn ghost sm" @click="later(x, 1)">+1 ч</button><button class="btn ghost sm" @click="later(x, 24)">Завтра</button></div>
    </div>
    <div v-if="!due.length" class="muted small" style="margin-bottom:6px">Сейчас дожимать некого.</div>
    <template v-if="soon.length"><div class="section-title" style="margin-top:10px">Скоро</div>
      <div v-for="x in soon" :key="x.i.id" class="note small"><a href="#" @click.prevent="openC(x.i.contact_id)">{{ cname(x.i.contact_id) }}</a> <span class="meta">⏰ {{ followText(x.i.followup_at) }}</span></div></template>
    <div class="row" style="margin-top:12px"><div class="section-title grow" style="margin:0">Упоминания</div><a v-if="unread" href="#" class="small" @click.prevent="readAll">прочитать все</a></div>
    <div v-for="n in ment" :key="n.id" class="note" style="cursor:pointer" @click="openMention(n)" :style="n.read_at ? 'opacity:.6' : ''">
      <div><b>{{ pname(n.created_by) }}</b> упомянул(а) вас · {{ cname(n.contact_id) }} <span class="meta">{{ fmtShort(n.created_at) }}</span></div>
      <div class="small" style="white-space:pre-line">{{ (n.text || '').slice(0, 160) }}</div>
    </div>
    <div v-if="!ment.length" class="muted small">Вас ещё не упоминали.</div>
  </div>
</div>`,
  };
  Bell.methods.followText = followText;
  Nav.components.Bell = Bell;

  // ====================== 2.0 · КЛИЕНТЫ ======================
  function clientStats(clientId) {
    const camps = D.campaigns.filter(c => c.client_id === clientId);
    const ids = new Set(camps.map(c => c.id));
    const items = D.items.filter(i => ids.has(i.campaign_id));
    const f = funnel(items);
    return { camps, items, f, pubs: items.filter(i => i.status === 'published'), lists: D.lists.filter(l => l.client_id === clientId) };
  }
  const ClientsView = {
    mixins: [helpers], components: { Ic },
    data: () => ({ q: '' }),
    computed: {
      list() {
        S.rev; const q = norm(this.q);
        return D.clients.filter(c => !q || norm(c.name).includes(q)).map(c => ({ c, s: clientStats(c.id) }))
          .sort((a, b) => (a.c.archived - b.c.archived) || a.c.name.localeCompare(b.c.name, 'ru'));
      },
    },
    methods: {
      async create() {
        const name = (prompt('Название клиента') || '').trim(); if (!name) return;
        if (D.clients.some(c => norm(c.name) === norm(name))) { toast('Такой клиент уже есть'); return; }
        const row = await safe(() => api.insert('clients', { name })); D.clients.push(row); rebuildIndex(); bump();
        go('client', { clientId: row.id });
      },
    },
    template: `
<div>
  <div class="page-head"><div><h1>Клиенты</h1><div class="muted small" style="margin-top:6px">Все инфоповоды, рассылки и публикации клиента в одном месте</div></div>
    <button class="btn primary" @click="create"><Ic n="plus"/> Клиент</button></div>
  <input class="input" style="max-width:320px; margin-bottom:14px" v-model="q" placeholder="Найти клиента" aria-label="Найти клиента">
  <div v-if="!list.length" class="empty">Клиентов пока нет. Они появятся сами, когда вы укажете клиента в инфоповоде.</div>
  <div class="card scroll-x" style="padding:0" v-else><table class="tbl" style="min-width:640px">
    <thead><tr><th>Клиент</th><th>Инфоповоды</th><th>Питчей</th><th>Интерес</th><th>Публикации</th><th>Рассылки</th></tr></thead>
    <tbody><tr v-for="x in list" :key="x.c.id" class="click" @click="go('client', {clientId: x.c.id})" :style="x.c.archived ? 'opacity:.55' : ''">
      <td><b>{{ x.c.name }}</b><span v-if="x.c.archived" class="small muted"> · архив</span></td>
      <td class="mono">{{ x.s.camps.length }}</td><td class="mono">{{ x.s.f.sentAll }}</td><td class="mono">{{ x.s.f.interest }}</td><td class="mono">{{ x.s.f.published }}</td><td class="mono">{{ x.s.lists.length }}</td>
    </tr></tbody></table></div>
</div>`,
  };

  const ClientView = {
    mixins: [helpers], components: { Ic },
    data: () => ({ editNote: false, note: '' }),
    computed: {
      c() { S.rev; return D.clients.find(x => x.id === S.clientId); },
      s() { S.rev; return clientStats(S.clientId); },
      camps() { return this.s.camps.slice().sort((a, b) => (b.pitch_date || b.created_at || '').localeCompare(a.pitch_date || a.created_at || '')).map(c => ({ c, f: funnel(ix().itemsByCampaign.get(c.id) || []) })); },
      pubs() {
        return this.s.pubs.map(i => ({ i, c: ix().contactById.get(i.contact_id), o: ix().outletById.get(i.outlet_id || (ix().contactById.get(i.contact_id) || {}).outlet_id), camp: D.campaigns.find(x => x.id === i.campaign_id) }))
          .sort((a, b) => (b.i.updated_at || '').localeCompare(a.i.updated_at || ''));
      },
    },
    methods: {
      async rename() {
        const name = (prompt('Название клиента', this.c.name) || '').trim(); if (!name || name === this.c.name) return;
        const row = await safe(() => api.update('clients', this.c.id, { name }), 'Сохранено'); Object.assign(this.c, row);
        for (const cp of this.s.camps) { cp.client = name; api.update('campaigns', cp.id, { client: name }).catch(() => {}); }
        bump();
      },
      startNote() { this.note = this.c.note || ''; this.editNote = true; },
      async saveNote() { const row = await safe(() => api.update('clients', this.c.id, { note: this.note.trim() || null }), 'Сохранено'); Object.assign(this.c, row); this.editNote = false; bump(); },
      async archive() { const row = await safe(() => api.update('clients', this.c.id, { archived: !this.c.archived })); Object.assign(this.c, row); bump(); },
      async del() {
        if (!confirm('Убрать клиента «' + this.c.name + '» в корзину? Инфоповоды и рассылки останутся.')) return;
        await safe(() => api.softDelete('clients', this.c.id), 'Клиент в корзине'); D.clients = markRaw(D.clients.filter(x => x.id !== this.c.id)); rebuildIndex(); bump(); go('clients');
      },
      newCamp() { S.modal = { kind: 'campaignForm', id: null, clientName: this.c.name }; },
      newList() { S.modal = { kind: 'listForm', id: null, clientId: this.c.id }; },
      meId: () => S.me.id,
    },
    template: `
<div v-if="c">
  <div class="page-head">
    <div class="grow"><a href="#" class="small" @click.prevent="go('clients')">← Все клиенты</a><h1 style="margin-top:6px">{{ c.name }}</h1>
      <div class="muted small" style="margin-top:6px">{{ s.camps.length }} инфоповодов · {{ s.f.sentAll }} питчей · {{ s.f.published }} публикаций<template v-if="c.archived"> · в архиве</template></div></div>
    <div class="row wrap">
      <button class="btn primary" @click="newCamp"><Ic n="plus"/> Инфоповод</button>
      <button class="btn" @click="newList"><Ic n="plus"/> Рассылка</button>
      <button class="btn" @click="rename"><Ic n="edit"/> Переименовать</button>
      <button class="btn" @click="archive">{{ c.archived ? 'Из архива' : 'В архив' }}</button>
      <button v-if="isAdmin() || c.created_by === meId()" class="btn ghost" style="color:var(--danger)" aria-label="В корзину" @click="del"><Ic n="trash"/></button>
    </div>
  </div>
  <div class="funnel" style="margin-bottom:16px">
    <div class="f"><b>{{ s.camps.length }}</b><span>инфоповодов</span></div>
    <div class="f"><b>{{ s.f.sentAll }}</b><span>отправлено питчей</span></div>
    <div class="f"><b>{{ s.f.interest }}</b><span>интерес</span></div>
    <div class="f"><b>{{ s.f.published }}</b><span>публикаций</span></div>
    <div class="f"><b>{{ s.f.sentAll ? Math.round(s.f.replied / s.f.sentAll * 100) : 0 }}%</b><span>ответили</span></div>
  </div>
  <div class="card stack" style="margin-bottom:16px">
    <div class="row"><h2 class="h2 grow" style="margin:0">О клиенте</h2><a v-if="!editNote" href="#" class="small" @click.prevent="startNote">{{ c.note ? 'изменить' : 'добавить' }}</a></div>
    <template v-if="editNote"><textarea class="textarea" v-model="note" placeholder="Контактные лица, особенности согласования, ключевые сообщения, кого не трогать"></textarea>
      <div class="row"><button class="btn primary sm" @click="saveNote">Сохранить</button><button class="btn ghost sm" @click="editNote=false">Отмена</button></div></template>
    <div v-else-if="c.note" style="white-space:pre-line">{{ c.note }}</div><div v-else class="muted small">Пока пусто.</div>
  </div>
  <div class="dash">
    <div class="card"><h2 class="h2">Инфоповоды</h2>
      <div v-for="x in camps" :key="x.c.id" class="note" style="cursor:pointer" @click="go('campaign', {campaignId: x.c.id})">
        <div class="row"><b class="grow">{{ x.c.title }}</b><span class="small muted">{{ fmtDate(x.c.pitch_date || x.c.created_at) }}</span></div>
        <div class="meta">{{ x.f.total }} в медиалисте · {{ x.f.sentAll }} отправлено · {{ x.f.interest }} интерес · {{ x.f.published }} вышло<template v-if="x.c.archived"> · архив</template></div>
      </div>
      <div v-if="!camps.length" class="muted small">Инфоповодов пока нет.</div>
    </div>
    <div class="card"><h2 class="h2">Публикации</h2>
      <div v-for="x in pubs" :key="x.i.id" class="note">
        <div><b>{{ x.o ? x.o.name : '—' }}</b> · {{ x.c ? x.c.name : '' }}</div>
        <div class="meta">«{{ x.camp ? x.camp.title : '' }}»<template v-if="safeUrl(x.i.publication_url)"> · <a :href="safeUrl(x.i.publication_url)" target="_blank" rel="noopener">ссылка ↗</a></template></div>
      </div>
      <div v-if="!pubs.length" class="muted small">Публикаций пока нет.</div>
    </div>
    <div class="card"><h2 class="h2">Рассылки</h2>
      <div v-for="l in s.lists" :key="l.id" class="note" style="cursor:pointer" @click="go('mailing', {listId: l.id})"><b>{{ l.name }}</b> <span class="meta">{{ l.kind === 'dynamic' ? 'живой список' : 'список' }}</span></div>
      <div v-if="!s.lists.length" class="muted small">Рассылок пока нет.</div>
    </div>
  </div>
</div>
<div v-else class="empty">Клиент не найден. <a href="#" @click.prevent="go('clients')">К списку</a></div>`,
  };

  // ====================== 2.0 · РАССЫЛКИ ======================
  const NO_MAIL_TAG = 'не любит рассылки';
  function listMembers(l) {
    const X = ix();
    if (l.kind === 'dynamic') {
      const f = l.filter || {};
      return D.contacts.filter(c => {
        if (c.is_desk && !f.desks) return false;
        const o = X.outletById.get(c.outlet_id);
        if (f.type && (!o || o.type !== f.type)) return false;
        if (f.tier && (!o || String(o.tier) !== String(f.tier))) return false;
        if (f.geo && (!o || !(o.geo || []).includes(f.geo))) return false;
        if (f.relation && c.relation !== f.relation) return false;
        if (f.topic && !((c.topics || []).includes(f.topic) || (o && (o.topics || []).includes(f.topic)))) return false;
        if (f.tag && !(c.tags || []).includes(f.tag)) return false;
        return true;
      });
    }
    return (X.membersByList.get(l.id) || []).map(id => X.contactById.get(id)).filter(Boolean);
  }
  function recipients(l) {
    const seen = new Set(), ok = [], excluded = [];
    for (const c of listMembers(l)) {
      const email = (c.emails || [])[0];
      let why = '';
      if (!email) why = 'нет почты';
      else if (c.unsubscribed) why = 'отписался';
      else if ((c.tags || []).includes(NO_MAIL_TAG)) why = 'не любит рассылки';
      else if (c.relation === 'cold') why = 'негатив';
      else if (c.inactive) why = 'не работает';
      else if (seen.has(email.toLowerCase())) why = 'почта уже в списке';
      if (why) excluded.push({ c, why }); else { seen.add(email.toLowerCase()); ok.push({ c, email }); }
    }
    return { ok, excluded };
  }

  const ListForm = {
    mixins: [helpers], props: { m: Object },
    data() {
      const l = this.m.id ? D.lists.find(x => x.id === this.m.id) : null;
      const cl = l ? D.clients.find(c => c.id === l.client_id) : D.clients.find(c => c.id === this.m.clientId);
      return { name: l ? l.name : '', client: cl ? cl.name : '', kind: l ? l.kind : 'static', note: l ? l.note || '' : '', clients: D.clients.map(c => c.name), busy: false, err: '' };
    },
    methods: {
      close() { S.modal = null; },
      async save() {
        if (!this.name.trim()) { this.err = 'Назовите список'; return; }
        this.busy = true;
        try {
          let cl = this.client.trim() ? D.clients.find(c => norm(c.name) === norm(this.client.trim())) : null;
          if (this.client.trim() && !cl) { cl = await api.insert('clients', { name: this.client.trim() }); D.clients.push(cl); }
          const patch = { name: this.name.trim(), client_id: cl ? cl.id : null, kind: this.kind, note: this.note.trim() || null };
          let row;
          if (this.m.id) { row = await api.update('mailing_lists', this.m.id, patch); Object.assign(D.lists.find(x => x.id === row.id), row); }
          else { row = await api.insert('mailing_lists', Object.assign({ filter: { desks: true } }, patch)); D.lists.push(row); }
          rebuildIndex(); bump(); S.modal = null;
          if (this.m.thenAdd) await actions.addToList(row.id, this.m.thenAdd);
          go('mailing', { listId: row.id });
        } catch (e) { this.err = e.message; } finally { this.busy = false; }
      },
    },
    template: `
<div class="modal-back" @click.self="close"><form class="modal" @submit.prevent="save">
  <h3>{{ m.id ? 'Настройки рассылки' : 'Новый список рассылки' }}</h3>
  <label class="field"><span>Название *</span><input class="input" v-model="name" required placeholder="Например: Финтех · деловые СМИ"></label>
  <label class="field"><span>Клиент</span><input class="input" v-model="client" list="mk-clients2" placeholder="необязательно"></label>
  <datalist id="mk-clients2"><option v-for="n in clients" :key="n" :value="n"></option></datalist>
  <div class="field"><span>Тип списка</span><div class="seg">
    <button type="button" :class="{on: kind==='static'}" @click="kind='static'">Ручной</button>
    <button type="button" :class="{on: kind==='dynamic'}" @click="kind='dynamic'">Живой (по фильтру)</button></div>
    <div class="small muted" style="margin-top:4px">{{ kind==='static' ? 'Вы сами добавляете людей. Список не меняется без вас.' : 'Список собирается по фильтру и сам подхватывает новых журналистов из базы.' }}</div></div>
  <label class="field"><span>Заметка</span><textarea class="textarea" v-model="note" style="min-height:60px"></textarea></label>
  <div v-if="err" class="banner">{{ err }}</div>
  <div class="foot"><button type="button" class="btn ghost" @click="close">Отмена</button><button class="btn primary" :disabled="busy">Сохранить</button></div>
</form></div>`,
  };

  const AddToList = {
    mixins: [helpers], props: { m: Object },
    data: () => ({ lid: '', busy: false }),
    computed: { lists() { S.rev; return D.lists.filter(l => l.kind === 'static').sort((a, b) => a.name.localeCompare(b.name, 'ru')); } },
    created() { if (this.lists.length) this.lid = this.lists[0].id; },
    methods: {
      close() { S.modal = null; },
      clientName(id) { const c = ix().clientById.get(id); return c ? ' · ' + c.name : ''; },
      async add() {
        this.busy = true;
        try { const r = await actions.addToList(+this.lid, this.m.ids); toast('Добавлено в рассылку: ' + r.added); this.m.done && this.m.done(); S.modal = null; }
        catch (e) { toast('Ошибка: ' + e.message); } finally { this.busy = false; }
      },
      create() { S.modal = { kind: 'listForm', id: null, thenAdd: this.m.ids.slice() }; },
    },
    template: `
<div class="modal-back" @click.self="close"><div class="modal">
  <h3>Добавить в рассылку</h3>
  <div class="muted">Контактов: {{ m.ids.length }}</div>
  <label v-if="lists.length" class="field"><span>Список</span><select class="select" v-model="lid"><option v-for="l in lists" :key="l.id" :value="l.id">{{ l.name }}{{ clientName(l.client_id) }}</option></select></label>
  <div v-else class="muted">Ручных списков пока нет.</div>
  <div class="foot"><button class="btn" @click="create">+ Новый список</button><span class="grow"></span><button class="btn ghost" @click="close">Отмена</button><button class="btn primary" :disabled="!lid || busy" @click="add">Добавить</button></div>
</div></div>`,
  };

  const MailingsView = {
    mixins: [helpers], components: { Ic },
    data: () => ({ client: '' }),
    computed: {
      clients() { S.rev; return D.clients; },
      list() {
        S.rev; return D.lists.filter(l => !this.client || String(l.client_id) === this.client)
          .map(l => { const r = recipients(l); const last = D.sends.filter(s => s.list_id === l.id).sort((a, b) => b.sent_at.localeCompare(a.sent_at))[0]; return { l, n: r.ok.length, ex: r.excluded.length, last }; })
          .sort((a, b) => a.l.name.localeCompare(b.l.name, 'ru'));
      },
    },
    methods: {
      create() { S.modal = { kind: 'listForm', id: null, clientId: this.client ? +this.client : null }; },
      cname(id) { const c = ix().clientById.get(id); return c ? c.name : 'без клиента'; },
    },
    template: `
<div>
  <div class="page-head"><div><h1>Рассылки</h1><div class="muted small" style="margin-top:6px">Списки для массовой рассылки релизов. Адреса копируются пачками, «не любит рассылки», «отписался» и «негатив» исключаются сами.</div></div>
    <button class="btn primary" @click="create"><Ic n="plus"/> Список</button></div>
  <select class="fselect" :class="{set: client}" v-model="client" aria-label="Клиент" style="margin-bottom:14px"><option value="">Все клиенты</option><option v-for="c in clients" :key="c.id" :value="String(c.id)">{{ c.name }}</option></select>
  <div v-if="!list.length" class="empty">Списков пока нет. Создайте список или отметьте журналистов на Медиакарте и нажмите «В рассылку».</div>
  <div v-else class="card scroll-x" style="padding:0"><table class="tbl" style="min-width:640px">
    <thead><tr><th>Список</th><th>Клиент</th><th>Тип</th><th>Получателей</th><th>Исключено</th><th>Последняя рассылка</th></tr></thead>
    <tbody><tr v-for="x in list" :key="x.l.id" class="click" @click="go('mailing', {listId: x.l.id})">
      <td><b>{{ x.l.name }}</b></td><td>{{ cname(x.l.client_id) }}</td><td class="small">{{ x.l.kind==='dynamic' ? 'живой' : 'ручной' }}</td>
      <td class="mono">{{ x.n }}</td><td class="mono muted">{{ x.ex }}</td><td class="small">{{ x.last ? fmtDate(x.last.sent_at) + ' · ' + pname(x.last.sent_by) : '—' }}</td>
    </tr></tbody></table></div>
</div>`,
  };

  const MailingView = {
    mixins: [helpers], components: { Ic },
    data: () => ({ batch: 50, showEx: false, q: '', sending: false, campId: '' }),
    computed: {
      l() { S.rev; return D.lists.find(x => x.id === S.listId); },
      r() { S.rev; return this.l ? recipients(this.l) : { ok: [], excluded: [] }; },
      batches() { const out = []; for (let i = 0; i < this.r.ok.length; i += this.batch) out.push({ from: i + 1, to: Math.min(i + this.batch, this.r.ok.length), emails: this.r.ok.slice(i, i + this.batch).map(x => x.email) }); return out; },
      shown() { const q = norm(this.q); return this.r.ok.filter(x => !q || norm(x.c.name + ' ' + x.email + ' ' + this.outletName(x.c.outlet_id)).includes(q)).slice(0, 300); },
      sends() { S.rev; return D.sends.filter(s => s.list_id === S.listId).sort((a, b) => b.sent_at.localeCompare(a.sent_at)); },
      camps() { S.rev; return D.campaigns.filter(c => !c.archived && (!this.l.client_id || c.client_id === this.l.client_id || !c.client_id)); },
      f() { return this.l.filter || {}; },
      topics() { S.rev; return D.dict.topic; }, tags() { S.rev; return D.dict.tag; },
      geos() { S.rev; const s = new Set(); D.outlets.forEach(o => (o.geo || []).forEach(g => s.add(g))); return [...s].sort(); },
      client() { S.rev; return this.l && ix().clientById.get(this.l.client_id); },
    },
    methods: {
      async setF(k, v) {
        const filter = Object.assign({}, this.f, { [k]: v }); if (v === '' || v === false) delete filter[k];
        const row = await safe(() => api.update('mailing_lists', this.l.id, { filter })); Object.assign(this.l, row); bump();
      },
      copyBatch(b) { copy(b.emails.join(', '), 'Адреса ' + b.from + '–' + b.to); },
      async remove(x) { await safe(() => api.removeMember(this.l.id, x.c.id)); D.members = markRaw(D.members.filter(m => !(m.list_id === this.l.id && m.contact_id === x.c.id))); rebuildIndex(); bump(); },
      pick() { S.modal = { kind: 'picker', listId: this.l.id }; },
      edit() { S.modal = { kind: 'listForm', id: this.l.id }; },
      async del() {
        if (!confirm('Убрать список «' + this.l.name + '» в корзину?')) return;
        await safe(() => api.softDelete('mailing_lists', this.l.id), 'Список в корзине'); D.lists = markRaw(D.lists.filter(x => x.id !== this.l.id)); rebuildIndex(); bump(); go('mailings');
      },
      async markSent() {
        if (!this.r.ok.length) return;
        if (!confirm('Отметить, что рассылка по списку «' + this.l.name + '» ушла ' + this.r.ok.length + ' получателям?' + (this.campId ? ' Они попадут в медиалист инфоповода со статусом «Отправлено».' : ''))) return;
        this.sending = true;
        try {
          const ids = this.r.ok.map(x => x.c.id);
          const s = await api.insert('mailing_sends', { list_id: this.l.id, list_name: this.l.name, campaign_id: this.campId ? +this.campId : null, contact_ids: ids, sent_by: S.me.id });
          D.sends.push(s);
          if (this.campId) {
            const now = new Date().toISOString();
            const have = new Set((ix().itemsByCampaign.get(+this.campId) || []).map(i => i.contact_id));
            const rows = ids.filter(id => !have.has(id)).map(id => ({ campaign_id: +this.campId, contact_id: id, owner: S.me.id, status: 'sent', channel: 'email', sent_at: now, note: 'рассылка «' + this.l.name + '»' }));
            const res = await api.insertMany('campaign_items', rows); for (const r of res) D.items.push(r);
          }
          rebuildIndex(); bump(); toast('Записали рассылку в историю ' + ids.length + ' журналистов');
        } catch (e) { toast('Ошибка: ' + e.message); } finally { this.sending = false; }
      },
      async exportX() { await exportXlsx('Рассылка — ' + this.l.name.replace(/[\\/:*?"<>|]/g, '') + '.xlsx', [['Получатели', this.r.ok.map(x => contactRow(x.c))], ['Исключены', this.r.excluded.map(x => Object.assign({ 'Причина': x.why }, contactRow(x.c)))]]); },
      campTitle(id) { const c = D.campaigns.find(x => x.id === id); return c ? c.title : ''; },
    },
    template: `
<div v-if="l">
  <div class="page-head">
    <div class="grow"><a href="#" class="small" @click.prevent="go('mailings')">← Все рассылки</a><h1 style="margin-top:6px">{{ l.name }}</h1>
      <div class="muted small" style="margin-top:6px">{{ l.kind==='dynamic' ? 'Живой список' : 'Ручной список' }}<template v-if="client"> · <a href="#" @click.prevent="go('client', {clientId: client.id})">{{ client.name }}</a></template> · создал(а) {{ pname(l.created_by) }}</div></div>
    <div class="row wrap">
      <button v-if="l.kind==='static'" class="btn primary" @click="pick"><Ic n="plus"/> Журналисты</button>
      <button class="btn" @click="edit"><Ic n="edit"/> Настройки</button>
      <button class="btn" @click="exportX"><Ic n="down"/> Excel</button>
      <button class="btn ghost" style="color:var(--danger)" aria-label="В корзину" @click="del"><Ic n="trash"/></button>
    </div>
  </div>
  <div v-if="l.note" class="comment-box" style="margin-bottom:14px">{{ l.note }}</div>

  <div v-if="l.kind==='dynamic'" class="card stack" style="margin-bottom:14px">
    <h2 class="h2" style="margin:0">Фильтр списка</h2>
    <div class="row wrap">
      <select class="fselect" :class="{set: f.type}" :value="f.type || ''" @change="setF('type', $event.target.value)" aria-label="Тип"><option value="">Все типы</option><option>СМИ</option><option>Новые медиа</option><option>Блогеры</option></select>
      <select class="fselect" :class="{set: f.topic}" :value="f.topic || ''" @change="setF('topic', $event.target.value)" aria-label="Тематика"><option value="">Тематика</option><option v-for="t in topics" :key="t">{{ t }}</option></select>
      <select class="fselect" :class="{set: f.geo}" :value="f.geo || ''" @change="setF('geo', $event.target.value)" aria-label="География"><option value="">География</option><option v-for="g in geos" :key="g">{{ g }}</option></select>
      <select class="fselect" :class="{set: f.tier}" :value="f.tier || ''" @change="setF('tier', $event.target.value)" aria-label="Tier"><option value="">Tier</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select>
      <select class="fselect" :class="{set: f.relation}" :value="f.relation || ''" @change="setF('relation', $event.target.value)" aria-label="Отношение"><option value="">Отношение</option><option value="warm">Тёплые</option><option value="neutral">Нейтральные</option></select>
      <select class="fselect" :class="{set: f.tag}" :value="f.tag || ''" @change="setF('tag', $event.target.value)" aria-label="Тег"><option value="">Тег</option><option v-for="t in tags" :key="t">{{ t }}</option></select>
      <label class="toggle"><input type="checkbox" :checked="!!f.desks" @change="setF('desks', $event.target.checked)"> С общими ящиками редакций</label>
    </div>
  </div>

  <div class="card stack" style="margin-bottom:14px">
    <div class="row wrap"><h2 class="h2 grow" style="margin:0">Копировать адреса</h2>
      <span class="small muted">по</span><select class="select" style="width:90px; height:32px" v-model.number="batch" aria-label="Размер пачки"><option :value="30">30</option><option :value="50">50</option><option :value="100">100</option></select><span class="small muted">в пачке</span></div>
    <div class="muted small">Получателей: <b>{{ r.ok.length }}</b>. Вставляйте адреса в поле «Скрытая копия» (BCC), чтобы журналисты не видели друг друга. Почтовики режут письма, в которых больше 50–100 получателей.</div>
    <div class="row wrap"><button v-for="b in batches" :key="b.from" class="btn" @click="copyBatch(b)"><Ic n="copy"/> {{ b.from }}–{{ b.to }}</button></div>
    <div class="row wrap" style="border-top:1px solid var(--line); padding-top:10px">
      <span class="small">Разослали?</span>
      <select class="select" style="max-width:320px; height:34px" v-model="campId" aria-label="Инфоповод"><option value="">без привязки к инфоповоду</option><option v-for="c in camps" :key="c.id" :value="String(c.id)">в медиалист: {{ c.title }}</option></select>
      <button class="btn primary sm" :disabled="sending || !r.ok.length" @click="markSent"><Ic n="check"/> Отметить: разослано</button>
    </div>
  </div>

  <div class="row wrap" style="margin-bottom:8px"><input class="input" style="max-width:280px; height:34px" v-model="q" placeholder="Найти в списке" aria-label="Найти в списке">
    <a v-if="r.excluded.length" href="#" class="small" @click.prevent="showEx=!showEx">{{ showEx ? 'Скрыть' : 'Показать' }} исключённых ({{ r.excluded.length }})</a></div>
  <div v-if="showEx" class="card scroll-x" style="padding:0; margin-bottom:12px"><table class="tbl"><tbody>
    <tr v-for="x in r.excluded" :key="x.c.id" class="click" @click="openContact(x.c.id)"><td><b>{{ x.c.name }}</b></td><td>{{ outletName(x.c.outlet_id) }}</td><td class="small"><span class="status declined">{{ x.why }}</span></td></tr>
  </tbody></table></div>
  <div class="card scroll-x" style="padding:0"><table class="tbl" style="min-width:640px">
    <thead><tr><th>Журналист</th><th>Издание</th><th>Почта</th><th v-if="l.kind==='static'"></th></tr></thead>
    <tbody><tr v-for="x in shown" :key="x.c.id">
      <td><a href="#" @click.prevent="openContact(x.c.id)"><b>{{ x.c.name }}</b></a> <span class="small muted">{{ x.c.role }}</span></td>
      <td>{{ outletName(x.c.outlet_id) }}</td><td class="small">{{ x.email }}</td>
      <td v-if="l.kind==='static'"><button class="icon-btn" aria-label="Убрать из списка" @click="remove(x)"><Ic n="close"/></button></td>
    </tr></tbody></table>
    <div v-if="!r.ok.length" class="empty">{{ l.kind==='static' ? 'Список пуст. Добавьте журналистов кнопкой сверху или с Медиакарты.' : 'Под фильтр никто не попал.' }}</div>
    <div v-if="r.ok.length > 300 && shown.length === 300" class="small muted" style="padding:8px">Показаны первые 300. Копирование и выгрузка работают по всему списку.</div>
  </div>
  <div v-if="sends.length" class="card" style="margin-top:14px"><h2 class="h2">История рассылок</h2>
    <div v-for="s in sends" :key="s.id" class="note small">{{ fmtDate(s.sent_at) }} · {{ pname(s.sent_by) }} · {{ (s.contact_ids||[]).length }} получателей<template v-if="s.campaign_id"> · инфоповод «{{ campTitle(s.campaign_id) }}»</template></div></div>
</div>
<div v-else class="empty">Список не найден. <a href="#" @click.prevent="go('mailings')">К рассылкам</a></div>`,
  };

  // ====================== 2.0 · АКТУАЛИЗАЦИЯ ======================
  const VerifyView = {
    mixins: [helpers], components: { Ic },
    data: () => ({ loading: true }),
    async created() {
      try { await api.assignVerify(); D.tasks = markRaw(await api.verifyTasks()); bump(); }
      catch (e) { toast('Ошибка: ' + e.message); } finally { this.loading = false; }
    },
    computed: {
      mine() { S.rev; return D.tasks.filter(t => t.user_id === S.me.id).map(t => ({ t, c: ix().contactById.get(t.contact_id) })).filter(x => x.c).sort((a, b) => (!!a.t.result - !!b.t.result) || a.t.id - b.t.id); },
      done() { return this.mine.filter(x => x.t.result).length; },
      team() {
        S.rev; const by = new Map();
        for (const t of D.tasks) { if (!by.has(t.user_id)) by.set(t.user_id, { total: 0, done: 0 }); const s = by.get(t.user_id); s.total++; if (t.result) s.done++; }
        return [...by.entries()].map(([id, s]) => ({ id, name: pname(id), ...s }));
      },
      backlog() { S.rev; const y = Date.now() - 365 * 864e5; return D.contacts.filter(c => !c.is_desk && !c.inactive && (!c.verified_at || new Date(c.verified_at) < y)).length; },
    },
    methods: {
      async finish(x, result) {
        try {
          if (result === 'ok' || result === 'changed') await actions.saveContact(x.c.id, { verified_at: new Date().toISOString().slice(0, 10), verified_by: S.me.id });
          if (result === 'inactive') await actions.saveContact(x.c.id, { inactive: true });
          const row = await api.update('verify_tasks', x.t.id, { result, done_at: new Date().toISOString() }); Object.assign(x.t, row); bump();
        } catch (e) { toast('Ошибка: ' + e.message); }
      },
      move(x) { S.modal = { kind: 'move', id: x.c.id }; this.finish(x, 'changed'); },
      label(r) { return { ok: '✓ актуален', changed: '✓ обновлён', inactive: 'не работает', skipped: 'пропущен' }[r]; },
    },
    template: `
<div>
  <div class="page-head"><div><h1>Актуализация</h1><div class="muted small" style="margin-top:6px">Каждую неделю система выдаёт вам контакты, которые давно никто не проверял. Сначала тех, с кем вы работаете (пул, питчи), потом Tier 1. Всего ждут проверки: {{ backlog.toLocaleString('ru') }}.</div></div></div>
  <div v-if="loading" class="loading">Собираем контакты на эту неделю…</div>
  <template v-else>
    <div class="card stack" style="margin-bottom:16px">
      <div class="row"><b class="grow">Моя неделя: {{ done }} из {{ mine.length }}</b><span v-if="mine.length && done===mine.length" class="status published">всё проверено 🎉</span></div>
      <div class="progress"><i :style="{width: (mine.length ? done / mine.length * 100 : 0) + '%'}"></i></div>
      <div class="small muted">Как проверять: загляните на сайт издания или в соцсети журналиста, убедитесь, что он там работает, и обновите почту или телефон, если нужно.</div>
    </div>
    <div class="stack">
      <div v-for="x in mine" :key="x.t.id" class="card row wrap" :style="x.t.result ? 'opacity:.55' : ''" style="gap:14px">
        <div class="grow" style="min-width:240px">
          <a href="#" @click.prevent="openContact(x.c.id)"><b>{{ x.c.name }}</b></a> <span class="muted small">{{ x.c.role }}</span>
          <div class="small">{{ outletName(x.c.outlet_id) }} · {{ (x.c.emails||[])[0] || 'нет почты' }} · {{ (x.c.phones||[])[0] || 'нет телефона' }}</div>
          <div class="small muted">{{ x.c.verified_at ? 'проверен ' + fmtDate(x.c.verified_at) : (x.c.verified_note ? 'в старой базе: ' + x.c.verified_note : 'ещё не проверялся') }}</div>
        </div>
        <template v-if="!x.t.result">
          <button class="btn primary sm" @click="finish(x, 'ok')"><Ic n="check"/> Актуален</button>
          <button class="btn sm" @click="openContact(x.c.id)">Открыть и поправить</button>
          <button class="btn sm" @click="finish(x, 'changed')">Поправил(а)</button>
          <button class="btn sm" @click="move(x)">Перешёл</button>
          <button class="btn sm" @click="finish(x, 'inactive')">Не работает</button>
          <button class="btn ghost sm" @click="finish(x, 'skipped')">Пропустить</button>
        </template>
        <span v-else class="status">{{ label(x.t.result) }}</span>
      </div>
      <div v-if="!mine.length" class="empty">На этой неделе проверять некого. Отличная работа!</div>
    </div>
    <div v-if="isAdmin() && team.length" class="card" style="margin-top:16px"><h2 class="h2">Команда на этой неделе</h2>
      <div v-for="u in team" :key="u.id" class="note row"><span class="grow">{{ u.name }}</span><span class="mono">{{ u.done }} / {{ u.total }}</span></div></div>
  </template>
</div>`,
  };

  // ====================== АДМИНКА ======================
  const AdminView = {
    mixins: [helpers], components: { Ic, DupsView, TrashView },
    data: () => ({ tab: 'users', newTopic: '', newTag: '', days: D.settings.collision_days || 7, perWeek: D.settings.verify_per_week || 20, file: null, preview: null, importing: false, progress: 0, importLog: '' }),
    created() { if (!D.contacts.length) this.tab = 'import'; },
    computed: {
      profiles() { S.rev; return D.profiles; }, topics() { S.rev; return D.dict.topic; }, tags() { S.rev; return D.dict.tag; },
      stats() { S.rev; return { outlets: D.outlets.length, contacts: D.contacts.length }; }, mode: () => S.mode,
      supaUsersUrl() { const u = (window.MK_CONFIG || {}).supabaseUrl || ''; const m = u.match(/https:\/\/([a-z0-9]+)\.supabase\.co/); return m ? 'https://supabase.com/dashboard/project/' + m[1] + '/auth/users' : 'https://supabase.com/dashboard'; },
    },
    methods: {
      async setRole(p, role) {
        if (p.id === S.me.id && role !== 'admin' && !confirm('Вы снимаете админа с себя. Уверены?')) return;
        const row = await safe(() => api.updateProfile(p.id, { role }), 'Роль обновлена'); Object.assign(p, row); bump();
      },
      async addDict(kind) {
        const v = (kind === 'topic' ? this.newTopic : this.newTag).trim(); if (!v || D.dict[kind].includes(v)) return;
        await safe(() => api.dictAdd(kind, v)); D.dict[kind].push(v); bump(); this.newTopic = this.newTag = '';
      },
      async delDict(kind, v) {
        if (!confirm('Убрать «' + v + '» из справочника? У существующих карточек значение останется.')) return;
        await safe(() => api.dictRemove(kind, v)); D.dict[kind] = D.dict[kind].filter(x => x !== v); bump();
      },
      async savePerWeek() { await safe(() => api.setSetting('verify_per_week', +this.perWeek || 20), 'Сохранено. Действует со следующей недели'); D.settings.verify_per_week = +this.perWeek || 20; },
      stage2: () => S.stage2,
      async saveDays() { await safe(() => api.setSetting('collision_days', +this.days || 7), 'Сохранено'); D.settings.collision_days = +this.days || 7; bump(); },
      async readFile(e) {
        const f = e.target.files[0]; if (!f) return;
        try {
          const data = JSON.parse(await f.text());
          if (!Array.isArray(data.outlets)) throw new Error('Это не файл выгрузки Медиакарты');
          const contacts = data.outlets.reduce((n, o) => n + (o.contacts || []).length, 0);
          this.preview = { data, outlets: data.outlets.length, contacts, report: data.report || null };
        } catch (err) { toast('Не удалось прочитать файл: ' + err.message); }
      },
      async runImport() {
        if (this.stats.contacts && !confirm('В базе уже есть ' + this.stats.contacts + ' контактов. Загрузить ещё раз? Появятся дубли.')) return;
        this.importing = true; this.progress = 0; this.importLog = '';
        const list = this.preview.data.outlets; const size = 150; let done = 0, n = 0;
        try {
          for (let i = 0; i < list.length; i += size) {
            n += await api.bulkImport(list.slice(i, i + size));
            done = Math.min(list.length, i + size); this.progress = Math.round(done / list.length * 100);
          }
          this.importLog = 'Готово: ' + done + ' изданий, ' + n + ' контактов.';
          await loadData(); toast('База загружена');
        } catch (e) { this.importLog = 'Остановилось на ' + done + ' из ' + list.length + ': ' + e.message; }
        finally { this.importing = false; }
      },
      async exportAll() {
        toast('Готовим файл…');
        const outlets = D.outlets.map(o => ({ 'Издание': o.name, 'Тип': o.type, 'Формат': o.format || '', 'Тематики': (o.topics || []).join(', '), 'География': (o.geo || []).join(', '), 'Tier': o.tier || '', 'Сайт': o.website || '', 'Охват': o.reach || '', 'Контактов': (ix().byOutlet.get(o.id) || []).length }));
        const contacts = D.contacts.map(contactRow);
        const camps = D.items.map(it => { const c = ix().contactById.get(it.contact_id) || {}; const cp = D.campaigns.find(x => x.id === it.campaign_id) || {};
          return { 'Инфоповод': cp.title, 'Клиент': cp.client || '', 'Журналист': c.name, 'Издание': this.outletName(c.outlet_id), 'Статус': STATUS[it.status], 'Канал': CHANNEL[it.channel] || '', 'Отправлено': fmtDate(it.sent_at), 'Ведёт': pname(it.owner), 'Публикация': it.publication_url || '' }; });
        await exportXlsx('Медиакарта — полная выгрузка ' + fmtDate(new Date()) + '.xlsx', [['Издания', outlets], ['Контакты', contacts], ['Питчи', camps]]);
      },
    },
    template: `
<div style="max-width:980px">
  <div class="page-head"><h1>Управление</h1></div>
  <div class="seg" style="margin-bottom:16px">
    <button v-for="t in [['users','Пользователи'],['dicts','Справочники'],['dups','Дубли'],['trash','Корзина'],['import','Загрузка базы'],['export','Выгрузка']]" :key="t[0]" :class="{on: tab===t[0]}" @click="tab=t[0]">{{ t[1] }}</button>
  </div>

  <div v-if="tab==='users'" class="stack" style="gap:16px">
    <div class="card scroll-x" style="padding:0"><table class="tbl"><thead><tr><th>Имя</th><th>Почта</th><th>Роль</th></tr></thead><tbody>
      <tr v-for="p in profiles" :key="p.id"><td>{{ p.full_name }}</td><td>{{ p.email }}</td>
        <td><select class="select" style="width:160px" :value="p.role" @change="setRole(p, $event.target.value)" aria-label="Роль"><option value="member">Сотрудник</option><option value="admin">Администратор</option></select></td></tr>
    </tbody></table></div>
    <div class="banner info">Как добавить коллегу: откройте <a :href="supaUsersUrl" target="_blank" rel="noopener">Supabase → Authentication → Users</a>, нажмите «Add user → Create new user», впишите почту и временный пароль, поставьте галочку «Auto Confirm User». Коллега появится здесь после первого входа и сможет сменить пароль в настройках.</div>
    <div class="card stack"><h2 class="h2">Защита от двойного питча</h2>
      <div v-if="stage2()" class="row"><span>Актуализация: выдавать каждому сотруднику по</span><input class="input" type="number" min="5" max="100" style="width:80px" v-model="perWeek" aria-label="Контактов в неделю"><span>контактов в неделю</span><button class="btn" @click="savePerWeek">Сохранить</button></div>
      <div class="row"><span>Предупреждать, если журналисту уже писали за последние</span><input class="input" type="number" min="1" max="60" style="width:80px" v-model="days" aria-label="Дней"><span>дней</span><button class="btn" @click="saveDays">Сохранить</button></div></div>
  </div>

  <div v-if="tab==='dicts'" class="grid2">
    <div class="card stack"><h2 class="h2">Тематики</h2>
      <div><span v-for="t in topics" :key="t" class="chip x" @click="delDict('topic', t)" :title="'Убрать ' + t">{{ t }} ✕</span></div>
      <div class="row"><input class="input" v-model="newTopic" placeholder="Новая тематика" @keydown.enter="addDict('topic')"><button class="btn" @click="addDict('topic')">Добавить</button></div></div>
    <div class="card stack"><h2 class="h2">Теги-предпочтения</h2>
      <div><span v-for="t in tags" :key="t" class="chip x" @click="delDict('tag', t)" :title="'Убрать ' + t">{{ t }} ✕</span></div>
      <div class="row"><input class="input" v-model="newTag" placeholder="Новый тег" @keydown.enter="addDict('tag')"><button class="btn" @click="addDict('tag')">Добавить</button></div></div>
  </div>

  <div v-if="tab==='import'" class="card stack">
    <h2 class="h2">Загрузка исходной базы</h2>
    <div class="muted">Сейчас в базе: {{ stats.outlets }} изданий, {{ stats.contacts }} контактов. Выберите файл <b>mediakarta_seed.json</b>, который подготовил скрипт переноса. Загрузка делается один раз.</div>
    <div v-if="mode==='demo'" class="banner info">Демо-режим: данные загрузятся только в эту вкладку и пропадут после перезагрузки. Так можно посмотреть свою базу до подключения Supabase.</div>
    <input type="file" accept=".json,application/json" @change="readFile" aria-label="Файл базы">
    <div v-if="preview" class="banner info">В файле: {{ preview.outlets.toLocaleString('ru') }} изданий и {{ preview.contacts.toLocaleString('ru') }} контактов.</div>
    <div v-if="importing || progress" class="progress"><i :style="{width: progress + '%'}"></i></div>
    <div v-if="importLog">{{ importLog }}</div>
    <div><button class="btn primary" :disabled="!preview || importing" @click="runImport">{{ importing ? 'Загружаем… ' + progress + '%' : 'Загрузить' }}</button></div>
  </div>

  <DupsView v-if="tab==='dups'" />
  <TrashView v-if="tab==='trash'" />
  <div v-if="tab==='export'" class="card stack">
    <h2 class="h2">Полная выгрузка в Excel</h2>
    <div class="muted">Все издания, контакты и история питчей в одном файле. Это бэкап и способ передать карту дальше.</div>
    <div><button class="btn primary" @click="exportAll"><Ic n="down"/> Скачать Excel</button></div>
  </div>
</div>`,
  };

  // ====================== КОРЕНЬ ======================
  const Root = {
    components: { Login, Nav, MapView, ContactDrawer, OutletDrawer, ContactForm, OutletForm, CampaignForm, AddToCampaign, Picker, CampaignsView, CampaignView, PoolView, DashView, SettingsView, AdminView, MoveModal, BulkEdit,
      ClientsView, ClientView, MailingsView, MailingView, ListForm, AddToList, VerifyView },
    computed: { s: () => S },
    mounted() {
      boot();
      api.onAuth(async (ev, user) => {
        if (ev === 'SIGNED_OUT') { S.user = null; S.me = null; }
        if (ev === 'PASSWORD_RECOVERY' && user) {
          S.user = user; if (!S.me) await loadData();
          S.view = 'settings'; toast('Задайте новый пароль внизу страницы');
        }
      });
      window.addEventListener('keydown', e => { if (e.key === 'Escape') { if (S.modal) S.modal = null; else if (S.drawer) S.drawer = null; } });
      // напоминания о фоллоу-апах и новые упоминания
      const shown = new Set();
      const notify = (title, body, contactId) => {
        toast(title + (body ? ': ' + body : ''));
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            const n = new Notification(title, { body, tag: 'mk-' + title + body });
            n.onclick = () => { window.focus(); if (contactId) openContact(contactId); n.close(); };
          }
        } catch (e) {}
      };
      let lastPoll = 0;
      setInterval(async () => {
        S.tick = Date.now();
        if (!S.me || !S.stage2) return;
        for (const x of dueFollowups()) {
          if (!x.due || shown.has(x.i.id + x.i.followup_at)) continue;
          shown.add(x.i.id + x.i.followup_at);
          const c = ix().contactById.get(x.i.contact_id), cp = D.campaigns.find(k => k.id === x.i.campaign_id);
          notify('Пора дожать: ' + (c ? c.name : ''), cp ? '«' + cp.title + '»' : '', x.i.contact_id);
        }
        if (Date.now() - lastPoll > 120000) {
          lastPoll = Date.now();
          try {
            const fresh = await api.notifications(); const known = new Set(D.notifs.map(n => n.id));
            for (const n of fresh) if (!known.has(n.id) && !n.read_at) notify(pname(n.created_by) + ' упомянул(а) вас', (n.text || '').slice(0, 80), n.contact_id);
            D.notifs = markRaw(fresh); bump();
          } catch (e) { console.error(e); }
        }
      }, 30000);
    },
    methods: { retry() { loadData(); } },
    template: `
<div v-if="s.booting" class="loading">Загрузка…</div>
<Login v-else-if="!s.user" />
<div v-else-if="!s.me" class="loading">
  <template v-if="s.loadError"><p>Не удалось загрузить базу: {{ s.loadError }}</p><button class="btn" @click="retry">Повторить</button></template>
  <template v-else>Загружаем медиакарту… {{ s.loadingPct }}%<div class="progress" style="max-width:320px; margin:12px auto"><i :style="{width: s.loadingPct + '%'}"></i></div></template>
</div>
<div v-else class="app" :class="{'with-drawer': !!s.drawer}">
  <Nav />
  <main class="main">
    <div v-if="s.needsUpdate" class="banner" style="margin-bottom:16px">Вышло обновление Медиакарты, но база данных ещё не обновлена, поэтому часть новых функций пока не работает. Администратору нужно выполнить файл <b>supabase/{{ s.needsUpdate }}</b> в Supabase → SQL Editor и обновить страницу.</div>
    <DashView v-if="s.view==='dash'" />
    <MapView v-else-if="s.view==='map'" />
    <CampaignsView v-else-if="s.view==='campaigns'" />
    <CampaignView v-else-if="s.view==='campaign'" :key="s.campaignId" />
    <PoolView v-else-if="s.view==='pool'" />
    <SettingsView v-else-if="s.view==='settings'" />
    <AdminView v-else-if="s.view==='admin'" />
    <ClientsView v-else-if="s.view==='clients'" />
    <ClientView v-else-if="s.view==='client'" :key="'cl' + s.clientId" />
    <MailingsView v-else-if="s.view==='mailings'" />
    <MailingView v-else-if="s.view==='mailing'" :key="'ml' + s.listId" />
    <VerifyView v-else-if="s.view==='verify'" />
  </main>
  <div class="drawer-wrap" v-if="s.drawer">
    <ContactDrawer v-if="s.drawer.kind==='contact'" :id="s.drawer.id" :key="'c' + s.drawer.id" />
    <OutletDrawer v-else :id="s.drawer.id" :key="'o' + s.drawer.id" />
  </div>
  <ContactForm v-if="s.modal && s.modal.kind==='contactForm'" :m="s.modal" />
  <OutletForm v-if="s.modal && s.modal.kind==='outletForm'" :m="s.modal" />
  <CampaignForm v-if="s.modal && s.modal.kind==='campaignForm'" :m="s.modal" />
  <AddToCampaign v-if="s.modal && s.modal.kind==='addToCampaign'" :m="s.modal" />
  <Picker v-if="s.modal && s.modal.kind==='picker'" :m="s.modal" />
  <MoveModal v-if="s.modal && s.modal.kind==='move'" :m="s.modal" />
  <BulkEdit v-if="s.modal && s.modal.kind==='bulk'" :m="s.modal" />
  <ListForm v-if="s.modal && s.modal.kind==='listForm'" :m="s.modal" />
  <AddToList v-if="s.modal && s.modal.kind==='addToList'" :m="s.modal" />
</div>
<div v-if="s.toast" class="toast" role="status">{{ s.toast }}</div>`,
  };

  createApp(Root).mount('#app');
})();
