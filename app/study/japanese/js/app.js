import { COLLECTIONS, createLocalStore } from './store.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const includes = (q, ...fields) => !q || fields.some((f) => String(f ?? '').toLowerCase().includes(q));

function pref(key, fallback) {
  try {
    return localStorage.getItem('midori-pref:' + key) ?? fallback;
  } catch {
    return fallback;
  }
}
function setPref(key, value) {
  try {
    localStorage.setItem('midori-pref:' + key, value);
  } catch {}
}

const PAGE_SIZES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const GRAMMAR_PAGE_SIZE = 10;
const sizePref = (key, fallback) => {
  const n = Number(pref(key, fallback));
  return PAGE_SIZES.includes(n) ? n : fallback;
};

const state = {
  store: null,
  data: { vocab: [], grammar: [], known: [] },
  editing: { vocab: null, grammar: null },
  query: { vocab: '', grammar: '' },
  sort: pref('vocab-sort', 'new'),
  vocabView: pref('vocab-view', 'study') === 'done' ? 'done' : 'study', // 학습 중 | 학습 완료
  hide: { reading: false, meaning: false },
  page: { vocab: 1, grammar: 1, kanji: 1 },
  pageSize: { vocab: sizePref('vocab-page-size', 20), kanji: sizePref('kanji-page-size', 10) },
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

function bindPagers() {
  const render = { vocab: renderVocab, grammar: renderGrammar, kanji: renderKanji };
  $$('[data-pager]').forEach((el) =>
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-page]');
      if (!btn || btn.disabled) return;
      state.page[el.dataset.pager] = Number(btn.dataset.page);
      render[el.dataset.pager]();
      window.scrollTo({ top: 0 });
    }),
  );
}

/* ---------- 탭 ---------- */

function showTab(name) {
  $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
  $$('.panel').forEach((p) => (p.hidden = p.id !== 'tab-' + name));
  setPref('tab', name);
}

/* ---------- 単語 ---------- */
// 단어마다 status('known' 외움 | 'confused' 헷갈림 | '') 와 done(학습 완료) 를 저장한다.

function renderVocab() {
  const q = state.query.vocab.trim().toLowerCase();
  const done = state.vocabView === 'done';
  const inView = state.data.vocab.filter((v) => !!v.done === done);
  const items = inView
    .filter((v) => includes(q, v.word, v.reading, v.meaning))
    .sort((a, b) => (state.sort === 'new' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));

  const doneCount = state.data.vocab.filter((v) => v.done).length;
  $$('#vocab-view [data-view]').forEach((b) => {
    b.setAttribute('aria-pressed', b.dataset.view === state.vocabView);
    $('.n', b).textContent = b.dataset.view === 'done' ? doneCount : state.data.vocab.length - doneCount;
  });
  $('#test-open').hidden = done;
  $('#vocab-count').textContent = q ? `${items.length} / ${inView.length}개` : `${inView.length}개`;

  // 학습 완료 목록에는 외움/헷갈림 칸이 없다
  const ckCols = done ? 1 : 3;
  $('.vocab-table').classList.toggle('view-done', done);
  $('#vocab-cols').innerHTML = `<col class="c-word"><col class="c-reading"><col class="c-meaning">${'<col class="c-ck">'.repeat(ckCols)}<col class="c-actions">`;
  $('#vocab-head').innerHTML = `<tr><th>単語</th><th>読み方</th><th>意味</th>${
    done ? '' : '<th class="ck-h known">외움</th><th class="ck-h confused">헷갈림</th>'
  }<th class="ck-h done">완료</th><th></th></tr>`;

  $('#vocab-body').innerHTML = paginate('vocab', items, state.pageSize.vocab)
    .map((v) => {
      if (state.editing.vocab === v.id) {
        return `<tr data-id="${esc(v.id)}" class="editing">
          <td><input class="jp" name="word" value="${esc(v.word)}"></td>
          <td><input class="jp" name="reading" value="${esc(v.reading)}"></td>
          <td><input name="meaning" value="${esc(v.meaning)}"></td>
          ${'<td></td>'.repeat(ckCols)}
          <td class="actions"><button type="button" data-act="save" class="icon" title="저장">✓</button><button type="button" data-act="cancel" class="icon" title="취소">↺</button></td>
        </tr>`;
      }
      const marks = done
        ? ''
        : Object.entries(STATUS_LABEL)
            .map(
              ([st, label]) =>
                `<td class="ck-cell"><input type="checkbox" class="ck ck-${st}" data-status="${st}" aria-label="${label}"${v.status === st ? ' checked' : ''}></td>`,
            )
            .join('');
      return `<tr data-id="${esc(v.id)}" class="${done ? 'is-done' : v.status ? 'st-' + v.status : ''}">
        <td class="jp word">${esc(v.word)}</td>
        <td class="jp reading maskable">${esc(v.reading)}</td>
        <td class="meaning maskable">${esc(v.meaning)}</td>
        ${marks}
        <td class="ck-cell"><input type="checkbox" class="ck ck-done" data-done aria-label="학습 완료"${v.done ? ' checked' : ''}></td>
        <td class="actions"><button type="button" data-act="edit" class="icon" title="수정">✎</button><button type="button" data-act="del" class="icon danger" title="삭제">×</button></td>
      </tr>`;
    })
    .join('');

  const empty = $('#vocab-empty');
  empty.hidden = items.length > 0;
  empty.textContent = q
    ? '검색 결과가 없어요.'
    : done
      ? '학습 완료한 단어가 없어요. 단어 줄의 「완료」를 체크하면 여기로 옮겨져요.'
      : '아직 등록한 단어가 없어요. 위에서 단어를 추가해 보세요.';

  const editRow = $('#vocab-body tr.editing input');
  if (editRow && !document.activeElement?.closest('#vocab-body')) editRow.focus();
}

