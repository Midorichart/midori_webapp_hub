// 클라우드(Supabase) 동기화.
// 과목 앱의 저장소(store.js)는 지금처럼 localStorage 를 읽고 쓰고, 쓸 때마다 바뀐 항목만 골라 study_items 테이블로 올린다.
// 다른 기기에서 바뀐 내용은 실시간으로 받아 localStorage 에 반영하고 화면을 다시 그리게 한다.
// 인터넷이 끊겨도 바뀐 내용은 대기열(localStorage)에 남았다가 연결되면 올라간다.
// config.js 가 비어 있으면 아무것도 하지 않는다 (예전처럼 로컬 모드).

export const APPS = {
  japanese: { prefix: 'midori-study:', name: '일본어' },
  english: { prefix: 'midori-english:', name: '영어' },
  math: { prefix: 'midori-math:', name: '수학', images: 'midori-math' },
  physics: { prefix: 'midori-physics:', name: '물리', images: 'midori-physics' },
  chemistry: { prefix: 'midori-chemistry:', name: '화학', images: 'midori-chemistry' },
};

const TABLE = 'study_items';
const BUCKET = 'study-images';
const QUEUE_KEY = 'midori-sync:queue'; // { 'app|col|id': { app, col, id, data | null(삭제) } }
const IMG_QUEUE_KEY = 'midori-sync:images'; // [{ db, id, op: 'put' | 'del' }]
const OWNER_KEY = 'midori-sync:owner'; // 이 브라우저의 캐시가 누구 계정 것인지

const cfg = window.STUDY_CONFIG || {};
export const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
export const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

const readJSON = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJSON = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const qkey = (app, col, id) => `${app}|${col}|${id}`;

/* ---------- 상태 알림 (대시보드가 표시) ---------- */

export const pendingCount = () => Object.keys(readJSON(QUEUE_KEY, {})).length + readJSON(IMG_QUEUE_KEY, []).length;

let lastState = configured ? 'idle' : 'local';
export const syncState = () => lastState;
function setState(state) {
  lastState = state;
  window.dispatchEvent(new CustomEvent('study-sync', { detail: { state, pending: pendingCount() } }));
}

/* ---------- 계정 ---------- */

let userP;
const getUser = () => sb.auth.getSession().then(({ data }) => data.session?.user || null);

// 로그인돼 있으면 사용자, 아니면 null. 처음 로그인한 브라우저라면 원래 있던 데이터를 어떻게 할지 정한다.
export function currentUser() {
  if (!configured) return Promise.resolve(null);
  return (userP ||= getUser().then(async (user) => {
    if (user && localStorage.getItem(OWNER_KEY) !== user.id) await adopt(user);
    return user;
  }));
}

export async function login(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  userP = null;
  return currentUser();
}

export async function logout() {
  const n = pendingCount();
  if (n && !confirm(`아직 계정에 올라가지 않은 변경이 ${n}개 있어요. 그래도 로그아웃할까요?`)) return false;
  await sb.auth.signOut();
  await clearCache();
  localStorage.removeItem(OWNER_KEY);
  userP = null;
  return true;
}

const appKeys = (app) => Object.keys(localStorage).filter((k) => k.startsWith(APPS[app].prefix));
const localCount = () =>
  Object.keys(APPS).reduce((sum, app) => sum + appKeys(app).reduce((s, k) => s + readJSON(k, []).length, 0), 0);

// 이 브라우저의 학습 데이터(캐시)를 지운다. 화면 설정(pref)은 남긴다.
async function clearCache() {
  for (const app of Object.keys(APPS)) appKeys(app).forEach((k) => localStorage.removeItem(k));
  localStorage.removeItem(QUEUE_KEY);
  localStorage.removeItem(IMG_QUEUE_KEY);
  await Promise.all(
    Object.values(APPS)
      .filter((a) => a.images)
      .map((a) => new Promise((resolve) => Object.assign(indexedDB.deleteDatabase(a.images), { onsuccess: resolve, onerror: resolve, onblocked: resolve }))),
  );
}

// 로그인 전에(로컬 모드로) 이 브라우저에 저장한 데이터가 있으면 계정에 합칠지 묻는다.
// 다른 계정이 쓰던 캐시라면 묻지 않고 지운다.
async function adopt(user) {
  const owner = localStorage.getItem(OWNER_KEY);
  const n = owner ? 0 : localCount();
  if (n && confirm(`이 브라우저에 로그인 전에 저장한 학습 데이터가 ${n}개 있어요. 계정에 합칠까요?\n취소하면 이 브라우저의 데이터는 지우고 계정 데이터만 보여요.`)) {
    const ops = [];
    for (const app of Object.keys(APPS)) {
      for (const key of appKeys(app)) {
        const col = key.slice(APPS[app].prefix.length);
        for (const x of readJSON(key, [])) if (x?.id != null) ops.push({ app, col, id: String(x.id), data: x });
      }
    }
    enqueue(ops);
    for (const a of Object.values(APPS)) {
      if (!a.images) continue;
      const db = await openDB(a.images);
      for (const { id } of await idb(db, 'readonly', (s) => s.getAll())) queueImage(a.images, id, 'put');
    }
  } else {
    await clearCache();
  }
  localStorage.setItem(OWNER_KEY, user.id);
}

