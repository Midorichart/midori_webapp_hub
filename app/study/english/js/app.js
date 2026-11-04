import { COLLECTIONS, createLocalStore } from './store.js';

// 영어 앱. 단어장·시험지는 일본어 앱(japanese/js/app.js)과 같은 방식이고, 단어에 읽기 대신 예문이 있다.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const includes = (q, ...fields) => !q || fields.some((f) => String(f ?? '').toLowerCase().includes(q));

function pref(key, fallback) {
  try {
    return localStorage.getItem('midori-english-pref:' + key) ?? fallback;
  } catch {
    return fallback;
  }
}
function setPref(key, value) {
  try {
    localStorage.setItem('midori-english-pref:' + key, value);
  } catch {}
}

const TABS = ['vocab', 'reading', 'listening', 'writing', 'speaking'];
const PAGE_SIZES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const sizePref = (key, fallback) => {
  const n = Number(pref(key, fallback));
  return PAGE_SIZES.includes(n) ? n : fallback;
};

const state = {
  store: null,
  data: { vocab: [], templates: [], answers: [] },
  editing: { vocab: null },
  query: { vocab: '' },
  sort: pref('vocab-sort', 'new'),
  vocabView: pref('vocab-view', 'study') === 'done' ? 'done' : 'study', // 학습 중 | 학습 완료
  hide: { word: false, meaning: false, example: false },
  page: { vocab: 1 },
  pageSize: { vocab: sizePref('vocab-page-size', 20) },
};

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

// 저장 실패 시 알림 (클라우드 저장소처럼 비동기일 수 있으므로 await 하지 않고 에러만 잡는다)
function run(promise) {
  Promise.resolve(promise).catch((err) => {
    console.error(err);
    toast('저장에 실패했어요: ' + err.message);
  });
}

function formData(form) {
  return Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v).trim()]));
}

// IME 변환 확정용 Enter 는 무시
const isEnter = (e) => e.key === 'Enter' && !e.isComposing && e.keyCode !== 229;

/* ---------- 페이지 나누기 ---------- */

// 1 … 4 5 [6] 7 8 … 20
function pageNumbers(cur, pages) {
  const out = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - cur) <= 2) out.push(p);
    else if (out[out.length - 1] !== null) out.push(null);
  }
  return out;
}

// 현재 페이지에 해당하는 항목만 돌려주고 페이지 버튼을 그린다
function paginate(key, items, size) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const cur = (state.page[key] = Math.min(Math.max(1, state.page[key]), pages));
  const start = (cur - 1) * size;

  const el = $(`#${key}-pager`);
  el.hidden = pages <= 1;
  el.innerHTML =
    pages <= 1
      ? ''
      : `<button type="button" data-page="${cur - 1}" title="이전 페이지"${cur === 1 ? ' disabled' : ''}>‹</button>
        ${pageNumbers(cur, pages)
          .map((p) =>
            p === null
              ? '<span class="gap">…</span>'
              : `<button type="button" data-page="${p}"${p === cur ? ' aria-current="page"' : ''}>${p}</button>`,
          )
          .join('')}
        <button type="button" data-page="${cur + 1}" title="다음 페이지"${cur === pages ? ' disabled' : ''}>›</button>
        <span class="pager-range">${start + 1}–${Math.min(start + size, items.length)} / ${items.length}</span>`;

  return items.slice(start, start + size);
}

// 「N개씩」 드롭다운
function bindPageSize(key, render) {
  const sel = $(`#${key}-size`);
  sel.innerHTML = PAGE_SIZES.map((n) => `<option value="${n}">${n}개씩</option>`).join('');
  sel.value = state.pageSize[key];
  sel.addEventListener('change', () => {
    state.pageSize[key] = Number(sel.value);
    state.page[key] = 1;
    setPref(`${key}-page-size`, sel.value);
    render();
  });
}

// 검색어·페이지를 가진 목록 key → 그 목록을 다시 그리는 함수 (라이팅·스피킹 목록은 buildPractice 가 추가)
const views = {};

function bindPagers() {
  $$('[data-pager]').forEach((el) =>
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-page]');
      if (!btn || btn.disabled) return;
      state.page[el.dataset.pager] = Number(btn.dataset.page);
      views[el.dataset.pager]();
      window.scrollTo({ top: 0 });
    }),
  );
}

/* ---------- 탭 ---------- */

function showTab(name) {
  if (!TABS.includes(name)) name = 'vocab';
  $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
  $$('.panel').forEach((p) => (p.hidden = p.id !== 'tab-' + name));
  setPref('tab', name);
}

/* ---------- 단어 ---------- */
// 단어마다 status('known' 외움 | 'confused' 헷갈림 | '') 와 done(학습 완료) 를 저장한다.
// 한 단어 = <tbody> 하나 (윗줄: 단어 · 뜻 / 아랫줄: 예문, 체크박스는 두 줄에 걸쳐 오른쪽)

const STATUS_LABEL = { known: '외움', confused: '헷갈림' };

const SORTS = {
  new: (a, b) => b.createdAt - a.createdAt,
  old: (a, b) => a.createdAt - b.createdAt,
  abc: (a, b) => a.word.localeCompare(b.word, 'en', { sensitivity: 'base' }),
};

// 예문 속 그 단어를 <mark> 로 감싼다. 끝의 e · y 를 떼고 뒤에 붙는 글자를 허용해서
// paved · values · rationalized · delves 같은 꼴도 찾는다. 여러 단어(pave the way)는 사이 공백 · 하이픈을 허용.
// 불규칙 변화(rise → rose)는 못 찾으면 그냥 둔다. 뜻 칸처럼 괄호 안 설명은 무시.
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function markWord(example, word) {
  const parts = String(word ?? '').toLowerCase().replace(/\(.*?\)/g, ' ').split(/\s+/).filter(Boolean);
  if (!parts.length) return esc(example);
  const pat = parts
    .map((p) => {
      if (p.length <= 3 || !/[a-z]$/.test(p)) return reEsc(p);
      return reEsc(p.length > 4 && /[ey]$/.test(p) ? p.slice(0, -1) : p) + '[a-z]*';
    })
    .join('[\\s-]+');
  const re = new RegExp(`(?<![a-z])${pat}(?![a-z])`, 'gi');
  let out = '';
  let at = 0;
  for (const m of String(example).matchAll(re)) {
    out += esc(example.slice(at, m.index)) + `<mark class="hl">${esc(m[0])}</mark>`;
    at = m.index + m[0].length;
  }
  return out + esc(example.slice(at));
}

