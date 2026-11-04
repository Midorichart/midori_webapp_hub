// 포트폴리오 메인: works.js 의 작업물을 섹션별 카드로 그리고, 누르면 크게 보기
(() => {
  const WORKS = window.WORKS || [];
  const DIR = 'assets/portfolio/';
  const FIRST = { env: 10, tech: 9, props: 9 }; // 처음에 보여 줄 개수 (나머지는 더 보기)
  const byId = new Map(WORKS.map((w) => [w.id, w]));
  // 배경 섹션에서 크게 보여 줄 작업 (첫 화면 이미지와 겹치지 않게), 카드 표지를 직접 고른 작업
  const FEATURE = { env: '2102302850215030823' };
  // 첫 화면에 크게 나온 밤 버전, 출시 게시물(…88543)에 같은 사진이 다 들어 있는 프로 버전은 카드에서 뺀다
  const HIDE_IN_GRID = new Set(['2104784888172077391', '2105336890677494240']);
  // 다른 카드나 첫 화면과 같은 사진이 표지가 되지 않게 직접 고른 표지
  const COVER = { '2105931502844588543': 0, '2015785171510067524': 1 };
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ym = (d) => d.slice(0, 7).replace('-', '.');
  const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';

  function card(w, wide) {
    // 카드에는 가로로 긴 이미지가 잘 맞는다
    const cover = w.id in COVER ? w.imgs[COVER[w.id]] : w.imgs.find((i) => i.w / i.h >= 1.3) || w.imgs[0];
    const photos = w.imgs.filter((i) => !i.video).length;
    const badge = photos > 1 ? `<span class="badge">사진 ${photos}</span>` : '';
    const play = cover.video ? `<span class="play">${PLAY}</span>` : w.video ? '<span class="badge">영상</span>' : '';
    return `<li${wide ? ' class="wide"' : ''}><button class="work" type="button" data-open="${w.id}">
      <span class="thumb"><img src="${DIR}${wide ? '' : 't/'}${cover.src}.webp" alt="${esc(w.title)}" loading="lazy" decoding="async" width="${cover.w}" height="${cover.h}">${badge}${play}</span>
      <span class="meta"><span class="mt">${esc(w.title)}</span><span class="md">${ym(w.date)}${w.desc ? ' · ' + esc(w.desc) : ''}</span></span>
    </button></li>`;
  }

  function render(cat, all) {
    const list = WORKS.filter((w) => w.cat === cat && !HIDE_IN_GRID.has(w.id));
    const f = list.findIndex((w) => w.id === FEATURE[cat]);
    if (f > 0) list.unshift(...list.splice(f, 1));
    const shown = all ? list : list.slice(0, FIRST[cat]);
    // 배경 섹션은 첫 작업을 크게
    document.querySelector(`.grid[data-cat="${cat}"]`).innerHTML = shown.map((w, i) => card(w, cat === 'env' && i === 0)).join('');
    const more = document.querySelector(`[data-more="${cat}"]`);
    more.hidden = all || list.length <= FIRST[cat];
    more.textContent = `더 보기 (${list.length - shown.length})`;
  }
  ['env', 'tech', 'props'].forEach((c) => render(c, false));

  // ---------- 크게 보기 ----------
  const dlg = $('#viewer');
  let cur = null;
  let idx = 0;

  function show() {
    const item = cur.imgs[idx];
    const xUrl = `https://x.com/midorichart/status/${cur.id}`;
    $('#v-img').src = DIR + item.src + '.webp';
    $('#v-img').alt = cur.title;
    $('#v-play').hidden = !item.video;
    $('#v-play').href = xUrl;
    $('#v-date').textContent = cur.date.replace(/-/g, '.');
    $('#v-title').textContent = cur.title;
    $('#v-desc').textContent = cur.desc || '';
    $('#v-x').href = xUrl;
    $('#v-buy').hidden = !cur.link;
    if (cur.link) $('#v-buy').href = cur.link;
    const many = cur.imgs.length > 1;
    dlg.querySelectorAll('.v-nav').forEach((b) => (b.hidden = !many));
    $('#v-count').textContent = many ? `${idx + 1} / ${cur.imgs.length}` : '';
  }
  function open(id) {
    cur = byId.get(id);
    if (!cur) return;
    idx = 0;
    show();
    if (!dlg.open) dlg.showModal();
  }
  const step = (d) => { if (!cur) return; idx = (idx + d + cur.imgs.length) % cur.imgs.length; show(); };

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open]');
    if (t) return open(t.dataset.open);
    const m = e.target.closest('[data-more]');
    if (m) return render(m.dataset.more, true);
    const s = e.target.closest('[data-step]');
    if (s) return step(Number(s.dataset.step));
  });
  $('#v-close').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // 바깥(배경) 누르면 닫기
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
  // 휴대폰: 좌우로 밀어서 넘기기
  let x0 = null;
  dlg.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  dlg.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    x0 = null;
  });
})();
