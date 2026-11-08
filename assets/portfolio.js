// 메인 페이지: 배경 연표(큰 화면에선 한 칸씩 딱딱 넘어가고, 도트 디졸브로 나타남 · 사진도 디졸브로 넘어감), 사진 크게 보기, KO · JA · EN 전환
import { mountTerrain } from './terrain.js?v=8b990d6f';

// 포트폴리오 내용: Supabase 의 portfolio_items (관리자 페이지 /app/portfolio/ 에서 고침).
// 표가 비었거나 못 불러오면 works.js 의 내용을 그대로 쓴다. (아래 키는 공개용 publishable 키: 읽기만 가능)
const SB_URL = 'https://avnqsbwbmvwtpkquvrtt.supabase.co';
const SB_KEY = 'sb_publishable_GTRIqmu5GN5yeYswVZNb2g_9QcR32M4';
let BGS = window.BACKGROUNDS || [];
let ETC = window.ETC || [];
async function loadWorks() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3000);
    const r = await fetch(`${SB_URL}/rest/v1/portfolio_items?select=id,kind,date,data&order=date.desc`, { headers: { apikey: SB_KEY }, signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) return;
    const rows = await r.json();
    if (!rows.length) return;
    BGS = rows.filter((x) => x.kind === 'bg').map((x) => ({ ...x.data, key: x.id, date: x.date }));
    ETC = rows.filter((x) => x.kind === 'etc').map((x) => ({ ...x.data, id: x.id, date: x.date }));
  } catch {}
}
const DIR = new URL('portfolio/', import.meta.url).href; // 언어별 페이지(/ja/ 등)에서도 같은 사진 폴더
// 사진 주소: 관리자 페이지에서 올린 사진은 전체 주소(Supabase Storage), 예전 사진은 assets/portfolio/ 의 파일 이름
const isUrl = (s) => /^https?:\/\//.test(s);
const full = (i) => (isUrl(i.src) ? i.src : `${DIR}${i.src}.webp`);
const thumb = (i) => i.thumb || (isUrl(i.src) ? i.src : `${DIR}t/${i.src}.webp`);
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
    side: '이 배경 전에 만든 것',
    mbTitle: 'MESSAGE', mbTo: '→ MIDORI', mbHello: '궁금한 점이나 작업 의뢰, 편하게 남겨 주세요!', mbName: '이름', mbAnon: '익명으로',
    mbNote: '여기에 입력하면 저에게 디스코드로 알림이 와요.', mbCancel: '취소',
    adId: '관리자 로그인 — 이메일을 입력하세요.', adPw: '비밀번호를 입력하세요.', adWait: '로그인 중…', adOk: '로그인했어요. 관리자 페이지로 이동할게요.', adFail: '이메일 또는 비밀번호가 맞지 않아요. 다시 입력하세요.', adBye: '로그인을 취소했어요.',
    mbBody: '메시지 (답장이 필요하면 메일이나 X 아이디도 함께)', mbSend: '보내기 ▶', mbSending: '보내는 중…', mbAnonName: '익명',
    mbThanks: '잘 받았어요! 확인하고 답장할게요. 연락처를 안 남기셨다면 답장은 어려워요.', mbSlow: '조금 뒤에 다시 보내 주세요.', mbFail: '못 보냈어요. midorichart@gmail.com 으로 메일 주세요.', soon: '다음 배경 준비 중', soonNote: (name) => `${name} 다음 배경을 만들고 있어요. 그 사이에 만든 것들은 오른쪽에.`, tape: '준비중', post: '작업 글 보기 (X) ↗', photos: (n) => `사진 ${n}장`, month: (m) => `${m}월`,
    view: (name) => `${name} 사진 보기`, close: '닫기', play: '▶ X 에서 영상 보기',
    booth: 'BOOTH 상품 이미지', wip: '작업하면서 올린 것',
    reach: (mail, dm) => `일 얘기는 ${mail} 이나 ${dm} 으로 주세요.`,
  },
  ja: {
    timeline: '年表', contact: '連絡', cue: '▼ 年表',
    intro1: 'WARUDOの背景や小物を作っています。', intro2: 'Studio Raming 所属 · 3D Environment & Props',
    side: 'この背景の前に作ったもの',
    mbTitle: 'MESSAGE', mbTo: '→ MIDORI', mbHello: 'ご質問やお仕事のご依頼など、お気軽にどうぞ！', mbName: 'お名前', mbAnon: '匿名で',
    mbNote: 'ここに入力すると、私にDiscordで通知が届きます。', mbCancel: 'キャンセル',
    adId: '管理者ログイン — メールアドレスを入力してください。', adPw: 'パスワードを入力してください。', adWait: 'ログイン中…', adOk: 'ログインしました。管理ページに移動します。', adFail: 'メールアドレスまたはパスワードが違います。もう一度入力してください。', adBye: 'ログインをキャンセルしました。',
    mbBody: 'メッセージ（返信が必要な場合はメールかXのIDも一緒に）', mbSend: '送信 ▶', mbSending: '送信中…', mbAnonName: '匿名',
    mbThanks: '受け取りました！確認してお返事します。連絡先がない場合はお返事できません。', mbSlow: '少し時間をおいてもう一度送ってください。', mbFail: '送信できませんでした。midorichart@gmail.com までメールでお願いします。', soon: '次の背景を準備中', soonNote: (name) => `${name} の次の背景を制作中です。その間に作ったものは右側に。`, tape: '準備中', post: '制作ポストを見る (X) ↗', photos: (n) => `写真 ${n}枚`, month: (m) => `${m}月`,
    view: (name) => `${name} の写真を見る`, close: '閉じる', play: '▶ Xで動画を見る',
    booth: 'BOOTH 商品画像', wip: '制作中に投稿したもの',
    reach: (mail, dm) => `お仕事のご相談は ${mail} または ${dm} までどうぞ。`,
  },
  en: {
    timeline: 'Timeline', contact: 'Contact', cue: '▼ Timeline',
    intro1: 'I make backgrounds and props for WARUDO.', intro2: 'At Studio Raming · 3D Environment & Props',
    side: 'Made before this background',
    mbTitle: 'MESSAGE', mbTo: '→ MIDORI', mbHello: 'Questions or commissions? Leave a message anytime!', mbName: 'Name', mbAnon: 'Anonymous',
    mbNote: 'Messages sent here reach me as a Discord notification.', mbCancel: 'Cancel',
    adId: 'Admin login — enter your email.', adPw: 'Enter your password.', adWait: 'Signing in…', adOk: 'Signed in. Taking you to the admin page.', adFail: 'Wrong email or password. Please try again.', adBye: 'Login cancelled.',
    mbBody: 'Message (add your email or X handle if you want a reply)', mbSend: 'Send ▶', mbSending: 'Sending…', mbAnonName: 'Anonymous',
    mbThanks: 'Got it, thank you! I will reply once I read it. Without contact info I cannot reply.', mbSlow: 'Please wait a moment and try again.', mbFail: 'Could not send. Please email midorichart@gmail.com instead.', soon: 'Next background in progress', soonNote: (name) => `Working on the next background after ${name}. Things made in the meantime are on the right.`, tape: 'COMING SOON', post: 'Work-in-progress post (X) ↗', photos: (n) => `${n} photos`, month: (m) => MONTHS_EN[m - 1],
    view: (name) => `View ${name} photos`, close: 'Close', play: '▶ Watch on X',
    booth: 'BOOTH product image', wip: 'Posted while working',
    reach: (mail, dm) => `For work inquiries, reach me at ${mail} or via ${dm}.`,
  },
};
const LANGS = Object.keys(UI);
// 언어: 페이지 주소(/ko/ · /ja/ · /en/ — scripts/langs.py 가 PAGE_LANG 을 넣음) → 고른 언어 → 브라우저 언어
let lang = (() => {
  if (LANGS.includes(window.PAGE_LANG)) return window.PAGE_LANG;
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
// 각 배경 칸에는 「바로 전 배경 ~ 이 배경을 낸 날」 사이에 만든 것 (이 배경보다 먼저 만든 것만).
// 가장 최근 배경보다 뒤에 만든 것은 맨 위 「최근 작업」 칸(LATEST)에.
let PERIOD = [];
let LATEST = [];
function group() {
  PERIOD = BGS.map(() => []);
  LATEST = [];
  for (const w of ETC) {
    let k = -1;
    BGS.forEach((b, i) => { if (b.date >= w.date) k = i; }); // 날짜가 같거나 뒤인 배경 중 가장 오래된 것
    (k < 0 ? LATEST : PERIOD[k]).push(w);
  }
}
let cycleTimers = [];

// 배경 한 칸 (큰 사진 + 이름 · 소개 · 버튼). PC 연표와 휴대폰 연표가 같이 쓴다.
function bgBlock(g, n) {
  const cover = g.imgs[0];
  return `<div class="track-bg">
      <button class="stage-view" type="button" data-bg="${g.key}" data-cycle="${n}" aria-label="${esc(T().view(g.name))}">
        <img src="${esc(full(cover))}" alt="${esc(g.name)}" width="${cover.w || 1600}" height="${cover.h || 900}" loading="lazy" decoding="async">
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
    </div>`;
}
// 소품 · 셰이더 하나의 작은 그림
function etcThumb(w) {
  const c = w.imgs.find((i) => i.w / i.h >= 1.2) || w.imgs[0];
  const vid = w.imgs.some((i) => i.video) ? '<span class="play">▶</span>' : '';
  return `<span class="mini-img"><img src="${esc(thumb(c))}" alt="" loading="lazy" decoding="async">${vid}</span>`;
}

// ---------- 다음 배경 준비 중: 빈 사진 틀 + 노란 「준비중」 테이프 (도트) ----------
const TODAY = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
function soonBlock() {
  return `<div class="track-bg">
      <div class="soon-view"><canvas class="soon-canvas" width="512" height="288" aria-label="${esc(T().tape)}"></canvas></div>
      <div class="stage-info">
        <div class="stage-head"><h3 class="stage-name">${esc(T().soon)}</h3></div>
        <p class="say">${esc(T().soonNote(BGS[0] ? BGS[0].name : ''))}</p>
      </div>
    </div>`;
}
// 512 x 288 점으로 그리고 CSS 로 늘린다 (image-rendering: pixelated). 글자는 도트 글꼴을 2배(24px)로 써서 굵은 도트로.
// 테이프는 가로 띠를 먼저 그린 뒤 점 단위로 돌려서 붙이므로, 기울어져도 번지지 않고 도트 그대로.
function drawSoon(cv) {
  const W = cv.width, H = cv.height, S = W / 256; // S: 도트 한 칸 크기 (256 기준)
  const g = cv.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const INK = css.getPropertyValue('--ink').trim();
  const SKY = css.getPropertyValue('--sky').trim();
  const PAPER2 = css.getPropertyValue('--paper-2').trim();
  const YELLOW = '#f6c83a', YELLOW_D = '#d9a91c';
  const block = (x, y, w = 1, h = 1) => g.fillRect(Math.round(x * S), Math.round(y * S), Math.round(w * S), Math.round(h * S)); // 256 기준 좌표로 그리기
  const paint = () => {
    // 바탕: 옅은 하늘 + 점 격자 + 가운데 「빈 사진」 아이콘 (산 · 해)
    g.fillStyle = PAPER2; g.fillRect(0, 0, W, H);
    g.fillStyle = SKY;
    for (let y = 2; y < H; y += 6) for (let x = 2; x < W; x += 6) g.fillRect(x, y, 1, 1);
    const ix = 128 - 22, iy = 72 - 15;
    block(ix, iy, 44, 30);
    g.fillStyle = PAPER2; block(ix + 2, iy + 2, 40, 26);
    g.fillStyle = SKY;
    for (let r = -3; r <= 3; r++) for (let c = -3; c <= 3; c++) if (r * r + c * c <= 10) block(ix + 31 + c, iy + 9 + r); // 해
    for (let k = 0; k < 13; k++) block(ix + 4 + k, iy + 26 - k, Math.max(1, 26 - 2 * k), 1); // 큰 산
    for (let k = 0; k < 8; k++) block(ix + 23 + k, iy + 26 - k, Math.max(1, 16 - 2 * k), 1); // 작은 산
    // 테이프 띠 (가로, 실제 점 크기)
    const TH = Math.round(17 * S), TL = Math.round(400 * S);
    const strip = document.createElement('canvas');
    strip.width = TL; strip.height = TH;
    const t = strip.getContext('2d');
    t.fillStyle = YELLOW; t.fillRect(0, 0, TL, TH);
    t.fillStyle = YELLOW_D; t.fillRect(0, TH - 2 * S, TL, S); // 아래쪽 그늘
    t.fillStyle = INK; t.fillRect(0, 0, TL, S); t.fillRect(0, TH - S, TL, S); // 위아래 테두리
    t.font = `${12 * S}px Galmuri11, Galmuri9, monospace`;
    t.textBaseline = 'top';
    const word = T().tape;
    const ww = Math.ceil(t.measureText(word).width);
    for (let x = 4 * S; x < TL; x += ww + 22 * S) {
      t.fillStyle = INK; t.fillText(word, x, 3 * S);
      for (let k = 0; k < 3; k++) for (let r = 2; r < 15; r++) t.fillRect(x + ww + (6 + k * 4 + Math.floor((17 - r) / 3)) * S, r * S, 2 * S, S); // 사선 줄무늬
    }
    // 번진 가장자리를 없애서 도트로: 점마다 노랑 · 진노랑 · 먹색 중 가장 가까운 색으로
    const sd = t.getImageData(0, 0, TL, TH);
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const PAL = [hex(YELLOW), hex(YELLOW_D), hex(INK)];
    for (let i = 0; i < sd.data.length; i += 4) {
      let best = PAL[0], bd = Infinity;
      for (const c of PAL) {
        const d = (sd.data[i] - c[0]) ** 2 + (sd.data[i + 1] - c[1]) ** 2 + (sd.data[i + 2] - c[2]) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      sd.data[i] = best[0]; sd.data[i + 1] = best[1]; sd.data[i + 2] = best[2]; sd.data[i + 3] = 255;
    }
    // 띠를 점 단위로 돌려서 붙이기 (가장 가까운 점 그대로 = 번짐 없음). 그림자를 먼저.
    const out = g.getImageData(0, 0, W, H);
    const tape = (cx, cy, deg) => {
      const a = (deg * Math.PI) / 180, co = Math.cos(a), sn = Math.sin(a);
      for (const [ox, oy, shade] of [[S, 2 * S, true], [0, 0, false]]) {
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const dx = x - cx - ox, dy = y - cy - oy;
            const u = Math.round(co * dx + sn * dy + TL / 2), v = Math.round(-sn * dx + co * dy + TH / 2);
            if (u < 0 || u >= TL || v < 0 || v >= TH) continue;
            const o = (y * W + x) * 4;
            if (shade) { out.data[o] *= 0.8; out.data[o + 1] *= 0.84; out.data[o + 2] *= 0.86; continue; }
            const q = (v * TL + u) * 4;
            out.data[o] = sd.data[q]; out.data[o + 1] = sd.data[q + 1]; out.data[o + 2] = sd.data[q + 2]; out.data[o + 3] = 255;
          }
        }
      }
    };
    tape(W / 2 - 10 * S, H / 2, 9); // 가운데에서 X 자로 교차 (많이 기울이면 글자가 깨져서 완만하게)
    tape(W / 2 + 10 * S, H / 2 + 2 * S, -8);
    g.putImageData(out, 0, 0);
  };
  paint();
  if (document.fonts) document.fonts.load('24px Galmuri11').then(paint, () => {}); // 글꼴이 늦게 오면 다시
}

function renderStages(animate) {
// PC: 왼쪽 배경 · 가운데 세로줄 · 오른쪽 같은 시기 소품
let html = '';
let year = '';
const sideList = (list) => list.map((w) => `<li><button class="mini" type="button" data-etc="${w.id}">
      ${etcThumb(w)}
      <span class="mini-text"><span class="mini-name">${esc(tr(w, 'title'))}</span><span class="mini-date">${dot(w.date)}</span></span>
    </button></li>`).join('');
// 맨 위: 다음 배경 준비 중 (오늘 날짜). 오른쪽엔 가장 최근 배경 이후에 만든 것.
{
  year = TODAY.slice(0, 4);
  html += `<li class="stage snap reveal stage-soon" data-date="${TODAY}">
    ${soonBlock()}
    <p class="when"><b>${year}</b><i class="rail-dot" aria-hidden="true"></i><span>${T().month(Number(TODAY.slice(5, 7)))}</span></p>
    <div class="track-etc">
      ${LATEST.length ? `<p class="track-label">${T().side}</p><ul class="minis">${sideList(LATEST)}</ul>` : ''}
    </div>
  </li>`;
}
BGS.forEach((g, n) => {
  const y = g.date.slice(0, 4);
  const newYear = y !== year;
  year = y;
  const side = sideList(PERIOD[n]);
  html += `<li class="stage snap reveal" data-date="${g.date}">
    ${bgBlock(g, n)}
    <p class="when">${newYear ? `<b>${y}</b>` : ''}<i class="rail-dot" aria-hidden="true"></i><span>${T().month(Number(g.date.slice(5, 7)))}</span></p>
    <div class="track-etc">
      ${side ? `<p class="track-label">${T().side}</p><ul class="minis">${side}</ul>` : ''}
    </div>
  </li>`;
});
$('#stages').innerHTML = html;

// 휴대폰: 배경과 그 밖의 작업을 날짜순으로 한 줄에. 배경은 크게, 소품 · 셰이더는 작게.
const items = [...BGS.map((g, n) => ({ g, n, date: g.date })), ...ETC.map((w) => ({ w, date: w.date }))]
  .sort((a, b) => (a.date === b.date ? (a.g ? -1 : 1) : a.date < b.date ? 1 : -1));
let fy = TODAY.slice(0, 4);
$('#feed').innerHTML = `<li class="feed-item feed-bg feed-soon reveal" data-date="${TODAY}">
      <p class="when"><b>${fy}</b><i class="rail-dot" aria-hidden="true"></i><span>${T().month(Number(TODAY.slice(5, 7)))}</span></p>
      ${soonBlock()}
    </li>` + items.map((it) => {
  const y = it.date.slice(0, 4);
  const yr = y !== fy ? `<b>${y}</b>` : '';
  fy = y;
  if (it.g) {
    return `<li class="feed-item feed-bg reveal" data-date="${it.date}">
      <p class="when">${yr}<i class="rail-dot" aria-hidden="true"></i><span>${T().month(Number(it.date.slice(5, 7)))}</span></p>
      ${bgBlock(it.g, it.n)}
    </li>`;
  }
  return `<li class="feed-item feed-etc reveal" data-date="${it.w.date}">
    ${yr ? `<p class="when">${yr}</p>` : ''}
    <button class="feed-mini" type="button" data-etc="${it.w.id}">
      <i class="feed-dot rail-dot" aria-hidden="true"></i>
      ${etcThumb(it.w)}
      <span class="feed-text"><span class="mini-name">${esc(tr(it.w, 'title'))}</span><span class="mini-date">${dot(it.w.date)}</span></span>
    </button>
  </li>`;
}).join('');

cycleTimers.forEach(clearInterval);
cycleTimers = [];
document.querySelectorAll('#stages .reveal, #feed .reveal').forEach((el) => (animate ? revealer.observe(el) : el.classList.add('shown')));
document.querySelectorAll('[data-cycle]').forEach(startCycle);
document.querySelectorAll('canvas.soon-canvas').forEach(drawSoon);
railClock.update();
}

// ---------- 세로줄을 타고 내려오는 도트 시계 (PC 연표) ----------
// 화면 가운데 높이를 목표로 세로줄 위를 따라오되, 스크롤보다 조금 늦게 따라붙는다 (스프링처럼).
// 시계가 있는 자리의 연 · 월을 보여 준다: 배경 칸 맨 위 = 그 배경을 낸 달,
// 다음(더 오래된) 배경 칸까지 내려가는 동안 달을 거슬러 올라간다.
// 짧은 바늘은 달(12시 = 12월), 긴 바늘은 한 달 사이를 얼마나 지나왔는지. 움직이는 동안 양옆 톱니바퀴가 돈다.
// 화면 가운데가 연표 안에 있을 때만 보인다 (맨 위 소개 화면 · 맨 아래 연락 화면에서는 숨김).
// PC 연표(#stages)와 휴대폰 연표(#feed) 중 보이는 쪽을 따라간다. 휴대폰은 항목마다(배경 · 소품) 날짜가 있다.
const railClock = (() => {
  const sec = $('#backgrounds');
  const el = document.createElement('div');
  el.className = 'rail-clock';
  el.setAttribute('aria-hidden', 'true');
  const W = 33, H = 21, CX = 16, CY = 11; // 캔버스 점 크기, 시계 가운데
  el.innerHTML = `<canvas width="${W}" height="${H}"></canvas><span></span>`;
  sec.append(el);
  const cv = el.querySelector('canvas');
  const g = cv.getContext('2d');
  const label = el.querySelector('span');
  const css = getComputedStyle(document.documentElement);
  const INK = css.getPropertyValue('--ink').trim();
  const INK2 = css.getPropertyValue('--ink-2').trim();
  const MUTE = css.getPropertyValue('--mute').trim();
  const ACCENT = css.getPropertyValue('--accent').trim();
  const px = (x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  // 바늘: 가운데에서 끝점까지 곧은 도트 선 (브레젠험)
  const hand = (ang, len, c) => {
    let x = CX, y = CY;
    const x1 = CX + Math.round(Math.sin(ang) * len), y1 = CY - Math.round(Math.cos(ang) * len);
    const dx = Math.abs(x1 - x), dy = -Math.abs(y1 - y), sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      px(x, y, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  };
  // 톱니바퀴: 가운데 (gx, gy), 몸통 반지름 r, 톱니 n 개, 돌아간 각도 rot
  const gear = (gx, gy, r, n, rot, c) => {
    const R = r + 1.6;
    for (let y = -Math.ceil(R); y <= Math.ceil(R); y++) {
      for (let x = -Math.ceil(R); x <= Math.ceil(R); x++) {
        const d = Math.hypot(x, y);
        if (d <= 1.1) continue; // 축 구멍
        const a = Math.atan2(y, x) - rot;
        if (d <= r + 0.4 || (d <= R && Math.cos(n * a) > 0.25)) px(gx + x, gy + y, d <= 1.9 ? INK : c);
      }
    }
  };

  let rotA = 0, rotB = 0, lastKey = '';
  function draw(mf) { // mf: 연 * 12 + (월 - 1), 소수
    const key = `${mf.toFixed(3)}|${rotA.toFixed(2)}`;
    if (key === lastKey) return;
    lastKey = key;
    g.clearRect(0, 0, W, H);
    gear(6, 15, 4, 7, rotA, INK2); // 왼쪽 아래 큰 톱니
    gear(27, 6, 3, 5, rotB, MUTE); // 오른쪽 위 작은 톱니
    for (let y = -7; y <= 7; y++) {
      for (let x = -7; x <= 7; x++) {
        const d = Math.hypot(x, y);
        if (d <= 6.5) px(CX + x, CY + y, '#ffffff'); // 판
        else if (d <= 7.5) px(CX + x, CY + y, INK); // 테두리
      }
    }
    px(CX - 1, CY - 9, INK); px(CX, CY - 9, INK); px(CX + 1, CY - 9, INK); px(CX, CY - 8, INK); // 꼭지
    px(CX, CY - 6, ACCENT); px(CX + 6, CY, ACCENT); px(CX, CY + 6, ACCENT); px(CX - 6, CY, ACCENT); // 12 · 3 · 6 · 9
    const month = ((Math.round(mf) % 12) + 12) % 12; // 0 = 1월
    hand((mf - Math.floor(mf)) * 2 * Math.PI, 5, ACCENT); // 긴 바늘
    hand(((month + 1) / 12) * 2 * Math.PI, 3, INK); // 짧은 바늘
    px(CX, CY, INK);
  }

  const mOf = (d) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
  let cur = null; // 지금 시계 높이 (연표 안 px)
  let lastList = null;
  let shown = false;
  let raf = 0, lastT = 0;

  // 연표 안 높이 y 의 연 · 월 (소수)
  function monthAt(items, y, total) {
    let k = 0;
    items.forEach((li, i) => { if (li.offsetTop <= y) k = i; });
    const top = items[k].offsetTop;
    const next = items[k + 1];
    const frac = Math.min(1, Math.max(0, (y - top) / ((next ? next.offsetTop : total) - top)));
    const m0 = mOf(items[k].dataset.date);
    return m0 + ((next ? mOf(next.dataset.date) : m0) - m0) * frac;
  }

  function frame(t) {
    raf = 0;
    const dt = Math.min(0.05, lastT ? (t - lastT) / 1000 : 0.016);
    lastT = t;
    const ol = [$('#stages'), $('#feed')].find((l) => getComputedStyle(l).display !== 'none');
    const items = ol ? [...ol.children] : [];
    if (!items.length) return;
    if (ol !== lastList) { lastList = ol; cur = null; } // 화면 폭이 바뀌어 연표가 바뀌면 제자리에서 다시
    const sr = sec.getBoundingClientRect();
    const or = ol.getBoundingClientRect();
    const mid = innerHeight / 2;
    const inside = or.top < mid && or.bottom > mid;
    if (inside !== shown) {
      shown = inside;
      el.classList.toggle('on', shown);
      if (shown) cur = null; // 나타날 때는 제자리에서 시작
    }
    const target = Math.min(Math.max(mid - or.top, 0), or.height - 1);
    if (cur === null || still) cur = target;
    const prev = cur;
    cur += (target - cur) * (1 - Math.exp(-dt * 7)); // 늦게 따라붙기
    const moved = cur - prev;
    rotA += moved * 0.045;
    rotB -= moved * 0.045 * (7 / 5);
    const rail = ol.querySelector('.rail-dot').getBoundingClientRect();
    el.style.left = `${rail.left + rail.width / 2 - sr.left}px`;
    el.style.top = `${or.top - sr.top + cur}px`;
    const mf = monthAt(items, cur, or.height);
    const m = Math.round(mf);
    label.textContent = `${Math.floor(m / 12)}.${String((m % 12) + 1).padStart(2, '0')}`;
    draw(mf);
    if (Math.abs(target - cur) > 0.3) raf = requestAnimationFrame(frame); // 다 따라붙을 때까지
    else lastT = 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', kick);
  // 확인용: 시간을 직접 넘기며 한 장면 그리기
  el.update = (ms = 16) => { lastT = performance.now() - ms; frame(performance.now()); if (raf) { cancelAnimationFrame(raf); raf = 0; } };
  return { update: () => frame(performance.now()) };
})();

// 내려가면 하나씩 도트 디졸브로 나타남
const revealer = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    revealer.unobserve(e.target);
    dissolveIn(e.target);
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
    im.src = full(photos[i]);
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
const snapOn = matchMedia('(min-width: 961px) and (min-height: 620px)'); // portfolio.css 의 PC 연표와 같은 기준
const HEAD = () => document.querySelector('.site-head').getBoundingClientRect().height;
let wheelLock = 0;
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
  $('#v-img').src = full(item);
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
  $('#v-strip').innerHTML = cur.imgs.map((i, n) => `<button type="button" data-go="${n}" aria-label="${n + 1}"><img src="${esc(thumb(i))}" alt="" loading="lazy">${i.video ? '<span>▶</span>' : ''}</button>`).join('');
  show();
  if (!dlg.open) dlg.showModal();
}
function openBg(key, at = 0) {
  const g = BGS.find((b) => b.key === key);
  if (g) open({ title: g.name, date: g.date.slice(0, 7).replace('-', '.'), desc: tr(g, 'desc'), booth: g.booth, imgs: g.imgs }, at);
}
function openEtc(id) {
  const w = ETC.find((e) => e.id === id);
  // X 글 번호: 따로 적은 post, 없으면 id 가 숫자(예전 항목은 X 글 번호가 id)일 때 그것
  if (w) open({ title: tr(w, 'title'), date: dot(w.date), desc: tr(w, 'desc'), post: w.post || (/^\d+$/.test(w.id) ? w.id : null), imgs: w.imgs });
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
  document.querySelectorAll('[data-ph]').forEach((el) => { el.placeholder = T()[el.dataset.ph]; });
  const mail = '<a href="mailto:midorichart@gmail.com">midorichart@gmail.com</a>';
  const dm = '<a href="https://x.com/midorichart" target="_blank" rel="noopener">X DM</a>';
  $('#reach').innerHTML = T().reach(mail, dm);
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
}
// 언어 버튼: 고른 언어를 기억하고 그 언어 페이지(/ko/ · /ja/ · /en/)로 옮긴다
function setLang(next) {
  try { localStorage.setItem('lang', next); } catch {}
  if (next === lang) return;
  location.href = new URL(`../${next}/`, import.meta.url).href;
}
document.querySelectorAll('[data-lang]').forEach((b) => { b.onclick = () => setLang(b.dataset.lang); });
applyStatic();

// ---------- 메시지 창 (첫 화면 오른쪽 · 휴대폰은 로고 바로 아래) ----------
// Supabase 의 send_message() 함수만 부른다 (app/inbox/supabase/messages.sql). 받은 메시지는 /app/inbox/ 와 디스코드로.
// 아래 키는 공개용(publishable) 키라 페이지에 있어도 되고, 이 키로는 메시지를 보내기만 할 수 있다.
// 'admin' 을 보내면 메시지 대신 이 창에서 관리자 로그인 (이메일 → 비밀번호) 을 하고 /app/ 으로 간다.
const MSG_API = `${SB_URL}/rest/v1/rpc/send_message`;
const MSG_KEY = SB_KEY;
(() => {
  const box = $('#msgbox');
  if (!box) return;
  const name = $('#mb-name'), anon = $('#mb-anon'), body = $('#mb-body'), log = $('#mb-log'), status = $('#mb-status');
  const pw = $('#mb-pw'), cancel = $('#mb-cancel'), who = box.querySelector('.mb-who');
  try { name.value = localStorage.getItem('mb-name') || ''; anon.checked = localStorage.getItem('mb-anon') === '1'; } catch {}
  const sync = () => { name.disabled = anon.checked; };
  anon.addEventListener('change', sync);
  sync();
  const bubble = (text, who, meta) => {
    const p = document.createElement('p');
    p.className = `mb-bubble ${who}`;
    p.textContent = text;
    if (meta) { const s = document.createElement('small'); s.textContent = meta; p.prepend(s); }
    log.append(p);
    log.scrollTop = log.scrollHeight;
  };
  // ----- 관리자 로그인 (mode: 'msg' 보통 메시지 → 'id' 이메일 받는 중 → 'pw' 비밀번호 받는 중) -----
  let mode = 'msg', email = '';
  const setMode = (m) => {
    mode = m;
    const admin = m !== 'msg';
    who.hidden = admin;
    cancel.hidden = !admin;
    body.hidden = m === 'pw';
    body.required = m !== 'pw';
    pw.hidden = m !== 'pw';
    pw.required = m === 'pw';
    body.placeholder = m === 'id' ? 'email@example.com' : T().mbBody;
    body.rows = m === 'id' ? 1 : 4;
    (m === 'pw' ? pw : body).focus();
  };
  cancel.addEventListener('click', () => { pw.value = ''; body.value = ''; status.textContent = ''; bubble(T().adBye, 'sys'); setMode('msg'); });
  let supa = null;
  const loadSupabase = () => supa || (supa = new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.min.js';
    s.onload = () => ok(window.supabase.createClient(SB_URL, SB_KEY));
    s.onerror = () => { supa = null; fail(new Error('load')); };
    document.head.append(s);
  }));
  async function adminStep() {
    if (mode === 'id') {
      email = body.value.trim();
      body.value = '';
      bubble(email, 'me');
      bubble(T().adPw, 'them');
      setMode('pw');
      return;
    }
    const pass = pw.value;
    pw.value = '';
    if (!pass) return;
    bubble('••••••••', 'me');
    status.textContent = T().adWait;
    try {
      const sb = await loadSupabase();
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
      status.textContent = '';
      bubble(T().adOk, 'them');
      location.href = '/app/';
    } catch {
      status.textContent = '';
      bubble(T().adFail, 'them');
      bubble(T().adId, 'them');
      setMode('id');
    }
  }

  $('#mb-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (mode !== 'msg') return adminStep();
    const text = body.value.trim();
    if (!text) return;
    if (text.toLowerCase() === 'admin') {
      body.value = '';
      bubble('admin', 'me');
      bubble(T().adId, 'them');
      setMode('id');
      return;
    }
    const who = anon.checked ? null : name.value.trim() || null;
    const btn = box.querySelector('button[type=submit]');
    btn.disabled = true;
    status.textContent = T().mbSending;
    try {
      const r = await fetch(MSG_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: MSG_KEY },
        body: JSON.stringify({ p_name: who, p_body: text, p_lang: lang, p_hp: $('#mb-hp').value }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || String(r.status)); }
      bubble(text, 'me', who || T().mbAnonName);
      bubble(T().mbThanks, 'them');
      body.value = '';
      status.textContent = '';
      try { localStorage.setItem('mb-name', name.value.trim()); localStorage.setItem('mb-anon', anon.checked ? '1' : '0'); } catch {}
    } catch (err) {
      status.textContent = /slow_down/.test(err.message) ? T().mbSlow : T().mbFail;
    } finally {
      btn.disabled = false;
    }
  });
  // Ctrl(⌘) + Enter 로 보내기. 이메일을 받는 중에는 Enter 만으로
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || mode === 'id')) { e.preventDefault(); $('#mb-form').requestSubmit(); }
  });
})();

// ---------- 맨 뒤 도트 물결 (화면 고정) ----------
mountTerrain($('#terrain'));

// ---------- 연표: 내용을 불러온 뒤 그린다 (Supabase → 안 되면 works.js) ----------
await loadWorks();
group();
renderStages(true);