function vocabEntry(v, done) {
  if (state.editing.vocab === v.id) {
    return `<tbody data-id="${esc(v.id)}" class="editing">
      <tr>
        <td><input class="en" name="word" value="${esc(v.word)}" placeholder="단어"></td>
        <td><input name="meaning" value="${esc(v.meaning)}" placeholder="뜻"></td>
        ${'<td rowspan="2"></td>'.repeat(done ? 1 : 3)}
        <td class="actions" rowspan="2"><button type="button" data-act="save" class="icon" title="저장">✓</button><button type="button" data-act="cancel" class="icon" title="취소">↺</button></td>
      </tr>
      <tr class="ex-row"><td colspan="2"><input class="en" name="example" value="${esc(v.example)}" placeholder="예문"></td></tr>
    </tbody>`;
  }
  const span = v.example ? ' rowspan="2"' : '';
  const marks = done
    ? ''
    : Object.entries(STATUS_LABEL)
        .map(
          ([st, label]) =>
            `<td class="ck-cell"${span}><input type="checkbox" class="ck ck-${st}" data-status="${st}" aria-label="${label}"${v.status === st ? ' checked' : ''}></td>`,
        )
        .join('');
  return `<tbody data-id="${esc(v.id)}" class="${done ? 'is-done' : v.status ? 'st-' + v.status : ''}">
    <tr>
      <td class="en word maskable">${esc(v.word)}</td>
      <td class="meaning maskable">${esc(v.meaning)}</td>
      ${marks}
      <td class="ck-cell"${span}><input type="checkbox" class="ck ck-done" data-done aria-label="학습 완료"${v.done ? ' checked' : ''}></td>
      <td class="actions"${span}><button type="button" data-act="edit" class="icon" title="수정">✎</button><button type="button" data-act="del" class="icon danger" title="삭제">×</button></td>
    </tr>
    ${v.example ? `<tr class="ex-row"><td colspan="2" class="en example maskable">${markWord(v.example, v.word)}</td></tr>` : ''}
  </tbody>`;
}

function renderVocab() {
  const q = state.query.vocab.trim().toLowerCase();
  const done = state.vocabView === 'done';
  const inView = state.data.vocab.filter((v) => !!v.done === done);
  const items = inView.filter((v) => includes(q, v.word, v.meaning, v.example)).sort(SORTS[state.sort] || SORTS.new);

  const doneCount = state.data.vocab.filter((v) => v.done).length;
  $$('#vocab-view [data-view]').forEach((b) => {
    b.setAttribute('aria-pressed', b.dataset.view === state.vocabView);
    $('.n', b).textContent = b.dataset.view === 'done' ? doneCount : state.data.vocab.length - doneCount;
  });
  $('#test-open').hidden = done;
  $('#vocab-count').textContent = q ? `${items.length} / ${inView.length}개` : `${inView.length}개`;

  // 학습 완료 목록에는 외움/헷갈림 칸이 없다
  const table = $('#vocab-table');
  table.classList.toggle('view-done', done);
  $('#vocab-cols').innerHTML = `<col class="c-word"><col class="c-meaning">${'<col class="c-ck">'.repeat(done ? 1 : 3)}<col class="c-actions">`;
  $('#vocab-head').innerHTML = `<tr><th>단어</th><th>뜻 <small>· 예문</small></th>${
    done ? '' : '<th class="ck-h known">외움</th><th class="ck-h confused">헷갈림</th>'
  }<th class="ck-h done">완료</th><th></th></tr>`;

  $$('tbody', table).forEach((tb) => tb.remove());
  table.insertAdjacentHTML('beforeend', paginate('vocab', items, state.pageSize.vocab).map((v) => vocabEntry(v, done)).join(''));

  const empty = $('#vocab-empty');
  empty.hidden = items.length > 0;
  empty.textContent = q
    ? '검색 결과가 없어요.'
    : done
      ? '학습 완료한 단어가 없어요. 단어 줄의 「완료」를 체크하면 여기로 옮겨져요.'
      : '아직 등록한 단어가 없어요. 위에서 단어를 추가해 보세요.';

  const editInput = $('tbody.editing input', table);
  if (editInput && !document.activeElement?.closest('tbody.editing')) editInput.focus();
}

function setVocabView(view) {
  state.vocabView = view;
  state.page.vocab = 1;
  setPref('vocab-view', view);
  renderVocab();
}

function saveVocabEntry(tb) {
  const data = Object.fromEntries($$('input', tb).map((i) => [i.name, i.value.trim()]));
  if (!data.word) return toast('단어는 비워둘 수 없어요.');
  state.editing.vocab = null;
  run(state.store.update('vocab', tb.dataset.id, data));
  renderVocab();
}

function bindVocab() {
  $('#vocab-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = formData(e.target);
    if (!data.word) return;
    state.vocabView = 'study';
    state.page.vocab = state.sort === 'new' ? 1 : Infinity; // 새 단어가 보이는 페이지로 (알파벳순이면 마지막 쪽 근처)
    run(state.store.add('vocab', data));
    e.target.reset();
    e.target.word.focus();
  });

  $('#vocab-view').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (btn) setVocabView(btn.dataset.view);
  });

  const table = $('#vocab-table');
  table.addEventListener('click', (e) => {
    const tb = e.target.closest('tbody');
    if (!tb || e.target.closest('.ck-cell')) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'edit') {
      state.editing.vocab = tb.dataset.id;
      renderVocab();
    } else if (act === 'cancel') {
      state.editing.vocab = null;
      renderVocab();
    } else if (act === 'save') {
      saveVocabEntry(tb);
    } else if (act === 'del') {
      const word = state.data.vocab.find((v) => v.id === tb.dataset.id)?.word;
      if (confirm(`「${word}」을(를) 삭제할까요?`)) run(state.store.remove('vocab', tb.dataset.id));
    } else {
      e.target.closest('.maskable')?.classList.toggle('revealed');
    }
  });
  table.addEventListener('change', (e) => {
    const ck = e.target.closest('.ck');
    if (!ck) return;
    const tb = ck.closest('tbody');
    if ('done' in ck.dataset) {
      // 회색으로 바뀐 걸 잠깐 보여 준 뒤 다른 목록으로 옮긴다
      tb.className = ck.checked ? 'is-done' : '';
      $$('.ck', tb).forEach((c) => (c.disabled = true));
      setTimeout(() => {
        run(state.store.update('vocab', tb.dataset.id, { done: ck.checked }));
        toast(ck.checked ? '학습 완료 단어로 옮겼어요.' : '학습 중 단어로 되돌렸어요.');
      }, 350);
    } else {
      run(state.store.update('vocab', tb.dataset.id, { status: ck.checked ? ck.dataset.status : '' }));
    }
  });
  table.addEventListener('keydown', (e) => {
    const tb = e.target.closest('tbody.editing');
    if (!tb) return;
    if (isEnter(e)) saveVocabEntry(tb);
    if (e.key === 'Escape') {
      state.editing.vocab = null;
      renderVocab();
    }
  });

  $$('[data-hide]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const key = btn.dataset.hide;
      state.hide[key] = !state.hide[key];
      btn.setAttribute('aria-pressed', state.hide[key]);
      table.classList.toggle('hide-' + key, state.hide[key]);
      $$('.revealed', table).forEach((td) => td.classList.remove('revealed'));
    }),
  );

  const sort = $('#vocab-sort');
  sort.value = state.sort in SORTS ? state.sort : 'new';
  sort.addEventListener('change', () => {
    state.sort = sort.value;
    state.page.vocab = 1;
    setPref('vocab-sort', sort.value);
    renderVocab();
  });
  bindPageSize('vocab', renderVocab);
  bindTest();
}

