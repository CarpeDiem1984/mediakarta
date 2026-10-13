/* Настройки подключения к базе.
   Пока поля пустые, Медиакарта работает в демо-режиме на тестовых данных.
   Где взять значения: Supabase → Project Settings → API (или кнопка Connect).
   Ключ anon public можно хранить в открытом коде: доступ к данным закрыт паролями и правилами базы. */
window.MK_CONFIG = {
  supabaseUrl: 'https://zbminuoppselbjxcefaf.supabase.co',      // например: 'https://abcdefgh.supabase.co'
  supabaseAnonKey: 'sb_publishable_JUlXLnG0ow69bf9aDngA4Q_E72fNT-Q',  // ключ Publishable (sb_publishable_...) или старый anon (eyJ...)
};
