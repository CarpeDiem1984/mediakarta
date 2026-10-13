/* Слой данных: Supabase (боевой режим) или память браузера (демо-режим).
   Интерфейс одинаковый, поэтому интерфейс приложения не знает, где лежат данные. */
(function () {
  const cfg = window.MK_CONFIG || {};
  const DEMO = !cfg.supabaseUrl || !cfg.supabaseAnonKey;

  // ---------------- Supabase ----------------
  function supabaseApi() {
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

    async function fetchAll(table, columns, order = 'id', onPage) {
      const { count, error } = await sb.from(table).select('id', { count: 'exact', head: true });
      if (error) throw new Error(error.message);
      const size = 1000, pages = Math.max(1, Math.ceil((count || 0) / size));
      const out = new Array(pages);
      let next = 0, done = 0;
      async function worker() {
        while (next < pages) {
          const p = next++;
          out[p] = must(await sb.from(table).select(columns).order(order).range(p * size, p * size + size - 1));
          done++; onPage && onPage(done, pages);
        }
      }
      await Promise.all(Array.from({ length: Math.min(6, pages) }, worker));
      return out.flat();
    }

    return {
      mode: 'supabase',
      async session() {
        const { data } = await sb.auth.getSession();
        return data.session ? data.session.user : null;
      },
      async signIn(email, password) {
        must(await sb.auth.signInWithPassword({ email, password }));
      },
      async signOut() { await sb.auth.signOut(); },
      async updatePassword(password) { must(await sb.auth.updateUser({ password })); },
      async resetPassword(email) {
        must(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
      },
      onAuth(cb) { sb.auth.onAuthStateChange((ev, s) => cb(ev, s ? s.user : null)); },

      async loadAll(progress) {
        const user = await this.session();
        let pc = 0, po = 0;
        const report = () => progress && progress(Math.round((po * 0.25 + pc * 0.75) * 100));
        const [outlets, contacts, campaigns, items, profiles, favs, dicts, settings] = await Promise.all([
          fetchAll('outlets', '*', 'id', (d, t) => { po = d / t; report(); }),
          fetchAll('contacts', '*', 'id', (d, t) => { pc = d / t; report(); }),
          fetchAll('campaigns', '*'),
          fetchAll('campaign_items', '*'),
          sb.from('profiles').select('*').then(must),
          sb.from('favorites').select('contact_id').eq('user_id', user.id).then(must),
          sb.from('dictionaries').select('*').order('sort').then(must),
          sb.from('app_settings').select('*').then(must),
        ]);
        return {
          outlets, contacts, campaigns, items, profiles,
          favorites: favs.map(f => f.contact_id),
          dictionaries: dicts, settings: Object.fromEntries(settings.map(s => [s.key, s.value])),
          me: profiles.find(p => p.id === user.id) || { id: user.id, email: user.email, full_name: user.email, role: 'member', theme: 'calm' }
        };
      },
      async insert(table, row) { return must(await sb.from(table).insert(row).select().single()); },
      async insertMany(table, rows) {
        if (!rows.length) return [];
        return must(await sb.from(table).upsert(rows, { onConflict: 'campaign_id,contact_id', ignoreDuplicates: true }).select());
      },
      async update(table, id, patch) { return must(await sb.from(table).update(patch).eq('id', id).select().single()); },
      async remove(table, id) { must(await sb.from(table).delete().eq('id', id)); },
      async notes(contactId) {
        return must(await sb.from('notes').select('*').eq('contact_id', contactId).order('created_at', { ascending: false }));
      },
      async recentNotes(limit = 12) {
        return must(await sb.from('notes').select('*').order('created_at', { ascending: false }).limit(limit));
      },
      async addFavorite(cid, uid) { must(await sb.from('favorites').insert({ contact_id: cid, user_id: uid })); },
      async removeFavorite(cid, uid) { must(await sb.from('favorites').delete().eq('contact_id', cid).eq('user_id', uid)); },
      async audit(table, rowId) {
        return must(await sb.from('audit_log').select('*').eq('table_name', table).eq('row_id', rowId).order('changed_at', { ascending: false }).limit(30));
      },
      async bulkImport(batch) { return must(await sb.rpc('bulk_import', { batch })); },
      async dictAdd(kind, value) { must(await sb.from('dictionaries').insert({ kind, value })); },
      async dictRemove(kind, value) { must(await sb.from('dictionaries').delete().eq('kind', kind).eq('value', value)); },
      async setSetting(key, value) { must(await sb.from('app_settings').upsert({ key, value })); },
      async updateProfile(id, patch) { return must(await sb.from('profiles').update(patch).eq('id', id).select().single()); },
    };
  }

  // ---------------- Демо (данные живут в памяти вкладки) ----------------
  function demoApi() {
    const db = window.MK_DEMO_DATA();
    const seq = {};
    for (const t of Object.keys(db)) if (Array.isArray(db[t])) seq[t] = db[t].reduce((m, r) => Math.max(m, r.id || 0), 0);
    const now = () => new Date().toISOString();
    const clone = x => JSON.parse(JSON.stringify(x));
    const me = db.profiles[0];
    let logged = false;
    const tables = { outlets: 1, contacts: 1, campaigns: 1, campaign_items: 1, notes: 1 };
    const auditLog = (table, id, action, diff) => db.audit_log.push({ id: ++seq.audit_log, table_name: table, row_id: id, action, changed_by: me.id, changed_at: now(), diff });

    return {
      mode: 'demo',
      async session() { return logged ? { id: me.id, email: me.email } : null; },
      async signIn() { logged = true; },
      async signOut() { logged = false; },
      async updatePassword() {},
      async resetPassword() {},
      onAuth() {},
      async loadAll(progress) {
        progress && progress(100);
        return {
          outlets: clone(db.outlets), contacts: clone(db.contacts), campaigns: clone(db.campaigns),
          items: clone(db.campaign_items), profiles: clone(db.profiles), favorites: db.favorites.slice(),
          dictionaries: clone(db.dictionaries), settings: clone(db.settings), me: clone(me)
        };
      },
      async insert(table, row) {
        if (!tables[table]) throw new Error('unknown table');
        const r = Object.assign({}, row, { id: ++seq[table], created_at: now() });
        if (table === 'notes') r.author = me.id;
        if (['outlets', 'contacts', 'campaign_items'].includes(table)) { r.updated_at = now(); r.created_by = me.id; }
        if (table === 'campaigns') r.created_by = me.id;
        db[table].push(r);
        if (table === 'contacts' || table === 'outlets') auditLog(table, r.id, 'insert', null);
        return clone(r);
      },
      async insertMany(table, rows) {
        const out = [];
        for (const row of rows) {
          if (db.campaign_items.some(i => i.campaign_id === row.campaign_id && i.contact_id === row.contact_id)) continue;
          out.push(await this.insert(table, Object.assign({ status: 'not_sent', owner: me.id }, row)));
        }
        return out;
      },
      async update(table, id, patch) {
        const r = db[table].find(x => x.id === id);
        const diff = {};
        for (const k of Object.keys(patch)) if (JSON.stringify(r[k]) !== JSON.stringify(patch[k])) diff[k] = { old: r[k] ?? null, new: patch[k] };
        Object.assign(r, patch, { updated_at: now(), updated_by: me.id });
        if ((table === 'contacts' || table === 'outlets') && Object.keys(diff).length) auditLog(table, id, 'update', diff);
        return clone(r);
      },
      async remove(table, id) {
        db[table] = db[table].filter(x => x.id !== id);
        if (table === 'contacts') { db.notes = db.notes.filter(n => n.contact_id !== id); db.campaign_items = db.campaign_items.filter(i => i.contact_id !== id); }
        if (table === 'campaigns') db.campaign_items = db.campaign_items.filter(i => i.campaign_id !== id);
        if (table === 'outlets') db.contacts.forEach(c => { if (c.outlet_id === id) c.outlet_id = null; });
      },
      async notes(cid) { return clone(db.notes.filter(n => n.contact_id === cid).sort((a, b) => b.created_at.localeCompare(a.created_at))); },
      async recentNotes(limit = 12) { return clone(db.notes.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit)); },
      async addFavorite(cid) { if (!db.favorites.includes(cid)) db.favorites.push(cid); },
      async removeFavorite(cid) { db.favorites = db.favorites.filter(x => x !== cid); },
      async audit(table, rowId) { return clone(db.audit_log.filter(a => a.table_name === table && a.row_id === rowId).reverse()); },
      async bulkImport(batch) {
        let n = 0;
        for (const o of batch) {
          const { contacts = [], ...od } = o;
          const or = await this.insert('outlets', Object.assign({ topics: [], geo: [], sources: [] }, od, { tier: od.tier ? +od.tier : null }));
          for (const c of contacts) {
            const { bd, bm, by, ...cd } = c;
            db.contacts.push(Object.assign({ topics: [], emails: [], phones: [], telegram: [], socials: [], tags: [], sources: [], relation: 'neutral' }, cd, {
              id: ++seq.contacts, outlet_id: or.id, birthday_day: bd || null, birthday_month: bm || null, birthday_year: by || null,
              created_at: now(), updated_at: now()
            }));
            n++;
          }
        }
        return n;
      },
      async dictAdd(kind, value) { db.dictionaries.push({ kind, value, sort: 100 }); },
      async dictRemove(kind, value) { db.dictionaries = db.dictionaries.filter(d => !(d.kind === kind && d.value === value)); },
      async setSetting(key, value) { db.settings[key] = value; },
      async updateProfile(id, patch) { const p = db.profiles.find(x => x.id === id); Object.assign(p, patch); return clone(p); },
    };
  }

  window.MK_API = DEMO ? demoApi() : supabaseApi();
})();