/* 시험지 */
// 외움·헷갈림으로 표시한 단어(학습 완료 제외)에서 정해진 수만큼 무작위로 뽑는다.

const test = { counts: null, type: pref('test-type', 'word'), items: [], answers: false };

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function testPool() {
  const pool = { confused: [], known: [] };
  for (const v of state.data.vocab) if (!v.done && (v.status === 'known' || v.status === 'confused')) pool[v.status].push(v);
  return pool;
}

function openTest() {
  const modal = $('#test-modal');
  modal.hidden = false;
  document.body.classList.add('modal-open');
  renderTestSetup();
  $('.modal-card', modal).focus();
}

function closeTest() {
  $('#test-modal').hidden = true;
  document.body.classList.remove('modal-open');
}

function renderTestSetup() {
  const pool = testPool();
  const body = $('#test-body');
  if (!pool.confused.length && !pool.known.length) {
    body.innerHTML = `<p class="empty">외움이나 헷갈림을 체크한 단어가 없어요.<br>단어 줄의 체크박스로 먼저 표시해 주세요.</p>`;
    return;
  }
  const last = test.counts || { confused: Number(pref('test-confused', 10)), known: Number(pref('test-known', 10)) };
  body.innerHTML = `<form class="test-setup" id="test-form" autocomplete="off">
    <p class="t-help">외움·헷갈림을 체크한 단어에서 무작위로 문제를 내요. 학습 완료 단어는 빠져요.</p>
    ${['confused', 'known']
      .map(
        (st) => `<label class="t-row">
          <span class="t-name"><span class="dot ${st}"></span>${STATUS_LABEL[st]}</span>
          <input type="number" name="${st}" min="0" max="${pool[st].length}" value="${Math.min(last[st] || 0, pool[st].length)}" inputmode="numeric"${pool[st].length ? '' : ' disabled'}>
          <span class="t-max">/ ${pool[st].length}문제</span>
        </label>`,
      )
      .join('')}
    <label class="t-row">
      <span class="t-name">문제 유형</span>
      <select name="type">
        <option value="word">단어 보고 뜻 쓰기</option>
        <option value="meaning">뜻 보고 단어 쓰기</option>
      </select>
    </label>
    <div class="t-foot"><span class="t-total" id="test-total"></span><button type="submit" class="primary">시험지 만들기</button></div>
  </form>`;
  const form = $('#test-form');
  form.type.value = test.type;
  const total = () => {
    const n = ['confused', 'known'].reduce((sum, st) => sum + Math.min(Number(form[st].value) || 0, pool[st].length), 0);
    $('#test-total').textContent = `총 ${n}문제`;
  };
  form.addEventListener('input', total);
  total();
}

function makeTest() {
  const pool = testPool();
  test.items = shuffle(['confused', 'known'].flatMap((st) => shuffle(pool[st]).slice(0, test.counts[st])));
  test.answers = false;
  renderTestSheet();
}