function setVocabView(view) {
  state.vocabView = view;
  state.page.vocab = 1;
  setPref('vocab-view', view);
  renderVocab();
}

function saveVocabRow(tr) {
  const data = Object.fromEntries($$('input', tr).map((i) => [i.name, i.value.trim()]));
  if (!data.word) return toast('単語는 비워둘 수 없어요.');
  state.editing.vocab = null;
  run(state.store.update('vocab', tr.dataset.id, data));
  renderVocab();
}

function bindVocab() {
  $('#vocab-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = formData(e.target);
    if (!data.word) return;
    state.vocabView = 'study';
    state.page.vocab = state.sort === 'new' ? 1 : Infinity; // 새 단어가 보이는 페이지로
    run(state.store.add('vocab', data));
    e.target.reset();
    e.target.word.focus();
  });

  $('#vocab-view').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (btn) setVocabView(btn.dataset.view);
  });

  const body = $('#vocab-body');
  body.addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (!tr || e.target.closest('.ck-cell')) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'edit') {
      state.editing.vocab = tr.dataset.id;
      renderVocab();
    } else if (act === 'cancel') {
      state.editing.vocab = null;
      renderVocab();
    } else if (act === 'save') {
      saveVocabRow(tr);
    } else if (act === 'del') {
      const word = state.data.vocab.find((v) => v.id === tr.dataset.id)?.word;
      if (confirm(`「${word}」을(를) 삭제할까요?`)) run(state.store.remove('vocab', tr.dataset.id));
    } else {
      e.target.closest('.maskable')?.classList.toggle('revealed');
    }
  });
  body.addEventListener('change', (e) => {
    const ck = e.target.closest('.ck');
    if (!ck) return;
    const tr = ck.closest('tr');
    if ('done' in ck.dataset) {
      // 회색으로 바뀐 걸 잠깐 보여 준 뒤 다른 목록으로 옮긴다
      tr.className = ck.checked ? 'is-done' : '';
      $$('.ck', tr).forEach((c) => (c.disabled = true));
      setTimeout(() => {
        run(state.store.update('vocab', tr.dataset.id, { done: ck.checked }));
        toast(ck.checked ? '학습 완료 단어로 옮겼어요.' : '학습 중 단어로 되돌렸어요.');
      }, 350);
    } else {
      run(state.store.update('vocab', tr.dataset.id, { status: ck.checked ? ck.dataset.status : '' }));
    }
  });
  body.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr.editing');
    if (!tr) return;
    if (isEnter(e)) saveVocabRow(tr);
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
      $('.vocab-table').classList.toggle('hide-' + key, state.hide[key]);
      $$('.revealed', body).forEach((td) => td.classList.remove('revealed'));
    }),
  );

  const sort = $('#vocab-sort');
  sort.value = state.sort;
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
        <option value="word">단어 보고 읽기·뜻 쓰기</option>
        <option value="meaning">뜻 보고 단어·읽기 쓰기</option>
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
  const cols = byWord ? ['単語', '読み方', '意味'] : ['意味', '単語', '読み方'];
  const rows = test.items
    .map((v, i) => {
      // 가나로만 된 단어는 読み方 칸이 필요 없다
      const ans = { 単語: v.word, 読み方: v.reading && v.reading !== v.word ? v.reading : null, 意味: v.meaning };
      const blanks = cols
        .slice(1)
        .map((c) => (ans[c] === null ? '<td class="t-na"></td>' : `<td><span class="t-answer${c === '意味' ? '' : ' jp'}">${esc(ans[c])}</span></td>`))
        .join('');
      return `<tr><td class="t-no">${i + 1}</td><td class="t-prompt${byWord ? ' jp' : ''}">${esc(byWord ? v.word : v.meaning || '—')}</td>${blanks}</tr>`;
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
        <h2 class="jp">単語テスト</h2>
        <div class="sheet-meta">${new Date().toLocaleDateString('ko-KR')} · ${n}문제 (헷갈림 ${count('confused')} · 외움 ${count('known')})</div>
        <div class="sheet-score">점수 <span class="score-box"></span> / ${n}</div>
      </div>
      <table class="t-table">
        <colgroup><col class="t-no-col"><col class="t-q-col">${'<col>'.repeat(cols.length - 1)}</colgroup>
        <thead><tr><th class="t-no">#</th>${cols.map((c) => `<th class="jp">${c}</th>`).join('')}</tr></thead>
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

/* ---------- 文法 ---------- */

const lines = (text) =>
  String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

function grammarFields(g = {}) {
  return `<label>문법<input name="title" class="jp" value="${esc(g.title)}" required></label>
    <label>例文 <small>한 줄에 하나씩</small><textarea name="examples" class="jp" rows="3">${esc(g.examples)}</textarea></label>
    <label>설명<textarea name="explanation" rows="3">${esc(g.explanation)}</textarea></label>`;
}

function renderGrammar() {
  const q = state.query.grammar.trim().toLowerCase();
  const items = state.data.grammar
    .filter((g) => includes(q, g.title, g.examples, g.explanation))
    .sort((a, b) => b.createdAt - a.createdAt);

  $('#grammar-count').textContent = q ? `${items.length} / ${state.data.grammar.length}개` : `${state.data.grammar.length}개`;
  $('#grammar-list').innerHTML = paginate('grammar', items, GRAMMAR_PAGE_SIZE)
    .map((g) => {
      if (state.editing.grammar === g.id) {
        return `<article class="card g-card" data-id="${esc(g.id)}">
          <form class="grammar-form" data-edit>${grammarFields(g)}
            <div class="form-actions"><button type="button" data-act="cancel">취소</button><button type="submit" class="primary">저장</button></div>
          </form></article>`;
      }
      const examples = lines(g.examples);
      return `<article class="card g-card" data-id="${esc(g.id)}">
        <header class="g-head">
          <h3 class="jp">${esc(g.title)}</h3>
          <div class="actions"><button type="button" data-act="edit" class="icon" title="수정">✎</button><button type="button" data-act="del" class="icon danger" title="삭제">×</button></div>
        </header>
        ${examples.length ? `<div class="g-block"><div class="g-label">例文</div><ul class="examples jp">${examples.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>` : ''}
        ${g.explanation ? `<div class="g-block"><div class="g-label">설명</div><p class="explain">${esc(g.explanation)}</p></div>` : ''}
      </article>`;
    })
    .join('');

  const empty = $('#grammar-empty');
  empty.hidden = items.length > 0;
  empty.textContent = q ? '검색 결과가 없어요.' : '아직 등록한 문법이 없어요. 「+ 문법 추가」를 눌러 시작해 보세요.';
}

function bindGrammar() {
  $('#grammar-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = formData(e.target);
    if (!data.title) return;
    state.page.grammar = 1;
    run(state.store.add('grammar', data));
    e.target.reset();
    e.target.title.focus();
  });

  const list = $('#grammar-list');
  list.addEventListener('click', (e) => {
    const card = e.target.closest('.g-card');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!card || !act) return;
    if (act === 'edit') {
      state.editing.grammar = card.dataset.id;
      renderGrammar();
      $('[data-edit] input', list)?.focus();
    } else if (act === 'cancel') {
      state.editing.grammar = null;
      renderGrammar();
    } else if (act === 'del') {
      const title = state.data.grammar.find((g) => g.id === card.dataset.id)?.title;
      if (confirm(`「${title}」 섹션을 삭제할까요?`)) run(state.store.remove('grammar', card.dataset.id));
    }
  });
  list.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = formData(e.target);
    if (!data.title) return;
    const id = e.target.closest('.g-card').dataset.id;
    state.editing.grammar = null;
    run(state.store.update('grammar', id, data));
    renderGrammar();
  });
}

