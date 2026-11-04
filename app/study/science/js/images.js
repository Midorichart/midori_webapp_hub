// 첨부 이미지는 IndexedDB 에 { id, blob } 으로 저장한다 (localStorage 는 용량이 작아서).
// 로그인돼 있으면 계정(Supabase Storage)에도 올리고, 이 기기에 없는 이미지는 계정에서 받아 온다.
import { openDB, idb, queueImage, downloadImage, listImages, configured } from '../../shared/sync.js?v=a8780c44';

let dbp;
let dbName;
const urls = new Map(); // id -> object URL

export function openImages(name) {
  dbName = name;
  return (dbp = openDB(name));
}

const tx = async (mode, fn) => idb(await dbp, mode, fn);

export async function putImage(id, blob) {
  await tx('readwrite', (s) => s.put({ id, blob }));
  queueImage(dbName, id, 'put');
}

// 백업 내보내기용: 계정에만 있고 이 기기에 없는 이미지도 받아 와서 모두 돌려준다
export async function allImages() {
  if (configured) {
    const have = new Set(await tx('readonly', (s) => s.getAllKeys()));
    for (const id of await listImages(dbName).catch(() => [])) {
      if (have.has(id)) continue;
      const blob = await downloadImage(dbName, id);
      if (blob) await tx('readwrite', (s) => s.put({ id, blob }));
    }
  }
  return tx('readonly', (s) => s.getAll());
}

export function deleteImage(id) {
  if (urls.get(id)) URL.revokeObjectURL(urls.get(id));
  urls.delete(id);
  queueImage(dbName, id, 'del');
  return tx('readwrite', (s) => s.delete(id));
}

export async function imageURL(id) {
  if (!urls.has(id)) {
    let blob = (await tx('readonly', (s) => s.get(id)))?.blob;
    if (!blob && configured) {
      blob = await downloadImage(dbName, id);
      if (blob) await tx('readwrite', (s) => s.put({ id, blob }));
    }
    if (!blob) return ''; // 아직 올라가는 중일 수 있으니 실패는 기억하지 않는다
    urls.set(id, URL.createObjectURL(blob));
  }
  return urls.get(id);
}
