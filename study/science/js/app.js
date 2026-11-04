import { COLLECTIONS, createStore as createSyncedStore, newId } from './store.js';
import * as images from './images.js';

// 수학·물리·화학이 같은 코드를 쓴다. 과목은 주소의 ?subject= 로 정해진다 (학습 대시보드에서 들어옴).
const SUBJECTS = {
  math: { name: '수학', ja: '数学' },
  physics: { name: '물리', ja: '物理' },
  chemistry: { name: '화학', ja: '化学', elements: true },
};
const subject = new URLSearchParams(location.search).get('subject');
const SUB = SUBJECTS[subject];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const norm = (s) => toHira(String(s ?? '').toLowerCase()).replace(/\s+/g, '');
const groupBy = (list, key) => {
  const map = new Map();
  for (const x of list) {
    const k = key(x);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(x);
  }
  return map;
};

function pref(key, fallback) {
  try {
    return localStorage.getItem(`midori-${subject}-pref:${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}
function setPref(key, value) {
  try {
    localStorage.setItem(`midori-${subject}-pref:${key}`, value);
  } catch {}
}

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
  return Promise.resolve(promise).catch((err) => {
    console.error(err);
    toast('저장에 실패했어요: ' + err.message);
  });
}

/* ---------- 수식 (KaTeX) ---------- */

function texHTML(tex) {
  if (!tex?.trim()) return '<span class="muted">수식을 입력하세요</span>';
  try {
    return katex.renderToString(tex, { displayMode: true, throwOnError: false, strict: 'ignore' });
  } catch (err) {
    return `<span class="tex-err">${esc(err.message)}</span>`;
  }
}

// 글 (옵시디언처럼): $…$ 줄 안 수식, $$…$$ 따로 한 줄 수식, ![[이미지id]] 또는 ![[이미지id|너비]] 이미지
const RICH_RE = /!\[\[([^\]|\n]+)(?:\|(\d+))?\]\]|\$\$([\s\S]+?)\$\$|\$(?!\s)([^$\n]+?)(?<!\s)\$/g;
const IMG_RE = /!\[\[([^\]|\n]+)(?:\|\d+)?\]\]/g;
const hasRich = (text) => /\$|!\[\[/.test(text || '');
const textImages = (text) => [...(text || '').matchAll(IMG_RE)].map((m) => m[1].trim());

function texInline(tex, display) {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore' });
  } catch (err) {
    return `<span class="tex-err">${esc(err.message)}</span>`;
  }
}

function richHTML(text) {
  text = String(text ?? '');
  const out = [];
  let last = 0;
  let eatNewline = false; // 수식 블록·이미지 앞뒤의 줄바꿈 하나는 블록이 대신한다
  const plain = (s, block) => {
    if (eatNewline) s = s.replace(/^\r?\n/, '');
    if (block) s = s.replace(/\r?\n$/, '');
    out.push(esc(s));
  };
  for (const m of text.matchAll(RICH_RE)) {
    const [all, img, width, display, inline] = m;
    const block = inline === undefined;
    plain(text.slice(last, m.index), block);
    if (img) out.push(`<img class="rich-img" data-img="${esc(img.trim())}" alt=""${width ? ` style="width:${width}px"` : ''}>`);
    else if (display !== undefined) out.push(texInline(display, true));
    else out.push(texInline(inline, false));
    eatNewline = block;
    last = m.index + all.length;
  }
  plain(text.slice(last), false);
  return out.join('');
}

/* ---------- 단원 ---------- */
// data/units-<과목>.json (Obsidian 진도 체크리스트에서 생성). 단원 id 는 「상위 › 하위」 경로 문자열.

const units = { roots: [], byId: new Map(), order: [] };

async function loadUnits() {
  const tree = await (await fetch(`data/units-${subject}.json`)).json();
  const walk = (list, parent, depth) =>
    list.map((n) => {
      const node = { id: parent ? `${parent.id} › ${n.t}` : n.t, t: n.t, depth, parent, children: [] };
      units.byId.set(node.id, node);
      units.order.push(node);
      node.children = walk(n.c || [], node, depth + 1);
      return node;
    });
  units.roots = walk(tree, null, 0);
}

// 없는 단원(체크리스트에서 지워짐 등)은 '' = 단원 미지정
const unitKey = (id) => (id && units.byId.has(id) ? id : '');
const unitPath = (id) => (unitKey(id) ? id : '단원 미지정');
const isUnder = (id, ancestor) => !ancestor || id === ancestor || id.startsWith(ancestor + ' › ');

function unitOptions(selected, empty = '단원 선택…') {
  return (
    `<option value="">${empty}</option>` +
    units.order
      .map((n) => `<option value="${esc(n.id)}"${n.id === selected ? ' selected' : ''}>${'　'.repeat(n.depth)}${esc(n.t)}</option>`)
      .join('')
  );
}

/* ---------- 페이지 종류 ---------- */

const PAGES = {
  concepts: { noun: '개념', sections: [{ key: 'blocks', label: '', first: 'text' }] },
  // 오답노트는 칸마다 글 상자 하나 (수식·이미지는 글 안에)
  notes: {
    noun: '오답',
    rich: true,
    sections: [
      { key: 'problem', label: '문제', first: 'text' },
      { key: 'solution', label: '풀이', first: 'text' },
      { key: 'used', label: '사용된 개념', first: 'text' },
      { key: 'memo', label: '암기 사항', first: 'memo' },
    ],
  },
};
const KINDS = { wrong: '틀림', confused: '헷갈림', unknown: '모름' };
const BLOCKS = { text: '글', formula: '수식', image: '이미지', memo: '암기' };
// 등록할 수 있는 블록 → 모아 보는 탭
const REG = {
  formula: { tab: 'formulas', label: '수식 탭에 등록', ask: '수식 등록할 때 단원을 선택해 주세요' },
  memo: { tab: 'memos', label: '암기 탭에 등록', ask: '암기 사항 등록할 때 단원을 선택해 주세요' },
};
const REG_TABS = { formulas: 'formula', memos: 'memo' };
const NONE = '∅'; // 수식/암기 탭에서 「단원 미지정」만 보기

const newBlock = (type) => ({ id: newId(), type, ...(type in REG ? { reg: false, ref: false, unit: '' } : {}) });
const pageBlocks = (col, p) => PAGES[col].sections.flatMap((s) => p[s.key] || []);
const pageText = (col, p) =>
  norm([p.title, ...pageBlocks(col, p).map((b) => [(b.text || '').replace(IMG_RE, ' '), b.tex, b.name, b.caption].join(' '))].join(' '));
// 페이지가 쓰는 이미지 id (이미지 블록 + 글 안의 ![[…]])
const pageImages = (col, p) => new Set(pageBlocks(col, p).flatMap((b) => [b.image, ...textImages(b.text)].filter(Boolean)));

// 예전 오답노트(칸마다 글·수식·이미지·암기 블록 여러 개) → 칸마다 글 상자 하나.
// 수식은 $$…$$, 이미지는 ![[id]] 로 글에 합치고, 암기 블록은 모두 「암기 사항」 칸으로 모은다.
const blockText = (b) =>
  b.type === 'formula'
    ? [b.name, b.tex?.trim() && `$$${b.tex.trim()}$$`].filter(Boolean).join('\n')
    : b.type === 'image'
      ? [b.image && `![[${b.image}]]`, b.caption].filter(Boolean).join('\n')
      : b.text || '';

const noteType = (key) => (key === 'memo' ? 'memo' : 'text');
const isOldNote = (p) => !PAGES.notes.sections.every((s) => p[s.key]?.length === 1 && p[s.key][0].type === noteType(s.key));

function migrateNote(p) {
  const secs = PAGES.notes.sections;
  const all = secs.flatMap((s) => (p[s.key] || []).map((b) => ({ b, sec: s.key })));
  const patch = {};
  for (const s of secs) {
    const type = noteType(s.key);
    const list = all.filter((x) => (type === 'memo' ? x.b.type === 'memo' : x.sec === s.key && x.b.type !== 'memo')).map((x) => x.b);
    const reg = type === 'memo' && (list.find((b) => b.reg) || list[0]);
    patch[s.key] = [
      {
        ...newBlock(type),
        id: list[0]?.id || newId(),
        text: list.map(blockText).filter((t) => t.trim()).join('\n'),
        ...(reg ? { reg: !!reg.reg, ref: !!reg.ref, unit: reg.unit || '' } : {}),
      },
    ];
  }
  return { ...p, ...patch };
}

/* ---------- 상태 ---------- */

const state = {
  store: null,
  data: { concepts: [], notes: [] },
  sel: { concepts: pref('sel-concepts', ''), notes: pref('sel-notes', '') },
  edit: null, // { col, draft } — 편집 중인 페이지 사본
  query: { concepts: '', notes: '', formulas: '', memos: '', elements: '' },
  showEmpty: { concepts: false, notes: false, formulas: false, memos: false },
  open: { concepts: new Map(), notes: new Map(), formulas: new Map(), memos: new Map() }, // 단원 펼침 (기본: 내용 있으면 펼침)
  filter: { formulas: '', memos: '' }, // 수식/암기 탭에서 고른 단원
  rhide: { formulas: false, memos: false },
  elView: pref('el-view', 'list'),
};

/* ---------- 탭 ---------- */

const TABS = ['concepts', 'notes', 'formulas', 'memos', ...(SUB?.elements ? ['elements'] : [])];

function showTab(name) {
  if (!TABS.includes(name)) name = 'concepts';
  $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
  $$('.panel').forEach((p) => (p.hidden = p.id !== 'tab-' + name));
  setPref('tab', name);
  if (name === 'elements') renderElements();
}

/* ---------- 단원 트리 ---------- */

// direct: 단원 id → 그 단원에 바로 속한 항목 수 / leaf(id): 단원 아래에 붙일 항목 html (페이지 링크)
function treeHTML(tab, direct, { leaf, addLabel, forceOpen } = {}) {
  const total = new Map();
  const sum = (n) => {
    let c = direct.get(n.id) || 0;
    for (const ch of n.children) c += sum(ch);
    total.set(n.id, c);
    return c;
  };
  units.roots.forEach(sum);

  const open = state.open[tab];
  const active = state.filter[tab];
  const row = (id, title, c, kids, isOpen) =>
    `<li class="tn${c ? '' : ' empty'}${active && active === (id || NONE) ? ' active' : ''}" data-unit="${esc(id)}">
      <div class="tn-row">
        ${kids ? `<button type="button" class="tn-tog" data-tog aria-expanded="${isOpen}" aria-label="펼치기">▸</button>` : '<span class="tn-tog"></span>'}
        <span class="tn-title" data-unitclick title="${esc(title)}">${esc(title)}</span>
        ${c ? `<span class="tn-n">${c}</span>` : ''}
        ${addLabel ? `<button type="button" class="tn-add" data-newin="${esc(id)}" title="이 단원에 ${addLabel}">+</button>` : ''}
      </div>
      ${kids && isOpen ? `<ul>${kids}</ul>` : ''}
    </li>`;

  const node = (n) => {
    const c = total.get(n.id);
    if (!c && !state.showEmpty[tab]) return '';
    const kids = n.children.map(node).join('') + (leaf?.(n.id) || '');
    const isOpen = forceOpen || (open.has(n.id) ? open.get(n.id) : c > 0);
    return row(n.id, n.t, c, kids, isOpen);
  };
  let html = units.roots.map(node).join('');
  const none = direct.get('') || 0;
  if (none) {
    const isOpen = forceOpen || (open.has('') ? open.get('') : true);
    html += row('', '단원 미지정', none, leaf?.('') || '', isOpen);
  }
  return html ? `<ul class="tree">${html}</ul>` : '';
}

function bindTree(tab, { onUnit } = {}) {
  $(`#${tab}-tree`).addEventListener('click', (e) => {
    const li = e.target.closest('.tn');
    if (e.target.closest('[data-newin]')) return newPage(tab, e.target.closest('[data-newin]').dataset.newin);
    if (e.target.closest('[data-page]')) {
      e.preventDefault();
      return selectPage(tab, e.target.closest('[data-page]').dataset.page);
    }
    if (!li) return;
    const id = li.dataset.unit;
    if (e.target.closest('[data-tog]') || (!onUnit && e.target.closest('[data-unitclick]'))) {
      const btn = $('[data-tog]', li);
      if (!btn) return;
      state.open[tab].set(id, btn.getAttribute('aria-expanded') !== 'true');
      renderers[tab]();
    } else if (onUnit && e.target.closest('[data-unitclick]')) onUnit(id);
  });
}

