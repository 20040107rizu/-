// タイトル画面の背景（夜の鬼の街）とロゴ「鬼バスターズ」をSVGで描く
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  };
  // 毎回同じ街並みになるようにシード付き乱数
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  // ---------- 背景 ----------
  function buildBackground() {
    const W = 1600, H = 900;
    const svg = el('svg', { class: 'title-bg', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMax slice', 'aria-hidden': 'true' });
    const defs = el('defs', {}, svg);
    const sky = el('linearGradient', { id: 'tSky', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0', 'stop-color': '#0b0514' }, sky);
    el('stop', { offset: '0.55', 'stop-color': '#3a1238' }, sky);
    el('stop', { offset: '1', 'stop-color': '#8a2430' }, sky);
    const fog = el('linearGradient', { id: 'tFog', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0', 'stop-color': '#ff6a8a', 'stop-opacity': '0' }, fog);
    el('stop', { offset: '1', 'stop-color': '#ff6a8a', 'stop-opacity': '0.28' }, fog);
    const glow = el('filter', { id: 'tGlow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
    el('feGaussianBlur', { stdDeviation: '18' }, glow);
    const glowS = el('filter', { id: 'tGlowS', x: '-100%', y: '-100%', width: '300%', height: '300%' }, defs);
    el('feGaussianBlur', { stdDeviation: '5' }, glowS);

    el('rect', { width: W, height: H, fill: 'url(#tSky)' }, svg);
    // 星
    for (let i = 0; i < 70; i++) el('circle', { class: 'twinkle', cx: rnd() * W, cy: rnd() * H * 0.5, r: 0.8 + rnd() * 1.8, fill: '#fff', style: `animation-delay:${(rnd() * 4).toFixed(2)}s` }, svg);
    // 赤い月
    el('circle', { cx: 1270, cy: 210, r: 150, fill: '#ff7a4a', opacity: 0.55, filter: 'url(#tGlow)' }, svg);
    el('circle', { cx: 1270, cy: 210, r: 118, fill: '#ffb36a' }, svg);
    el('circle', { cx: 1230, cy: 180, r: 26, fill: '#f09a5a', opacity: 0.6 }, svg);
    el('circle', { cx: 1310, cy: 250, r: 16, fill: '#f09a5a', opacity: 0.6 }, svg);
    // 遠くの山
    el('path', { d: `M0 640 L180 520 L330 600 L520 470 L700 590 L880 500 L1080 610 L1280 520 L1450 590 L1600 540 L1600 900 L0 900Z`, fill: '#2a0f2e' }, svg);

    // 街の向こうからのぞくボス鬼
    const boss = el('g', { class: 'peek' }, svg);
    el('path', { d: 'M240 470 L285 330 L330 455Z M470 455 L515 330 L560 470Z', fill: '#e8d6a0' }, boss);
    el('circle', { cx: 400, cy: 640, r: 230, fill: '#5a0f1a' }, boss);
    const eyes = el('g', { class: 'blink' }, boss);
    for (const s of [-1, 1]) {
      el('ellipse', { cx: 400 + s * 80, cy: 560, rx: 46, ry: 30, fill: '#ffe14a', filter: 'url(#tGlowS)', transform: `rotate(${s * 18} ${400 + s * 80} 560)` }, eyes);
      el('ellipse', { cx: 400 + s * 80, cy: 560, rx: 40, ry: 24, fill: '#ffe14a', transform: `rotate(${s * 18} ${400 + s * 80} 560)` }, eyes);
      el('circle', { cx: 400 + s * 74, cy: 564, r: 11, fill: '#1a0000' }, eyes);
    }

    // 五重塔
    const pg = el('g', { fill: '#1a0b20' }, svg);
    const px = 1080;
    for (let i = 0; i < 5; i++) {
      const y = 380 + i * 62, w = 70 + i * 18;
      el('path', { d: `M${px - w} ${y + 30} Q${px - w * 0.5} ${y + 10} ${px} ${y} Q${px + w * 0.5} ${y + 10} ${px + w} ${y + 30}Z`, }, pg);
      el('rect', { x: px - 34 - i * 6, y: y + 28, width: 68 + i * 12, height: 34 }, pg);
    }
    el('rect', { x: px - 4, y: 320, width: 8, height: 64 }, pg);

    // 手前の町並み（瓦屋根の家）
    const town = el('g', {}, svg);
    let x = -20;
    const windows = [];
    while (x < W + 40) {
      const w = 110 + rnd() * 120, h = 90 + rnd() * 110, base = 820;
      const top = base - h;
      el('rect', { x, y: top, width: w, height: h + 100, fill: '#140818' }, town);
      // 反った屋根
      const o = 26;
      el('path', { d: `M${x - o} ${top + 8} Q${x + w * 0.2} ${top - 4} ${x + w * 0.5} ${top - 40 - rnd() * 20} Q${x + w * 0.8} ${top - 4} ${x + w + o} ${top + 8} L${x + w + o} ${top + 16} L${x - o} ${top + 16}Z`, fill: '#0e0512' }, town);
      const nw = Math.floor(w / 50);
      for (let k = 0; k < nw; k++) if (rnd() < 0.6) windows.push([x + 18 + k * 48, top + 36 + rnd() * (h - 70)]);
      x += w + 6;
    }
    for (const [wx, wy] of windows) {
      el('rect', { x: wx - 4, y: wy - 4, width: 30, height: 26, fill: '#ffb050', opacity: 0.35, filter: 'url(#tGlowS)' }, town);
      el('rect', { class: 'flicker', x: wx, y: wy, width: 22, height: 18, rx: 2, fill: '#ffc36a', style: `animation-delay:${(rnd() * 3).toFixed(2)}s` }, town);
    }

    // ちょうちんの列
    el('path', { d: `M-20 640 Q400 700 800 650 T1620 660`, stroke: '#2a1020', 'stroke-width': 4, fill: 'none' }, svg);
    for (let i = 0; i < 12; i++) {
      const lx = 60 + i * 135, ly = 655 + Math.sin(i * 1.3) * 18;
      const g = el('g', { class: 'swing', style: `transform-origin:${lx}px ${ly - 20}px;animation-delay:${(i * 0.37).toFixed(2)}s` }, svg);
      el('circle', { cx: lx, cy: ly, r: 30, fill: '#ff4a3a', opacity: 0.55, filter: 'url(#tGlow)' }, g);
      el('rect', { x: lx - 16, y: ly - 22, width: 32, height: 42, rx: 14, fill: '#e8322a' }, g);
      el('rect', { x: lx - 10, y: ly - 26, width: 20, height: 6, fill: '#2a1020' }, g);
      el('rect', { x: lx - 10, y: ly + 18, width: 20, height: 6, fill: '#2a1020' }, g);
      el('text', { x: lx, y: ly + 7, 'text-anchor': 'middle', 'font-size': 18, fill: '#2a0a0a', 'font-family': '"Dela Gothic One", sans-serif' }, g).textContent = '鬼';
    }
    // 霧
    el('rect', { y: 600, width: W, height: 300, fill: 'url(#tFog)' }, svg);
    // 浮かぶ鬼玉
    for (let i = 0; i < 14; i++) {
      const g = el('g', { class: 'orb', style: `animation-delay:${(-rnd() * 9).toFixed(2)}s;animation-duration:${(7 + rnd() * 5).toFixed(1)}s` }, svg);
      const cx = rnd() * W, cy = 760 + rnd() * 120, r = 8 + rnd() * 10;
      el('circle', { cx, cy, r: r * 2, fill: '#ff3da8', opacity: 0.5, filter: 'url(#tGlowS)' }, g);
      el('circle', { cx, cy, r, fill: '#ff5ab8' }, g);
      el('circle', { cx: cx - r * 0.35, cy: cy - r * 0.35, r: r * 0.3, fill: '#ffe0f4' }, g);
    }
    return svg;
  }

  // ---------- ロゴ ----------
  function buildLogo() {
    const svg = el('svg', { class: 'logo', viewBox: '0 0 1120 360', role: 'img', 'aria-label': '鬼バスターズ' });
    const defs = el('defs', {}, svg);
    const red = el('linearGradient', { id: 'lRed', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0', 'stop-color': '#ff8a5a' }, red);
    el('stop', { offset: '0.5', 'stop-color': '#ff2a2a' }, red);
    el('stop', { offset: '1', 'stop-color': '#9a0a1a' }, red);
    const yel = el('linearGradient', { id: 'lYel', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0', 'stop-color': '#fff6a0' }, yel);
    el('stop', { offset: '0.45', 'stop-color': '#ffd23a' }, yel);
    el('stop', { offset: '1', 'stop-color': '#ff7a1a' }, yel);
    const sh = el('filter', { id: 'lShadow', x: '-20%', y: '-20%', width: '140%', height: '160%' }, defs);
    el('feDropShadow', { dx: 0, dy: 10, stdDeviation: 0, 'flood-color': '#2a0010', 'flood-opacity': 1 }, sh);

    // 1文字ずつ: [文字, x, y, 大きさ, 傾き, 塗り, フォント]
    const chars = [
      ['鬼', 160, 292, 250, -8, 'url(#lRed)'],
      ['バ', 380, 280, 165, 6, 'url(#lYel)'],
      ['ス', 535, 290, 165, -5, 'url(#lYel)'],
      ['タ', 690, 278, 165, 5, 'url(#lYel)'],
      ['ー', 840, 284, 165, -3, 'url(#lYel)'],
      ['ズ', 995, 288, 165, 6, 'url(#lYel)'],
    ];
    const all = el('g', { filter: 'url(#lShadow)' }, svg);
    chars.forEach(([ch, x, y, fs, rot, fill, font], i) => {
      const g = el('g', { class: 'lc', style: `animation-delay:${(i * 0.12).toFixed(2)}s, ${(0.8 + i * 0.25).toFixed(2)}s` }, all);
      const inner = el('g', { transform: `rotate(${rot} ${x} ${y - fs * 0.35})` }, g);
      if (i === 0) {
        // 鬼の文字にツノ
        for (const [hx, tilt] of [[95, -1], [225, 1]]) {
          el('path', { d: `M${hx - 26} 92 Q${hx + tilt * 6} 10 ${hx + tilt * 30} -6 Q${hx + tilt * 14} 50 ${hx + 26} 98Z`, fill: '#f6e6b0', stroke: '#2a0010', 'stroke-width': 10, 'stroke-linejoin': 'round', 'paint-order': 'stroke' }, inner);
        }
      }
      const base = { x, y, 'text-anchor': 'middle', 'font-size': fs, 'font-family': font || '"Mochiy Pop One", sans-serif', 'stroke-linejoin': 'round', 'paint-order': 'stroke' };
      const k = i === 0 ? 0.7 : 1; // 画数の多い「鬼」はフチを細くして潰れないように
      el('text', { ...base, fill: '#fff', stroke: '#fff', 'stroke-width': 40 * k }, inner).textContent = ch;     // 外側の白フチ
      el('text', { ...base, fill: '#2a0010', stroke: '#2a0010', 'stroke-width': 20 * k }, inner).textContent = ch; // 内側の黒フチ
      el('text', { ...base, fill }, inner).textContent = ch;
    });
    // サブタイトルの帯
    const band = el('g', { class: 'band' }, svg);
    el('path', { d: 'M330 318 L1080 318 L1060 352 L350 352Z', fill: '#2a0010' }, band);
    el('path', { d: 'M340 312 L1070 312 L1052 344 L358 344Z', fill: '#7a1fc0', stroke: '#fff', 'stroke-width': 4 }, band);
    el('text', { x: 705, y: 337, 'text-anchor': 'middle', 'font-size': 24, fill: '#fff', 'font-family': '"Mochiy Pop One", sans-serif', 'letter-spacing': 10 }, band).textContent = 'ONI BUSTERS';
    return svg;
  }

  const title = document.getElementById('title');
  title.prepend(buildBackground());
  document.getElementById('logo').appendChild(buildLogo());
})();
