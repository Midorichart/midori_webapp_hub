// 맨 위 복셀 물결 — 격자 칸 하나하나가 블록이 되어 물결 높이를 따라 계단처럼 천천히 오르내리고,
// 커서가 닿은 곳과 파동이 지나가는 곳만 블록이 2x2 로 쪼개진다.
// 높이장을 원근으로 투영해서 블록의 윗면 · 앞면 · 옆면을 칠한다. 캔버스를 절반 해상도로 그리고 늘려서 도트 느낌.

// ---------- 시드 고정 값 노이즈 (점마다 아주 약한 결) ----------
const P = new Uint8Array(512);
{
  let s = 1234567;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
}
const fade = (t) => t * t * (3 - 2 * t);
function noise(x, y) { // 0..1
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a, b) => P[(P[a & 255] + b) & 511] / 255;
  const u = fade(xf), v = fade(yf);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ---------- 조절값 ----------
const AMP_IDLE = 0.02;   // 저절로 일렁이는 물결 높이
const AMP_MOUSE = 0.055; // 마우스 파동 높이
const IDLE_SPEED = 0.8;  // 물결 속도 (작을수록 느림)
const IDLE_FREQ = 3.6;   // 물결 촘촘함 (작을수록 파장이 김)
const RING_SPEED = 0.75; // 마우스 파동이 퍼지는 속도
const RING_FREQ = 5.5;
const RING_LIFE = 9;     // 파동이 사라지기까지 (초)
const COLS = 40, ROWS = 18; // 평소 격자 (성기게)
// 아주 옅은 하늘색 → 로고 청록 (블록 윗면은 이 중에서 높이에 따라, 앞 · 옆면은 조금 어둡게)
const COLORS = ['#e6f5f8', '#d9f0f4', '#cbeaf0', '#bde4ec', '#acdde7', '#99d5e1', '#84cbd9', '#6dc0d1'];

