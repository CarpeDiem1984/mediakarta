/* Тестовые данные для демо-режима. Издания настоящие, люди выдуманные. */
window.MK_DEMO_DATA = function () {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const day = n => new Date(Date.now() - n * 864e5).toISOString();

  const profiles = [
    { id: 'u-admin', email: 'demo@mediakarta.local', full_name: 'Кирилл П.', role: 'admin', theme: 'calm' },
    { id: 'u-masha', email: 'masha@agency.local', full_name: 'Маша', role: 'member', theme: 'paper' },
    { id: 'u-oleg', email: 'oleg@agency.local', full_name: 'Олег', role: 'member', theme: 'console' },
  ];
  const O = [
    ['Ведомости', 'СМИ', null, ['Бизнес и экономика', 'Финансы и банки'], ['Федеральные'], 1, 'https://www.vedomosti.ru'],
    ['РБК', 'СМИ', null, ['Бизнес и экономика', 'IT и технологии'], ['Федеральные'], 1, 'https://www.rbc.ru'],
    ['Коммерсант', 'СМИ', null, ['Бизнес и экономика', 'Общество и новости'], ['Федеральные'], 1, 'https://www.kommersant.ru'],
    ['ТАСС', 'СМИ', 'Информагентство', ['Общество и новости'], ['Федеральные'], 1, 'https://tass.ru'],
    ['РИА Новости', 'СМИ', 'Информагентство', ['Общество и новости'], ['Федеральные'], 1, 'https://ria.ru'],
    ['Интерфакс', 'СМИ', 'Информагентство', ['Бизнес и экономика', 'Финансы и банки'], ['Федеральные'], 1, 'https://www.interfax.ru'],
    ['Forbes', 'СМИ', null, ['Бизнес и экономика'], ['Федеральные'], 1, 'https://www.forbes.ru'],
    ['Известия', 'СМИ', null, ['Общество и новости'], ['Федеральные'], 1, 'https://iz.ru'],
    ['Lenta.ru', 'СМИ', null, ['Общество и новости'], ['Федеральные'], 1, 'https://lenta.ru'],
    ['Газета.ру', 'СМИ', null, ['Общество и новости'], ['Федеральные'], 1, 'https://www.gazeta.ru'],
    ['3DNews', 'СМИ', null, ['IT и технологии'], ['Федеральные'], 1, 'https://3dnews.ru'],
    ['CNews', 'СМИ', null, ['IT и технологии'], ['Федеральные'], 1, 'https://www.cnews.ru'],
    ['vc.ru', 'СМИ', null, ['Бизнес и экономика', 'IT и технологии'], ['Федеральные'], 1, 'https://vc.ru'],
    ['Хабр', 'СМИ', null, ['IT и технологии'], ['Федеральные'], 2, 'https://habr.com'],
    ['Banki.ru', 'СМИ', null, ['Финансы и банки'], ['Федеральные'], 1, 'https://www.banki.ru'],
    ['Афиша Daily', 'СМИ', null, ['Lifestyle и мода', 'Культура и кино'], ['Федеральные'], 1, 'https://daily.afisha.ru'],
    ['The Blueprint', 'СМИ', null, ['Lifestyle и мода'], ['Федеральные'], 1, 'https://theblueprint.ru'],
    ['Москва 24', 'СМИ', 'ТВ', ['Общество и новости'], ['Москва'], 1, 'https://www.m24.ru'],
    ['Business FM', 'СМИ', 'Радио', ['Бизнес и экономика'], ['Федеральные'], 1, 'https://www.bfm.ru'],
    ['Коммерсант FM', 'СМИ', 'Радио', ['Бизнес и экономика'], ['Федеральные'], 1, null],
    ['Fontanka.ru', 'СМИ', null, ['Общество и новости'], ['Санкт-Петербург'], 1, 'https://www.fontanka.ru'],
    ['Деловой Петербург', 'СМИ', null, ['Бизнес и экономика'], ['Санкт-Петербург'], 1, 'https://www.dp.ru'],
    ['Реальное время', 'СМИ', null, ['Бизнес и экономика'], ['Казань'], 2, 'https://realnoevremya.ru'],
    ['E1.ru', 'СМИ', null, ['Общество и новости'], ['Екатеринбург'], 2, 'https://www.e1.ru'],
    ['Sostav', 'СМИ', null, ['Маркетинг и реклама'], ['Федеральные'], 1, 'https://www.sostav.ru'],
    ['Retail.ru', 'СМИ', null, ['Ритейл и e-com'], ['Федеральные'], 2, 'https://www.retail.ru'],
    ['Банкста', 'Новые медиа', null, ['Финансы и банки'], ['Федеральные'], 1, 'https://t.me/banksta'],
    ['The Bell', 'Новые медиа', null, ['Бизнес и экономика'], ['Федеральные'], 1, 'https://t.me/thebell_io'],
    ['addmeto', 'Новые медиа', null, ['IT и технологии'], ['Федеральные'], 2, 'https://t.me/addmeto'],
    ['Москвач', 'Новые медиа', null, ['Общество и новости'], ['Москва'], 2, null],
    ['Алина Корнеева', 'Блогеры', null, ['Lifestyle и мода', 'Еда и HoReCa'], ['Федеральные'], 2, null],
    ['Дмитрий Тех', 'Блогеры', null, ['IT и технологии'], ['Федеральные'], 3, null],
  ];
  const outlets = O.map((o, i) => ({
    id: i + 1, name: o[0], type: o[1], format: o[2], topics: o[3], geo: o[4], tier: o[5], website: o[6],
    reach: o[1] === 'СМИ' ? Math.round(rnd() * 900 + 50) + ' тыс./день' : Math.round(rnd() * 300 + 20) + ' тыс. подписчиков',
    note: null, sources: ['Демо'], created_at: day(200), updated_at: day(30)
  }));

  const first = ['Анна', 'Мария', 'Екатерина', 'Ольга', 'Дарья', 'Ирина', 'Алина', 'Полина', 'Наталья', 'Юлия', 'Михаил', 'Денис', 'Алексей', 'Илья', 'Артём', 'Сергей', 'Павел', 'Никита', 'Глеб', 'Иван'];
  const last = ['Литвинова', 'Орлова', 'Белова', 'Котова', 'Соколова', 'Морозова', 'Павлова', 'Зайцева', 'Волкова', 'Лебедева', 'Орлов', 'Хабаров', 'Соловьёв', 'Ершов', 'Громов', 'Титов', 'Фролов', 'Комаров', 'Беляев', 'Кузнецов'];
  const roles = ['Корреспондент', 'Редактор отдела', 'Обозреватель', 'Шеф-редактор', 'Главный редактор', 'Продюсер', 'Выпускающий редактор', 'Автор'];
  const tagsAll = ['берёт эксклюзивы', 'берёт комментарии', 'только TG', 'не любит звонки', 'пишет колонки', 'любит цифры и данные', 'отвечает быстро'];
  const comments = [
    'Пишет про финтех и банки. Любит цифры и эксклюзивные данные, общие релизы не открывает. Писать в TG до 11 утра.',
    'Быстро отвечает, но просит заранее согласовывать спикера.', 'Не любит рассылки, только персональные письма.',
    'Брала комментарий нашего спикера в материал про кешбэк.', null, null, null];
  const contacts = []; let cid = 0;
  const translit = s => s.toLowerCase().replace(/[а-яё]/g, ch => ({ а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' }[ch]));
  for (const o of outlets) {
    const dom = o.website ? o.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*/, '') : 'mail.ru';
    if (o.type === 'СМИ') contacts.push({ id: ++cid, outlet_id: o.id, is_desk: true, name: 'Редакция', role: 'для пресс-релизов', emails: ['news@' + dom], phones: ['+7 495 000-00-' + String(10 + cid).slice(-2)], telegram: [], relation: 'neutral', tags: [] });
    const n = o.type === 'СМИ' ? 2 + Math.floor(rnd() * 5) : 1;
    for (let k = 0; k < n; k++) {
      const fem = rnd() > .45;
      const f = fem ? pick(first.slice(0, 10)) : pick(first.slice(10)), l = fem ? pick(last.slice(0, 10)) : pick(last.slice(10));
      const name = o.type === 'Блогеры' ? o.name : f + ' ' + l;
      const r = rnd();
      contacts.push({
        id: ++cid, outlet_id: o.id, is_desk: false, name,
        role: o.type === 'СМИ' ? pick(roles) + (rnd() > .5 ? ', «' + pick(o.topics).split(' ')[0] + '»' : '') : (o.type === 'Блогеры' ? 'Автор блога' : 'Админ канала'),
        topics: o.topics.slice(0, 1),
        emails: rnd() > .2 ? [translit(f[0] + '.' + l) + '@' + dom] : [],
        phones: rnd() > .5 ? ['+7 9' + Math.floor(10 + rnd() * 89) + ' 000-' + String(Math.floor(rnd() * 90 + 10)) + '-' + String(Math.floor(rnd() * 90 + 10))] : [],
        telegram: rnd() > .55 ? ['@' + translit(f).slice(0, 4) + '_' + translit(l).slice(0, 6)] : [],
        relation: r > .8 ? 'warm' : r < .1 ? 'cold' : 'neutral',
        tags: rnd() > .6 ? [pick(tagsAll)] : [],
        comment: pick(comments),
        birthday_day: rnd() > .7 ? Math.floor(rnd() * 28) + 1 : null,
        birthday_month: null,
        last_pub_url: rnd() > .7 ? o.website || null : null,
        last_pub_date: null,
        verified_at: rnd() > .6 ? day(Math.floor(rnd() * 300)).slice(0, 10) : null,
        verified_by: 'u-masha', verified_note: rnd() > .8 ? 'март 2024' : null,
      });
    }
  }
  const today = new Date();
  for (const c of contacts) {
    c.topics = c.topics || []; c.socials = []; c.sources = ['Демо']; c.dept = null; c.address = null; c.birthday_year = null;
    c.created_at = day(180); c.updated_at = day(Math.floor(rnd() * 60));
    if (c.birthday_day) {
      const d = new Date(today.getTime() + Math.floor(rnd() * 60 - 5) * 864e5);
      c.birthday_day = d.getDate(); c.birthday_month = d.getMonth() + 1;
    }
    if (c.last_pub_url) c.last_pub_date = day(Math.floor(rnd() * 90)).slice(0, 10);
  }
  const anna = contacts.find(c => !c.is_desk && c.outlet_id === 1);
  Object.assign(anna, { name: 'Анна Литвинова', role: 'Корреспондент отдела «Финансы»', relation: 'warm', tags: ['берёт эксклюзивы', 'только TG', 'берёт комментарии'], comment: comments[0], telegram: ['@a_litvinova'], emails: ['a.litvinova@vedomosti.ru'] });

  const campaigns = [
    { id: 1, title: 'Исследование рынка BNPL', client: 'Финтех-клиент', pitch_date: day(4).slice(0, 10), description: 'Эксклюзивные данные исследования: объём рынка, рост за год, портрет пользователя.', materials_url: null, archived: false, created_by: 'u-masha', created_at: day(6) },
    { id: 2, title: 'Запуск мобильного приложения', client: 'Банк', pitch_date: day(60).slice(0, 10), description: 'Релиз о запуске, доступ к спикеру, демо-доступ для обзоров.', materials_url: null, archived: false, created_by: 'u-admin', created_at: day(62) },
    { id: 3, title: 'Назначение нового CEO', client: 'Ритейл', pitch_date: day(100).slice(0, 10), description: null, materials_url: null, archived: true, created_by: 'u-oleg', created_at: day(101) },
  ];
  const items = []; let iid = 0;
  const people = contacts.filter(c => !c.is_desk);
  const st = ['sent', 'no_reply', 'interest', 'declined', 'published', 'not_sent'];
  for (const camp of campaigns) {
    const age = Math.round((Date.now() - new Date(camp.created_at)) / 864e5);
    const sel = people.filter((c, i) => (i + camp.id * 3) % (camp.id === 1 ? 4 : 5) === 0).slice(0, camp.id === 1 ? 18 : 14);
    if (camp.id === 1 && !sel.includes(anna)) sel.unshift(anna);
    for (const c of sel) {
      const s = c === anna && camp.id === 1 ? 'interest' : pick(st);
      items.push({
        id: ++iid, campaign_id: camp.id, contact_id: c.id, owner: camp.created_by, status: s,
        channel: s === 'not_sent' ? null : pick(['email', 'email', 'telegram', 'phone']),
        sent_at: s === 'not_sent' ? null : day(Math.max(1, age - 2 - Math.floor(rnd() * 3))),
        publication_url: s === 'published' ? (outlets.find(o => o.id === c.outlet_id).website || null) : null,
        note: null, updated_at: day(1)
      });
    }
  }
  const notes = [
    { id: 1, contact_id: anna.id, author: 'u-masha', body: 'Созвонились, ждёт данные по BNPL к концу месяца.', created_at: day(3) },
    { id: 2, contact_id: anna.id, author: 'u-admin', body: 'Взяла комментарий спикера в материал про кешбэк.', created_at: day(15) },
  ];
  let nid = 2;
  for (const c of people.filter((_, i) => i % 9 === 0).slice(0, 10)) {
    notes.push({ id: ++nid, contact_id: c.id, author: pick(['u-masha', 'u-oleg', 'u-admin']), body: pick(['Попросил присылать только эксклюзивы.', 'Ушла в декрет до весны, писать коллеге.', 'Готов взять колонку в следующем месяце.', 'Отвечает только в телеграме.', 'Был на нашем пресс-завтраке, очень вовлечён.']), created_at: day(Math.floor(rnd() * 30)) });
  }
  const dictionaries = [
    'Общество и новости', 'Бизнес и экономика', 'Финансы и банки', 'IT и технологии', 'Кибербезопасность', 'Наука', 'Ритейл и e-com', 'Маркетинг и реклама',
    'Lifestyle и мода', 'Еда и HoReCa', 'Путешествия', 'Авто и транспорт', 'Логистика', 'Недвижимость и стройка', 'Культура и кино', 'Игры и развлечения',
    'Спорт', 'Медицина и фарма', 'Образование и HR', 'Семья и дети', 'Промышленность и энергетика', 'Агро', 'ESG и благотворительность'
  ].map((v, i) => ({ kind: 'topic', value: v, sort: i }))
    .concat(['берёт эксклюзивы', 'берёт комментарии', 'пишет колонки', 'только TG', 'не любит звонки', 'не любит рассылки', 'отвечает быстро', 'игнорирует', 'коммерция / платно', 'любит цифры и данные'].map((v, i) => ({ kind: 'tag', value: v, sort: i })));

  // пара дублей и дубль издания, чтобы было что склеивать в демо
  const dupSrc = contacts.find(c => !c.is_desk && c.outlet_id === 2 && c.emails.length);
  if (dupSrc) contacts.push(Object.assign({}, dupSrc, { id: ++cid, name: dupSrc.name.split(' ').reverse().join(' '), emails: [dupSrc.emails[0].toUpperCase()], phones: [], comment: 'Из второй базы: просит писать в TG', tags: [], sources: ['Демо-2'] }));
  outlets.push(Object.assign({}, outlets[2], { id: outlets.length + 1, name: 'Коммерсантъ', topics: ['Общество и новости'], sources: ['Демо-2'] }));
  contacts.push({ id: ++cid, outlet_id: outlets.length, is_desk: false, name: 'Глеб Громов', role: 'Обозреватель', topics: [], emails: ['g.gromov@kommersant.ru'], phones: [], telegram: [], socials: [], relation: 'neutral', tags: [], sources: ['Демо-2'], created_at: day(10), updated_at: day(10) });
  const clients = [{ id: 1, name: 'Финтех-клиент', created_by: 'u-masha', created_at: day(60) }, { id: 2, name: 'Банк', created_by: 'u-admin', created_at: day(90) }, { id: 3, name: 'Ритейл', created_by: 'u-oleg', created_at: day(120) }];
  campaigns.forEach(c => { c.client_id = (clients.find(k => k.name === c.client) || {}).id || null; });
  const mailing_lists = [{ id: 1, name: 'Финтех · деловые СМИ', client_id: 1, kind: 'dynamic', filter: { topic: 'Финансы и банки', desks: true }, created_by: 'u-masha', created_at: day(20) },
    { id: 2, name: 'Банк · ключевые', client_id: 2, kind: 'static', filter: {}, created_by: 'u-admin', created_at: day(30) }];
  const mailing_members = people.slice(0, 12).map(c => ({ list_id: 2, contact_id: c.id, added_at: day(30) }));
  people[1].tags = ['не любит рассылки'];
  const notifications = [{ id: 1, user_id: 'u-admin', kind: 'mention', contact_id: anna.id, note_id: 1, text: '@Кирилл П. она просила прислать данные до пятницы', created_by: 'u-masha', created_at: day(0), read_at: null }];
  items.filter(i => i.campaign_id === 1 && i.status === 'sent').slice(0, 2).forEach((i, k) => { i.owner = 'u-admin'; i.followup_at = new Date(Date.now() + (k ? 3 : -1) * 3600e3).toISOString(); });
  const events = [
    { id: 1, title: 'Пресс-завтрак: итоги года в финтехе', client_id: 1, event_at: new Date(Date.now() + 9 * 864e5).toISOString(), place: 'Москва, ресторан «Белуга»', description: 'Завтрак со спикерами клиента, 12–15 журналистов.', created_by: 'u-masha', created_at: day(5) },
    { id: 2, title: 'Презентация мобильного приложения', client_id: 2, event_at: day(55), place: 'Москва, Digital October', description: null, created_by: 'u-admin', created_at: day(70) },
  ];
  const gst = ['invited', 'confirmed', 'declined', 'planned'], gst2 = ['attended', 'attended', 'no_show', 'declined'];
  const event_guests = [];
  people.slice(0, 10).forEach((c, k) => event_guests.push({ id: event_guests.length + 1, event_id: 1, contact_id: c.id, owner: 'u-masha', status: gst[k % 4], note: null, updated_at: day(1) }));
  people.slice(3, 15).forEach((c, k) => event_guests.push({ id: event_guests.length + 1, event_id: 2, contact_id: c.id, owner: 'u-admin', status: gst2[k % 4], note: null, updated_at: day(50) }));
  return {
    events, event_guests,
    clients, mailing_lists, mailing_members, mailing_sends: [], notifications, verify_tasks: [],
    profiles, outlets, contacts, campaigns, campaign_items: items, notes,
    favorites: [anna.id].concat(people.filter((_, i) => i % 11 === 0).map(c => c.id)),
    dictionaries, settings: { collision_days: 7 }, audit_log: []
  };
};
