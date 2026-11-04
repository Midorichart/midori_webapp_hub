// 메인 페이지: 배경 연표(큰 화면에선 한 칸씩 딱딱 넘어가고, 도트 디졸브로 나타남 · 사진도 디졸브로 넘어감), 사진 크게 보기, KO · JA · EN 전환
import { mountTerrain } from './terrain.js?v=a01f9339';

const BGS = window.BACKGROUNDS || [];
const ETC = window.ETC || [];
const DIR = 'assets/portfolio/';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dot = (d) => d.replace(/-/g, '.');
const xUrl = (id) => `https://x.com/midorichart/status/${id}`;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
document.documentElement.classList.add('js');

// ---------- 언어 (KO · JA · EN) ----------
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const UI = {
  ko: {
    timeline: '연표', contact: '연락', cue: '▼ 연표',
    intro1: 'WARUDO 배경이랑 소품 만들어요.', intro2: 'Studio Raming 소속 · 3D Environment & Props',
    side: '이 무렵 만든 것', post: '작업 글 보기 (X) ↗', photos: (n) => `사진 ${n}장`, month: (m) => `${m}월`,
    view: (name) => `${name} 사진 보기`, close: '닫기', play: '▶ X 에서 영상 보기',
    booth: 'BOOTH 상품 이미지', wip: '작업하면서 올린 것',
    reach: (mail, dm) => `일 얘기는 ${mail} 이나 ${dm} 으로 주세요.`,
  },
  ja: {
    timeline: '年表', contact: '連絡', cue: '▼ 年表',
    intro1: 'WARUDOの背景や小物を作っています。', intro2: 'Studio Raming 所属 · 3D Environment & Props',
    side: 'この頃に作ったもの', post: '制作ポストを見る (X) ↗', photos: (n) => `写真 ${n}枚`, month: (m) => `${m}月`,
    view: (name) => `${name} の写真を見る`, close: '閉じる', play: '▶ Xで動画を見る',
    booth: 'BOOTH 商品画像', wip: '制作中に投稿したもの',
    reach: (mail, dm) => `お仕事のご相談は ${mail} または ${dm} までどうぞ。`,
  },
  en: {
    timeline: 'Timeline', contact: 'Contact', cue: '▼ Timeline',
    intro1: 'I make backgrounds and props for WARUDO.', intro2: 'At Studio Raming · 3D Environment & Props',
    side: 'Made around this time', post: 'Work-in-progress post (X) ↗', photos: (n) => `${n} photos`, month: (m) => MONTHS_EN[m - 1],
    view: (name) => `View ${name} photos`, close: 'Close', play: '▶ Watch on X',
    booth: 'BOOTH product image', wip: 'Posted while working',
    reach: (mail, dm) => `For work inquiries, reach me at ${mail} or via ${dm}.`,
  },
};
const LANGS = Object.keys(UI);
let lang = (() => {
  try { const saved = localStorage.getItem('lang'); if (LANGS.includes(saved)) return saved; } catch {}
  const nav = (navigator.language || 'ko').slice(0, 2);
  return nav === 'ja' ? 'ja' : nav === 'ko' ? 'ko' : 'en';
})();
const T = () => UI[lang];
// 항목의 번역 (없으면 한국어 원문)
const tr = (obj, field) => obj.i18n?.[lang]?.[field] ?? obj[field];

// ---------- 도트 디졸브 ----------
// 4x4 베이어 행렬 순서대로 점이 하나씩 채워지는 마스크 프레임을 만들어 두고, 차례로 씌운다.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const CELL = 6;
const FRAMES = (() => {
  const out = [];
  const c = document.createElement('canvas');
  c.width = c.height = CELL * 4;
  const ctx = c.getContext('2d');
  for (let k = 1; k < 16; k++) {
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#000';
    BAYER.forEach((b, i) => { if (b < k) ctx.fillRect((i % 4) * CELL, Math.floor(i / 4) * CELL, CELL, CELL); });
    out.push(`url(${c.toDataURL()})`);
  }
  return out;
})();
function dissolveIn(el, done, speed = 22) {
  el.classList.add('shown');
  if (still) { done?.(); return; }
  let k = 0;
  const s = el.style;
  s.maskSize = s.webkitMaskSize = `${CELL * 4}px`;
  const step = () => {
    if (k >= FRAMES.length) {
      s.maskImage = s.webkitMaskImage = '';
      done?.();
      return;
    }
    s.maskImage = s.webkitMaskImage = FRAMES[k++];
    setTimeout(step, speed);
  };
  step();
}