// 표: 번호 · 문제 · 답 칸 (답 칸은 비워 두고 「정답 보기」 때만 채운다)
function renderTestSheet() {
  const byWord = test.type === 'word';
  const n = test.items.length;
  const count = (st) => test.items.filter((v) => v.status === st).length;
  const rows = test.items
    .map((v, i) => {
      const [prompt, answer] = byWord ? [v.word, v.meaning] : [v.meaning || '—', v.word];
      return `<tr><td class="t-no">${i + 1}</td><td class="t-prompt${byWord ? ' en' : ''}">${esc(prompt)}</td><td><span class="t-answer${byWord ? '' : ' en'}">${esc(answer)}</span></td></tr>`;
    })
    .join('');
  $('#test-body').innerHTML = `
    <div class="t-actions">
      <button type="button" data-tact="setup">‹ 설정</button>
      <button type="button" data-tact="shuffle" title="같은 문제 수로 다시 뽑기">다시 뽑기</button>
      <button type="button" class="chip" data-tact="answers" aria-pressed="${test.answers}">정답 보기</button>
      <button type="button" class="primary" data-tact="print">인쇄</button>
    </div>
    <div class="sheet${test.answers ? ' show-answers' : ''}">
      <div class="sheet-head">
        <h2 class="en">Vocabulary Test</h2>
        <div class="sheet-meta">${new Date().toLocaleDateString('ko-KR')} · ${n}문제 (헷갈림 ${count('confused')} · 외움 ${count('known')})</div>
        <div class="sheet-score">점수 <span class="score-box"></span> / ${n}</div>
      </div>
      <table class="t-table">
        <colgroup><col class="t-no-col"><col class="t-q-col"><col></colgroup>
        <thead><tr><th class="t-no">#</th><th>${byWord ? '단어' : '뜻'}</th><th>${byWord ? '뜻' : '단어'}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function bindTest() {
  $('#test-open').addEventListener('click', openTest);
  const modal = $('#test-modal');
  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-tclose]')) return closeTest();
    const act = e.target.closest('[data-tact]')?.dataset.tact;
    if (act === 'setup') renderTestSetup();
    else if (act === 'shuffle') makeTest();
    else if (act === 'print') window.print();
    else if (act === 'answers') {
      test.answers = !test.answers;
      e.target.setAttribute('aria-pressed', test.answers);
      $('.sheet', modal).classList.toggle('show-answers', test.answers);
    }
  });
  modal.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const pool = testPool();
    test.counts = Object.fromEntries(
      ['confused', 'known'].map((st) => [st, Math.max(0, Math.min(Number(form[st].value) || 0, pool[st].length))]),
    );
    test.type = form.type.value;
    if (!test.counts.confused && !test.counts.known) return toast('문제 수를 1개 이상 정해 주세요.');
    setPref('test-confused', test.counts.confused);
    setPref('test-known', test.counts.known);
    setPref('test-type', test.type);
    makeTest();
    $('#test-body').scrollTop = 0;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeTest();
  });
}

/* ---------- 라이팅 · 스피킹 ---------- */
// 두 탭이 같은 틀을 쓴다: 풀이 노트 | 템플릿 | 따라적기.
// 템플릿 구절에 빈칸([힌트] 또는 ___)을 두고, 풀이 노트에서 불러와 빈칸만 채우면 답변이 된다.

const SKILLS = { writing: 'Writing', speaking: 'Speaking' };
const SUBS = { notes: '풀이 노트', templates: '템플릿', copy: '따라적기' };
const PRACTICE_PAGE_SIZE = 10;
const BLANK_RE = /\[([^\]\n]*)\]|_{2,}/g;

const practice = {}; // skill → { sub, copyId, copyHide, edit, collapsed }
const copyDrafts = new Map(); // 풀이 노트 id → 따라 적은 글 (연습용이라 저장하지 않는다)

const notesOf = (skill) => state.data.answers.filter((n) => n.skill === skill);
const byNew = (a, b) => b.createdAt - a.createdAt;
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/* 템플릿 트리 */
// templates 컬렉션에 폴더({kind:'folder', title})와 템플릿({title, text})이 함께 들어 있고,
// parent(폴더 id, 맨 위는 '')와 order(같은 폴더 안 순서)로 트리를 이룬다.

const isFolder = (t) => t.kind === 'folder';
const nodesOf = (skill) => state.data.templates.filter((t) => t.skill === skill);
const tplsOf = (skill) => nodesOf(skill).filter((t) => !isFolder(t));
const ord = (t) => t.order ?? t.createdAt;
const byTree = (a, b) => isFolder(b) - isFolder(a) || ord(a) - ord(b); // 폴더 먼저, 그다음 순서대로

// parent id → 자식 목록 (부모 폴더가 사라진 항목은 맨 위로)
function treeOf(skill) {
  const nodes = nodesOf(skill);
  const folders = new Set(nodes.filter(isFolder).map((f) => f.id));
  const kids = new Map([['', []]]);
  for (const n of nodes) {
    const p = folders.has(n.parent) ? n.parent : '';
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(n);
  }
  kids.forEach((list) => list.sort(byTree));
  return kids;
}

const descendants = (kids, id) => (kids.get(id) || []).flatMap((n) => [n, ...descendants(kids, n.id)]);
const countTpls = (kids, id) => descendants(kids, id).filter((n) => !isFolder(n)).length;
const parentOf = (n) => state.data.templates.find((f) => f.id === n.parent && isFolder(f));

// 템플릿이 들어 있는 폴더 이름들 (위에서 아래로)
function tplPath(t) {
  const names = [];
  const seen = new Set();
  for (let p = parentOf(t); p && !seen.has(p.id); p = parentOf(p)) {
    seen.add(p.id);
    names.unshift(p.title);
  }
  return names;
}

function folderOptions(kids, selected, exclude) {
  const out = ['<option value="">맨 위</option>'];
  const walk = (parent, depth) => {
    for (const n of kids.get(parent) || []) {
      if (!isFolder(n) || n.id === exclude) continue; // 폴더를 자기 안으로 옮길 수는 없다
      out.push(`<option value="${esc(n.id)}"${n.id === selected ? ' selected' : ''}>${'　'.repeat(depth)}📁 ${esc(n.title)}</option>`);
      walk(n.id, depth + 1);
    }
  };
  walk('', 0);
  return out.join('');
}

function saveCollapsed(skill) {
  setPref('collapsed-' + skill, JSON.stringify([...practice[skill].collapsed]));
}

// 'I think [의견] because ___.' → [{text}, {blank:'의견'}, {text}, {blank:''}, {text}]
function tplParts(text) {
  text = String(text ?? '');
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(BLANK_RE)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ blank: (m[1] ?? '').trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

const tplHTML = (text) =>
  tplParts(text)
    .map((p) => ('blank' in p ? `<span class="blank">${esc(p.blank) || '&nbsp;'}</span>` : esc(p.text)))
    .join('');

const fillSize = (s) => Math.max(5, String(s).length + 2);

const noteFields = (n = {}) => `
  <label>문제<textarea name="question" rows="2">${esc(n.question)}</textarea></label>
  <div class="ans-field">
    <div class="ans-head"><span>답변</span><button type="button" class="chip" data-act="pick">템플릿 불러오기</button></div>
    <div class="tpl-slot"></div>
    <textarea name="answer" class="en" rows="5">${esc(n.answer)}</textarea>
  </div>`;

const templateFields = (t = {}) => `
  <label>제목<input name="title" value="${esc(t.title)}" placeholder="예) 의견 말하기 · 서론" required></label>
  <label>구절 <small>빈칸은 [힌트] 또는 ___ 로 적어요</small><textarea name="text" class="en" rows="4" placeholder="In my opinion, [의견] because [이유].">${esc(t.text)}</textarea></label>`;

const editCard = (id, fields) => `<article class="card g-card" data-id="${esc(id)}">
  <form class="grammar-form" data-form="edit" autocomplete="off">${fields}
    <div class="form-actions"><button type="button" data-act="cancel">취소</button><button type="submit" class="primary">저장</button></div>
  </form></article>`;

const cardActions = `<div class="actions"><button type="button" data-act="edit" class="icon" title="수정">✎</button><button type="button" data-act="del" class="icon danger" title="삭제">×</button></div>`;

function buildPractice(skill) {
  const sub = pref('sub-' + skill, 'notes');
  let collapsed = [];
  try {
    collapsed = JSON.parse(pref('collapsed-' + skill, '[]'));
  } catch {}
  practice[skill] = { sub: sub in SUBS ? sub : 'notes', copyId: pref('copy-' + skill, ''), copyHide: false, edit: null, collapsed: new Set(collapsed) };
  for (const kind of ['notes', 'templates']) {
    const key = `${skill}-${kind}`;
    state.query[key] = '';
    state.page[key] = 1;
    views[key] = () => (kind === 'notes' ? renderNotes(skill) : renderTemplates(skill));
  }

  const panel = $('#tab-' + skill);
  panel.innerHTML = `
    <div class="seg sub-tabs" role="group" aria-label="${SKILLS[skill]}">
      ${Object.entries(SUBS).map(([k, label]) => `<button type="button" data-sub="${k}">${label} <span class="n"></span></button>`).join('')}
    </div>

    <div data-sub-panel="notes">
      <details class="card add-grammar">
        <summary>+ 문제 추가</summary>
        <form class="grammar-form" data-form="notes" autocomplete="off">${noteFields()}
          <div class="form-actions"><button type="submit" class="primary">추가</button></div>
        </form>
      </details>
      <div class="toolbar">
        <input type="search" class="search" data-search="${skill}-notes" placeholder="검색">
        <span class="count" data-count="notes"></span>
      </div>
      <div class="grammar-list" data-list="notes"></div>
      <p class="empty" data-empty="notes"></p>
      <nav class="pager" id="${skill}-notes-pager" data-pager="${skill}-notes" aria-label="풀이 노트 페이지" hidden></nav>
    </div>

    <div data-sub-panel="templates">
      <div class="toolbar tree-bar">
        <button type="button" class="primary" data-act="add-folder" data-parent="">+ 새 폴더</button>
        <button type="button" data-act="add-tpl" data-parent="">+ 템플릿</button>
        <input type="search" class="search" data-search="${skill}-templates" placeholder="검색">
        <button type="button" class="chip" data-act="expand-all">모두 펼치기</button>
        <button type="button" class="chip" data-act="collapse-all">모두 접기</button>
        <span class="count" data-count="templates"></span>
      </div>
      <ul class="tree tree-root card" data-list="templates"></ul>
      <p class="empty" data-empty="templates"></p>
    </div>

    <div data-sub-panel="copy"><div class="card copy" data-copy></div></div>`;
  bindPractice(skill, panel);
  showSub(skill, practice[skill].sub);
}

function showSub(skill, sub) {
  const panel = $('#tab-' + skill);
  practice[skill].sub = sub;
  setPref('sub-' + skill, sub);
  $$('[data-sub]', panel).forEach((b) => b.setAttribute('aria-pressed', b.dataset.sub === sub));
  $$('[data-sub-panel]', panel).forEach((p) => (p.hidden = p.dataset.subPanel !== sub));
  if (sub === 'copy') renderCopy(skill);
}

function subCounts(skill) {
  const n = { notes: notesOf(skill).length, templates: tplsOf(skill).length, copy: '' };
  $$(`#tab-${skill} [data-sub]`).forEach((b) => ($('.n', b).textContent = n[b.dataset.sub]));
}