/* ---------- 常用漢字 ---------- */
// 한자 데이터는 web/data/kanji.json (읽기 전용). 사용자 데이터는 외움/헷갈림 표시(known 컬렉션)만 저장한다.

const kanji = {
  list: [], // [{ n, k, lv, st, mean, on, kun, shape, onD, kunD, key, words? }]
  byN: new Map(),
  loaded: false,
  failed: false,
  level: pref('kanji-level', ''),
  knownFilter: pref('kanji-known', '').replace('todo', 'none'), // '' | none | known | confused
  query: '',
  hide: { reading: false, meaning: false },
  view: [], // 지금 목록에 걸러진 번호 전체 (상세 창의 이전/다음 순서, 페이지와 무관)
  detail: null, // { list, idx }
};

const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const normalize = (s) => toHira(String(s ?? '').toLowerCase()).replace(/[()（）\-.・、,\s]/g, '');
const isKanjiChar = (c) => /[㐀-鿿豈-﫿\u{20000}-\u{2ffff}々]/u.test(c);

// 한자 → 'known' | 'confused' (status 가 없는 예전 기록은 외움)
const kanjiStatus = () => new Map(state.data.known.map((d) => [d.kanji, d.status || 'known']));

const STATUS_LABEL = { known: '외움', confused: '헷갈림' };

