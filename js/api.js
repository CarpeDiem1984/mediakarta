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

    async function fetchAll(table, columns, order = 'id', onPage, filt) {
      const f = q => filt ? filt(q) : q;
      const { count, error } = await f(sb.from(table).select('id', { count: 'exact', head: true }));
      if (error) throw new Error(error.message);
      const size = 1000, pages = Math.max(1, Math.ceil((count || 0) / size));
      const out = new Array(pages);
      let next = 0, done = 0;
      async function worker() {
        while (next < pages) {
          const p = next++;
          out[p] = must(await f(sb.from(table).select(columns)).order(order).range(p * size, p * size + size - 1));
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
        const alive = q => q.is('deleted_at', null);
        const [outlets, contacts, campaigns, items, profiles, favs, dicts, settings, moves, ignores] = await Promise.all([
          fetchAll('outlets', '*', 'id', (d, t) => { po = d / t; report(); }, alive),
          fetchAll('contacts', '*', 'id', (d, t) => { pc = d / t; report(); }, alive),
          fetchAll('campaigns', '*', 'id', null, alive),
          fetchAll('campaign_items', '*'),
          sb.from('profiles').select('*').then(must),
          sb.from('favorites').select('contact_id').eq('user_id', user.id).then(must),
          sb.from('dictionaries').select('*').order('sort').then(must),
          sb.from('app_settings').select('*').then(must),
          fetchAll('contact_moves', '*'),
          sb.from('dup_ignores').select('kind,a,b').then(must),
        ]);
        return {
          outlets, contacts, campaigns, items, profiles,
          favorites: favs.map(f => f.contact_id),
          dictionaries: dicts, settings: Object.fromEntries(settings.map(s => [s.key, s.value])), moves, ignores,
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
      // --- 2.0 этап 1 ---
      async getRow(table, id) { return must(await sb.from(table).select('*').eq('id', id).single()); },
      async itemsFor(contactId) { return must(await sb.from('campaign_items').select('*').eq('contact_id', contactId)); },
      async softDelete(table, id) { return must(await sb.from(table).update({ deleted_at: new Date().toISOString() }).eq('id', id).select().single()); },
      async restore(table, id) { return must(await sb.from(table).update({ deleted_at: null }).eq('id', id).select().single()); },
      async trash() {
        const q = t => sb.from(t).select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(500).then(must);
        const [outlets, contacts, campaigns] = await Promise.all([q('outlets'), q('contacts'), q('campaigns')]);
        return { outlets, contacts, campaigns };
      },
      async purgeTrash() { return must(await sb.rpc('purge_trash')); },
      async moveContact(id, to, role) { must(await sb.rpc('move_contact', { p_contact: id, p_to: to, p_role: role || null })); },
      async movesFor(id) { return must(await sb.from('contact_moves').select('*').eq('contact_id', id).order('moved_at')); },
      async mergeContacts(keep, drop) { must(await sb.rpc('merge_contacts', { p_keep: keep, p_drop: drop })); },
      async mergeOutlets(keep, drop) { must(await sb.rpc('merge_outlets', { p_keep: keep, p_drop: drop })); },
      async bulkEditContacts(ids, ops) { return must(await sb.rpc('bulk_edit_contacts', { p_ids: ids, ops })); },
      async bulkEditOutlets(ids, ops) { return must(await sb.rpc('bulk_edit_outlets', { p_ids: ids, ops })); },
      async rowsByIds(table, ids) {
        const out = [];
        for (let i = 0; i < ids.length; i += 200) out.push(...must(await sb.from(table).select('*').in('id', ids.slice(i, i + 200))));
        return out;
      },
      async dupIgnore(kind, a, b) { must(await sb.from('dup_ignores').upsert({ kind, a: Math.min(a, b), b: Math.max(a, b) }, { ignoreDuplicates: true })); },
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
    db.contact_moves = db.contact_moves || []; db.dup_ignores = db.dup_ignores || []; seq.contact_moves = 0;
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
        const alive = a => clone(a.filter(r => !r.deleted_at));
        return {
          moves: clone(db.contact_moves), ignores: clone(db.dup_ignores),
          outlets: alive(db.outlets), contacts: alive(db.contacts), campaigns: alive(db.campaigns),
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
      // --- 2.0 этап 1 ---
      async getRow(table, id) { return clone(db[table].find(x => x.id === id)); },
      async itemsFor(cid) { return clone(db.campaign_items.filter(i => i.contact_id === cid)); },
      async softDelete(table, id) { return this.update(table, id, { deleted_at: now(), deleted_by: me.id }); },
      async restore(table, id) { return this.update(table, id, { deleted_at: null, deleted_by: null }); },
      async trash() {
        const q = t => clone(db[t].filter(r => r.deleted_at).sort((a, b) => b.deleted_at.localeCompare(a.deleted_at)));
        return { outlets: q('outlets'), contacts: q('contacts'), campaigns: q('campaigns') };
      },
      async purgeTrash() {
        const old = r => r.deleted_at && Date.now() - new Date(r.deleted_at) > 30 * 864e5;
        let n = 0; for (const t of ['contacts', 'campaigns', 'outlets']) { const before = db[t].length; db[t] = db[t].filter(r => !old(r)); n += before - db[t].length; }
        return n;
      },
      async moveContact(id, to, role) {
        const c = db.contacts.find(x => x.id === id);
        const name = oid => (db.outlets.find(o => o.id === oid) || {}).name || null;
        db.contact_moves.push({ id: ++seq.contact_moves, contact_id: id, from_outlet_id: c.outlet_id, to_outlet_id: to, from_name: name(c.outlet_id), to_name: name(to), from_role: c.role, moved_by: me.id, moved_at: now() });
        await this.update('contacts', id, Object.assign({ outlet_id: to }, role ? { role } : {}));
      },
      async movesFor(id) { return clone(db.contact_moves.filter(m => m.contact_id === id)); },
      async mergeContacts(keep, drop) {
        const k = db.contacts.find(x => x.id === keep), d = db.contacts.find(x => x.id === drop);
        const u = (a, b) => { const out = [], seen = new Set(); for (const x of (a || []).concat(b || [])) { const l = String(x).toLowerCase(); if (x && !seen.has(l)) { seen.add(l); out.push(x); } } return out; };
        for (const f of ['emails', 'phones', 'telegram', 'socials', 'topics', 'tags', 'sources']) k[f] = u(k[f], d[f]);
        for (const f of ['role', 'dept', 'address', 'birthday_day', 'birthday_month', 'birthday_year', 'last_pub_url', 'last_pub_date', 'verified_note']) if (k[f] == null) k[f] = d[f];
        if (k.relation === 'neutral') k.relation = d.relation;
        if (d.comment && d.comment !== k.comment) k.comment = [k.comment, d.comment].filter(Boolean).join('\n\n');
        db.notes.forEach(n => { if (n.contact_id === drop) n.contact_id = keep; });
        db.contact_moves.forEach(m => { if (m.contact_id === drop) m.contact_id = keep; });
        if (db.favorites.includes(drop)) { db.favorites = db.favorites.filter(x => x !== drop); if (!db.favorites.includes(keep)) db.favorites.push(keep); }
        const ord = ['not_sent', 'sent', 'no_reply', 'declined', 'interest', 'published'];
        for (const i of db.campaign_items.filter(i => i.contact_id === drop)) {
          const j = db.campaign_items.find(x => x.contact_id === keep && x.campaign_id === i.campaign_id);
          if (!j) i.contact_id = keep;
          else { if (ord.indexOf(i.status) > ord.indexOf(j.status)) Object.assign(j, i, { id: j.id, contact_id: keep }); db.campaign_items = db.campaign_items.filter(x => x !== i); }
        }
        db.contacts = db.contacts.filter(x => x.id !== drop);
        auditLog('contacts', keep, 'merge', { merged: { old: d, new: keep } });
      },
      async mergeOutlets(keep, drop) {
        const k = db.outlets.find(x => x.id === keep), d = db.outlets.find(x => x.id === drop);
        for (const f of ['topics', 'geo', 'sources']) k[f] = [...new Set((k[f] || []).concat(d[f] || []))];
        for (const f of ['website', 'reach', 'format', 'tier']) if (k[f] == null) k[f] = d[f];
        db.contacts.forEach(c => { if (c.outlet_id === drop) c.outlet_id = keep; });
        db.campaign_items.forEach(i => { if (i.outlet_id === drop) i.outlet_id = keep; });
        db.outlets = db.outlets.filter(x => x.id !== drop);
      },
      async bulkEditContacts(ids, ops) {
        for (const id of ids) {
          const c = db.contacts.find(x => x.id === id); if (!c) continue;
          const patch = {
            topics: [...new Set((c.topics || []).concat(ops.topics_add || []))].filter(x => !(ops.topics_remove || []).includes(x)),
            tags: [...new Set((c.tags || []).concat(ops.tags_add || []))].filter(x => !(ops.tags_remove || []).includes(x)),
          };
          if (ops.relation) patch.relation = ops.relation;
          if (ops.outlet_id) patch.outlet_id = ops.outlet_id;
          await this.update('contacts', id, patch);
        }
        return ids.length;
      },
      async bulkEditOutlets(ids, ops) {
        for (const id of ids) {
          const o = db.outlets.find(x => x.id === id); if (!o) continue;
          const patch = { topics: [...new Set((o.topics || []).concat(ops.topics_add || []))].filter(x => !(ops.topics_remove || []).includes(x)) };
          if (ops.type) patch.type = ops.type;
          if ('tier' in ops) patch.tier = ops.tier ? +ops.tier : null;
          if (ops.geo_set) patch.geo = ops.geo_set;
          await this.update('outlets', id, patch);
        }
        return ids.length;
      },
      async rowsByIds(table, ids) { const s = new Set(ids); return clone(db[table].filter(r => s.has(r.id))); },
      async dupIgnore(kind, a, b) { db.dup_ignores.push({ kind, a: Math.min(a, b), b: Math.max(a, b) }); },
    };
  }

  window.MK_API = DEMO ? demoApi() : supabaseApi();
})();