function renderNotes(skill) {
  const key = `${skill}-notes`;
  const panel = $(`#tab-${skill} [data-sub-panel="notes"]`);
  const all = notesOf(skill);
  const q = state.query[key].trim().toLowerCase();
  const items = all.filter((n) => includes(q, n.question, n.answer)).sort(byNew);
  $('[data-count="notes"]', panel).textContent = q ? `${items.length} / ${all.length}개` : `${all.length}개`;
  $('[data-list="notes"]', panel).innerHTML = paginate(key, items, PRACTICE_PAGE_SIZE)
    .map((n) =>
      state.editing[key] === n.id
        ? editCard(n.id, noteFields(n))
        : `<article class="card g-card p-card" data-id="${esc(n.id)}">
      <header class="g-head"><h3 class="p-q">${esc(n.question) || '<span class="muted">(문제 없음)</span>'}</h3>${cardActions}</header>
      ${n.answer ? `<div class="g-block"><div class="g-label">답변</div><p class="explain en">${esc(n.answer)}</p></div>
        <footer class="p-foot"><button type="button" class="chip" data-act="speak">🔊 듣기</button><button type="button" class="chip" data-act="copy">따라적기 ›</button></footer>` : ''}
    </article>`,
    )
    .join('');
  const empty = $('[data-empty="notes"]', panel);
  empty.hidden = items.length > 0;
  empty.textContent = q
    ? '검색 결과가 없어요.'
    : '아직 풀이 노트가 없어요. 「+ 문제 추가」에서 문제와 답변을 적어 보세요. 답변 칸의 「템플릿 불러오기」로 템플릿 구절을 가져올 수 있어요.';
  subCounts(skill);
}

// 트리 안에 펼쳐지는 추가·수정 폼 (edit = { mode: 'folder' | 'tpl', id: 수정할 id 또는 null, parent })
function treeForm(kids, edit, item = {}) {
  const fields =
    edit.mode === 'folder'
      ? `<label>폴더 이름<input name="title" value="${esc(item.title)}" placeholder="예) 이메일 작성 · 인사 · 자기소개" required></label>`
      : templateFields(item);
  return `<li class="t-form"><form class="grammar-form" data-form="tree" autocomplete="off">${fields}
    <label>위치<select name="parent">${folderOptions(kids, edit.parent, edit.mode === 'folder' ? edit.id : null)}</select></label>
    <div class="form-actions"><button type="button" data-act="tree-cancel">취소</button><button type="submit" class="primary">${edit.id ? '저장' : '추가'}</button></div>
  </form></li>`;
}

function renderTemplates(skill) {
  const key = `${skill}-templates`;
  const panel = $(`#tab-${skill} [data-sub-panel="templates"]`);
  const st = practice[skill];
  const edit = st.edit;
  const kids = treeOf(skill);
  const q = state.query[key].trim().toLowerCase();

  // 검색 중이면 맞는 항목과 그 위 폴더만 보이고 모두 펼친다 (폴더 이름이 맞으면 안의 것은 다 보인다)
  const hits = new Map();
  const matches = (n) => {
    if (!hits.has(n.id)) hits.set(n.id, includes(q, n.title, n.text) || (isFolder(n) && (kids.get(n.id) || []).some(matches)));
    return hits.get(n.id);
  };
  const actions = (folder) => `<span class="row-actions">
    ${folder ? '<button type="button" class="mini" data-act="add-folder" title="하위 폴더 추가">+ 폴더</button><button type="button" class="mini" data-act="add-tpl" title="이 폴더에 템플릿 추가">+ 템플릿</button>' : ''}
    <button type="button" class="icon" data-act="tree-edit" title="${folder ? '이름 바꾸기 · 옮기기' : '수정'}">✎</button><button type="button" class="icon danger" data-act="tree-del" title="삭제">×</button>
  </span>`;

  const node = (n, all) => {
    if (edit?.id === n.id) return treeForm(kids, edit, n);
    if (!isFolder(n)) {
      return `<li class="t-item" data-id="${esc(n.id)}"><div class="t-row" draggable="true">
        <span class="t-icon">❝</span>
        <div class="t-body"><div class="t-name">${esc(n.title)}</div><div class="t-text en">${tplHTML(n.text)}</div></div>
        ${actions(false)}
      </div></li>`;
    }
    const open = q || !st.collapsed.has(n.id);
    return `<li class="t-folder${open ? ' open' : ''}" data-id="${esc(n.id)}">
      <div class="t-row" draggable="true" data-act="toggle">
        <span class="caret">▸</span><span class="f-icon">${open ? '📂' : '📁'}</span><span class="t-name">${esc(n.title)}</span><span class="f-n">${countTpls(kids, n.id)}</span>
        ${actions(true)}
      </div>
      ${open ? `<ul class="tree">${walk(n.id, all || (q && includes(q, n.title)))}</ul>` : ''}
    </li>`;
  };
  const walk = (parent, all) => {
    const list = (kids.get(parent) || []).filter((n) => !q || all || matches(n));
    let html = list.map((n) => node(n, all)).join('');
    if (edit && !edit.id && edit.parent === parent) html = treeForm(kids, edit) + html;
    if (!html && parent && !q) html = '<li class="t-empty">비어 있어요 · 여기로 끌어다 놓을 수 있어요</li>';
    return html;
  };

  const tree = $('[data-list="templates"]', panel);
  tree.innerHTML = walk('', false);
  tree.hidden = !tree.innerHTML;

  const nodes = nodesOf(skill);
  const folders = nodes.filter(isFolder).length;
  $('[data-count="templates"]', panel).textContent = `템플릿 ${nodes.length - folders}개 · 폴더 ${folders}개`;
  const empty = $('[data-empty="templates"]', panel);
  empty.hidden = !tree.hidden;
  empty.textContent = q
    ? '검색 결과가 없어요.'
    : '아직 템플릿이 없어요. 「+ 새 폴더」로 「이메일 작성」 같은 폴더를 만들고, 그 안에 「인사」·「자기소개」 같은 하위 폴더와 템플릿을 넣어 보세요. 빈칸은 [힌트] 또는 ___ 로 적어요.';
  subCounts(skill);

  const input = $('[data-form="tree"] input', tree);
  if (input && !tree.contains(document.activeElement)) input.focus();
}