/* ---------- 개념 · 오답노트 ---------- */

function renderPageTab(col) {
  const q = norm(state.query[col]);
  const pages = state.data[col]
    .filter((p) => !q || pageText(col, p).includes(q))
    .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ko'));
  const byUnit = groupBy(pages, (p) => unitKey(p.unit));
  const direct = new Map([...byUnit].map(([k, v]) => [k, v.length]));
  const leaf = (uid) =>
    (byUnit.get(uid) || [])
      .map(
        (p) =>
          `<li class="tp"><a href="#" class="tp-link${p.id === state.sel[col] ? ' sel' : ''}" data-page="${esc(p.id)}">${
            col === 'notes' ? `<span class="kind-dot ${esc(p.kind || 'wrong')}" title="${KINDS[p.kind] || ''}"></span>` : ''
          }${esc(p.title || '(제목 없음)')}</a></li>`,
      )
      .join('');

  $(`#${col}-tree`).innerHTML =
    treeHTML(col, direct, { leaf, addLabel: `새 ${PAGES[col].noun}`, forceOpen: !!q }) ||
    `<p class="empty small">${q ? '검색 결과가 없어요.' : `아직 ${PAGES[col].noun}이 없어요.`}</p>`;
  $(`#${col}-count`).textContent = q ? `${pages.length} / ${state.data[col].length}개` : `${state.data[col].length}개`;
  if (state.edit?.col !== col) renderPageMain(col);
}