// 외움/헷갈림 체크박스 둘 (하나만 켜진다)
const statusMarks = (status, attr) =>
  Object.entries(STATUS_LABEL)
    .map(
      ([st, label]) =>
        `<label class="mark ${st}"><input type="checkbox" class="ck ck-${st}" ${attr}="${st}"${status === st ? ' checked' : ''}>${label}</label>`,
    )
    .join('');

async function loadKanji() {
  try {
    const res = await fetch('data/kanji.json');
    if (!res.ok) throw new Error(res.status);
    kanji.list = await res.json();
    for (const k of kanji.list) {
      k.key = normalize(`${k.k}|${k.on}|${k.kun}|${k.mean}`);
      kanji.byN.set(k.n, k);
    }
    kanji.loaded = true;
  } catch (err) {
    console.error(err);
    kanji.failed = true;
  }
  renderKanji();
}

/* 음독·훈독 단어 */
// 음독/훈독 상세의 단어 줄(.wr)과 훈독 상세의 뜻풀이 문장(「会う는 “만나다”라는 뜻의…」)에서 단어를 뽑는다.

const vocabKey = (word, reading) => `${word}|${reading}`;
const vocabKeys = () => new Set(state.data.vocab.map((v) => vocabKey(v.word, v.reading)));
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const DEF_RE = /^\s*[은는이가]\s*(?:둘 다\s*|모두\s*)?[“"]([^”"]+)[”"]/;

// <ruby> 가 섞인 요소 → 글자만 / 읽기만
function splitRuby(el) {
  const word = el.cloneNode(true);
  $$('rt', word).forEach((rt) => rt.remove());
  const reading = el.cloneNode(true);
  $$('ruby', reading).forEach((r) => r.replaceWith($('rt', r)?.textContent ?? r.textContent));
  return { word: clean(word.textContent), reading: clean(reading.textContent) };
}

function parseWords(root, char) {
  const out = [];
  for (const el of $$('.wr, p', root)) {
    const kind = el.closest('[data-kind]').dataset.kind;
    if (el.matches('.wr')) {
      const jp = $('.w > .jp', el);
      if (jp) out.push({ ...splitRuby(jp), meaning: clean($('.m', el)?.textContent), kind });
    } else if (kind === 'kun') {
      const span = el.firstChild;
      if (!span?.matches?.('span.jp')) continue;
      const def = el.textContent.slice(span.textContent.length).match(DEF_RE);
      if (!def) continue;
      // 「住む、住まう는 둘 다 “거주하다”…」 처럼 한 문장에 여러 단어
      const { word, reading } = splitRuby(span);
      const readings = reading.split('、');
      word.split('、').forEach((w, i) => {
        if (w.includes(char)) out.push({ word: w, reading: readings[i] ?? '', meaning: clean(def[1]), kind });
      });
    }
  }
  return out;
}

function kanjiWords(k) {
  if (!k.words) {
    const tpl = document.createElement('template');
    tpl.innerHTML = `<div data-kind="on">${k.onD || ''}</div><div data-kind="kun">${k.kunD || ''}</div>`;
    const seen = new Set();
    k.words = parseWords(tpl.content, k.k)
      .map((w) => ({ ...w, key: vocabKey(w.word, w.reading) }))
      .filter((w) => w.word && !seen.has(w.key) && seen.add(w.key));
  }
  return k.words;
}

// 단어장에 아직 없는 단어 (중복 제거)
function freshWords(words) {
  const have = vocabKeys();
  return words.filter((w) => !have.has(w.key) && have.add(w.key));
}

function addWords(words) {
  const fresh = freshWords(words);
  if (fresh.length) run(state.store.bulkAdd('vocab', fresh.map(({ word, reading, meaning }) => ({ word, reading, meaning }))));
  return fresh.length;
}

const addAllLabel = (left) => (left ? `＋ 단어 ${left}개 모두 단어장에` : '✓ 모두 단어장에 있어요');

function wordsBlock(k, have) {
  const words = kanjiWords(k);
  if (!words.length) return '<p class="kw-none">예시 단어가 없어요.</p>';
  const group = (label, list) =>
    list.length
      ? `<div class="kw-group"><div class="kw-label">${label}</div><ul class="kw-list">${list
          .map((w) => {
            const added = have.has(w.key);
            return `<li class="kw">
              <span class="kw-word jp">${esc(w.word)}</span>
              <span class="kw-read jp">${esc(w.reading)}</span>
              <span class="kw-mean">${esc(w.meaning)}</span>
              <button type="button" class="add-word${added ? ' added' : ''}" data-add="${esc(w.key)}" data-kn="${k.n}" title="${added ? '단어장에서 빼기' : '단어장에 추가'}">${added ? '✓' : '+'}</button>
            </li>`;
          })
          .join('')}</ul></div>`
      : '';
  const left = words.filter((w) => !have.has(w.key)).length;
  return `${group('음독 단어', words.filter((w) => w.kind === 'on'))}${group('훈독 단어', words.filter((w) => w.kind === 'kun'))}
    <button type="button" class="chip add-all" data-addall data-kn="${k.n}"${left ? '' : ' disabled'}>${addAllLabel(left)}</button>`;
}

// 단어장이 바뀌면 화면의 추가 버튼 상태만 맞춘다 (다시 그리면 스크롤/포커스가 흔들리므로)
function syncWordButtons() {
  if (!kanji.loaded) return;
  const have = vocabKeys();
  $$('[data-add]').forEach((btn) => {
    const added = have.has(btn.dataset.add);
    btn.classList.toggle('added', added);
    btn.textContent = added ? '✓' : '+';
    btn.title = added ? '단어장에서 빼기' : '단어장에 추가';
  });
  $$('[data-addall]').forEach((btn) => {
    const left = kanjiWords(kanji.byN.get(Number(btn.dataset.kn))).filter((w) => !have.has(w.key)).length;
    btn.disabled = !left;
    btn.textContent = addAllLabel(left);
  });
}

// 카드·상세 창 공통: 단어 추가(✓ 이면 빼기) 버튼 클릭이면 처리하고 true
function handleWordClick(e) {
  const btn = e.target.closest('[data-add], [data-addall]');
  if (!btn) return false;
  const k = kanji.byN.get(Number(btn.dataset.kn));
  if ('add' in btn.dataset) {
    const w = kanjiWords(k).find((x) => x.key === btn.dataset.add);
    const docs = state.data.vocab.filter((v) => vocabKey(v.word, v.reading) === w.key);
    if (!docs.length) {
      addWords([w]);
      toast(`「${w.word}」 단어장에 추가했어요.`);
    } else if (!docs.some((v) => v.status || v.done) || confirm(`「${w.word}」에는 외움·헷갈림·학습 완료 표시가 있어요. 단어장에서 뺄까요?`)) {
      docs.forEach((v) => run(state.store.remove('vocab', v.id)));
      toast(`「${w.word}」 단어장에서 뺐어요.`);
    }
  } else {
    const n = addWords(kanjiWords(k));
    toast(n ? `${k.k} 단어 ${n}개를 단어장에 추가했어요.` : '이미 모두 단어장에 있어요.');
  }
  return true;
}

/* 목록 */

function filterKanji() {
  const raw = kanji.query.trim();
  const status = kanjiStatus();
  let items = kanji.list;

  if (raw) {
    const chars = [...raw.replace(/\s/g, '')];
    if (/^\d+$/.test(raw)) {
      items = items.filter((k) => k.n === Number(raw));
    } else if (chars.every(isKanjiChar)) {
      // 한자만 입력하면 그 글자들을 찾는다 (예: 会社 → 会, 社)
      const set = new Set(chars);
      items = items.filter((k) => set.has(k.k));
    } else {
      const q = normalize(raw);
      items = items.filter((k) => k.key.includes(q));
    }
  }
  if (kanji.level) items = items.filter((k) => k.lv === kanji.level);
  if (kanji.knownFilter === 'none') items = items.filter((k) => !status.has(k.k));
  else if (kanji.knownFilter) items = items.filter((k) => status.get(k.k) === kanji.knownFilter);
  return { items, status };
}

function renderKanji() {
  const grid = $('#kanji-grid');
  const empty = $('#kanji-empty');
  $$('#kanji-level [data-lv]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.lv === kanji.level));

  if (!kanji.loaded) {
    empty.hidden = false;
    empty.textContent = kanji.failed ? '한자 데이터를 불러오지 못했어요.' : '한자 데이터를 불러오는 중…';
    return;
  }

  const { items, status } = filterKanji();
  const have = vocabKeys();
  kanji.view = items.map((k) => k.n);
  const marked = [...status.values()];
  $('#kanji-count').textContent = `${items.length}자 · 외움 ${marked.filter((s) => s === 'known').length} · 헷갈림 ${marked.filter((s) => s === 'confused').length}`;

  grid.innerHTML = paginate('kanji', items, state.pageSize.kanji)
    .map((k) => {
      const st = status.get(k.k);
      return `<article class="card k-card${st ? ' ' + st : ''}" data-n="${k.n}" tabindex="0" aria-label="${k.n}번 ${esc(k.k)}">
        <div class="k-side">
          <div class="k-top"><span class="k-no">${k.n}</span><span class="lv lv-${k.lv.toLowerCase()}">${k.lv}</span></div>
          <div class="k-char jp">${esc(k.k)}</div>
          <div class="k-marks">${statusMarks(st, 'data-kstatus')}</div>
        </div>
        <div class="k-main">
          <div class="k-summary">
            <dl class="k-info">
              <div><dt>音</dt><dd class="jp">${esc(k.on) || '—'}</dd></div>
              <div><dt>訓</dt><dd class="jp">${esc(k.kun) || '—'}</dd></div>
            </dl>
            <div class="k-mean">${esc(k.mean)}</div>
          </div>
          <div class="k-words">${wordsBlock(k, have)}</div>
          <div class="k-open">상세 보기 ›</div>
        </div>
      </article>`;
    })
    .join('');

  empty.hidden = items.length > 0;
  empty.textContent = '조건에 맞는 한자가 없어요.';
}

// status: 'known' | 'confused' | '' (표시 해제)
function setKanjiStatus(char, status) {
  const [doc, ...dupes] = state.data.known.filter((d) => d.kanji === char);
  dupes.forEach((d) => run(state.store.remove('known', d.id)));
  if (!status) {
    if (doc) run(state.store.remove('known', doc.id));
  } else if (doc) run(state.store.update('known', doc.id, { status }));
  else run(state.store.add('known', { kanji: char, status }));
}

/* 상세 창 */

function openKanji(n, list = kanji.view) {
  if (!list.includes(n)) list = kanji.list.map((k) => k.n);
  kanji.detail = { list, idx: list.indexOf(n) };
  const modal = $('#kanji-modal');
  modal.hidden = false;
  document.body.classList.add('modal-open');
  renderDetail();
  $('.modal-card', modal).focus();
}

function closeKanji() {
  if (!kanji.detail) return;
  const n = kanji.detail.list[kanji.detail.idx];
  kanji.detail = null;
  $('#kanji-modal').hidden = true;
  document.body.classList.remove('modal-open');
  // 상세 창에서 넘겨 본 한자가 다른 페이지에 있으면 그 페이지로
  const idx = kanji.view.indexOf(n);
  const page = Math.floor(idx / state.pageSize.kanji) + 1;
  if (idx >= 0 && page !== state.page.kanji) {
    state.page.kanji = page;
    renderKanji();
  }
  $(`#kanji-grid [data-n="${n}"]`)?.focus();
}

function moveKanji(step) {
  const d = kanji.detail;
  if (!d) return;
  d.idx = (d.idx + step + d.list.length) % d.list.length;
  renderDetail();
}

function detailSection(title, body) {
  return body ? `<section class="kd-sec"><h3>${title}</h3><div class="rich">${body}</div></section>` : '';
}

// 표시만 바뀔 때는 본문을 다시 그리지 않는다 (스크롤 유지)
function renderDetailMarks() {
  const d = kanji.detail;
  if (!d) return;
  const k = kanji.byN.get(d.list[d.idx]);
  $('#kd-marks').innerHTML = statusMarks(kanjiStatus().get(k.k), 'data-kstatus');
}

function renderDetail() {
  const d = kanji.detail;
  if (!d) return;
  const k = kanji.byN.get(d.list[d.idx]);

  $('#kd-pos').textContent = `${d.idx + 1} / ${d.list.length}`;
  renderDetailMarks();

  // shape / onD / kunD 는 빌드 시 화이트리스트로 정리된 HTML (web/data/kanji.json)
  const body = $('#kd-body');
  body.innerHTML = `
    <div class="kd-head">
      <div class="kd-char jp">${esc(k.k)}</div>
      <div class="kd-summary">
        <div class="kd-meta"><span class="k-no">${k.n}번</span><span class="lv lv-${k.lv.toLowerCase()}">${k.lv}</span>${k.st ? `<span>${k.st}획</span>` : ''}</div>
        <dl class="kd-info">
          <div><dt>의미</dt><dd>${esc(k.mean)}</dd></div>
          <div><dt>음독</dt><dd class="jp">${esc(k.on) || '—'}</dd></div>
          <div><dt>훈독</dt><dd class="jp">${esc(k.kun) || '—'}</dd></div>
        </dl>
      </div>
    </div>
    <section class="kd-sec"><h3>단어</h3><div class="k-words">${wordsBlock(k, vocabKeys())}</div></section>
    ${detailSection('한자 모양 해설', k.shape)}
    ${detailSection('음독 상세', k.onD)}
    ${detailSection('훈독 상세', k.kunD)}`;
  body.scrollTop = 0;
}

function bindKanji() {
  const resetPage = () => (state.page.kanji = 1);

  let timer;
  $('#kanji-search').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      kanji.query = e.target.value;
      resetPage();
      renderKanji();
    }, 120);
  });

  $('#kanji-level').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-lv]');
    if (!btn) return;
    kanji.level = btn.dataset.lv;
    setPref('kanji-level', kanji.level);
    resetPage();
    renderKanji();
  });

  const knownSel = $('#kanji-known');
  knownSel.value = kanji.knownFilter;
  knownSel.addEventListener('change', () => {
    kanji.knownFilter = knownSel.value;
    setPref('kanji-known', knownSel.value);
    resetPage();
    renderKanji();
  });

  bindPageSize('kanji', renderKanji);

  $$('[data-khide]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const key = btn.dataset.khide;
      kanji.hide[key] = !kanji.hide[key];
      btn.setAttribute('aria-pressed', kanji.hide[key]);
      $('#kanji-grid').classList.toggle('hide-' + key, kanji.hide[key]);
    }),
  );

  $('#kanji-addlist').addEventListener('click', () => {
    if (!kanji.loaded) return;
    const list = kanji.view.map((n) => kanji.byN.get(n));
    const fresh = freshWords(list.flatMap(kanjiWords));
    if (!fresh.length) return toast('이 목록의 단어는 이미 모두 단어장에 있어요.');
    if (!confirm(`지금 목록의 한자 ${list.length}자에 나오는 단어 중 단어장에 없는 ${fresh.length}개를 추가할까요?`)) return;
    addWords(fresh);
    toast(`단어 ${fresh.length}개를 단어장에 추가했어요.`);
  });

  const grid = $('#kanji-grid');
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.k-card');
    if (!card || handleWordClick(e) || e.target.closest('button, .mark')) return;
    if (!getSelection().toString()) openKanji(Number(card.dataset.n)); // 글자를 드래그해 복사할 때는 열지 않음
  });
  grid.addEventListener('change', (e) => {
    const ck = e.target.closest('[data-kstatus]');
    if (ck) setKanjiStatus(kanji.byN.get(Number(ck.closest('.k-card').dataset.n)).k, ck.checked ? ck.dataset.kstatus : '');
  });
  grid.addEventListener('keydown', (e) => {
    const card = e.target.closest('.k-card');
    if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openKanji(Number(card.dataset.n));
    }
  });

  const modal = $('#kanji-modal');
  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeKanji();
    if (handleWordClick(e)) return;
    const nav = e.target.closest('[data-nav]');
    if (nav) return moveKanji(Number(nav.dataset.nav));
    const link = e.target.closest('.kl[data-n]');
    if (link) {
      const d = kanji.detail;
      const n = Number(link.dataset.n);
      if (d.list.includes(n)) {
        d.idx = d.list.indexOf(n);
        renderDetail();
      } else openKanji(n);
    }
  });
  $('#kd-marks').addEventListener('change', (e) => {
    const d = kanji.detail;
    setKanjiStatus(kanji.byN.get(d.list[d.idx]).k, e.target.checked ? e.target.dataset.kstatus : '');
  });
  document.addEventListener('keydown', (e) => {
    if (!kanji.detail || e.target.closest?.('input, textarea, select')) return;
    if (e.key === 'Escape') closeKanji();
    if (e.key === 'ArrowLeft') moveKanji(-1);
    if (e.key === 'ArrowRight') moveKanji(1);
  });
}