// 끌어다 놓기: 폴더 줄 가운데 → 그 폴더 안으로, 줄의 위/아래 가장자리 → 그 앞/뒤로
function moveNode(skill, id, { where, target }) {
  const nodes = nodesOf(skill);
  let parent = '';
  let order = Date.now();
  if (where === 'inside') {
    parent = target;
    practice[skill].collapsed.delete(target);
    saveCollapsed(skill);
  } else if (where !== 'root') {
    const t = nodes.find((n) => n.id === target);
    parent = parentOf(t)?.id || '';
    const sibs = (treeOf(skill).get(parent) || []).filter((n) => n.id !== id);
    const i = sibs.indexOf(t);
    const nb = sibs[where === 'before' ? i - 1 : i + 1];
    order = nb ? (ord(nb) + ord(t)) / 2 : ord(t) + (where === 'before' ? -1 : 1);
  }
  run(state.store.update('templates', id, { parent, order }));
}

/* 템플릿 불러오기 → 빈칸 채우기 → 답변에 넣기 */

const tplOpt = (t, withPath) => {
  const path = withPath ? tplPath(t) : [];
  return `<button type="button" class="tpl-opt" data-tpl="${esc(t.id)}">${path.length ? `<small>${esc(path.join(' › '))}</small>` : ''}<strong>${esc(t.title)}</strong><span class="en">${tplHTML(t.text)}</span></button>`;
};

// 검색어가 없으면 폴더 트리, 있으면 맞는 템플릿을 경로와 함께 나열
function pickerList(skill, q) {
  q = q.trim().toLowerCase();
  if (q) {
    const hits = tplsOf(skill).filter((t) => includes(q, t.title, t.text, ...tplPath(t)));
    return hits.length ? hits.map((t) => tplOpt(t, true)).join('') : '<p class="tpl-none">검색 결과가 없어요.</p>';
  }
  const kids = treeOf(skill);
  const walk = (parent) =>
    (kids.get(parent) || [])
      .map((n) => {
        if (!isFolder(n)) return tplOpt(n, false);
        const count = countTpls(kids, n.id);
        return count
          ? `<details class="pk-folder"><summary><span class="caret">▸</span>📁 ${esc(n.title)} <span class="f-n">${count}</span></summary><div class="pk-kids">${walk(n.id)}</div></details>`
          : '';
      })
      .join('');
  return walk('');
}

function openPicker(form, skill) {
  const slot = $('.tpl-slot', form);
  delete slot.dataset.using;
  slot.innerHTML = `<div class="tpl-box">
    <div class="tpl-box-head"><span>불러올 템플릿</span><button type="button" class="icon" data-act="close-tpl" title="닫기">×</button></div>
    ${
      tplsOf(skill).length
        ? `<input type="search" class="pk-search" data-pk-search placeholder="템플릿 검색 (폴더 이름도 돼요)"><div class="tpl-opts">${pickerList(skill, '')}</div>`
        : '<p class="tpl-none">아직 템플릿이 없어요. 「템플릿」 탭에서 구절을 먼저 만들어 주세요.</p>'
    }
  </div>`;
  $('[data-pk-search]', slot)?.focus();
}

function openFill(form, tpl) {
  const slot = $('.tpl-slot', form);
  const path = tplPath(tpl);
  slot.dataset.using = tpl.id;
  slot.innerHTML = `<div class="tpl-box">
    <div class="tpl-box-head"><span>${path.length ? `<small class="path">${esc(path.join(' › '))} ›</small> ` : ''}${esc(tpl.title)} <small>빈칸을 채워 주세요</small></span><button type="button" class="icon" data-act="close-tpl" title="닫기">×</button></div>
    <div class="fill-text en">${tplParts(tpl.text)
      .map((p) => ('blank' in p ? `<input class="fill" data-fill placeholder="${esc(p.blank)}" size="${fillSize(p.blank)}">` : esc(p.text)))
      .join('')}</div>
    <div class="form-actions"><button type="button" data-act="pick">다른 템플릿</button><button type="button" class="primary" data-act="insert-tpl">답변에 넣기</button></div>
  </div>`;
  $('[data-fill]', slot)?.focus();
}

