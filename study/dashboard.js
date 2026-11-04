// 학습 대시보드: 과목별 앱이 저장해 둔 데이터(localStorage)를 읽어서 진도만 요약한다.
// 저장 형식은 japanese/js/store.js, english/js/store.js, science/js/store.js 와 같다.
// 계정 연결(config.js)이 있으면 로그인 · 동기화 상태 · 전체 백업/복원도 여기서 한다.
import * as sync from './shared/sync.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
}

const stat = (n, label, cls = '') => `<div class="stat ${cls}"><b>${n}</b><span>${label}</span></div>`;
const sub = (items) => `<div class="sub">${items.filter(Boolean).join('<i>·</i>')}</div>`;
const clipText = (s, n = 30) => (String(s ?? '').length > n ? String(s).slice(0, n - 1) + '…' : String(s ?? ''));

function ago(t) {
  if (!t) return '';
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  if (min < 60 * 24) return `${Math.round(min / 60)}시간 전`;
  return `${Math.round(min / 60 / 24)}일 전`;
}

function japanese() {
  const vocab = read('midori-study:vocab');
  const grammar = read('midori-study:grammar');
  const kanji = read('midori-study:known');
  const studying = vocab.filter((v) => !v.done);
  const count = (list, st) => list.filter((x) => (x.status || 'known') === st).length;
  $('#stats-japanese').innerHTML =
    stat(studying.length, '학습 중 단어') +
    stat(vocab.length - studying.length, '학습 완료', 'muted') +
    stat(grammar.length, '문법') +
    stat(`${count(kanji, 'known')}<small>/2136</small>`, '외운 한자') +
    sub([
      `단어 외움 <em class="known">${studying.filter((v) => v.status === 'known').length}</em>`,
      `헷갈림 <em class="confused">${studying.filter((v) => v.status === 'confused').length}</em>`,
      `헷갈리는 한자 <em class="confused">${count(kanji, 'confused')}</em>`,
    ]);
  const last = [...vocab, ...grammar].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
  $('#recent-japanese').innerHTML = last ? `최근 추가 · <span class="jp">${esc(last.word || last.title)}</span> <time>${ago(last.createdAt)}</time>` : '';
}

function english() {
  const vocab = read('midori-english:vocab');
  const answers = read('midori-english:answers');
  const templates = read('midori-english:templates').filter((t) => t.kind !== 'folder');
  const studying = vocab.filter((v) => !v.done);
  const count = (st) => studying.filter((v) => v.status === st).length;
  $('#stats-english').innerHTML =
    stat(studying.length, '학습 중 단어') +
    stat(vocab.length - studying.length, '학습 완료', 'muted') +
    stat(count('known'), '외움') +
    stat(answers.length, '풀이 노트') +
    sub([`헷갈림 <em class="confused">${count('confused')}</em>`, `템플릿 <em>${templates.length}</em>`]);
  const last = [...vocab, ...answers].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
  $('#recent-english').innerHTML = last ? `최근 추가 · ${esc(clipText(last.word || last.question || last.answer))} <time>${ago(last.createdAt)}</time>` : '';
}

function science(subject) {
  const concepts = read(`midori-${subject}:concepts`);
  const notes = read(`midori-${subject}:notes`);
  const blocks = (p) => [p.blocks, p.problem, p.solution, p.used, p.memo].flat().filter(Boolean);
  const all = [...concepts, ...notes].flatMap(blocks);
  const reg = (type) => all.filter((b) => b.type === type && b.reg).length;
  const kind = (k) => notes.filter((n) => (n.kind || 'wrong') === k).length;
  $(`#stats-${subject}`).innerHTML =
    stat(concepts.length, '개념') +
    stat(notes.length, '오답') +
    stat(reg('formula'), '수식') +
    stat(reg('memo'), '암기') +
    (notes.length
      ? sub([`틀림 <em class="wrong">${kind('wrong')}</em>`, `헷갈림 <em class="confused">${kind('confused')}</em>`, `모름 <em class="unknown">${kind('unknown')}</em>`])
      : '');
  const last = [...concepts, ...notes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  $(`#recent-${subject}`).innerHTML = last ? `최근 수정 · ${esc(last.title || '(제목 없음)')} <time>${ago(last.updatedAt)}</time>` : '';
}

function render() {
  $('#today').textContent = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  japanese();
  english();
  ['math', 'physics', 'chemistry'].forEach(science);
}

// 다른 창에서 공부하고 돌아왔을 때 다시 계산
window.addEventListener('pageshow', render);
window.addEventListener('storage', render);

/* ---------- 계정 · 동기화 ---------- */

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3000);
}

const STATE_LABEL = {
  idle: '연결 중…',
  synced: '동기화됨',
  saving: '올리는 중…',
  offline: '오프라인 · 연결되면 올려요',
  error: '동기화 오류 · 다시 시도해요',
};

function showStatus() {
  const el = $('#sync-state');
  if (!el) return;
  const state = sync.syncState();
  const n = sync.pendingCount();
  el.className = 'sync-state ' + state;
  el.textContent = STATE_LABEL[state] + (n && state !== 'synced' ? ` (${n})` : '');
}
window.addEventListener('study-sync', showStatus);

function showAccount(user) {
  $('#account').innerHTML = `
    ${user ? `<span class="sync-state" id="sync-state"></span><span class="who" title="${esc(user.email)}">${esc(user.email)}</span>` : ''}
    <button type="button" data-acc="backup" title="모든 과목 데이터를 파일 하나로 저장">전체 백업</button>
    <button type="button" data-acc="restore" title="전체 백업 파일에서 가져오기">백업 가져오기</button>
    ${user ? '<button type="button" data-acc="logout">로그아웃</button>' : ''}`;
  showStatus();
}

