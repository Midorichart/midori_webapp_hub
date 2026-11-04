// 저장소. localStorage 에 두고, 로그인돼 있으면 shared/sync.js 가 계정(Supabase)과 맞춘다.
// 과목마다 prefix 가 달라서 같은 주소에서도 데이터가 섞이지 않는다.
//   subscribe(col, cb) -> unsubscribe   (cb 는 변경될 때마다 해당 컬렉션 전체 배열을 받음)
//   add(col, data) -> id / update(col, id, data) / remove(col, id) / bulkAdd(col, list)
// 이미지는 크기 때문에 따로 IndexedDB(images.js)에 둔다.
import { createSync, APPS } from '../../shared/sync.js';

export const COLLECTIONS = ['concepts', 'notes'];

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function createStore(subject) {
  const sync = createSync(subject);
  const prefix = APPS[subject].prefix;
  const listeners = {};
  const read = sync.read;
  const emit = (col) => (listeners[col] || []).forEach((cb) => cb(read(col)));
  const write = (col, items) => {
    sync.write(col, items);
    emit(col);
  };
  sync.onRemote(emit);
  sync.start({ login: '../index.html' });

  // 다른 탭에서 변경된 내용도 반영
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith(prefix)) emit(e.key.slice(prefix.length));
  });

  return {
    mode: 'local',
    subscribe(col, cb) {
      (listeners[col] ||= []).push(cb);
      cb(read(col));
      return () => {
        listeners[col] = listeners[col].filter((fn) => fn !== cb);
      };
    },
    async add(col, data) {
      const id = newId();
      const now = Date.now();
      write(col, [...read(col), { ...data, id, createdAt: now, updatedAt: now }]);
      return id;
    },
    // 백업 가져오기용: 페이지끼리의 링크가 깨지지 않도록 id 를 그대로 쓴다 (이미 있으면 덮어씀)
    async bulkAdd(col, list) {
      const ids = new Set(list.map((d) => d.id));
      write(col, [...read(col).filter((d) => !ids.has(d.id)), ...list.map((d) => ({ ...d, id: d.id || newId() }))]);
    },
    async update(col, id, data) {
      write(col, read(col).map((item) => (item.id === id ? { ...item, ...data } : item)));
    },
    async remove(col, id) {
      write(col, read(col).filter((item) => item.id !== id));
    },
  };
}