// ---------- 연표: 왼쪽 배경 · 오른쪽 같은 시기의 소품 · 셰이더 ----------
// 소품은 「그 배경 날짜 ~ 바로 다음(더 최근) 배경 날짜」 사이에 만든 것끼리 묶는다. 가장 오래된 것들은 마지막 칸에.
const PERIOD = BGS.map(() => []);
for (const w of ETC) {
  let k = BGS.findIndex((b) => b.date <= w.date);
  if (k < 0) k = BGS.length - 1;
  PERIOD[k].push(w);
}
let cycleTimers = [];
function renderStages(animate) {
let html = '';
let year = '';
BGS.forEach((g, n) => {
  const y = g.date.slice(0, 4);
  const newYear = y !== year;
  year = y;
  const cover = g.imgs[0];
  const side = PERIOD[n].map((w) => {
    const c = w.imgs.find((i) => i.w / i.h >= 1.2) || w.imgs[0];
    const vid = w.imgs.some((i) => i.video) ? '<span class="play">▶</span>' : '';
    return `<li><button class="mini" type="button" data-etc="${w.id}">
      <span class="mini-img"><img src="${DIR}t/${c.src}.webp" alt="" loading="lazy" decoding="async">${vid}</span>
      <span class="mini-name">${esc(tr(w, 'title'))}</span><span class="mini-date">${dot(w.date)}</span>
    </button></li>`;
  }).join('');
  html += `<li class="stage snap reveal">
    <div class="track-bg">
      <button class="stage-view" type="button" data-bg="${g.key}" data-cycle="${n}" aria-label="${esc(T().view(g.name))}">
        <img src="${DIR}${cover.src}.webp" alt="${esc(g.name)}" width="${cover.w}" height="${cover.h}" loading="lazy" decoding="async">
      </button>
      <div class="stage-info">
        <div class="stage-head">
          <h3 class="stage-name">${esc(g.name)}</h3>
          <p class="stage-sub">${esc(tr(g, 'sub'))}</p>
        </div>
        <p class="say">${esc(tr(g, 'desc'))}${g.qpost ? `<a href="${xUrl(g.qpost)}" target="_blank" rel="noopener">${T().post}</a>` : ''}</p>
        <div class="stage-actions">
          <button class="pxbtn" type="button" data-bg="${g.key}">${T().photos(g.imgs.length)}</button>
          ${g.booth ? `<a class="pxbtn accent" href="${g.booth}" target="_blank" rel="noopener">BOOTH ↗</a>` : ''}
        </div>
      </div>
    </div>
    <p class="when">${newYear ? `<b>${y}</b>` : ''}<i aria-hidden="true"></i><span>${T().month(Number(g.date.slice(5, 7)))}</span></p>
    <div class="track-etc">
      ${side ? `<p class="track-label">${T().side}</p><ul class="minis">${side}</ul>` : ''}
    </div>
  </li>`;
});
$('#stages').innerHTML = html;
cycleTimers.forEach(clearInterval);
cycleTimers = [];
document.querySelectorAll('#stages .reveal').forEach((el) => (animate ? revealer.observe(el) : el.classList.add('shown')));
document.querySelectorAll('[data-cycle]').forEach(startCycle);
watchSteps();
}