/* ---------- 백업 ---------- */

function bindBackup() {
  $('#export-btn').addEventListener('click', () => {
    const payload = { app: 'midori-study', version: 1, exportedAt: new Date().toISOString(), ...state.data };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `midori-study-${new Date().toISOString().slice(0, 10)}.json`,
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
      const counts = COLLECTIONS.map((col) => (Array.isArray(json[col]) ? json[col].length : 0));
      const total = counts.reduce((a, b) => a + b, 0);
      if (!total) return toast('가져올 데이터가 없어요.');
      if (!confirm(`단어 ${counts[0]}개, 문법 ${counts[1]}개, 한자 표시 ${counts[2]}개를 추가할까요?`)) return;
      for (const col of COLLECTIONS) {
        if (Array.isArray(json[col]) && json[col].length) await state.store.bulkAdd(col, json[col]);
      }
      toast(`${total}개 항목을 가져왔어요.`);
    } catch (err) {
      console.error(err);
      toast('백업 파일을 읽지 못했어요.');
    }
  });
}

/* ---------- 시작 ---------- */

const renderers = {
  vocab: () => {
    renderVocab();
    syncWordButtons();
  },
  grammar: renderGrammar,
  known: () => {
    renderKanji();
    renderDetailMarks();
  },
};

function createStore() {
  return createLocalStore();
}

function init() {
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $$('[data-search]').forEach((input) =>
    input.addEventListener('input', () => {
      state.query[input.dataset.search] = input.value;
      state.page[input.dataset.search] = 1;
      renderers[input.dataset.search]();
    }),
  );
  bindVocab();
  bindGrammar();
  bindKanji();
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
  loadKanji();
}

init();