/* ---------- 올리기 (대기열) ---------- */

function enqueue(ops) {
  if (!ops.length) return;
  const q = readJSON(QUEUE_KEY, {});
  for (const op of ops) q[qkey(op.app, op.col, op.id)] = op;
  writeJSON(QUEUE_KEY, q);
  scheduleFlush();
}

let flushTimer;
let flushing = null;
function scheduleFlush(delay = 400) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, delay);
}

export function flush() {
  if (flushing) return flushing.then(() => pendingCount() && flush());
  flushing = (async () => {
    const user = await currentUser();
    if (!user) return;
    if (!navigator.onLine) return setState('offline');
    setState('saving');

    const sent = readJSON(QUEUE_KEY, {});
    const ops = Object.values(sent);
    const now = new Date().toISOString();
    const ups = ops.filter((o) => o.data).map((o) => ({ user_id: user.id, app: o.app, col: o.col, id: o.id, data: o.data, updated_at: now }));
    for (const part of chunks(ups, 500)) {
      const { error } = await sb.from(TABLE).upsert(part);
      if (error) throw error;
    }
    const dels = {};
    for (const o of ops) if (!o.data) (dels[`${o.app}|${o.col}`] ||= []).push(o.id);
    for (const [ac, ids] of Object.entries(dels)) {
      const [app, col] = ac.split('|');
      for (const part of chunks(ids, 200)) {
        const { error } = await sb.from(TABLE).delete().eq('user_id', user.id).eq('app', app).eq('col', col).in('id', part);
        if (error) throw error;
      }
    }
    // 보내는 동안 다시 바뀐 항목은 대기열에 남긴다
    const q = readJSON(QUEUE_KEY, {});
    for (const [k, o] of Object.entries(sent)) if (JSON.stringify(q[k]) === JSON.stringify(o)) delete q[k];
    writeJSON(QUEUE_KEY, q);

    await flushImages(user);
    setState(pendingCount() ? 'saving' : 'synced');
  })()
    .catch((err) => {
      console.warn('동기화 실패:', err);
      setState('error');
      scheduleFlush(15000);
    })
    .finally(() => {
      flushing = null;
      if (lastState === 'saving') scheduleFlush();
    });
  return flushing;
}

window.addEventListener('online', () => configured && flush());

/* ---------- 과목 앱 저장소용 ---------- */

// 같은 순서를 유지하며 목록을 맞춘다: 원래 있던 항목은 그 자리에서 바뀌고, 새 항목은 만든 순서대로 뒤에 붙는다
function mergeOrder(local, incoming) {
  const map = new Map(incoming.map((x) => [String(x.id), x]));
  const out = [];
  for (const x of local) {
    const y = map.get(String(x.id));
    if (y) {
      out.push(y);
      map.delete(String(x.id));
    }
  }
  return [...out, ...[...map.values()].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))];
}

function diff(app, col, before, after) {
  const old = new Map(before.filter((x) => x?.id != null).map((x) => [String(x.id), JSON.stringify(x)]));
  const ops = [];
  for (const x of after) {
    if (x?.id == null) continue;
    const id = String(x.id);
    if (old.get(id) !== JSON.stringify(x)) ops.push({ app, col, id, data: x });
    old.delete(id);
  }
  for (const id of old.keys()) ops.push({ app, col, id, data: null });
  return ops;
}

