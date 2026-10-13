#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Медиакарта · автообновление статистики площадок и поиск свежих публикаций.
Запускается GitHub Actions по расписанию (см. .github/workflows/mediakarta-stats.yml).

  python scripts/update_stats.py stats   — подписчики Telegram / YouTube / VK
  python scripts/update_stats.py pubs    — свежие материалы ключевых журналистов (Google News RSS)

Переменные окружения (задаются в GitHub → Settings → Secrets and variables → Actions):
  SUPABASE_URL           https://xxxx.supabase.co
  SUPABASE_SERVICE_KEY   секретный ключ (sb_secret_… или service_role). Никогда не кладите его в код!
  YOUTUBE_API_KEY        ключ YouTube Data API v3 (необязательно)
  VK_TOKEN               сервисный ключ приложения VK (необязательно)
  PUBS_LIMIT             сколько журналистов проверять за запуск (по умолчанию 400)
"""
import json, os, re, sys, time, html, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
import xml.etree.ElementTree as ET

URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
YT = os.environ.get('YOUTUBE_API_KEY', '')
VK = os.environ.get('VK_TOKEN', '')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
NOW = datetime.now(timezone.utc)


def log(*a):
    print(*a, flush=True)


# ---------------- Supabase REST ----------------
def sb(method, path, body=None, prefer=None):
    headers = {'apikey': KEY, 'Content-Type': 'application/json'}
    if KEY.startswith('eyJ'):
        headers['Authorization'] = 'Bearer ' + KEY  # старый формат ключа
    if prefer:
        headers['Prefer'] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(URL + '/rest/v1/' + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'Supabase {method} {path}: {e.code} {e.read().decode()[:300]}')


def sb_all(path):
    out, step = [], 1000
    while True:
        sep = '&' if '?' in path else '?'
        chunk = sb('GET', f'{path}{sep}limit={step}&offset={len(out)}')
        out += chunk
        if len(chunk) < step:
            return out


def get(url, params=None, timeout=30):
    if params:
        url += ('&' if '?' in url else '?') + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'ru,en;q=0.8'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8', 'replace')


# ---------------- Определение площадки ----------------
def detect(website):
    w = (website or '').strip()
    if not w:
        return None, None
    m = re.search(r'(?:t\.me|telegram\.me)/(?:s/)?([A-Za-z0-9_+]+)', w)
    if m:
        h = m.group(1)
        return 'telegram', (None if h.startswith('+') or h.lower() == 'joinchat' else h)
    m = re.search(r'youtube\.com/(@[\w.\-]+|channel/[\w\-]+|c/[\w.\-]+|user/[\w.\-]+)', w, re.I)
    if m:
        return 'youtube', m.group(1)
    m = re.search(r'vk\.com/([\w.]+)', w, re.I)
    if m:
        return 'vk', m.group(1)
    m = re.search(r'instagram\.com/([\w.]+)', w, re.I)
    if m:
        return 'instagram', m.group(1)
    return 'web', None


def num(s):
    return int(re.sub(r'[^\d]', '', s))


# ---------------- Источники ----------------
def tg_subscribers(handle):
    page = get('https://t.me/' + handle)
    m = re.search(r'tgme_page_extra[^>]*>\s*([\d\s ]+)\s*(subscriber|member|подписчик|участник)', page, re.I)
    if not m:
        if 'tgme_page_extra' not in page:
            raise ValueError('канал не найден или закрыт')
        raise ValueError('не нашли число подписчиков на странице')
    return num(m.group(1))


def yt_subscribers(ref):
    if not YT:
        raise ValueError('нет ключа YOUTUBE_API_KEY')
    p = {'part': 'statistics', 'key': YT}
    if ref.startswith('@'):
        p['forHandle'] = ref
    elif ref.startswith('channel/'):
        p['id'] = ref.split('/', 1)[1]
    elif ref.startswith('user/'):
        p['forUsername'] = ref.split('/', 1)[1]
    else:  # /c/имя — пробуем как handle
        p['forHandle'] = '@' + ref.split('/', 1)[1]
    d = json.loads(get('https://www.googleapis.com/youtube/v3/channels', p))
    items = d.get('items') or []
    if not items:
        raise ValueError('канал не найден, проверьте ссылку')
    st = items[0]['statistics']
    if st.get('hiddenSubscriberCount'):
        raise ValueError('канал скрывает число подписчиков')
    return int(st['subscriberCount'])


def vk_subscribers(name):
    if not VK:
        raise ValueError('нет ключа VK_TOKEN')
    d = json.loads(get('https://api.vk.com/method/groups.getById', {'group_id': name, 'fields': 'members_count', 'v': '5.199', 'access_token': VK}))
    if 'response' in d:
        r = d['response']
        g = (r.get('groups') if isinstance(r, dict) else r) or []
        if g and 'members_count' in g[0]:
            return int(g[0]['members_count'])
    d = json.loads(get('https://api.vk.com/method/users.get', {'user_ids': name, 'fields': 'followers_count', 'v': '5.199', 'access_token': VK}))
    if d.get('response') and 'followers_count' in d['response'][0]:
        return int(d['response'][0]['followers_count'])
    raise ValueError('страница VK не найдена или закрыта: ' + json.dumps(d.get('error', {}), ensure_ascii=False)[:120])


SOURCES = {'telegram': tg_subscribers, 'youtube': yt_subscribers, 'vk': vk_subscribers}


def run_stats():
    outlets = sb_all('outlets?select=id,name,website,platform,platform_handle&deleted_at=is.null&website=not.is.null')
    stat = {'ok': 0, 'failed': 0, 'skipped': 0, 'by': {}}
    for o in outlets:
        platform, handle = detect(o['website'])
        if platform not in SOURCES:
            if platform and platform != o.get('platform'):
                sb('PATCH', f"outlets?id=eq.{o['id']}", {'platform': platform})
            continue
        if not handle:
            sb('PATCH', f"outlets?id=eq.{o['id']}", {'platform': platform, 'stats_error': 'закрытая ссылка-приглашение, нужна публичная ссылка'})
            stat['skipped'] += 1
            continue
        try:
            value = SOURCES[platform](handle)
            sb('PATCH', f"outlets?id=eq.{o['id']}", {'platform': platform, 'platform_handle': handle, 'subscribers': value,
                                                    'subscribers_at': NOW.isoformat(), 'stats_source': 'auto', 'stats_error': None})
            sb('POST', 'outlet_stats', {'outlet_id': o['id'], 'metric': 'subscribers', 'value': value, 'source': 'auto'})
            stat['ok'] += 1
            stat['by'][platform] = stat['by'].get(platform, 0) + 1
            log(f"✓ {platform:9} {o['name'][:40]:40} {value:>12,}")
        except Exception as e:
            stat['failed'] += 1
            sb('PATCH', f"outlets?id=eq.{o['id']}", {'platform': platform, 'platform_handle': handle, 'stats_error': str(e)[:200]})
            log(f"✗ {platform:9} {o['name'][:40]:40} {e}")
        time.sleep(1.2 if platform == 'telegram' else 0.2)
    stat['at'] = NOW.isoformat()
    sb('POST', 'app_settings?on_conflict=key', {'key': 'stats_last_run', 'value': stat}, prefer='resolution=merge-duplicates')
    log('Итог:', json.dumps(stat, ensure_ascii=False))


# ---------------- Свежие публикации ----------------
def domain_of(url):
    m = re.match(r'^(?:https?://)?(?:www\.)?([^/]+)', (url or '').strip().lower())
    return m.group(1) if m and '.' in m.group(1) else None


def run_pubs():
    limit = int(os.environ.get('PUBS_LIMIT', '400'))
    outlets = {o['id']: o for o in sb_all('outlets?select=id,name,website,tier,type&deleted_at=is.null')}
    favs = {f['contact_id'] for f in sb_all('favorites?select=contact_id')}
    contacts = sb_all('contacts?select=id,name,outlet_id,is_desk,inactive&deleted_at=is.null&is_desk=eq.false&inactive=eq.false')
    def key(c):
        o = outlets.get(c['outlet_id']) or {}
        return (0 if c['id'] in favs else 1, o.get('tier') or 9)
    pick = [c for c in contacts if len(c['name'].split()) >= 2 and (c['id'] in favs or (outlets.get(c['outlet_id']) or {}).get('tier') == 1)
            and domain_of((outlets.get(c['outlet_id']) or {}).get('website'))]
    pick.sort(key=key)
    pick = pick[:limit]
    since = NOW - timedelta(days=120)
    found = 0
    for c in pick:
        o = outlets[c['outlet_id']]
        dom = domain_of(o['website'])
        q = f'"{c["name"]}" site:{dom}'
        try:
            xml = get('https://news.google.com/rss/search', {'q': q, 'hl': 'ru', 'gl': 'RU', 'ceid': 'RU:ru'})
            root = ET.fromstring(xml)
            rows = []
            for it in root.iter('item'):
                title = html.unescape(it.findtext('title') or '')
                link = it.findtext('link') or ''
                try:
                    dt = parsedate_to_datetime(it.findtext('pubDate'))
                except Exception:
                    dt = None
                if not link or (dt and dt < since):
                    continue
                rows.append({'contact_id': c['id'], 'url': link, 'title': title[:300], 'published_at': dt.isoformat() if dt else None, 'source': 'google_news'})
                if len(rows) >= 5:
                    break
            if rows:
                sb('POST', 'contact_pubs?on_conflict=contact_id,url', rows, prefer='resolution=ignore-duplicates')
                found += len(rows)
                log(f"✓ {c['name'][:30]:30} {o['name'][:25]:25} {len(rows)}")
        except Exception as e:
            log(f"✗ {c['name'][:30]:30} {e}")
        time.sleep(1.5)
    sb('POST', 'app_settings?on_conflict=key', {'key': 'pubs_last_run', 'value': {'at': NOW.isoformat(), 'checked': len(pick), 'found': found}},
       prefer='resolution=merge-duplicates')
    log(f'Проверено журналистов: {len(pick)}, найдено материалов: {found}')


if __name__ == '__main__':
    if not URL or not KEY:
        sys.exit('Не заданы SUPABASE_URL и SUPABASE_SERVICE_KEY (GitHub → Settings → Secrets → Actions)')
    mode = sys.argv[1] if len(sys.argv) > 1 else 'stats'
    {'stats': run_stats, 'pubs': run_pubs}[mode]()