function renderPageMain(col) {
  const main = $(`#${col}-main`);
  if (state.edit?.col === col) {
    main.innerHTML = pageEditor(col, state.edit.draft);
    $$('textarea', main).forEach(autosize);
    $$('[data-block]', main).forEach(updatePreview);
  } else {
    const p = state.data[col].find((x) => x.id === state.sel[col]);
    main.innerHTML = p ? pageView(col, p) : pageHome(col);
  }
  hydrateImages(main);
}

function pageHome(col) {
  const recent = [...state.data[col]].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 8);
  const noun = PAGES[col].noun;
  return `<div class="home card">
    <p>왼쪽 단원 트리에서 ${noun}을 고르거나, 「+ 새 ${noun}」으로 만들어 보세요.</p>
    ${
      recent.length
        ? `<h3>최근 수정</h3><ul class="recent">${recent
            .map((p) => `<li><a href="#" data-page="${esc(p.id)}">${esc(p.title || '(제목 없음)')}</a><span>${esc(unitPath(p.unit))}</span></li>`)
            .join('')}</ul>`
        : ''
    }
  </div>`;
}

function blockView(b) {
  const attr = `data-block="${esc(b.id)}"`;
  if (b.type === 'text') return b.text?.trim() ? `<div class="bv txt" ${attr}>${richHTML(b.text)}</div>` : '';
  if (b.type === 'formula')
    return `<div class="bv fml" ${attr}>
      ${b.name || b.reg ? `<div class="bv-head">${b.name ? `<span class="fml-name">${esc(b.name)}</span>` : ''}${b.reg ? '<span class="reg-badge">수식 탭</span>' : ''}</div>` : ''}
      <div class="fml-tex">${texHTML(b.tex)}</div>
    </div>`;
  if (b.type === 'image')
    return b.image
      ? `<figure class="bv img" ${attr}><img data-img="${esc(b.image)}" alt="${esc(b.caption)}">${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`
      : '';
  if (b.type === 'memo')
    return b.text?.trim()
      ? `<div class="bv memo" ${attr}><div class="bv-head"><span class="memo-label">암기</span>${b.reg ? '<span class="reg-badge">암기 탭</span>' : ''}</div><div class="txt">${richHTML(b.text)}</div></div>`
      : '';
  return '';
}

function linksView(p) {
  const links = (p.links || []).map((id) => state.data.concepts.find((c) => c.id === id)).filter(Boolean);
  return links.length
    ? `<div class="links">${links.map((c) => `<button type="button" class="link-chip" data-goto="concepts|${esc(c.id)}">📄 ${esc(c.title || '(제목 없음)')}</button>`).join('')}</div>`
    : '';
}

function pageView(col, p) {
  const sections = PAGES[col].sections
    .map((s) => {
      const body = (s.key === 'used' ? linksView(p) : '') + (p[s.key] || []).map(blockView).join('');
      if (!s.label) return `<section class="sec">${body || '<p class="muted">내용이 없어요. 「편집」을 눌러 적어 보세요.</p>'}</section>`;
      return `<section class="sec"><h2>${s.label}</h2>${body || '<p class="muted">—</p>'}</section>`;
    })
    .join('');
  return `<article class="page card" data-col="${col}">
    <header class="page-head">
      <div class="crumbs">${esc(unitPath(p.unit))}</div>
      <div class="title-row">
        <h1>${esc(p.title || '(제목 없음)')}</h1>
        ${col === 'notes' ? `<span class="kind ${esc(p.kind || 'wrong')}">${KINDS[p.kind] || KINDS.wrong}</span>` : ''}
        <div class="page-tools">
          <button type="button" class="primary" data-pact="edit">✎ 편집</button>
          <button type="button" class="icon danger" data-pact="del" title="이 ${PAGES[col].noun} 삭제">×</button>
        </div>
      </div>
    </header>
    ${sections}
  </article>`;
}

/* 편집 */

function regRow(b, page) {
  const r = REG[b.type];
  let where = '';
  if (b.reg) {
    where = b.ref
      ? `현재 섹션 단원 참조 · ${esc(unitPath(page.unit))}`
      : esc(unitPath(b.unit));
    where = `<span class="reg-unit">${where}</span><button type="button" class="link" data-bact="unit">단원 변경</button>`;
  }
  return `<div class="reg-row"><label class="check"><input type="checkbox" data-reg${b.reg ? ' checked' : ''}> ${r.label}</label>${where}</div>`;
}

// 오답노트 칸: 글 상자 하나 + 수식·이미지 넣기 버튼
function richEditor(b, page) {
  return `<div class="blk blk-${b.type} blk-rich" data-block="${esc(b.id)}">
    <div class="rich-tools">
      <button type="button" data-ins="inline" title="글 사이에 수식: $x^2$">$ 수식</button>
      <button type="button" data-ins="display" title="따로 한 줄 수식: $$ … $$">$$ 수식 블록</button>
      <button type="button" data-ins="image" title="이미지 넣기 (붙여넣기·끌어다 놓기도 돼요)">🖼 이미지</button>
    </div>
    <textarea data-bf="text" rows="3" spellcheck="false" placeholder="${b.type === 'memo' ? '외울 내용' : '내용'}">${esc(b.text)}</textarea>
    <div class="txt prev" data-prev></div>${b.type in REG ? regRow(b, page) : ''}
  </div>`;
}