// 내려가면 하나씩 도트 디졸브로 나타남
const revealer = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    revealer.unobserve(e.target);
    if (stepOn()) e.target.classList.add('shown'); // 휴대폰은 칸 전체가 페이드로 나타나므로 디졸브는 생략
    else dissolveIn(e.target);
  }
}, { rootMargin: '0px 0px -12% 0px' });

// 대표 사진이 보이는 동안 사진이 디졸브로 넘어감
const visible = new Set();
const watcher = new IntersectionObserver((entries) => {
  for (const e of entries) (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target));
}, { threshold: 0.4 });
function startCycle(view) {
  const g = BGS[Number(view.dataset.cycle)];
  const photos = g.imgs.filter((i) => !i.video);
  if (photos.length < 2 || still) return;
  watcher.observe(view);
  let i = 0;
  let busy = false;
  cycleTimers.push(setInterval(() => {
    if (busy || !visible.has(view) || document.hidden || $('#viewer').open) return;
    busy = true;
    i = (i + 1) % photos.length;
    const im = new Image();
    im.alt = g.name;
    im.src = DIR + photos[i].src + '.webp';
    im.decode().catch(() => {}).then(() => {
      view.append(im);
      dissolveIn(im, () => {
        while (view.children.length > 1) view.firstElementChild.remove();
        busy = false;
      }, 28);
    });
  }, 3800 + Number(view.dataset.cycle) * 170));
}

// ---------- 휠 한 번에 한 칸 (큰 화면) ----------
// CSS scroll-snap 만으로는 휠을 조금 굴리면 제자리로 돌아와서, 휠 방향으로 다음 칸까지 직접 넘긴다.
// 화면보다 긴 칸(그 밖에)은 그 안에서는 그냥 스크롤되고, 끝에 닿았을 때 다음 칸으로 넘어간다.
const snapOn = matchMedia('(min-width: 861px) and (min-height: 620px)');
const HEAD = () => document.querySelector('.site-head').getBoundingClientRect().height;
let wheelLock = 0;

// ---------- 휴대폰: 넘기면 한 칸씩, 화면 가운데에 온 칸만 계단식으로 나타남 ----------
// (CSS 의 scroll-snap 이 한 칸씩 멈추게 하고, 여기서 가운데 칸에 .cur 를 붙인다. 모양은 portfolio.css 의 .stepfade)
function stepOn() { return !snapOn.matches && !still; }
function pickStep() {
  if (!stepOn()) return;
  const mid = innerHeight / 2, band = innerHeight * 0.05;
  document.querySelectorAll('.snap').forEach((sec) => {
    const r = sec.getBoundingClientRect();
    sec.classList.toggle('cur', r.top < mid + band && r.bottom > mid - band);
  });
}
function watchSteps() {
  document.documentElement.classList.toggle('stepfade', stepOn());
  pickStep();
}
addEventListener('scroll', pickStep, { passive: true });
addEventListener('resize', pickStep);
snapOn.addEventListener('change', watchSteps);
addEventListener('wheel', (e) => {
  if (!snapOn.matches || e.ctrlKey || document.querySelector('dialog[open]')) return;
  const dir = Math.sign(e.deltaY);
  if (!dir) return;
  const head = HEAD();
  const secs = [...document.querySelectorAll('.snap')];
  const tops = secs.map((s) => Math.round(s.getBoundingClientRect().top + scrollY - head));
  let i = 0;
  tops.forEach((t, k) => { if (t <= scrollY + 4) i = k; });
  const r = secs[i].getBoundingClientRect();
  if (dir > 0 && r.bottom > innerHeight + 4) return; // 긴 칸 안에서 아래로
  if (dir < 0 && r.top < head - 4) return; // 긴 칸 안에서 위로
  const j = i + dir;
  if (j < 0 || j >= secs.length) return; // 맨 위 · 맨 아래(바닥글)는 그냥 스크롤
  e.preventDefault();
  if (performance.now() < wheelLock) return;
  wheelLock = performance.now() + 750;
  scrollTo({ top: tops[j], behavior: still ? 'auto' : 'smooth' });
}, { passive: false });