export function mountTerrain(canvas, host) {
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const Z = 6, Z0 = 1.2, DOT = 2; // DOT: 화면 px 2개 = 캔버스 점 1개
  let W = 0, H = 0, f = 1, hy = 0, camH = 1, cx = 0;
  let lastT = 0;

  function layout() {
    // 너비는 화면 끝까지 (본문 폭이 아니라), 높이는 소개 칸만큼
    const cw = document.documentElement.clientWidth, ch = host.getBoundingClientRect().height;
    W = Math.max(2, Math.round(cw / DOT));
    H = Math.max(2, Math.round(ch / DOT));
    canvas.width = W; canvas.height = H;
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    f = W * 0.42;
    hy = H * 0.42;
    camH = (H * 1.02 - hy) * Z0 / f;
    cx = W / 2;
  }

  // 격자 좌표(u: 0..COLS-1, v: 0..ROWS-1, 소수 가능) → 바닥 좌표
  const zOf = (v) => Z * Math.pow(v / (ROWS - 1), 1.35);
  const xOf = (u, z) => ((u / (COLS - 1)) * 2 - 1) * (cx / f) * (z + Z0) * 1.08; // 줄마다 화면 너비를 꽉 채운다

  // 마우스
  const sources = []; // 파동 { x, z, t0 }
  let cursor = null; // 지금 커서가 닿은 바닥 좌표
  let lastDrop = 0;
  function toGround(px, py) {
    const r = canvas.getBoundingClientRect();
    const sx = ((px - r.left) / r.width) * W, sy = ((py - r.top) / r.height) * H;
    if (sy <= hy + 2) return null;
    const zz = (f * camH) / (sy - hy) - Z0;
    if (zz < 0 || zz > Z) return null;
    return { x: ((sx - cx) * (zz + Z0)) / f, z: zz };
  }
  host.addEventListener('pointermove', (e) => {
    cursor = toGround(e.clientX, e.clientY);
    const now = performance.now() / 1000;
    const last = sources[sources.length - 1];
    const moved = !last || Math.hypot(cursor ? cursor.x - last.x : 0, cursor ? cursor.z - last.z : 0) > 0.45;
    if (cursor && moved && now - lastDrop > 0.5) {
      lastDrop = now;
      sources.push({ x: cursor.x, z: cursor.z, t0: now });
      if (sources.length > 10) sources.shift();
    }
  });
  host.addEventListener('pointerleave', () => { cursor = null; });

  function height(x, z, t) {
    let r = 0;
    // 천천히 떠도는 물결 중심 두 개
    for (const [sx, sz, k] of [[Math.sin(t * 0.09) * 1.5, 2.6, 0], [Math.cos(t * 0.07) * 2.2, 4.4, 1.7]]) {
      const d = Math.hypot(x - sx, z - sz);
      r += AMP_IDLE * Math.sin(d * IDLE_FREQ - t * IDLE_SPEED + k) * Math.exp(-d * 0.3);
    }
    // 마우스 파동: 천천히 퍼지며 약해진다
    for (const s of sources) {
      const age = t - s.t0;
      const d = Math.hypot(x - s.x, z - s.z);
      if (d > age * RING_SPEED) continue;
      r += AMP_MOUSE * Math.sin(d * RING_FREQ - age * RING_SPEED * RING_FREQ) * Math.exp(-d * 0.7) * Math.exp(-age * 0.32);
    }
    return r + (noise(x * 1.3 + 11, z * 1.3 + 5) - 0.5) * 0.01;
  }

  // 칸마다 얼마나 쪼개져 있을지 (0..1): 커서 근처와 파동 물결 앞부분이 지나가는 칸
  function activity(x, z, t) {
    let a = 0;
    if (cursor) a = Math.max(a, 1 - Math.hypot(x - cursor.x, z - cursor.z) / 0.9);
    for (const s of sources) {
      const age = t - s.t0;
      const front = age * RING_SPEED;
      const d = Math.hypot(x - s.x, z - s.z);
      a = Math.max(a, Math.exp(-(((d - front) / 0.55) ** 2)) * Math.exp(-age * 0.22));
    }
    return Math.min(1, a);
  }
  // ---------- 복셀 ----------
  // 칸 하나 = 블록 하나. 높이는 칸 가운데의 물결 높이를 STEP 단위로 끊어서 계단처럼.
  // 커서 · 파동이 지나가는 칸(활성도 > SPLIT)은 블록을 2x2 로 쪼갠다.
  const STEP = 0.007;   // 높이 계단 한 칸
  const BASE = -0.022;  // 블록 바닥 높이 (앞면 두께)
  const GAP = 0.07;     // 블록 사이 틈 (칸 크기 대비)
  const SPLIT = 0.42;   // 이만큼 활성이면 2x2 로
  const shade = (hex, k) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
  const TOP = COLORS;
  const FRONT = COLORS.map((c) => shade(c, 0.9));
  const SIDE = COLORS.map((c) => shade(c, 0.95));
  // 그리는 순서: 가운데에서 먼 열부터 (원근상 안쪽 옆면이 가려지게)
  const colOrder = [...Array(COLS - 1).keys()].sort((a, b) => Math.abs(b + 0.5 - (COLS - 1) / 2) - Math.abs(a + 0.5 - (COLS - 1) / 2));

  function draw(t) {
    while (sources.length && t - sources[0].t0 > RING_LIFE) sources.shift();
    const proj = (u, v, h) => {
      const z = zOf(v), x = xOf(u, z), k = f / (z + Z0);
      return [cx + x * k, hy + (camH - h) * k];
    };
    const quad = (a, b, c, d, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]);
      ctx.closePath();
      ctx.fill();
    };
    // 블록 하나: (u0,v0)~(u1,v1) 바닥 칸, 가운데 물결 높이로
    const voxel = (u0, v0, u1, v1) => {
      const g = (u1 - u0) * GAP;
      u0 += g; u1 -= g; v0 += g; v1 -= g;
      const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2, zc = zOf(vc);
      const h = Math.round(height(xOf(uc, zc), zc, t) / STEP) * STEP;
      const A = proj(u0, v0, h), B = proj(u1, v0, h), C = proj(u1, v1, h), D = proj(u0, v1, h);
      if (Math.max(A[0], B[0], C[0], D[0]) < -4 || Math.min(A[0], B[0], C[0], D[0]) > W + 4 || Math.min(A[1], D[1]) > H + 4) return;
      const ci = Math.max(0, Math.min(COLORS.length - 1, Math.round(3 + h * 55)));
      const A0 = proj(u0, v0, BASE), B0 = proj(u1, v0, BASE);
      if (uc > (COLS - 1) / 2) quad(A, D, proj(u0, v1, BASE), A0, SIDE[ci]); // 오른쪽 블록은 왼쪽 옆면이 보임
      else quad(B, C, proj(u1, v1, BASE), B0, SIDE[ci]);
      quad(A, B, B0, A0, FRONT[ci]); // 앞면
      quad(A, B, C, D, TOP[ci]);      // 윗면
    };

    ctx.clearRect(0, 0, W, H);
    // 먼 줄부터 가까운 줄로
    for (let j = ROWS - 2; j >= 0; j--) {
      ctx.globalAlpha = 0.55 + 0.45 * (1 - j / (ROWS - 2));
      for (const i of colOrder) {
        const zc = zOf(j + 0.5);
        if (activity(xOf(i + 0.5, zc), zc, t) > SPLIT) {
          // 2x2: 먼 쪽 줄 먼저, 바깥쪽 먼저
          const right = i + 0.5 > (COLS - 1) / 2;
          for (const q of [1, 0]) for (const p of right ? [1, 0] : [0, 1]) voxel(i + p / 2, j + q / 2, i + (p + 1) / 2, j + (q + 1) / 2);
        } else {
          voxel(i, j, i + 1, j + 1);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  layout();
  canvas.drawAt = draw; // 특정 시점 장면을 바로 그려 볼 때 (확인용)
  new ResizeObserver(() => { layout(); if (still) draw(3); }).observe(host);

  if (still) { draw(3); return; } // 움직임 줄이기: 한 장면만

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(host);
  function frame(ms) {
    requestAnimationFrame(frame);
    if (!visible || document.hidden || canvas.paused) return;
    if (ms - lastT < 33) return; // 30fps 면 충분
    lastT = ms;
    draw(ms / 1000);
  }
  requestAnimationFrame(frame);
}