// 채운 템플릿을 답변 끝에 이어 붙인다 (비운 빈칸은 ___ 로 남김)
function insertFill(form) {
  const slot = $('.tpl-slot', form);
  const tpl = state.data.templates.find((t) => t.id === slot.dataset.using);
  if (!tpl) return;
  const vals = $$('[data-fill]', slot).map((i) => i.value.trim());
  let i = 0;
  const text = tplParts(tpl.text)
    .map((p) => ('blank' in p ? vals[i++] || '___' : p.text))
    .join('');
  const ta = form.answer;
  ta.value += (ta.value && !/\s$/.test(ta.value) ? ' ' : '') + text;
  slot.innerHTML = '';
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

/* 따라적기: 왼쪽 답변을 보며 오른쪽에 그대로 적고, 단어 단위로 맞았는지 표시 */

const words = (s) => String(s ?? '').split(/\s+/).filter(Boolean);
const normWord = (w) => w.toLowerCase().replace(/[‘’]/g, "'").replace(/[^\p{L}\p{N}']/gu, '');

function renderCopy(skill) {
  const st = practice[skill];
  const box = $(`#tab-${skill} [data-copy]`);
  const notes = notesOf(skill).filter((n) => n.answer).sort(byNew);
  if (!notes.length) {
    box.innerHTML = '<p class="empty">답변이 있는 풀이 노트가 없어요. 「풀이 노트」에서 먼저 답변을 만들어 주세요.</p>';
    return;
  }
  const note = notes.find((n) => n.id === st.copyId) || notes[0];
  st.copyId = note.id;
  setPref('copy-' + skill, note.id);
  box.innerHTML = `
    <div class="copy-bar">
      <select data-copy-pick aria-label="따라 적을 문제">${notes
        .map((n) => `<option value="${esc(n.id)}"${n.id === note.id ? ' selected' : ''}>${esc(clip(n.question || n.answer, 70))}</option>`)
        .join('')}</select>
      <button type="button" class="chip" data-act="copy-hide" aria-pressed="${st.copyHide}">답변 가리기</button>
      <button type="button" class="chip" data-act="speak">🔊 듣기</button>
      <button type="button" class="chip" data-act="copy-reset">다시 쓰기</button>
    </div>
    <div class="copy-grid">
      <div class="copy-src">
        ${note.question ? `<div class="g-label">문제</div><p class="explain copy-q">${esc(note.question)}</p>` : ''}
        <div class="g-label">답변</div>
        <p class="explain en copy-answer${st.copyHide ? ' masked' : ''}" data-act="peek">${esc(note.answer)}</p>
      </div>
      <div class="copy-write">
        <div class="g-label">따라 적기 <span class="copy-score"></span></div>
        <textarea class="en" data-copy-input rows="7" spellcheck="false" placeholder="왼쪽 답변을 보면서 그대로 적어 보세요."></textarea>
        <div class="copy-check en" aria-live="polite"></div>
      </div>
    </div>`;
  $('[data-copy-input]', box).value = copyDrafts.get(note.id) || '';
  renderCheck(box, note);
}

function renderCheck(box, note) {
  const typed = $('[data-copy-input]', box).value;
  const target = words(note.answer);
  const got = words(typed);
  const typing = !/\s$/.test(typed); // 마지막 단어는 아직 치는 중일 수 있다
  let ok = 0;
  const html = got
    .map((w, i) => {
      const want = target[i];
      let cls = 'bad';
      if (want !== undefined && normWord(w) === normWord(want)) {
        cls = 'ok';
        ok++;
      } else if (typing && i === got.length - 1 && want !== undefined && normWord(want).startsWith(normWord(w))) {
        cls = 'cur';
      }
      return `<span class="${cls}"${cls === 'bad' ? ` title="${esc(want ?? '(남는 단어)')}"` : ''}>${esc(w)}</span>`;
    })
    .join(' ');
  const done = ok === target.length && got.length === target.length;
  $('.copy-check', box).innerHTML = html;
  $('.copy-score', box).textContent = done ? `· 완성! ${ok} / ${target.length} 단어` : `· ${ok} / ${target.length} 단어`;
  box.classList.toggle('copy-done', done);
}

function speak(text) {
  if (!text) return;
  if (!('speechSynthesis' in window)) return toast('이 환경에서는 읽어 주기를 쓸 수 없어요.');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  speechSynthesis.speak(u);
}

function bindPractice(skill, panel) {
  const st = practice[skill];
  const findNote = (id) => state.data.answers.find((n) => n.id === id);
  const findNode = (id) => state.data.templates.find((t) => t.id === id);
  const rowId = (el) => el.closest('.tree li[data-id]')?.dataset.id;

  // 템플릿 트리 버튼
  function treeAct(act, el) {
    const id = rowId(el);
    if (act === 'add-folder' || act === 'add-tpl') {
      const parent = el.dataset.parent ?? id;
      st.edit = { mode: act === 'add-folder' ? 'folder' : 'tpl', id: null, parent };
      st.collapsed.delete(parent);
    } else if (act === 'tree-edit') {
      const n = findNode(id);
      st.edit = { mode: isFolder(n) ? 'folder' : 'tpl', id, parent: parentOf(n)?.id || '' };
    } else if (act === 'tree-cancel') {
      st.edit = null;
    } else if (act === 'tree-del') {
      const n = findNode(id);
      const inner = isFolder(n) ? descendants(treeOf(skill), id) : [];
      const tpls = inner.filter((x) => !isFolder(x)).length;
      const msg = isFolder(n)
        ? `「${n.title}」 폴더를 삭제할까요?${inner.length ? `\n안에 있는 하위 폴더 ${inner.length - tpls}개, 템플릿 ${tpls}개도 함께 삭제돼요.` : ''}`
        : `「${n.title}」 템플릿을 삭제할까요?`;
      if (!confirm(msg)) return;
      [n, ...inner].forEach((x) => run(state.store.remove('templates', x.id)));
      return;
    } else if (act === 'toggle') {
      st.collapsed.has(id) ? st.collapsed.delete(id) : st.collapsed.add(id);
    } else if (act === 'expand-all') {
      st.collapsed.clear();
    } else if (act === 'collapse-all') {
      nodesOf(skill).filter(isFolder).forEach((f) => st.collapsed.add(f.id));
    } else return false;
    saveCollapsed(skill);
    renderTemplates(skill);
  }

  panel.addEventListener('click', (e) => {
    const subBtn = e.target.closest('[data-sub]');
    if (subBtn) return showSub(skill, subBtn.dataset.sub);

    const form = e.target.closest('form');
    const tplBtn = e.target.closest('[data-tpl]');
    if (tplBtn) return openFill(form, findNode(tplBtn.dataset.tpl));

    const actEl = e.target.closest('[data-act]');
    const act = actEl?.dataset.act;
    if (!act || treeAct(act, actEl) !== false) return;

    const key = `${skill}-notes`;
    const card = e.target.closest('.g-card');
    if (act === 'pick') openPicker(form, skill);
    else if (act === 'close-tpl') $('.tpl-slot', form).innerHTML = '';
    else if (act === 'insert-tpl') insertFill(form);
    else if (act === 'edit') {
      state.editing[key] = card.dataset.id;
      renderNotes(skill);
      $('[data-form="edit"] textarea', panel)?.focus();
    } else if (act === 'cancel') {
      state.editing[key] = null;
      renderNotes(skill);
    } else if (act === 'del') {
      const n = findNote(card.dataset.id);
      if (confirm(`「${clip(n?.question || n?.answer || '', 40)}」 풀이 노트를 삭제할까요?`)) run(state.store.remove('answers', card.dataset.id));
    } else if (act === 'speak') {
      speak(findNote(card?.dataset.id || st.copyId)?.answer);
    } else if (act === 'copy') {
      st.copyId = card.dataset.id;
      showSub(skill, 'copy');
      $('[data-copy-input]', panel)?.focus();
    } else if (act === 'copy-hide') {
      st.copyHide = !st.copyHide;
      renderCopy(skill);
    } else if (act === 'copy-reset') {
      copyDrafts.delete(st.copyId);
      renderCopy(skill);
      $('[data-copy-input]', panel).focus();
    } else if (act === 'peek') {
      e.target.closest('.copy-answer').classList.toggle('revealed');
    }
  });

  panel.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const data = formData(form);

    if (form.dataset.form === 'tree') {
      const edit = st.edit;
      const folder = edit.mode === 'folder';
      if (!data.title || (!folder && !data.text)) return toast(folder ? '폴더 이름을 적어 주세요.' : '제목과 구절을 적어 주세요.');
      st.edit = null;
      st.collapsed.delete(data.parent);
      saveCollapsed(skill);
      if (edit.id) {
        const moved = (parentOf(findNode(edit.id))?.id || '') !== data.parent;
        run(state.store.update('templates', edit.id, moved ? { ...data, order: Date.now() } : data));
      } else {
        run(state.store.add('templates', { ...data, skill, order: Date.now(), ...(folder ? { kind: 'folder' } : {}) }));
      }
      return renderTemplates(skill);
    }

    if (!data.question && !data.answer) return toast('문제나 답변을 적어 주세요.');
    if (form.dataset.form === 'edit') {
      run(state.store.update('answers', form.closest('.g-card').dataset.id, data));
      state.editing[`${skill}-notes`] = null;
      renderNotes(skill);
    } else {
      state.page[`${skill}-notes`] = 1;
      run(state.store.add('answers', { ...data, skill }));
      form.reset();
      $('.tpl-slot', form).innerHTML = '';
      form.elements[0].focus();
    }
  });

  panel.addEventListener('input', (e) => {
    const fill = e.target.closest('[data-fill]');
    if (fill) fill.size = Math.max(fillSize(fill.placeholder), fill.value.length + 2);
    if (e.target.matches('[data-pk-search]')) {
      $('.tpl-opts', e.target.closest('.tpl-box')).innerHTML = pickerList(skill, e.target.value);
    }
    if (e.target.matches('[data-copy-input]')) {
      const note = findNote(st.copyId);
      copyDrafts.set(note.id, e.target.value);
      renderCheck($('[data-copy]', panel), note);
    }
  });

  panel.addEventListener('change', (e) => {
    if (!e.target.matches('[data-copy-pick]')) return;
    st.copyId = e.target.value;
    renderCopy(skill);
  });

  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && st.edit && e.target.closest('[data-form="tree"]')) {
      st.edit = null;
      return renderTemplates(skill);
    }
    if (!isEnter(e)) return;
    // 템플릿 검색 칸의 Enter 로 풀이 노트가 저장되지 않게
    if (e.target.matches('[data-pk-search]')) return e.preventDefault();
    // 빈칸에서 Enter → 다음 빈칸, 마지막 빈칸이면 답변에 넣기
    const fill = e.target.closest('[data-fill]');
    if (!fill) return;
    e.preventDefault();
    const fills = $$('[data-fill]', fill.closest('.tpl-slot'));
    const next = fills[fills.indexOf(fill) + 1];
    if (next) next.focus();
    else insertFill(fill.closest('form'));
  });

  // 템플릿 트리 끌어다 놓기
  let dragId = null;
  const clearDrop = () =>
    $$('.drop-before, .drop-after, .drop-inside, .drop-root', panel).forEach((el) =>
      el.classList.remove('drop-before', 'drop-after', 'drop-inside', 'drop-root'),
    );
  function dropSpot(e) {
    const root = e.target.closest('[data-list="templates"]');
    if (!root) return null;
    const banned = new Set([dragId, ...descendants(treeOf(skill), dragId).map((n) => n.id)]);
    const empty = e.target.closest('.t-empty');
    if (empty) {
      const target = rowId(empty);
      return banned.has(target) ? null : { el: empty, where: 'inside', target };
    }
    const row = e.target.closest('.t-row');
    if (!row) return { el: root, where: 'root' };
    const target = rowId(row);
    if (banned.has(target)) return null;
    const r = row.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const where = row.closest('.t-folder') === row.parentElement ? (y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside') : y < 0.5 ? 'before' : 'after';
    return { el: row, where, target };
  }

  panel.addEventListener('dragstart', (e) => {
    const id = e.target.closest?.('.t-row') && rowId(e.target);
    if (!id) return;
    dragId = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    e.target.closest('li').classList.add('dragging');
  });
  panel.addEventListener('dragend', () => {
    dragId = null;
    clearDrop();
    $$('.dragging', panel).forEach((el) => el.classList.remove('dragging'));
  });
  panel.addEventListener('dragover', (e) => {
    if (!dragId) return;
    clearDrop();
    const spot = dropSpot(e);
    if (!spot) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    spot.el.classList.add('drop-' + spot.where);
  });
  panel.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const spot = dropSpot(e);
    clearDrop();
    if (spot) moveNode(skill, dragId, spot);
    dragId = null;
  });
}

