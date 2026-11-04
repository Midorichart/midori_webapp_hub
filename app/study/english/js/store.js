// 저장소. localStorage 에 두고, 로그인돼 있으면 shared/sync.js 가 계정(Supabase)과 맞춘다.
// 인터페이스:
//   subscribe(col, cb) -> unsubscribe   (cb 는 변경될 때마다 해당 컬렉션 전체 배열을 받음)
//   add(col, data) / update(col, id, data) / remove(col, id) / bulkAdd(col, list)
// templates: 라이팅·스피킹 템플릿 구절, answers: 풀이 노트 (둘 다 skill: 'writing' | 'speaking')
// (예전 Grammar 탭의 'grammar' 데이터는 지우지 않고 그대로 남겨 둔다)
import { createSync } from '../../shared/sync.js';

export const COLLECTIONS = ['vocab', 'templates', 'answers'];

const PREFIX = 'midori-english:';
const sync = createSync('english');

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const readLocal = sync.read;

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
    // 가져온 항목의 id 는 겹치지 않으면 그대로 둔다 (템플릿 폴더의 parent 연결이 유지되도록)
    async bulkAdd(col, list) {
      const now = Date.now();
      const items = readLocal(col);
      const used = new Set(items.map((x) => x.id));
      const added = list.map((data, i) => {
        const id = data.id && !used.has(data.id) ? data.id : newId();
        used.add(id);
        return { createdAt: now + i, ...data, id };
      });
      write(col, [...items, ...added]);
    },
    async update(col, id, data) {
      write(col, readLocal(col).map((item) => (item.id === id ? { ...item, ...data } : item)));
    },
    async remove(col, id) {
      write(col, readLocal(col).filter((item) => item.id !== id));
    },
  };
}