// 한 과목 앱의 목록을 읽고 쓰면서 클라우드와 맞추는 도구.
//   read(col) / write(col, items): localStorage 그대로, write 는 바뀐 항목을 올린다
//   onRemote(fn): 다른 기기에서 받은 변경으로 목록이 바뀌면 fn(col)
//   start({ login }): 로그인돼 있으면 계정 데이터를 받아 오고 실시간 연결. 로그인이 필요하면 login 주소로 보낸다
export function createSync(app) {
  const { prefix } = APPS[app];
  const listeners = new Set();
  const read = (col) => readJSON(prefix + col, []);
  const save = (col, items) => {
    const s = JSON.stringify(items);
    if (localStorage.getItem(prefix + col) === s) return false;
    localStorage.setItem(prefix + col, s);
    return true;
  };
  const changed = (col) => listeners.forEach((fn) => fn(col));

  function write(col, items) {
    const before = configured ? read(col) : null;
    localStorage.setItem(prefix + col, JSON.stringify(items));
    if (configured) enqueue(diff(app, col, before, items));
  }

  // 계정 데이터를 받아 와서 이 기기의 아직 안 올라간 변경을 그 위에 다시 얹는다
  let lastPull = 0;
  async function pull() {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(TABLE).select('col,id,data').eq('app', app).order('col').order('id').range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    lastPull = Date.now();
    const by = {};
    for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) by[key.slice(prefix.length)] = [];
    for (const r of rows) (by[r.col] ||= []).push(r.data);
    for (const o of Object.values(readJSON(QUEUE_KEY, {}))) {
      if (o.app !== app) continue;
      const list = (by[o.col] ||= []);
      const i = list.findIndex((x) => String(x.id) === o.id);
      if (o.data) i >= 0 ? (list[i] = o.data) : list.push(o.data);
      else if (i >= 0) list.splice(i, 1);
    }
    for (const [col, list] of Object.entries(by)) if (save(col, mergeOrder(read(col), list))) changed(col);
  }

  function listen(user) {
    sb.channel(`study-${app}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, (p) => {
        const row = p.eventType === 'DELETE' ? p.old : p.new;
        if (!row || row.app !== app || (row.user_id && row.user_id !== user.id)) return;
        if (readJSON(QUEUE_KEY, {})[qkey(app, row.col, row.id)]) return; // 이 기기에서 더 나중에 바꾼 것
        const list = read(row.col);
        const i = list.findIndex((x) => String(x.id) === row.id);
        if (p.eventType === 'DELETE') {
          if (i < 0) return;
          list.splice(i, 1);
        } else if (i >= 0) list[i] = row.data;
        else list.push(row.data);
        if (save(row.col, list)) changed(row.col);
      })
      .subscribe((status) => {
        // 연결이 끊겼다 다시 붙으면 그사이 바뀐 것을 받아 온다
        if (status === 'SUBSCRIBED' && lastPull && Date.now() - lastPull > 5000) pull().catch(() => {});
      });
  }

  async function start({ login } = {}) {
    if (!configured) return 'local';
    const user = await currentUser();
    if (!user) {
      if (login) location.replace(login);
      return 'login';
    }
    sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && login) location.replace(login);
    });
    try {
      await pull();
      setState(pendingCount() ? 'saving' : 'synced');
    } catch (err) {
      console.warn('계정 데이터를 받아 오지 못했어요:', err);
      setState(navigator.onLine ? 'error' : 'offline');
    }
    listen(user);
    flush();
    // 다른 창·탭에서 돌아왔을 때 한 번 더 맞춘다
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastPull > 30000) pull().catch(() => {});
    });
    window.addEventListener('online', () => pull().catch(() => {}));
    return 'cloud';
  }

  return { read, write, start, onRemote: (fn) => listeners.add(fn) };
}

/* ---------- 이미지 (IndexedDB 캐시 + Storage) ---------- */

export function openDB(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('images', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function idb(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction('images', mode);
    const req = fn(t.objectStore('images'));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
  });
}

export function queueImage(db, id, op) {
  if (!configured) return;
  const q = readJSON(IMG_QUEUE_KEY, []).filter((x) => !(x.db === db && x.id === id));
  q.push({ db, id, op });
  writeJSON(IMG_QUEUE_KEY, q);
  scheduleFlush();
}

async function flushImages(user) {
  let q = readJSON(IMG_QUEUE_KEY, []);
  const dbs = {};
  for (const item of [...q]) {
    const path = `${user.id}/${item.db}/${item.id}`;
    if (item.op === 'put') {
      const db = (dbs[item.db] ||= await openDB(item.db));
      const rec = await idb(db, 'readonly', (s) => s.get(item.id));
      if (rec) {
        const { error } = await sb.storage.from(BUCKET).upload(path, rec.blob, { upsert: true, contentType: rec.blob.type || undefined });
        if (error) throw error;
      }
    } else {
      const { error } = await sb.storage.from(BUCKET).remove([path]);
      if (error) throw error;
    }
    // 그사이 같은 이미지에 새 작업이 들어왔으면 남긴다
    q = readJSON(IMG_QUEUE_KEY, []).filter((x) => x !== item && !(x.db === item.db && x.id === item.id && x.op === item.op));
    writeJSON(IMG_QUEUE_KEY, q);
  }
}

// 이 기기에 없는 이미지를 계정에서 받아 온다 (없으면 null)
export async function downloadImage(db, id) {
  const user = await currentUser();
  if (!user) return null;
  const { data, error } = await sb.storage.from(BUCKET).download(`${user.id}/${db}/${id}`);
  return error ? null : data;
}

// 계정에 올라가 있는 이미지 id 목록
export async function listImages(db) {
  const user = await currentUser();
  if (!user) return [];
  const ids = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.storage.from(BUCKET).list(`${user.id}/${db}`, { limit: 1000, offset });
    if (error) throw error;
    ids.push(...data.map((f) => f.name));
    if (data.length < 1000) return ids;
  }
}