function blockEditor(b, page) {
  const tools = `<div class="blk-tools"><span class="blk-type">${BLOCKS[b.type]}</span>
    <button type="button" class="icon" data-bact="up" title="위로">↑</button>
    <button type="button" class="icon" data-bact="down" title="아래로">↓</button>
    <button type="button" class="icon danger" data-bact="del" title="블록 삭제">×</button></div>`;
  let body = '';
  if (b.type === 'text')
    body = `<textarea data-bf="text" rows="3" placeholder="내용 (글 안에서 $x^2$ 처럼 쓰면 수식이 돼요)">${esc(b.text)}</textarea><div class="txt prev" data-prev></div>`;
  else if (b.type === 'formula')
    body = `<input data-bf="name" value="${esc(b.name)}" placeholder="수식 이름 (선택 · 예: 운동방정식)">
      <textarea data-bf="tex" class="mono" rows="2" placeholder="LaTeX 수식 (예: F = ma, \\frac{1}{2}mv^2)" spellcheck="false">${esc(b.tex)}</textarea>
      <div class="fml-tex prev" data-prev></div>${regRow(b, page)}`;
  else if (b.type === 'image')
    body = `<figure class="img-ed"><img data-img="${esc(b.image)}" alt=""></figure><input data-bf="caption" value="${esc(b.caption)}" placeholder="이미지 설명 (선택)">`;
  else if (b.type === 'memo')
    body = `<textarea data-bf="text" rows="2" placeholder="외울 내용">${esc(b.text)}</textarea><div class="txt prev" data-prev></div>${regRow(b, page)}`;
  return `<div class="blk blk-${b.type}" data-block="${esc(b.id)}">${tools}${body}</div>`;
}

function linksEditor(p) {
  const linked = new Set(p.links || []);
  const chips = [...linked]
    .map((id) => state.data.concepts.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => `<span class="link-chip">📄 ${esc(c.title || '(제목 없음)')}<button type="button" data-linkdel="${esc(c.id)}" title="연결 끊기">×</button></span>`)
    .join('');
  const options = state.data.concepts
    .filter((c) => !linked.has(c.id))
    .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ko'))
    .map((c) => `<option value="${esc(c.id)}">${esc(c.title || '(제목 없음)')}</option>`)
    .join('');
  return `<div class="links edit">${chips}<select data-linkadd aria-label="개념 연결"><option value="">+ 개념 페이지 연결…</option>${options}</select></div>`;
}

function pageEditor(col, p) {
  const noun = PAGES[col].noun;
  return `<article class="page card editing" data-col="${col}">
    <div class="ed-head">
      <input class="ed-title" data-pf="title" value="${esc(p.title)}" placeholder="${noun} 제목">
      <div class="ed-row">
        <select class="ed-unit" data-pf="unit" aria-label="단원">${unitOptions(unitKey(p.unit), '단원 선택…')}</select>
        ${
          col === 'notes'
            ? `<div class="seg kinds">${Object.entries(KINDS)
                .map(([k, l]) => `<button type="button" class="${k}" data-kind="${k}" aria-pressed="${(p.kind || 'wrong') === k}">${l}</button>`)
                .join('')}</div>`
            : ''
        }
        <div class="page-tools"><span class="save-state" id="save-state">저장됨</span><button type="button" class="primary" data-pact="done">✓ 완료</button></div>
      </div>
      <p class="ed-hint">${
        PAGES[col].rich
          ? '옵시디언처럼 적어요: 글 사이 수식은 $x^2$, 따로 한 줄 수식은 $$ … $$ 로 감싸요. 이미지는 붙여넣기(Ctrl+V)·끌어다 놓기·「🖼 이미지」로 글 안에 들어가요 (![[…|300]] 처럼 너비도 정할 수 있어요).'
          : `수식은 LaTeX 로 적어요 (\\frac{a}{b}, x^2, \\sqrt{x}, \\vec{v}${subject === 'chemistry' ? ', \\ce{2H2 + O2 -> 2H2O}' : ''}). 글 안에서는 $x^2$ 처럼 $ 로 감싸요. 이미지는 붙여넣기(Ctrl+V)나 끌어다 놓기도 돼요.`
      }</p>
    </div>
    ${PAGES[col].sections
      .map(
        (s) => `<section class="sec" data-sec="${s.key}">
          ${s.label ? `<h2>${s.label}</h2>` : ''}
          ${s.key === 'used' ? linksEditor(p) : ''}
          ${
            PAGES[col].rich
              ? `<div class="blocks">${(p[s.key] || []).map((b) => richEditor(b, p)).join('')}</div>`
              : `<div class="blocks">${(p[s.key] || []).map((b) => blockEditor(b, p)).join('')}</div>
          <div class="add-bar">${Object.entries(BLOCKS).map(([t, l]) => `<button type="button" data-addblock="${t}">+ ${l}</button>`).join('')}</div>`
          }
        </section>`,
      )
      .join('')}
  </article>`;
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 2 + 'px';
}

function findBlock(id, draft = state.edit.draft) {
  for (const s of PAGES[state.edit.col].sections) {
    const list = draft[s.key] || [];
    const idx = list.findIndex((b) => b.id === id);
    if (idx >= 0) return { list, idx, b: list[idx], sec: s.key };
  }
  return null;
}

function updatePreview(el) {
  const found = findBlock(el.dataset.block);
  const prev = $('[data-prev]', el);
  if (!found || !prev) return;
  const { b } = found;
  if (b.type === 'formula') prev.innerHTML = texHTML(b.tex);
  else {
    prev.hidden = !hasRich(b.text);
    if (!prev.hidden) {
      prev.innerHTML = richHTML(b.text);
      hydrateImages(prev);
    }
  }
}