const syncs = Object.fromEntries(Object.keys(sync.APPS).map((app) => [app, sync.createSync(app)]));
const appOfKey = (key) => Object.keys(sync.APPS).find((app) => key.startsWith(sync.APPS[app].prefix));

const blobToDataURL = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

function dataURLToBlob(url) {
  const [head, body] = url.split(',');
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: head.match(/data:([^;]+)/)?.[1] || 'application/octet-stream' });
}

// 모든 과목의 목록 + 이미지를 파일 하나로 (계정에만 있는 이미지도 받아서 넣는다)
async function backupAll() {
  toast('백업 파일을 만드는 중…');
  const data = {};
  for (const key of Object.keys(localStorage)) if (appOfKey(key)) data[key] = read(key);
  const images = {};
  for (const { images: name } of Object.values(sync.APPS)) {
    if (!name) continue;
    const db = await sync.openDB(name);
    if (sync.configured) {
      const have = new Set(await sync.idb(db, 'readonly', (s) => s.getAllKeys()));
      for (const id of await sync.listImages(name).catch(() => [])) {
        const blob = have.has(id) ? null : await sync.downloadImage(name, id);
        if (blob) await sync.idb(db, 'readwrite', (s) => s.put({ id, blob }));
      }
    }
    const list = await sync.idb(db, 'readonly', (s) => s.getAll());
    images[name] = await Promise.all(list.map(async ({ id, blob }) => ({ id, data: await blobToDataURL(blob) })));
  }
  const payload = { app: 'midori-study-all', version: 1, exportedAt: new Date().toISOString(), data, images };
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' })),
    download: `midori-study-all-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

// 같은 id 는 백업 내용으로 바꾸고, 없던 것은 뒤에 붙인다
function mergeById(current, incoming) {
  const map = new Map(incoming.map((x) => [String(x.id), x]));
  const out = current.map((x) => {
    const y = map.get(String(x.id));
    map.delete(String(x.id));
    return y || x;
  });
  return [...out, ...map.values()];
}

async function restoreAll(file) {
  let json;
  try {
    json = JSON.parse(await file.text());
  } catch {
    return toast('백업 파일을 읽지 못했어요.');
  }
  if (json.app !== 'midori-study-all') return toast('전체 백업 파일이 아니에요. 과목별 백업은 각 과목 화면의 「가져오기」로 넣어 주세요.');
  const keys = Object.keys(json.data || {}).filter((k) => appOfKey(k) && Array.isArray(json.data[k]));
  const items = keys.reduce((n, k) => n + json.data[k].length, 0);
  const imgs = Object.values(json.images || {}).reduce((n, list) => n + list.length, 0);
  if (!items && !imgs) return toast('가져올 데이터가 없어요.');
  if (!confirm(`학습 데이터 ${items}개, 이미지 ${imgs}개를 가져올까요?\n같은 항목이 이미 있으면 백업 내용으로 바뀌어요.`)) return;
  for (const [name, list] of Object.entries(json.images || {})) {
    if (!Object.values(sync.APPS).some((a) => a.images === name)) continue;
    const db = await sync.openDB(name);
    for (const { id, data } of list) {
      await sync.idb(db, 'readwrite', (s) => s.put({ id, blob: dataURLToBlob(data) }));
      sync.queueImage(name, id, 'put');
    }
  }
  for (const key of keys) {
    const app = appOfKey(key);
    const col = key.slice(sync.APPS[app].prefix.length);
    syncs[app].write(col, mergeById(read(key), json.data[key].filter((x) => x?.id != null)));
  }
  render();
  sync.flush();
  toast(`${items + imgs}개를 가져왔어요.${sync.configured ? ' 계정에 올리는 중이에요.' : ''}`);
}

function bindAccount() {
  $('#account').addEventListener('click', async (e) => {
    const act = e.target.closest('[data-acc]')?.dataset.acc;
    if (act === 'backup') backupAll().catch((err) => (console.error(err), toast('백업을 만들지 못했어요.')));
    else if (act === 'restore') $('#restore-input').click();
    else if (act === 'logout' && (await sync.logout())) location.reload();
  });
  $('#restore-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) restoreAll(file).catch((err) => (console.error(err), toast('가져오지 못했어요.')));
  });
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const err = $('#login-error');
    err.hidden = true;
    form.querySelector('button').disabled = true;
    try {
      await sync.login(form.email.value.trim(), form.password.value);
      location.reload();
    } catch (error) {
      err.textContent = /invalid/i.test(error.message) ? '이메일이나 비밀번호가 맞지 않아요.' : `로그인하지 못했어요: ${error.message}`;
      err.hidden = false;
      form.querySelector('button').disabled = false;
    }
  });
}

async function boot() {
  render();
  bindAccount();
  if (!sync.configured) return showAccount(null);
  const user = await sync.currentUser();
  $('#login').hidden = !!user;
  $('#subjects').hidden = !user;
  if (!user) {
    $('#account').innerHTML = '';
    return $('#login-form').email.focus();
  }
  showAccount(user);
  render(); // 처음 로그인한 브라우저라면 캐시가 바뀌었을 수 있다
  for (const s of Object.values(syncs)) {
    s.onRemote(render);
    s.start();
  }
}

boot();