/* ---------- 백업 ---------- */

function bindBackup() {
  $('#export-btn').addEventListener('click', () => {
    const payload = { app: 'midori-english', version: 1, exportedAt: new Date().toISOString(), ...state.data };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `midori-english-${new Date().toISOString().slice(0, 10)}.json`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      if (json.app && json.app !== 'midori-english' && !confirm('영어 앱 백업이 아닌 것 같아요. 그래도 가져올까요?')) return;
      const LABEL = { vocab: '단어', templates: '템플릿', answers: '풀이 노트' };
      const counts = COLLECTIONS.map((col) => [col, Array.isArray(json[col]) ? json[col].length : 0]).filter(([, n]) => n);
      if (!counts.length) return toast('가져올 데이터가 없어요.');
      if (!confirm(`${counts.map(([col, n]) => `${LABEL[col]} ${n}개`).join(', ')}를 추가할까요?`)) return;
      for (const [col] of counts) await state.store.bulkAdd(col, json[col]);
      toast(`${counts.reduce((sum, [, n]) => sum + n, 0)}개 항목을 가져왔어요.`);
    } catch (err) {
      console.error(err);
      toast('백업 파일을 읽지 못했어요.');
    }
  });
}

/* ---------- 시작 ---------- */

// 컬렉션이 바뀌면 다시 그릴 것
const renderers = {
  vocab: renderVocab,
  templates: () => Object.keys(SKILLS).forEach(renderTemplates),
  answers: () =>
    Object.keys(SKILLS).forEach((skill) => {
      renderNotes(skill);
      if (practice[skill].sub === 'copy') renderCopy(skill);
    }),
};

function createStore() {
  return createLocalStore();
}

function init() {
  views.vocab = renderVocab;
  Object.keys(SKILLS).forEach(buildPractice);

  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $$('[data-search]').forEach((input) =>
    input.addEventListener('input', () => {
      state.query[input.dataset.search] = input.value;
      state.page[input.dataset.search] = 1;
      views[input.dataset.search]();
    }),
  );
  bindVocab();
  bindPagers();
  bindBackup();

  state.store = createStore();
  for (const col of COLLECTIONS) {
    state.store.subscribe(col, (items) => {
      state.data[col] = items;
      renderers[col]();
    });
  }

  showTab(pref('tab', 'vocab'));
}

init();
