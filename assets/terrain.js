// 맨 위 도트 물결 — 성긴 와이어프레임이 천천히 일렁이고, 커서가 닿은 곳과 파동이 지나가는 곳만
// 칸을 2x2 + 대각선으로 잘게 쪼갠(테셀레이션) 삼각 격자가 서서히 진해졌다 옅어진다.
// 높이장을 원근으로 투영해서 선과 꼭짓점 도트로 그린다. 캔버스를 절반 해상도로 그리고 늘려서 도트 느낌.

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
const N = 2;             // 쪼갤 때 한 칸을 N x N 으로
// 아주 옅은 하늘색 → 로고 청록 (선은 이 중에서 높이에 따라)
const COLORS = ['#e6f5f8', '#d9f0f4', '#cbeaf0', '#bde4ec', '#acdde7', '#99d5e1', '#84cbd9', '#6dc0d1'];

export function mountTerrain(canvas, host) {
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const Z = 6, Z0 = 1.2, DOT = 2; // DOT: 화면 px 2개 = 캔버스 점 1개
  const ALPHAS = 10; // 투명도 단계 (선을 묶어 긋기 위해)
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

  // 마우스: 일정 거리 이상 움직였을 때만 파동 하나
  const sources = []; // { x, z, t0 }
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
    const moved = !last || (cursor && Math.hypot(cursor.x - last.x, cursor.z - last.z) > 0.45);
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

  // 그 자리가 얼마나 쪼개져 있을지 (0..1): 커서 근처와 파동 물결 앞부분이 지나가는 곳
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

  function draw(t) {
    while (sources.length && t - sources[0].t0 > RING_LIFE) sources.shift();

    const BANDS = 3;
    // 묶음: 투명도 단계 × 색 × 거리 — 같은 묶음끼리 한 번에 긋는다
    const paths = Array.from({ length: (ALPHAS + 1) * COLORS.length * BANDS }, () => new Path2D());
    const colorOf = (h) => Math.max(0, Math.min(COLORS.length - 1, Math.round(3 + h * 55)));
    const bandOf = (v) => Math.min(BANDS - 1, Math.floor((v / ROWS) * BANDS));
    const pt = (u, v) => {
      const z = zOf(v), x = xOf(u, z), h = height(x, z, t), k = f / (z + Z0);
      return [Math.round(cx + x * k), Math.round(hy + (camH - h) * k), h];
    };
    // (u,v) 에서 (u2,v2) 까지를 n 토막으로 나눠 표면을 따라 긋는다. op: 0..1 투명도
    const line = (u, v, u2, v2, n, op = 1) => {
      const al = Math.round(op * ALPHAS);
      if (al <= 0) return;
      let a = pt(u, v);
      for (let s = 1; s <= n; s++) {
        const b = pt(u + ((u2 - u) * s) / n, v + ((v2 - v) * s) / n);
        if (!((a[0] < -8 && b[0] < -8) || (a[0] > W + 8 && b[0] > W + 8) || (a[1] > H + 8 && b[1] > H + 8))) {
          const path = paths[(al * COLORS.length + colorOf((a[2] + b[2]) / 2)) * BANDS + bandOf(v)];
          path.moveTo(a[0], a[1]);
          path.lineTo(b[0], b[1]);
        }
        a = b;
      }
    };

    // 1) 기본 격자: 늘 그대로 (토막을 나눠 물결을 매끈하게 따라감)
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS - 1; i++) line(i, j, i + 1, j, 3);
    for (let j = 0; j < ROWS - 1; j++) for (let i = 0; i < COLS; i++) line(i, j, i, j + 1, 3);

    // 2) 쪼개진 메시: 칸을 가로지르는 이어진 보조선 + 한 방향 대각선(삼각 격자).
    //    선 토막마다 그 자리의 활성도로 투명도를 정해서, 칸 경계 없이 매끈하게 옅어졌다 진해진다.
    const fadeAt = (u, v) => {
      const z = zOf(v);
      const a = activity(xOf(u, z), z, t);
      return a * a * (3 - 2 * a);
    };
    const seg = (u, v, u2, v2) => {
      const op = fadeAt((u + u2) / 2, (v + v2) / 2);
      if (op > 0.04) line(u, v, u2, v2, 1, op);
    };
    const d = 1 / N;
    for (let j = 0; j < ROWS - 1; j++) for (let i = 0; i < COLS - 1; i++) {
      const zc = zOf(j + 0.5);
      if (activity(xOf(i + 0.5, zc), zc, t) < 0.02) continue; // 조용한 칸은 건너뜀
      for (let k = 0; k < N; k++) for (let s = 1; s < N; s++) {
        seg(i + k * d, j + s * d, i + (k + 1) * d, j + s * d); // 가로 보조선
        seg(i + s * d, j + k * d, i + s * d, j + (k + 1) * d); // 세로 보조선
      }
      for (let p = 0; p < N; p++) for (let q = 0; q < N; q++) {
        seg(i + p * d, j + q * d, i + (p + 1) * d, j + (q + 1) * d); // 대각선 (모두 같은 방향)
      }
    }

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(0.5, 0.5); // 1px 선이 번지지 않게
    ctx.lineWidth = 1;
    for (let b = BANDS - 1; b >= 0; b--) { // 먼 묶음부터
      for (let al = 1; al <= ALPHAS; al++) {
        ctx.globalAlpha = [0.85, 0.6, 0.38][b] * (al / ALPHAS);
        for (let c = 0; c < COLORS.length; c++) {
          ctx.strokeStyle = COLORS[c];
          ctx.stroke(paths[(al * COLORS.length + c) * BANDS + b]);
        }
      }
    }
    // 3) 기본 격자 꼭짓점 도트
    for (let j = ROWS - 1; j >= 0; j--) {
      const size = j < ROWS * 0.3 ? 2 : 1;
      ctx.globalAlpha = 0.45 + 0.45 * (1 - j / (ROWS - 1));
      for (let i = 0; i < COLS; i++) {
        const [sx, sy, h] = pt(i, j);
        if (sx < -4 || sx > W + 4 || sy > H + 4) continue;
        ctx.fillStyle = COLORS[Math.min(COLORS.length - 1, colorOf(h) + 1)];
        ctx.fillRect(sx - (size >> 1), sy - (size >> 1), size, size);
      }
    }
    ctx.restore();
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