let saveTimer;
function scheduleSave() {
  const s = $('#save-state');
  if (s) s.textContent = '저장 중…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}
function flushSave() {
  clearTimeout(saveTimer);
  const e = state.edit;
  if (!e) return;
  const { id, createdAt, ...data } = e.draft;
  run(state.store.update(e.col, id, { ...data, updatedAt: Date.now() }));
  const s = $('#save-state');
  if (s) s.textContent = '저장됨';
}

function startEdit(col, id) {
  const p = state.data[col].find((x) => x.id === id);
  if (!p) return;
  state.edit = { col, draft: structuredClone(p), orig: p, added: new Set() };
  renderPageMain(col);
}

function finishEdit() {
  if (!state.edit) return;
  const { col, draft, orig, added } = state.edit;
  flushSave();
  state.edit = null;
  // 글에서 지운 이미지는 저장소에서도 지운다 (다른 페이지가 쓰고 있으면 둔다)
  const keep = pageImages(col, draft);
  const gone = [...pageImages(col, orig), ...added].filter((id) => !keep.has(id));
  if (gone.length) {
    const used = new Set(COLLECTIONS.flatMap((c) => state.data[c].filter((x) => x.id !== draft.id).flatMap((x) => [...pageImages(c, x)])));
    gone.filter((id) => !used.has(id)).forEach((id) => images.deleteImage(id).catch(() => {}));
  }
  renderPageTab(col);
}

function selectPage(col, id) {
  if (state.edit) finishEdit();
  state.sel[col] = id;
  setPref('sel-' + col, id);
  renderPageTab(col);
  $(`#${col}-main`).scrollIntoView({ block: 'start' });
  window.scrollTo({ top: 0 });
}

async function newPage(col, unit = '') {
  if (state.edit) finishEdit();
  const page = { title: '', unit: unit || '' };
  for (const s of PAGES[col].sections) page[s.key] = [newBlock(s.first)];
  if (col === 'notes') Object.assign(page, { kind: 'wrong', links: [] });
  const id = await state.store.add(col, page);
  state.sel[col] = id;
  setPref('sel-' + col, id);
  startEdit(col, id);
  renderPageTab(col);
  $(`#${col}-main .ed-title`)?.focus();
}

function deletePage(col, id) {
  const p = state.data[col].find((x) => x.id === id);
  if (!p || !confirm(`「${p.title || '(제목 없음)'}」 ${PAGES[col].noun}을 삭제할까요?\n등록한 수식·암기 사항도 같이 사라져요.`)) return;
  pageImages(col, p).forEach((img) => images.deleteImage(img).catch(() => {}));
  if (col === 'concepts')
    state.data.notes
      .filter((n) => n.links?.includes(id))
      .forEach((n) => run(state.store.update('notes', n.id, { links: n.links.filter((x) => x !== id) })));
  state.sel[col] = '';
  run(state.store.remove(col, id));
}

// 이미지 파일들 → 이미지 블록 (sec 섹션의 afterId 블록 뒤, 없으면 끝)
async function addImages(files, sec, afterId) {
  const e = state.edit;
  if (!e) return;
  const list = (e.draft[sec] ||= []);
  let at = afterId ? list.findIndex((b) => b.id === afterId) + 1 : list.length;
  if (at <= 0) at = list.length;
  for (const file of [...files].filter((f) => f.type.startsWith('image/'))) {
    const b = { ...newBlock('image'), image: newId(), caption: '' };
    await images.putImage(b.image, file);
    list.splice(at++, 0, b);
  }
  renderPageMain(e.col);
  scheduleSave();
}

// 글 상자의 커서 자리에 끼워 넣는다 (caret: 끼운 글 안에서 커서를 둘 자리)
function insertText(ta, str, caret = str.length) {
  const start = ta.selectionStart;
  ta.setRangeText(str, start, ta.selectionEnd, 'end');
  ta.focus();
  ta.setSelectionRange(start + caret, start + caret);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}
const lineStart = (ta) => (ta.selectionStart > 0 && ta.value[ta.selectionStart - 1] !== '\n' ? '\n' : '');

function insertMath(ta, display) {
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  if (!display) return insertText(ta, `$${sel}$`, sel ? sel.length + 2 : 1);
  const pre = lineStart(ta);
  insertText(ta, `${pre}$$\n${sel}\n$$\n`, pre.length + 3 + sel.length);
}

// 이미지 파일들 → 글 상자 안의 ![[id]]
async function insertImages(files, ta) {
  const tokens = [];
  for (const file of [...files].filter((f) => f.type.startsWith('image/'))) {
    const id = newId();
    await images.putImage(id, file);
    state.edit?.added.add(id);
    tokens.push(`![[${id}]]`);
  }
  if (tokens.length && ta.isConnected) insertText(ta, lineStart(ta) + tokens.join('\n') + '\n');
}

// 등록 단원 고르기 창 → { ref, unit } 또는 취소 시 null
function askUnit(b, page) {
  const modal = $('#unit-modal');
  const form = $('#unit-form');
  $('#unit-q').textContent = REG[b.type].ask;
  form.ref.checked = !!b.ref;
  form.unit.innerHTML = unitOptions(unitKey(b.unit), '단원을 선택하세요…');
  form.unit.disabled = form.ref.checked;
  const cur = () => {
    $('#unit-cur').textContent = unitKey(page.unit)
      ? `이 페이지의 단원: ${unitPath(page.unit)}`
      : '이 페이지에는 아직 단원이 없어요. 페이지 단원을 정하면 그걸 따라가요.';
    form.unit.disabled = form.ref.checked;
  };
  cur();
  modal.hidden = false;
  (form.ref.checked ? form.ref : form.unit).focus();

  return new Promise((resolve) => {
    const done = (value) => {
      modal.hidden = true;
      form.removeEventListener('submit', onSubmit);
      form.ref.removeEventListener('change', cur);
      modal.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onSubmit = (e) => {
      e.preventDefault();
      if (!form.ref.checked && !form.unit.value) return toast('단원을 고르거나 「현재 섹션의 단원 참조」를 체크해 주세요.');
      done({ ref: form.ref.checked, unit: form.ref.checked ? b.unit || '' : form.unit.value });
    };
    const onClick = (e) => e.target.closest('[data-ucancel]') && done(null);
    const onKey = (e) => e.key === 'Escape' && done(null);
    form.addEventListener('submit', onSubmit);
    form.ref.addEventListener('change', cur);
    modal.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
  });
}

function bindPageTab(col) {
  const main = $(`#${col}-main`);
  bindTree(col);

  main.addEventListener('click', async (e) => {
    const pact = e.target.closest('[data-pact]')?.dataset.pact;
    if (pact === 'edit') return startEdit(col, state.sel[col]);
    if (pact === 'done') return finishEdit();
    if (pact === 'del') return deletePage(col, state.sel[col]);
    if (e.target.closest('[data-page]')) {
      e.preventDefault();
      return selectPage(col, e.target.closest('[data-page]').dataset.page);
    }
    const img = e.target.closest('.bv img, .img-ed img, .prev img');
    if (img?.src) return openLightbox(img.src);
    if (!state.edit || state.edit.col !== col) return;
    const d = state.edit.draft;

    const kind = e.target.closest('[data-kind]');
    if (kind) {
      d.kind = kind.dataset.kind;
      $$('[data-kind]', main).forEach((b) => b.setAttribute('aria-pressed', b === kind));
      return scheduleSave();
    }
    const linkDel = e.target.closest('[data-linkdel]');
    if (linkDel) {
      d.links = (d.links || []).filter((id) => id !== linkDel.dataset.linkdel);
      $('.links.edit', main).outerHTML = linksEditor(d);
      return scheduleSave();
    }
    const ins = e.target.closest('[data-ins]');
    if (ins) {
      const ta = $('textarea', ins.closest('[data-block]'));
      if (ins.dataset.ins !== 'image') return insertMath(ta, ins.dataset.ins === 'display');
      const input = $('#img-input');
      input.dataset.block = ins.closest('[data-block]').dataset.block;
      return input.click();
    }
    const add = e.target.closest('[data-addblock]');
    if (add) {
      const sec = add.closest('[data-sec]').dataset.sec;
      if (add.dataset.addblock === 'image') {
        const input = $('#img-input');
        input.dataset.sec = sec;
        input.dataset.block = '';
        return input.click();
      }
      const b = newBlock(add.dataset.addblock);
      (d[sec] ||= []).push(b);
      renderPageMain(col);
      $(`[data-block="${b.id}"] [data-bf]`, main)?.focus();
      return scheduleSave();
    }
    const bact = e.target.closest('[data-bact]')?.dataset.bact;
    if (!bact) return;
    const el = e.target.closest('[data-block]');
    const found = findBlock(el.dataset.block);
    if (!found) return;
    const { list, idx, b } = found;
    if (bact === 'unit') {
      const res = await askUnit(b, d);
      if (res) {
        Object.assign(b, res);
        $('.reg-row', el).outerHTML = regRow(b, d);
        scheduleSave();
      }
      return;
    }
    if (bact === 'del') {
      const filled = b.text || b.tex || b.image || b.name;
      if (filled && !confirm(`이 ${BLOCKS[b.type]} 블록을 삭제할까요?`)) return;
      list.splice(idx, 1);
      if (b.image) images.deleteImage(b.image).catch(() => {});
    } else {
      const to = idx + (bact === 'up' ? -1 : 1);
      if (to < 0 || to >= list.length) return;
      [list[idx], list[to]] = [list[to], list[idx]];
    }
    renderPageMain(col);
    scheduleSave();
  });

  main.addEventListener('input', (e) => {
    if (!state.edit || state.edit.col !== col) return;
    const d = state.edit.draft;
    const pf = e.target.dataset.pf;
    if (pf) {
      d[pf] = e.target.value;
      if (pf === 'unit') {
        // 「현재 섹션 단원 참조」 블록의 표시도 바뀐다
        $$('[data-block]', main).forEach((el) => {
          const f = findBlock(el.dataset.block);
          if (f?.b.reg && f.b.ref) $('.reg-row', el).outerHTML = regRow(f.b, d);
        });
      }
      return scheduleSave();
    }
    const bf = e.target.dataset.bf;
    if (bf) {
      const el = e.target.closest('[data-block]');
      const found = findBlock(el.dataset.block);
      if (!found) return;
      found.b[bf] = e.target.value;
      if (e.target.tagName === 'TEXTAREA') autosize(e.target);
      updatePreview(el);
      scheduleSave();
    }
  });

  main.addEventListener('change', async (e) => {
    if (!state.edit || state.edit.col !== col) return;
    const d = state.edit.draft;
    if (e.target.matches('[data-linkadd]') && e.target.value) {
      d.links = [...(d.links || []), e.target.value];
      $('.links.edit', main).outerHTML = linksEditor(d);
      return scheduleSave();
    }
    if (e.target.matches('[data-reg]')) {
      const el = e.target.closest('[data-block]');
      const { b } = findBlock(el.dataset.block);
      if (e.target.checked) {
        const res = await askUnit(b, d);
        if (!res) {
          e.target.checked = false;
          return;
        }
        Object.assign(b, res, { reg: true });
      } else b.reg = false;
      $('.reg-row', el).outerHTML = regRow(b, d);
      scheduleSave();
    }
  });

  // 이미지 붙여넣기 / 끌어다 놓기 — 오답노트는 글 상자 안으로, 개념은 이미지 블록으로
  const richBox = (e) => {
    if (!PAGES[col].rich) return null;
    const blk = e.target.closest?.('.blk-rich') || $('.blk-rich', main);
    return blk && $('textarea', blk);
  };
  const target = (e) => {
    const el = e.target.closest?.('[data-block]');
    const sec = e.target.closest?.('[data-sec]')?.dataset.sec || PAGES[col].sections[0].key;
    return { sec, after: el?.dataset.block };
  };
  main.addEventListener('paste', (e) => {
    if (!state.edit) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    const ta = richBox(e);
    if (ta) return insertImages(files, ta);
    const t = target(e);
    addImages(files, t.sec, t.after);
  });
  main.addEventListener('dragover', (e) => {
    if (state.edit && [...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) e.preventDefault();
  });
  main.addEventListener('drop', (e) => {
    if (!state.edit || !e.dataTransfer?.files.length) return;
    e.preventDefault();
    const ta = richBox(e);
    if (ta) return insertImages(e.dataTransfer.files, ta);
    const t = target(e);
    addImages(e.dataTransfer.files, t.sec, t.after);
  });
}

async function hydrateImages(root) {
  for (const img of $$('img[data-img]', root)) {
    const url = await images.imageURL(img.dataset.img).catch(() => '');
    if (url) img.src = url;
    else img.replaceWith(Object.assign(document.createElement('span'), { className: 'muted', textContent: '(이미지를 찾을 수 없어요)' }));
  }
}

function openLightbox(src) {
  const box = $('#lightbox');
  $('img', box).src = src;
  box.hidden = false;
}

/* ---------- 원본으로 이동 ---------- */

function goTo(col, pageId, blockId) {
  if (state.edit) finishEdit();
  showTab(col);
  state.sel[col] = pageId;
  setPref('sel-' + col, pageId);
  renderPageTab(col);
  const el = blockId && $(`#${col}-main [data-block="${CSS.escape(blockId)}"]`);
  if (el) {
    el.scrollIntoView({ block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1800);
  } else window.scrollTo({ top: 0 });
}

/* ---------- 수식 · 암기 탭 ---------- */

// 등록된 블록 전부: { b, p, col, unit }
function regItems(type) {
  const out = [];
  for (const col of COLLECTIONS)
    for (const p of state.data[col])
      for (const b of pageBlocks(col, p)) if (b.type === type && b.reg) out.push({ b, p, col, unit: unitKey(b.ref ? p.unit : b.unit) });
  return out;
}

function renderRegTab(tab) {
  const type = REG_TABS[tab];
  const q = norm(state.query[tab]);
  const all = regItems(type);
  const items = all.filter((x) => !q || norm(`${x.b.name} ${x.b.tex} ${x.b.text} ${x.p.title}`).includes(q));
  const byUnit = groupBy(items, (x) => x.unit);
  const direct = new Map([...byUnit].map(([k, v]) => [k, v.length]));

  const filter = state.filter[tab];
  $(`#${tab}-tree`).innerHTML =
    `<button type="button" class="tn-all${filter ? '' : ' active'}" data-unitall>전체 <span class="tn-n">${items.length}</span></button>` +
    treeHTML(tab, direct, { forceOpen: !!q });
  $(`#${tab}-count`).textContent = q ? `${items.length} / ${all.length}개` : `${all.length}개`;
  $(`#${tab}-filter`).textContent = filter ? `단원: ${unitPath(filter)}` : '전체 단원';

  const noun = tab === 'formulas' ? '수식' : '암기 사항';
  const groups = [...units.order.map((n) => n.id), '']
    .filter((id) => byUnit.has(id) && (!filter || (filter === NONE ? id === '' : id && isUnder(id, filter))))
    .map((id) => {
      const cards = byUnit
        .get(id)
        .map(({ b, p, col }) => {
          const src = `${col}|${p.id}|${b.id}`;
          const body =
            type === 'formula'
              ? `${b.name ? `<div class="r-name">${esc(b.name)}</div>` : ''}<div class="fml-tex r-body">${texHTML(b.tex)}</div>`
              : `<div class="txt r-body">${richHTML(b.text)}</div>`;
          return `<article class="card r-card">${body}
            <button type="button" class="r-src" data-goto="${esc(src)}" title="원본 섹션으로 이동">📄 ${PAGES[col].noun} · ${esc(p.title || '(제목 없음)')} <span>원본 보기 ›</span></button>
          </article>`;
        })
        .join('');
      return `<section class="r-group"><h3>${esc(unitPath(id))}</h3><div class="r-cards">${cards}</div></section>`;
    })
    .join('');
  const list = $(`#${tab}-list`);
  list.innerHTML =
    groups ||
    `<p class="empty">${
      all.length
        ? '조건에 맞는 항목이 없어요.'
        : `아직 등록한 ${noun}이 없어요.<br>개념이나 오답노트의 ${noun === '수식' ? '수식' : '암기'} 블록에서 「${REG[type].label}」을 체크해 보세요.`
    }</p>`;
  list.classList.toggle('hide-body', state.rhide[tab]);
  hydrateImages(list);
}

function bindRegTab(tab) {
  bindTree(tab, {
    onUnit: (id) => {
      const f = id || NONE;
      state.filter[tab] = state.filter[tab] === f ? '' : f;
      renderRegTab(tab);
    },
  });
  $(`#${tab}-tree`).addEventListener('click', (e) => {
    if (e.target.closest('[data-unitall]')) {
      state.filter[tab] = '';
      renderRegTab(tab);
    }
  });
  const list = $(`#${tab}-list`);
  list.addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) return goTo(...go.dataset.goto.split('|'));
    e.target.closest('.r-body')?.classList.toggle('revealed');
  });
  $(`[data-rhide="${tab}"]`).addEventListener('click', (e) => {
    state.rhide[tab] = !state.rhide[tab];
    e.target.setAttribute('aria-pressed', state.rhide[tab]);
    $$('.revealed', list).forEach((x) => x.classList.remove('revealed'));
    list.classList.toggle('hide-body', state.rhide[tab]);
  });
}

/* ---------- 주기율표 (화학) ---------- */

let elements = null; // [{ n, sym, ja, kana, ko, old, period, group, cat }]

function periodGroup(n) {
  const starts = [1, 3, 11, 19, 37, 55, 87, 119];
  const period = starts.findIndex((s, i) => n >= s && n < starts[i + 1]) + 1;
  const i = n - starts[period - 1];
  if (period === 1) return { period, group: n === 1 ? 1 : 18 };
  if (period <= 3) return { period, group: i < 2 ? i + 1 : i + 11 };
  if (period <= 5) return { period, group: i + 1 };
  if (i < 2) return { period, group: i + 1 };
  if (i <= 16) return { period, group: 0 }; // 란타넘족·악티늄족 (57–71, 89–103)
  return { period, group: i - 13 };
}

function category(n, group) {
  if (n >= 57 && n <= 71) return 'lanthanide';
  if (n >= 89 && n <= 103) return 'actinide';
  if (group === 18) return 'noble';
  if (group === 17) return 'halogen';
  if ([1, 6, 7, 8, 15, 16, 34].includes(n)) return 'nonmetal';
  if ([5, 14, 32, 33, 51, 52].includes(n)) return 'metalloid';
  if (group === 1) return 'alkali';
  if (group === 2) return 'alkaline';
  if (group >= 3 && group <= 12) return 'transition';
  return 'post';
}
const CATS = {
  alkali: '알칼리 금속',
  alkaline: '알칼리 토금속',
  transition: '전이 금속',
  post: '전이후 금속',
  metalloid: '준금속',
  nonmetal: '비금속',
  halogen: '할로젠',
  noble: '비활성 기체',
  lanthanide: '란타넘족',
  actinide: '악티늄족',
};

const jaName = (e) => (e.kana ? `<ruby>${esc(e.ja)}<rt>${esc(e.kana)}</rt></ruby>` : esc(e.ja));
const groupLabel = (e) => (e.group ? `${e.group}족` : e.n < 89 ? '란타넘족' : '악티늄족');

async function renderElements() {
  const body = $('#elements-body');
  if (!elements) {
    body.innerHTML = '<p class="empty">불러오는 중…</p>';
    const data = await fetch('data/elements.json').then((r) => r.json());
    elements = data.map(([n, sym, ja, kana, ko, old]) => {
      const pg = periodGroup(n);
      return { n, sym, ja, kana, ko, old, ...pg, cat: category(n, pg.group), key: norm(`${n} ${sym} ${ja} ${kana} ${ko} ${old}`) };
    });
  }
  const raw = state.query.elements.trim();
  const q = norm(raw);
  const match = (e) => !q || (/^\d+$/.test(raw) ? e.n === Number(raw) : e.key.includes(q) || e.sym.toLowerCase() === q);
  const shown = elements.filter(match);
  $('#elements-count').textContent = q ? `${shown.length} / ${elements.length}개` : `${elements.length}개 원소`;
  $$('#el-view [data-elview]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.elview === state.elView));

  if (state.elView === 'table') {
    // 7주기 + 한 줄 띄우고 란타넘족·악티늄족
    const cell = (e) => {
      const row = e.group ? e.period : e.period + 3;
      const colN = e.group || 3 + (e.n - (e.period === 6 ? 57 : 89));
      return `<button type="button" class="pt-cell cat-${e.cat}${match(e) ? '' : ' dim'}" style="grid-row:${row};grid-column:${colN}" data-el="${e.n}" title="${e.n} ${esc(e.sym)} · ${esc(e.ja)} · ${esc(e.ko)}">
        <span class="pt-n">${e.n}</span><span class="pt-sym">${esc(e.sym)}</span><span class="pt-ko">${esc(e.ko)}</span></button>`;
    };
    body.innerHTML = `<div class="pt-detail card" id="pt-detail"><p class="muted">원소를 누르면 여기에 이름이 나와요.</p></div>
      <div class="pt-scroll"><div class="pt-grid">
        ${elements.map(cell).join('')}
        <div class="pt-mark cat-lanthanide" style="grid-row:6;grid-column:3">57–71</div>
        <div class="pt-mark cat-actinide" style="grid-row:7;grid-column:3">89–103</div>
      </div></div>
      <div class="pt-legend">${Object.entries(CATS).map(([k, l]) => `<span class="cat-${k}"><i></i>${l}</span>`).join('')}</div>`;
    return;
  }
  body.innerHTML = shown.length
    ? `<div class="el-list">${shown
        .map(
          (e) => `<div class="card el-card cat-${e.cat}">
            <div class="el-top"><span class="el-n">${e.n}</span><span class="el-pg">${e.period}주기 · ${groupLabel(e)}</span></div>
            <div class="el-sym">${esc(e.sym)}</div>
            <div class="el-ja jp">${jaName(e)}</div>
            <div class="el-ko">${esc(e.ko)}${e.old ? ` <small>(${esc(e.old)})</small>` : ''}</div>
          </div>`,
        )
        .join('')}</div>`
    : '<p class="empty">검색 결과가 없어요.</p>';
}

function bindElements() {
  $('#el-view').addEventListener('click', (e) => {
    const b = e.target.closest('[data-elview]');
    if (!b) return;
    state.elView = b.dataset.elview;
    setPref('el-view', state.elView);
    renderElements();
  });
  $('#elements-body').addEventListener('click', (e) => {
    const cell = e.target.closest('[data-el]');
    if (!cell) return;
    const el = elements.find((x) => x.n === Number(cell.dataset.el));
    $$('.pt-cell.sel').forEach((c) => c.classList.remove('sel'));
    cell.classList.add('sel');
    $('#pt-detail').innerHTML = `<div class="el-sym cat-${el.cat}">${esc(el.sym)}</div>
      <div><div class="el-top"><span class="el-n">${el.n}번</span><span class="el-pg">${el.period}주기 · ${groupLabel(el)} · ${CATS[el.cat]}</span></div>
      <div class="el-ja jp">${jaName(el)}</div><div class="el-ko">${esc(el.ko)}${el.old ? ` <small>(${esc(el.old)})</small>` : ''}</div></div>`;
  });
}

/* ---------- 백업 (이미지 포함) ---------- */

const blobToDataURL = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

function bindBackup() {
  $('#export-btn').addEventListener('click', async () => {
    const imgs = await Promise.all((await images.allImages()).map(async ({ id, blob }) => ({ id, data: await blobToDataURL(blob) })));
    const payload = { app: 'midori-science', subject, version: 1, exportedAt: new Date().toISOString(), ...state.data, images: imgs };
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' })),
      download: `midori-${subject}-${new Date().toISOString().slice(0, 10)}.json`,
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
      if (json.subject && json.subject !== subject && !confirm(`이 백업은 ${SUBJECTS[json.subject]?.name || json.subject} 과목 것이에요. 그래도 가져올까요?`)) return;
      const [c, n] = COLLECTIONS.map((col) => (Array.isArray(json[col]) ? json[col].length : 0));
      if (!c && !n) return toast('가져올 데이터가 없어요.');
      if (!confirm(`개념 ${c}개, 오답 ${n}개${json.images?.length ? `, 이미지 ${json.images.length}개` : ''}를 가져올까요?\n같은 항목이 이미 있으면 백업 내용으로 바뀌어요.`)) return;
      if (state.edit) finishEdit();
      for (const img of json.images || []) await images.putImage(img.id, await (await fetch(img.data)).blob());
      for (const col of COLLECTIONS) if (Array.isArray(json[col]) && json[col].length) await state.store.bulkAdd(col, json[col]);
      toast('백업을 가져왔어요.');
    } catch (err) {
      console.error(err);
      toast('백업 파일을 읽지 못했어요.');
    }
  });
}

/* ---------- 시작 ---------- */

const renderers = {
  concepts: () => renderPageTab('concepts'),
  notes: () => renderPageTab('notes'),
  formulas: () => renderRegTab('formulas'),
  memos: () => renderRegTab('memos'),
  elements: renderElements,
};

function createStore() {
  return createSyncedStore(subject);
}

async function init() {
  if (!SUB) return location.replace('../index.html'); // 과목은 대시보드에서 고른다
  document.title = `みどり ${SUB.ja}`;
  $('#brand-subject').textContent = SUB.ja;
  $('#app').hidden = false;
  $('[data-tab="elements"]').hidden = !SUB.elements;

  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $$('[data-search]').forEach((input) => {
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.query[input.dataset.search] = input.value;
        renderers[input.dataset.search]();
      }, 120);
    });
  });
  $$('[data-showempty]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const tab = btn.dataset.showempty;
      state.showEmpty[tab] = !state.showEmpty[tab];
      btn.setAttribute('aria-pressed', state.showEmpty[tab]);
      renderers[tab]();
    }),
  );
  $$('[data-newpage]').forEach((btn) => btn.addEventListener('click', () => newPage(btn.dataset.newpage)));
  $('#img-input').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const ta = e.target.dataset.block && $(`[data-block="${CSS.escape(e.target.dataset.block)}"] textarea`);
    if (ta) insertImages(files, ta);
    else addImages(files, e.target.dataset.sec);
  });
  $('#lightbox').addEventListener('click', (e) => (e.currentTarget.hidden = true));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('#lightbox').hidden = true;
  });
  // 오답노트의 「사용된 개념」 링크
  $('#notes-main').addEventListener('click', (e) => {
    const go = e.target.closest('.link-chip[data-goto]');
    if (go) goTo(...go.dataset.goto.split('|'));
  });

  bindPageTab('concepts');
  bindPageTab('notes');
  bindRegTab('formulas');
  bindRegTab('memos');
  if (SUB.elements) bindElements();
  bindBackup();

  await Promise.all([loadUnits(), images.openImages(`midori-${subject}`)]);
  state.store = createStore();
  for (const col of COLLECTIONS) {
    state.store.subscribe(col, (items) => {
      const old = col === 'notes' ? items.filter(isOldNote) : [];
      if (old.length) return run(state.store.bulkAdd(col, old.map(migrateNote))); // 바뀐 목록으로 다시 불린다
      state.data[col] = items;
      renderPageTab(col);
      // 수식/암기 탭과 개념 링크는 두 컬렉션 모두에 영향을 받는다
      renderRegTab('formulas');
      renderRegTab('memos');
      if (col === 'concepts' && state.edit?.col !== 'notes') renderPageTab('notes');
    });
  }
  showTab(pref('tab', 'concepts'));
}

init();
