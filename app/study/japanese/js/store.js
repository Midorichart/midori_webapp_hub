// 저장소. localStorage 에 두고, 로그인돼 있으면 shared/sync.js 가 계정(Supabase)과 맞춘다.
// 인터페이스:
//   subscribe(col, cb) -> unsubscribe   (cb 는 변경될 때마다 해당 컬렉션 전체 배열을 받음)
//   add(col, data) / update(col, id, data) / remove(col, id) / bulkAdd(col, list)
import { createSync } from '../../shared/sync.js?v=a8780c44';

export const COLLECTIONS = ['vocab', 'grammar', 'known']; // known: 한자 표시 { kanji, status: 'known' | 'confused' }

const PREFIX = 'midori-study:';
const sync = createSync('japanese');

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const readLocal = sync.read;

export function localItemCount() {
  return COLLECTIONS.reduce((sum, col) => sum + readLocal(col).length, 0);
}

export function clearLocal() {
  COLLECTIONS.forEach((col) => localStorage.removeItem(PREFIX + col));
}

export function createLocalStore() {
  const listeners = {};

  const emit = (col) => (listeners[col] || []).forEach((cb) => cb(readLocal(col)));
  const write = (col, items) => {
    sync.write(col, items);
    emit(col);
  };
  sync.onRemote(emit);
  sync.start({ login: '../index.html' });

  // 다른 탭에서 변경된 내용도 반영
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith(PREFIX)) emit(e.key.slice(PREFIX.length));
  });

  return {
    mode: 'local',
    subscribe(col, cb) {
      (listeners[col] ||= []).push(cb);
      cb(readLocal(col));
      return () => {
        listeners[col] = listeners[col].filter((fn) => fn !== cb);
      };
    },
    async add(col, data) {
      write(col, [...readLocal(col), { ...data, id: newId(), createdAt: Date.now() }]);
    },
    async bulkAdd(col, list) {
      const now = Date.now();
      const added = list.map((data, i) => ({ createdAt: now + i, ...data, id: newId() }));
      write(col, [...readLocal(col), ...added]);
    },
    async update(col, id, data) {
      write(col, readLocal(col).map((item) => (item.id === id ? { ...item, ...data } : item)));
    },
    async remove(col, id) {
      write(col, readLocal(col).filter((item) => item.id !== id));
    },
  };
}