// ---------- 크게 보기 ----------
const dlg = $('#viewer');
let cur = null;
let idx = 0;

function show() {
  const item = cur.imgs[idx];
  const post = item.post || cur.post;
  $('#v-img').src = DIR + item.src + '.webp';
  $('#v-img').alt = cur.title;
  $('#v-play').hidden = !item.video;
  if (post) $('#v-play').href = xUrl(post);
  $('#v-date').textContent = cur.booth ? `${cur.date} · ${item.post ? T().wip : T().booth}` : cur.date;
  $('#v-title').textContent = cur.title;
  $('#v-desc').textContent = cur.desc || '';
  $('#v-x').hidden = !post;
  if (post) $('#v-x').href = xUrl(post);
  $('#v-buy').hidden = !cur.booth;
  if (cur.booth) $('#v-buy').href = cur.booth;
  const many = cur.imgs.length > 1;
  dlg.querySelectorAll('.v-nav').forEach((b) => (b.hidden = !many));
  $('#v-count').textContent = many ? `${idx + 1}/${cur.imgs.length}` : '';
  $('#v-strip').hidden = !many;
  $('#v-strip').querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === idx));
  $('#v-strip .on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function open(data, start = 0) {
  cur = data;
  idx = Math.max(0, start);
  $('#v-strip').innerHTML = cur.imgs.map((i, n) => `<button type="button" data-go="${n}" aria-label="${n + 1}"><img src="${DIR}t/${i.src}.webp" alt="" loading="lazy">${i.video ? '<span>▶</span>' : ''}</button>`).join('');
  show();
  if (!dlg.open) dlg.showModal();
}
function openBg(key, at = 0) {
  const g = BGS.find((b) => b.key === key);
  if (g) open({ title: g.name, date: g.date.slice(0, 7).replace('-', '.'), desc: tr(g, 'desc'), booth: g.booth, imgs: g.imgs }, at);
}
function openEtc(id) {
  const w = ETC.find((e) => e.id === id);
  if (w) open({ title: tr(w, 'title'), date: dot(w.date), desc: tr(w, 'desc'), post: w.id, imgs: w.imgs });
}
const step = (d) => { if (cur) { idx = (idx + d + cur.imgs.length) % cur.imgs.length; show(); } };

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-bg]');
  if (b) return openBg(b.dataset.bg, Number(b.dataset.at || 0));
  const w = e.target.closest('[data-etc]');
  if (w) return openEtc(w.dataset.etc);
  const s = e.target.closest('[data-step]');
  if (s) return step(Number(s.dataset.step));
  const g = e.target.closest('[data-go]');
  if (g) { idx = Number(g.dataset.go); show(); }
});
$('#v-close').onclick = () => dlg.close();
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
dlg.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') step(-1);
  if (e.key === 'ArrowRight') step(1);
});
let x0 = null;
$('.v-stage').addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
$('.v-stage').addEventListener('touchend', (e) => {
  if (x0 === null) return;
  const dx = e.changedTouches[0].clientX - x0;
  if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
  x0 = null;
});

// ---------- 고정 문구 + 언어 버튼 ----------
function applyStatic() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = T()[el.dataset.t]; });
  const mail = '<a href="mailto:midorichart@gmail.com">midorichart@gmail.com</a>';
  const dm = '<a href="https://x.com/midorichart" target="_blank" rel="noopener">X DM</a>';
  $('#reach').innerHTML = T().reach(mail, dm);
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
}
function setLang(next) {
  if (next === lang) return;
  lang = next;
  try { localStorage.setItem('lang', lang); } catch {}
  applyStatic();
  renderStages(false);
  if (dlg.open) dlg.close();
}
document.querySelectorAll('[data-lang]').forEach((b) => { b.onclick = () => setLang(b.dataset.lang); });
applyStatic();
renderStages(true);

// ---------- 맨 위 도트 지형 ----------
mountTerrain($('#terrain'), $('.intro'));
