// 妖怪の絵を「体の形＋飾り」の組み合わせで描く（public/yokai.js の look 指定を使う）
// 256×256、足元が y≈236。絵柄は tools/svg-art.js の手描きキャラに合わせている。
const INK = '#2a1020';
const O = `stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"`;
const O4 = `stroke="${INK}" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"`;

// ---------- 色の計算 ----------
function hex(c) { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function toHex([r, g, b]) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
const dark = (c, t = 0.35) => mix(c, '#000000', t);
const light = (c, t = 0.45) => mix(c, '#ffffff', t);
const lum = c => { const [r, g, b] = hex(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

// id から決まる乱数（同じ妖怪は毎回同じ絵）
function seeded(str) {
  let h = 2166136261;
  for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

function parseLook(s) {
  const o = {};
  for (const part of (s || '').split(/\s+/).filter(Boolean)) { const [k, v] = part.split('='); o[k] = v === undefined ? '1' : v; }
  return o;
}

// ---------- 部品 ----------
function eyes(L, hx, hy, hr, iris) {
  const kind = L.eyes || 'normal';
  const ex = hr * 0.42, ey = hy - hr * 0.02, r = hr * 0.24;
  const one = (cx, cy, rr, angry, side) => {
    let s = `<ellipse cx="${cx}" cy="${cy}" rx="${rr * 0.82}" ry="${rr}" fill="#fff" ${O4}/>
      <ellipse cx="${cx}" cy="${cy + rr * 0.15}" rx="${rr * 0.5}" ry="${rr * 0.62}" fill="${iris}"/>
      <circle cx="${cx - rr * 0.2}" cy="${cy - rr * 0.15}" r="${rr * 0.22}" fill="#fff"/>`;
    if (angry) s += `<path d="M${cx - rr * 1.1} ${cy - rr * (side > 0 ? 1.5 : 0.9)} L${cx + rr * 1.1} ${cy - rr * (side > 0 ? 0.9 : 1.5)}" ${O} fill="none"/>`;
    return s;
  };
  switch (kind) {
    case 'none': return '';
    case 'one': return one(hx, ey, r * 1.6, false, 0);
    case 'sleepy': return `<path d="M${hx - ex - r} ${ey} Q${hx - ex} ${ey + r} ${hx - ex + r} ${ey} M${hx + ex - r} ${ey} Q${hx + ex} ${ey + r} ${hx + ex + r} ${ey}" ${O} fill="none"/>`;
    case 'angry': return one(hx - ex, ey, r, true, -1) + one(hx + ex, ey, r, true, 1);
    case 'three': return one(hx - ex, ey, r * 0.85) + one(hx + ex, ey, r * 0.85) + one(hx, ey - hr * 0.42, r * 0.7);
    case 'many': return one(hx - ex, ey, r * 0.8) + one(hx + ex, ey, r * 0.8) + one(hx, ey - hr * 0.4, r * 0.6) + one(hx - ex * 1.3, ey - hr * 0.42, r * 0.45) + one(hx + ex * 1.3, ey - hr * 0.42, r * 0.45);
    default: return one(hx - ex, ey, r) + one(hx + ex, ey, r);
  }
}
function mouth(L, hx, hy, hr) {
  const y = hy + hr * 0.42;
  if (L.eyes === 'angry') return `<path d="M${hx - 14} ${y} Q${hx} ${y - 8} ${hx + 14} ${y} L${hx + 8} ${y + 6} L${hx + 2} ${y} L${hx - 4} ${y + 6} L${hx - 10} ${y}Z" fill="#fff" ${O4}/>`;
  if (L.eyes === 'none') return `<path d="M${hx - 8} ${y} L${hx + 8} ${y}" ${O4} opacity="0.4"/>`;
  return `<path d="M${hx - 12} ${y - 2} Q${hx} ${y + 12} ${hx + 12} ${y - 2}" ${O4} fill="#7a1a30"/>`;
}
const blush = (hx, hy, hr) => `<ellipse cx="${hx - hr * 0.66}" cy="${hy + hr * 0.3}" rx="9" ry="5" fill="#ff7aa8" opacity="0.5"/><ellipse cx="${hx + hr * 0.66}" cy="${hy + hr * 0.3}" rx="9" ry="5" fill="#ff7aa8" opacity="0.5"/>`;
const shine = (cx, cy, rx, ry) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" opacity="0.35" transform="rotate(-25 ${cx} ${cy})"/>`;
const face = (L, hx, hy, hr, iris) => eyes(L, hx, hy, hr, iris) + mouth(L, hx, hy, hr) + (L.eyes === 'angry' ? '' : blush(hx, hy, hr));

function horns(kind, hx, hy, hr, c = '#f6e6b0') {
  const t = hy - hr * 0.8;
  switch (kind) {
    case 'oni': return [-1, 1].map(s => `<path d="M${hx + s * hr * 0.32} ${t + 12} L${hx + s * hr * 0.5} ${t - 34} L${hx + s * hr * 0.7} ${t + 18}Z" fill="${c}" ${O}/>`).join('');
    case 'goat': return [-1, 1].map(s => `<path d="M${hx + s * hr * 0.4} ${t + 14} Q${hx + s * hr * 1.2} ${t - 30} ${hx + s * hr * 1.1} ${t + 30} Q${hx + s * hr * 0.9} ${t} ${hx + s * hr * 0.65} ${t + 22}Z" fill="#8a6a5a" ${O}/>`).join('');
    case 'unicorn': return `<path d="M${hx - 10} ${t + 12} L${hx} ${t - 42} L${hx + 10} ${t + 12}Z" fill="#ffe14a" ${O}/><path d="M${hx - 6} ${t - 4} L${hx + 6} ${t - 10} M${hx - 7} ${t - 18} L${hx + 4} ${t - 24}" stroke="${INK}" stroke-width="3"/>`;
    case 'antler': return [-1, 1].map(s => `<path d="M${hx + s * hr * 0.4} ${t + 14} L${hx + s * hr * 0.7} ${t - 30} M${hx + s * hr * 0.58} ${t - 10} L${hx + s * hr * 1.0} ${t - 18} M${hx + s * hr * 0.66} ${t - 22} L${hx + s * hr * 0.5} ${t - 42}" stroke="${INK}" stroke-width="13" stroke-linecap="round"/><path d="M${hx + s * hr * 0.4} ${t + 14} L${hx + s * hr * 0.7} ${t - 30} M${hx + s * hr * 0.58} ${t - 10} L${hx + s * hr * 1.0} ${t - 18} M${hx + s * hr * 0.66} ${t - 22} L${hx + s * hr * 0.5} ${t - 42}" stroke="#c8a070" stroke-width="6" stroke-linecap="round"/>`).join('');
    default: return '';
  }
}

function hat(kind, hx, hy, hr, c) {
  const t = hy - hr * 0.85;
  switch (kind) {
    case 'witch': return `<path d="M${hx - hr * 1.2} ${t + 18} Q${hx} ${t + 4} ${hx + hr * 1.2} ${t + 18} Q${hx} ${t + 30} ${hx - hr * 1.2} ${t + 18}Z" fill="#3a2a5a" ${O}/><path d="M${hx - hr * 0.6} ${t + 16} L${hx + 24} ${t - 70} L${hx + 50} ${t - 56} L${hx + hr * 0.6} ${t + 16}Z" fill="#3a2a5a" ${O}/><rect x="${hx - hr * 0.6}" y="${t + 4}" width="${hr * 1.2}" height="10" fill="#ffd23a"/>`;
    case 'crown': return `<path d="M${hx - hr * 0.6} ${t + 14} L${hx - hr * 0.7} ${t - 20} L${hx - hr * 0.3} ${t} L${hx} ${t - 30} L${hx + hr * 0.3} ${t} L${hx + hr * 0.7} ${t - 20} L${hx + hr * 0.6} ${t + 14}Z" fill="#ffd23a" ${O}/><circle cx="${hx}" cy="${t + 2}" r="6" fill="#ff3a5a" ${O4}/>`;
    case 'hood': return `<path d="M${hx - hr * 1.05} ${hy + hr * 0.3} Q${hx - hr * 1.1} ${t - 30} ${hx} ${t - 40} Q${hx + hr * 1.1} ${t - 30} ${hx + hr * 1.05} ${hy + hr * 0.3} Q${hx + hr * 0.8} ${hy - hr * 0.6} ${hx} ${hy - hr * 0.7} Q${hx - hr * 0.8} ${hy - hr * 0.6} ${hx - hr * 1.05} ${hy + hr * 0.3}Z" fill="${dark(c, 0.15)}" ${O}/>`;
    case 'helmet': return `<path d="M${hx - hr * 1.02} ${hy - hr * 0.05} Q${hx - hr} ${t - 24} ${hx} ${t - 26} Q${hx + hr} ${t - 24} ${hx + hr * 1.02} ${hy - hr * 0.05} L${hx + hr * 0.7} ${hy - hr * 0.3} L${hx - hr * 0.7} ${hy - hr * 0.3}Z" fill="#8a9ab0" ${O}/><path d="M${hx} ${t - 26} L${hx} ${hy - hr * 0.3}" stroke="#5a6a80" stroke-width="5"/>${shine(hx - hr * 0.45, t, 10, 5)}`;
    case 'turban': return `<ellipse cx="${hx}" cy="${t + 2}" rx="${hr * 0.95}" ry="${hr * 0.45}" fill="#f4f0e0" ${O}/><path d="M${hx - hr * 0.8} ${t + 8} Q${hx} ${t - 14} ${hx + hr * 0.8} ${t + 8}" stroke="#d8c8a0" stroke-width="4" fill="none"/><circle cx="${hx}" cy="${t + 2}" r="8" fill="#3ab0d0" ${O4}/>`;
    case 'pharaoh': return `<path d="M${hx - hr * 1.05} ${hy + hr * 0.9} L${hx - hr * 0.95} ${t} Q${hx} ${t - 24} ${hx + hr * 0.95} ${t} L${hx + hr * 1.05} ${hy + hr * 0.9} L${hx + hr * 0.72} ${hy + hr * 0.9} L${hx + hr * 0.75} ${hy - hr * 0.35} L${hx - hr * 0.75} ${hy - hr * 0.35} L${hx - hr * 0.72} ${hy + hr * 0.9}Z" fill="#3a6ad8" ${O}/><path d="M${hx - hr * 0.9} ${t + 20} L${hx + hr * 0.9} ${t + 20} M${hx - hr} ${hy} L${hx - hr * 0.75} ${hy} M${hx + hr} ${hy} L${hx + hr * 0.75} ${hy}" stroke="#ffd23a" stroke-width="7"/>`;
    case 'straw': return `<ellipse cx="${hx}" cy="${t + 12}" rx="${hr * 1.35}" ry="${hr * 0.32}" fill="#e8c860" ${O}/><path d="M${hx - hr * 0.6} ${t + 10} Q${hx} ${t - 34} ${hx + hr * 0.6} ${t + 10}Z" fill="#e8c860" ${O}/><path d="M${hx - hr * 0.6} ${t + 4} L${hx + hr * 0.6} ${t + 4}" stroke="#c83a3a" stroke-width="6"/>`;
    case 'tokin': return `<path d="M${hx - 18} ${t + 8} L${hx + 18} ${t + 8} L${hx + 12} ${t - 14} L${hx - 12} ${t - 14}Z" fill="#2a2a3a" ${O}/>`;
    case 'top': return `<ellipse cx="${hx}" cy="${t + 10}" rx="${hr * 0.95}" ry="${hr * 0.2}" fill="#2a2a3a" ${O}/><rect x="${hx - hr * 0.55}" y="${t - 46}" width="${hr * 1.1}" height="56" rx="6" fill="#2a2a3a" ${O}/><rect x="${hx - hr * 0.55}" y="${t - 4}" width="${hr * 1.1}" height="10" fill="${c}"/>`;
    case 'catears': return [-1, 1].map(s => `<path d="M${hx + s * hr * 0.3} ${t + 6} L${hx + s * hr * 0.6} ${t - 30} L${hx + s * hr * 0.9} ${t + 16}Z" fill="${c}" ${O}/><path d="M${hx + s * hr * 0.45} ${t + 4} L${hx + s * hr * 0.6} ${t - 16} L${hx + s * hr * 0.76} ${t + 8}Z" fill="#ffb0c0"/>`).join('');
    default: return '';
  }
}

function wings(kind, cx, cy, c) {
  switch (kind) {
    case 'bat': return [-1, 1].map(s => `<path d="M${cx + s * 20} ${cy} Q${cx + s * 90} ${cy - 70} ${cx + s * 116} ${cy - 26} Q${cx + s * 96} ${cy - 20} ${cx + s * 96} ${cy + 4} Q${cx + s * 76} ${cy - 6} ${cx + s * 70} ${cy + 18} Q${cx + s * 50} ${cy + 4} ${cx + s * 34} ${cy + 26}Z" fill="${dark(c, 0.45)}" ${O}/>`).join('');
    case 'feather': return [-1, 1].map(s => `<path d="M${cx + s * 18} ${cy + 10} Q${cx + s * 60} ${cy - 80} ${cx + s * 118} ${cy - 50} Q${cx + s * 104} ${cy - 30} ${cx + s * 112} ${cy - 14} Q${cx + s * 92} ${cy - 10} ${cx + s * 98} ${cy + 8} Q${cx + s * 74} ${cy + 4} ${cx + s * 76} ${cy + 24} Q${cx + s * 50} ${cy + 18} ${cx + s * 30} ${cy + 36}Z" fill="${light(c, 0.55)}" ${O}/><path d="M${cx + s * 40} ${cy + 6} L${cx + s * 96} ${cy - 40} M${cx + s * 40} ${cy + 18} L${cx + s * 86} ${cy - 4}" stroke="${dark(c, 0.1)}" stroke-width="3" opacity="0.6"/>`).join('');
    case 'fairy': return [-1, 1].map(s => `<ellipse cx="${cx + s * 60}" cy="${cy - 30}" rx="50" ry="30" fill="#e0f4ff" opacity="0.85" ${O4} transform="rotate(${s * -30} ${cx + s * 60} ${cy - 30})"/><ellipse cx="${cx + s * 50}" cy="${cy + 20}" rx="30" ry="18" fill="#e0f4ff" opacity="0.85" ${O4} transform="rotate(${s * 25} ${cx + s * 50} ${cy + 20})"/>`).join('');
    default: return '';
  }
}

function tail(kind, c, tip = '#fff4e0') {
  if (!kind || kind === 'none') return '';
  if (kind === 'thin') return `<path d="M100 210 C56 214 40 180 52 150 C58 136 70 140 64 154" stroke="${INK}" stroke-width="16" fill="none" stroke-linecap="round"/><path d="M100 210 C56 214 40 180 52 150 C58 136 70 140 64 154" stroke="${c}" stroke-width="8" fill="none" stroke-linecap="round"/>`;
  if (kind === 'fluffy') return `<path d="M96 206 C40 214 18 170 34 136 C46 112 70 122 66 140 C60 164 74 184 100 190Z" fill="${c}" ${O}/><path d="M38 138 C46 120 62 124 62 136 C54 134 46 136 38 138Z" fill="${tip}"/>`;
  const n = Math.min(9, +kind.split(':')[1] || 2);
  const fur = dark(c, 0.12);
  let s = '';
  for (let i = 0; i < n; i++) {
    // 腰のあたりから斜め上へ、付け根が細く先がふくらむ毛束
    const deg = n === 2 ? (i ? -48 : -132) : -160 + (i / (n - 1)) * 140;
    s += `<g transform="rotate(${deg} 128 200)"><path d="M150 200 Q190 176 236 186 Q254 200 236 214 Q190 224 150 200Z" fill="${fur}" ${O4}/><path d="M222 190 Q246 196 238 210 Q228 214 220 206Z" fill="${tip}"/></g>`;
  }
  return s;
}

function weapon(kind, x, y, c) {
  switch (kind) {
    case 'sword': return `<path d="M${x} ${y} L${x + 36} ${y - 110}" stroke="${INK}" stroke-width="15" stroke-linecap="round"/><path d="M${x} ${y} L${x + 36} ${y - 110}" stroke="#e8f0ff" stroke-width="8" stroke-linecap="round"/><path d="M${x - 14} ${y - 12} L${x + 16} ${y - 2}" stroke="${INK}" stroke-width="12" stroke-linecap="round"/><path d="M${x - 14} ${y - 12} L${x + 16} ${y - 2}" stroke="#ffd23a" stroke-width="6" stroke-linecap="round"/>`;
    case 'staff': return `<path d="M${x} ${y + 40} L${x + 14} ${y - 100}" stroke="${INK}" stroke-width="13" stroke-linecap="round"/><path d="M${x} ${y + 40} L${x + 14} ${y - 100}" stroke="#a0703a" stroke-width="6" stroke-linecap="round"/><circle cx="${x + 15}" cy="${y - 108}" r="15" fill="${light(c, 0.3)}" ${O4}/>${shine(x + 10, y - 113, 5, 3)}`;
    case 'spear': return `<path d="M${x} ${y + 40} L${x + 20} ${y - 100}" stroke="${INK}" stroke-width="12" stroke-linecap="round"/><path d="M${x} ${y + 40} L${x + 20} ${y - 100}" stroke="#a0703a" stroke-width="5" stroke-linecap="round"/><path d="M${x + 12} ${y - 96} L${x + 24} ${y - 132} L${x + 30} ${y - 94}Z" fill="#e8f0ff" ${O4}/>`;
    case 'bow': return `<path d="M${x + 10} ${y - 70} Q${x + 46} ${y - 10} ${x + 10} ${y + 50}" stroke="${INK}" stroke-width="12" fill="none" stroke-linecap="round"/><path d="M${x + 10} ${y - 70} Q${x + 46} ${y - 10} ${x + 10} ${y + 50}" stroke="#c86a3a" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M${x + 10} ${y - 70} L${x + 10} ${y + 50}" stroke="#fff" stroke-width="2"/>`;
    case 'hammer': return `<path d="M${x} ${y + 20} L${x + 20} ${y - 70}" stroke="${INK}" stroke-width="13" stroke-linecap="round"/><path d="M${x} ${y + 20} L${x + 20} ${y - 70}" stroke="#a0703a" stroke-width="6" stroke-linecap="round"/><rect x="${x - 4}" y="${y - 104}" width="52" height="36" rx="8" fill="#8a8a9a" ${O} transform="rotate(12 ${x + 22} ${y - 86})"/>`;
    case 'fan': return `<path d="M${x} ${y} L${x - 10} ${y - 80} Q${x + 30} ${y - 100} ${x + 50} ${y - 60}Z" fill="#7ad07a" ${O}/><path d="M${x} ${y} L${x + 10} ${y - 84} M${x} ${y} L${x + 30} ${y - 76}" stroke="#3a8a3a" stroke-width="3"/>`;
    default: return '';
  }
}

function effects(kind, rnd) {
  const pts = [[34, 60], [222, 72], [28, 186], [226, 196], [60, 26]];
  return pts.slice(0, 4).map(([x, y], i) => {
    const s = 10 + rnd() * 5;
    switch (kind) {
      case 'fire': return `<path d="M${x} ${y + s} C${x - s} ${y + s} ${x - s} ${y} ${x} ${y - s * 1.4} C${x + s} ${y} ${x + s} ${y + s} ${x} ${y + s}Z" fill="${i % 2 ? '#ffb030' : '#ff5a2a'}" ${O4}/>`;
      case 'ice': return `<path d="M${x - s} ${y} L${x + s} ${y} M${x} ${y - s} L${x} ${y + s} M${x - s * 0.7} ${y - s * 0.7} L${x + s * 0.7} ${y + s * 0.7} M${x - s * 0.7} ${y + s * 0.7} L${x + s * 0.7} ${y - s * 0.7}" stroke="#bfeaff" stroke-width="4" stroke-linecap="round"/>`;
      case 'leaf': return `<path d="M${x - s} ${y} Q${x} ${y - s * 1.2} ${x + s} ${y} Q${x} ${y + s * 1.2} ${x - s} ${y}Z" fill="#6ad06a" ${O4}/>`;
      case 'spark': return `<path d="M${x - s * 0.4} ${y - s} L${x + s * 0.5} ${y - s * 0.1} L${x - s * 0.1} ${y} L${x + s * 0.4} ${y + s} L${x - s * 0.5} ${y + s * 0.1} L${x + s * 0.1} ${y}Z" fill="#fff27a" ${O4}/>`;
      case 'star': return `<path d="M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s}Z" fill="#fff6a0" stroke="${INK}" stroke-width="2"/>`;
      default: return '';
    }
  }).join('');
}

function pattern(kind, cx, cy, rx, ry, c) {
  const d = dark(c, 0.3);
  switch (kind) {
    case 'stripes': return [-0.5, 0, 0.5].map(t => `<path d="M${cx - rx * 0.6} ${cy + ry * t - 6} Q${cx} ${cy + ry * t + 6} ${cx + rx * 0.6} ${cy + ry * t - 6}" stroke="${d}" stroke-width="7" fill="none" stroke-linecap="round"/>`).join('');
    case 'spots': return [[-0.4, -0.3, 9], [0.35, -0.1, 7], [-0.1, 0.35, 8], [0.5, 0.45, 5]].map(([a, b, r]) => `<circle cx="${cx + rx * a}" cy="${cy + ry * b}" r="${r}" fill="${d}"/>`).join('');
    case 'bandage': return [-0.5, -0.1, 0.3, 0.65].map((t, i) => `<path d="M${cx - rx} ${cy + ry * t} L${cx + rx} ${cy + ry * t + (i % 2 ? 8 : -8)}" stroke="#c8b890" stroke-width="5"/>`).join('');
    default: return '';
  }
}

// ランクの後光
function aura(rank, c) {
  if (rank === 'S') return {
    defs: `<radialGradient id="aura"><stop offset="0.35" stop-color="#ffe680" stop-opacity="0.9"/><stop offset="1" stop-color="#ffb000" stop-opacity="0"/></radialGradient>`,
    back: `<circle cx="128" cy="128" r="124" fill="url(#aura)"/>` + Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6; return `<path d="M128 128 L${128 + Math.cos(a - 0.08) * 126} ${128 + Math.sin(a - 0.08) * 126} L${128 + Math.cos(a + 0.08) * 126} ${128 + Math.sin(a + 0.08) * 126}Z" fill="#fff3a0" opacity="0.35"/>`; }).join(''),
  };
  if (rank === 'A') return { defs: `<radialGradient id="aura"><stop offset="0.4" stop-color="${c}" stop-opacity="0.55"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`, back: `<circle cx="128" cy="130" r="120" fill="url(#aura)"/>` };
  return { defs: '', back: '' };
}

// ---------- 体の形 ----------
// それぞれ { back, body, head: {x, y, r}, hand: {x, y} } を返す。back は体より後ろ（羽・しっぽなど）。
const BODY = {
  beast(L, c) {
    const c2 = light(c, 0.55);
    const ears = {
      cat: [-1, 1].map(s => `<path d="M${128 + s * 30} 62 L${128 + s * 52} 18 L${128 + s * 64} 72Z" fill="${c}" ${O}/><path d="M${128 + s * 38} 60 L${128 + s * 50} 34 L${128 + s * 56} 64Z" fill="#ffb0c0"/>`).join(''),
      fox: [-1, 1].map(s => `<path d="M${128 + s * 26} 62 L${128 + s * 56} 8 L${128 + s * 66} 72Z" fill="${c}" ${O}/><path d="M${128 + s * 36} 60 L${128 + s * 54} 28 L${128 + s * 58} 64Z" fill="${INK}"/>`).join(''),
      dog: [-1, 1].map(s => `<path d="M${128 + s * 40} 56 Q${128 + s * 84} 50 ${128 + s * 74} 108 Q${128 + s * 58} 100 ${128 + s * 46} 76Z" fill="${dark(c, 0.2)}" ${O}/>`).join(''),
      bunny: [-1, 1].map(s => `<ellipse cx="${128 + s * 24}" cy="30" rx="14" ry="38" fill="${c}" ${O} transform="rotate(${s * 12} ${128 + s * 24} 30)"/><ellipse cx="${128 + s * 24}" cy="32" rx="6" ry="26" fill="#ffb0c0" transform="rotate(${s * 12} ${128 + s * 24} 32)"/>`).join(''),
      bear: [-1, 1].map(s => `<circle cx="${128 + s * 46}" cy="56" r="18" fill="${c}" ${O}/><circle cx="${128 + s * 46}" cy="56" r="8" fill="${dark(c, 0.25)}"/>`).join(''),
      round: [-1, 1].map(s => `<circle cx="${128 + s * 50}" cy="66" r="13" fill="${c}" ${O}/>`).join(''),
      horn: [-1, 1].map(s => `<path d="M${128 + s * 30} 60 L${128 + s * 44} 22 L${128 + s * 56} 64Z" fill="${c}" ${O}/>`).join(''),
    }[L.ears || 'round'] || '';
    const snout = L.snout ? `<ellipse cx="128" cy="124" rx="28" ry="20" fill="${c2}" ${O4}/><ellipse cx="128" cy="114" rx="9" ry="6" fill="${INK}"/>` : `<path d="M122 116 L134 116 L128 122Z" fill="${INK}"/>`;
    return {
      back: tail(L.tail, c),
      body: `<ellipse cx="106" cy="228" rx="20" ry="11" fill="${c2}" ${O}/><ellipse cx="150" cy="228" rx="20" ry="11" fill="${c2}" ${O}/>
        <ellipse cx="128" cy="186" rx="48" ry="42" fill="${c}" ${O}/><ellipse cx="128" cy="194" rx="28" ry="26" fill="${c2}"/>
        ${pattern(L.pat, 128, 186, 48, 42, c)}
        <circle cx="78" cy="176" r="16" fill="${c2}" ${O}/><circle cx="180" cy="176" r="16" fill="${c2}" ${O}/>
        ${ears}<ellipse cx="128" cy="100" rx="64" ry="54" fill="${c}" ${O}/>${shine(98, 72, 15, 7)}${L.snout ? snout : ''}`,
      after: L.snout ? '' : snout,
      head: { x: 128, y: 96, r: 56 }, hand: { x: 182, y: 176 }, wing: { x: 128, y: 160 },
    };
  },
  ghost(L, c) {
    const c2 = light(c, 0.5);
    const hair = L.hair === 'long' ? `<path d="M70 96 Q60 40 128 34 Q196 40 186 96 Q196 160 176 200 L156 120 Q128 70 100 120 L80 200 Q60 160 70 96Z" fill="${dark(c, 0.55)}" ${O}/>` : '';
    return {
      back: hair,
      body: `<path d="M64 120 Q60 36 128 34 Q196 36 192 120 L198 220 Q186 206 174 224 Q160 206 148 226 Q136 206 124 226 Q110 206 98 224 Q86 206 72 222 Q66 180 64 120Z" fill="${c}" ${O}/>
        <path d="M80 200 Q100 190 116 204" stroke="${c2}" stroke-width="6" fill="none" stroke-linecap="round"/>${shine(92, 66, 18, 9)}
        <path d="M60 150 Q34 150 30 128 M196 150 Q222 150 226 128" ${O} fill="none"/>
        <circle cx="30" cy="124" r="10" fill="${c}" ${O4}/><circle cx="226" cy="124" r="10" fill="${c}" ${O4}/>`,
      head: { x: 128, y: 104, r: 58 }, hand: { x: 214, y: 150 }, wing: { x: 128, y: 130 },
    };
  },
  human(L, c, rnd) {
    const skin = L.skin === 'c' ? light(c, 0.15) : ['#ffe0c4', '#f4c8a0', '#d8a070', '#a87050'][Math.floor(rnd() * 4)];
    const robe = L.skin === 'c' ? dark(c, 0.35) : c;
    const hc = lum(c) > 0.7 ? '#2a1a2a' : ['#2a1a2a', '#5a3a2a', dark(c, 0.5), '#e8e0d0'][Math.floor(rnd() * 4)];
    const hairs = {
      short: `<path d="M74 100 Q70 44 128 40 Q186 44 182 100 Q170 70 150 66 L140 80 L128 64 L116 80 L106 66 Q86 70 74 100Z" fill="${hc}" ${O}/>`,
      spiky: `<path d="M72 100 L62 54 L88 72 L92 30 L112 60 L128 20 L144 60 L164 30 L168 72 L194 54 L184 100 Q172 68 128 66 Q84 68 72 100Z" fill="${hc}" ${O}/>`,
      long: `<path d="M72 100 Q66 40 128 38 Q190 40 184 100 Q170 70 128 70 Q86 70 72 100Z" fill="${hc}" ${O}/>`,
      bob: `<path d="M70 120 Q60 40 128 38 Q196 40 186 120 L170 120 Q172 80 150 74 Q128 90 106 74 Q84 80 86 120Z" fill="${hc}" ${O}/>`,
      bun: `<circle cx="128" cy="38" r="20" fill="${hc}" ${O}/><path d="M74 100 Q70 50 128 48 Q186 50 182 100 Q170 74 128 72 Q86 74 74 100Z" fill="${hc}" ${O}/>`,
      snake: [0, 1, 2, 3, 4].map(i => { const x = 76 + i * 26; return `<path d="M${x} 70 Q${x - 18} 30 ${x + 4} 14" stroke="${INK}" stroke-width="16" fill="none" stroke-linecap="round"/><path d="M${x} 70 Q${x - 18} 30 ${x + 4} 14" stroke="#6ab06a" stroke-width="9" fill="none" stroke-linecap="round"/><circle cx="${x + 4}" cy="14" r="5" fill="#ffe14a"/>`; }).join('') + `<path d="M74 100 Q70 52 128 50 Q186 52 182 100 Q170 74 128 72 Q86 74 74 100Z" fill="#4a8a4a" ${O}/>`,
      bald: '',
    };
    const backHair = L.hair === 'long' ? `<path d="M74 100 Q66 170 60 206 L96 206 Q86 160 90 110Z M182 100 Q190 170 196 206 L160 206 Q170 160 166 110Z" fill="${hc}" ${O}/>` : '';
    return {
      back: backHair,
      body: `<path d="M84 230 L94 140 L162 140 L172 230Z" fill="${robe}" ${O}/>
        <path d="M100 140 L128 176 L156 140" stroke="${light(robe, 0.5)}" stroke-width="8" fill="none"/>
        <path d="M96 200 L160 200" stroke="${dark(robe, 0.3)}" stroke-width="9"/>
        ${pattern(L.pat, 128, 184, 40, 44, robe)}
        <circle cx="76" cy="176" r="15" fill="${skin}" ${O}/><circle cx="182" cy="172" r="15" fill="${skin}" ${O}/>
        <ellipse cx="128" cy="100" rx="52" ry="50" fill="${skin}" ${O}/>
        ${pattern(L.pat === 'bandage' ? 'bandage' : '', 128, 96, 50, 46, skin)}
        ${hairs[L.hair || 'short'] || ''}`,
      head: { x: 128, y: 104, r: 50 }, hand: { x: 182, y: 172 }, wing: { x: 128, y: 150 },
    };
  },
  blob(L, c) {
    return {
      back: '',
      body: `<path d="M40 226 Q28 120 128 86 Q228 120 216 226 Q200 236 128 236 Q56 236 40 226Z" fill="${c}" ${O}/>
        <path d="M60 210 Q56 150 96 120" stroke="${light(c, 0.5)}" stroke-width="10" fill="none" stroke-linecap="round" opacity="0.7"/>
        ${pattern(L.pat, 128, 190, 70, 40, c)}
        <path d="M190 200 Q200 222 196 236" stroke="${c}" stroke-width="12" stroke-linecap="round"/>`,
      head: { x: 128, y: 168, r: 58 }, hand: { x: 200, y: 184 }, wing: { x: 128, y: 150 }, hatY: 104,
    };
  },
  bird(L, c) {
    const c2 = light(c, 0.5);
    return {
      back: `<path d="M110 214 L90 240 M146 214 L166 240" stroke="#e8a030" stroke-width="7" stroke-linecap="round"/>`,
      body: `<path d="M100 210 L92 236 M128 214 L128 238 M156 210 L164 236" stroke="#e8a030" stroke-width="7" stroke-linecap="round"/>
        <ellipse cx="128" cy="150" rx="66" ry="72" fill="${c}" ${O}/><ellipse cx="128" cy="176" rx="40" ry="40" fill="${c2}"/>
        ${pattern(L.pat, 128, 170, 40, 40, c2)}
        <path d="M64 150 Q20 140 26 190 Q50 174 70 186Z M192 150 Q236 140 230 190 Q206 174 186 186Z" fill="${dark(c, 0.15)}" ${O}/>
        <path d="M112 54 Q110 24 126 40 Q132 16 140 44" fill="${dark(c, 0.2)}" ${O4}/>
        <path d="M112 116 L144 116 L128 140Z" fill="#ffb030" ${O}/>${shine(94, 104, 16, 8)}`,
      head: { x: 128, y: 102, r: 54 }, hand: { x: 200, y: 160 }, wing: { x: 128, y: 140 }, noMouth: true,
    };
  },
  skull(L, c) {
    return {
      back: '',
      body: `<path d="M88 230 L94 150 L162 150 L168 230Z" fill="#3a3a4a" ${O}/>
        ${[0, 1, 2].map(i => `<path d="M100 ${166 + i * 18} Q128 ${174 + i * 18} 156 ${166 + i * 18}" stroke="${c}" stroke-width="7" fill="none" stroke-linecap="round"/>`).join('')}
        <path d="M128 152 L128 228" stroke="${c}" stroke-width="7"/>
        <circle cx="76" cy="176" r="14" fill="${c}" ${O}/><circle cx="182" cy="172" r="14" fill="${c}" ${O}/>
        <ellipse cx="128" cy="98" rx="58" ry="54" fill="${c}" ${O}/>
        <ellipse cx="104" cy="100" rx="17" ry="19" fill="${INK}"/><ellipse cx="152" cy="100" rx="17" ry="19" fill="${INK}"/>
        <circle cx="104" cy="102" r="7" fill="${L.eyes === 'angry' ? '#ff4a3a' : '#7ad8ff'}"/><circle cx="152" cy="102" r="7" fill="${L.eyes === 'angry' ? '#ff4a3a' : '#7ad8ff'}"/>
        <path d="M122 124 L128 114 L134 124Z" fill="${INK}"/>
        <path d="M98 140 L158 140 M108 134 L108 146 M120 134 L120 148 M132 134 L132 148 M144 134 L144 146" stroke="${INK}" stroke-width="4"/>`,
      head: { x: 128, y: 100, r: 56 }, hand: { x: 182, y: 172 }, wing: { x: 128, y: 150 }, noFace: true,
    };
  },
  dragon(L, c) {
    const c2 = light(c, 0.5);
    return {
      back: `<path d="M150 210 C210 220 236 180 226 140 C220 122 206 128 212 144 C220 170 200 196 156 194Z" fill="${c}" ${O}/><path d="M222 132 L236 116 L238 140Z" fill="${c2}" ${O4}/>`,
      body: `<ellipse cx="108" cy="228" rx="20" ry="11" fill="${dark(c, 0.15)}" ${O}/><ellipse cx="150" cy="228" rx="20" ry="11" fill="${dark(c, 0.15)}" ${O}/>
        <ellipse cx="128" cy="184" rx="50" ry="46" fill="${c}" ${O}/>
        <ellipse cx="128" cy="192" rx="28" ry="34" fill="${c2}"/>
        ${[0, 1, 2, 3].map(i => `<path d="M106 ${170 + i * 14} Q128 ${176 + i * 14} 150 ${170 + i * 14}" stroke="${dark(c2, 0.15)}" stroke-width="3" fill="none"/>`).join('')}
        ${pattern(L.pat, 128, 184, 50, 46, c)}
        <circle cx="78" cy="176" r="15" fill="${c}" ${O}/><circle cx="180" cy="172" r="15" fill="${c}" ${O}/>
        ${[-1, 1].map(s => `<path d="M${128 + s * 30} 58 Q${128 + s * 46} 20 ${128 + s * 64} 26 Q${128 + s * 50} 40 ${128 + s * 48} 66Z" fill="#f6e6b0" ${O}/>`).join('')}
        <path d="M84 68 L76 50 L92 60 M172 68 L180 50 L164 60" ${O4} fill="${c2}"/>
        <ellipse cx="128" cy="100" rx="60" ry="50" fill="${c}" ${O}/>
        <ellipse cx="128" cy="128" rx="34" ry="20" fill="${c2}" ${O4}/>
        <circle cx="116" cy="122" r="4" fill="${INK}"/><circle cx="140" cy="122" r="4" fill="${INK}"/>${shine(96, 74, 15, 7)}`,
      head: { x: 128, y: 92, r: 54 }, hand: { x: 180, y: 172 }, wing: { x: 128, y: 150 }, noMouth: true,
    };
  },
  object(L, c) {
    const kinds = {
      sandal: `<rect x="50" y="200" width="156" height="32" rx="12" fill="${dark(c, 0.3)}" ${O}/><rect x="46" y="70" width="164" height="136" rx="40" fill="${c}" ${O}/><path d="M128 70 L80 130 M128 70 L176 130" stroke="#c83a3a" stroke-width="10" stroke-linecap="round"/>`,
      kettle: `<path d="M90 66 Q128 36 166 66" stroke="${INK}" stroke-width="10" fill="none"/><ellipse cx="128" cy="76" rx="40" ry="12" fill="${dark(c, 0.2)}" ${O}/><path d="M56 150 Q56 80 128 80 Q200 80 200 150 Q200 230 128 230 Q56 230 56 150Z" fill="${c}" ${O}/><path d="M196 140 Q236 130 236 100" stroke="${c}" stroke-width="18" stroke-linecap="round"/><path d="M196 140 Q236 130 236 100" stroke="${INK}" stroke-width="3" fill="none"/><path d="M60 196 Q128 212 196 196" stroke="${dark(c, 0.3)}" stroke-width="6" fill="none"/>`,
      mirror: `<rect x="112" y="196" width="32" height="40" rx="8" fill="#a0703a" ${O}/><circle cx="128" cy="130" r="82" fill="#ffd23a" ${O}/><circle cx="128" cy="130" r="66" fill="${c}" ${O4}/><path d="M86 110 Q100 80 130 72" stroke="#fff" stroke-width="10" opacity="0.6" fill="none" stroke-linecap="round"/>`,
      drum: `<path d="M50 100 L50 200 Q128 236 206 200 L206 100Z" fill="${c}" ${O}/><ellipse cx="128" cy="100" rx="78" ry="26" fill="#f4e8d0" ${O}/>${[60, 90, 120, 150, 180].map(x => `<circle cx="${x + 8}" cy="${x === 60 || x === 180 ? 170 : 180}" r="5" fill="#ffd23a" ${O4}/>`).join('')}`,
      lamp: `<rect x="96" y="30" width="64" height="18" rx="6" fill="${INK}"/><rect x="96" y="214" width="64" height="18" rx="6" fill="${INK}"/><path d="M100 44 Q44 70 44 130 Q44 190 100 216 L156 216 Q212 190 212 130 Q212 70 156 44Z" fill="${c}" ${O}/><path d="M52 100 Q128 112 204 100 M48 160 Q128 172 208 160" stroke="${dark(c, 0.25)}" stroke-width="4" fill="none"/>`,
    };
    return {
      back: '', body: (kinds[L.kind] || kinds.lamp) + shine(90, 100, 16, 9),
      head: { x: 128, y: L.kind === 'sandal' ? 132 : L.kind === 'drum' ? 150 : 132, r: 54 }, hand: { x: 200, y: 160 }, wing: { x: 128, y: 140 },
    };
  },
  fish(L, c) {
    const c2 = light(c, 0.5);
    const hair = L.hair === 'long' ? `<path d="M66 110 Q56 40 128 34 Q200 40 190 110 Q200 170 180 200 L170 110 Q128 70 86 110 L76 200 Q56 170 66 110Z" fill="${dark(c, 0.45)}" ${O}/>` : '';
    return {
      back: hair + `<path d="M128 214 L84 244 L112 232 L128 244 L144 232 L172 244Z" fill="${dark(c, 0.2)}" ${O}/>`,
      body: `<path d="M128 26 Q206 60 206 140 Q206 214 128 222 Q50 214 50 140 Q50 60 128 26Z" fill="${c}" ${O}/>
        <ellipse cx="128" cy="170" rx="46" ry="40" fill="${c2}"/>
        ${[0, 1, 2].map(i => `<path d="M${100 + i * 20} 156 Q${110 + i * 20} 166 ${100 + i * 20} 176" stroke="${dark(c2, 0.15)}" stroke-width="3" fill="none"/>`).join('')}
        <path d="M52 140 Q18 150 26 182 Q44 166 60 172Z M204 140 Q238 150 230 182 Q212 166 196 172Z" fill="${dark(c, 0.15)}" ${O}/>
        <path d="M128 26 Q140 6 160 12 Q148 26 150 40" fill="${dark(c, 0.2)}" ${O4}/>${shine(92, 80, 18, 9)}
        ${L.hair ? '' : `<path d="M66 120 L44 112 M66 132 L44 136 M190 120 L212 112 M190 132 L212 136" stroke="${INK}" stroke-width="3"/>`}`,
      head: { x: 128, y: 108, r: 56 }, hand: { x: 206, y: 164 }, wing: { x: 128, y: 130 },
    };
  },
  plant(L, c) {
    const kinds = {
      mushroom: { s: `<rect x="92" y="130" width="72" height="100" rx="30" fill="#fff4e0" ${O}/><path d="M24 140 Q20 40 128 30 Q236 40 232 140 Q128 160 24 140Z" fill="${c}" ${O}/>${[[70, 90, 14], [128, 60, 12], [186, 92, 14], [100, 120, 9], [160, 122, 9]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" ${O4}/>`).join('')}`, head: { x: 128, y: 184, r: 40 } },
      tree: { s: `<rect x="96" y="120" width="64" height="112" rx="16" fill="#8a5a3a" ${O}/><path d="M96 230 Q60 236 50 222 M160 230 Q196 236 206 222" ${O} fill="none"/>${[[80, 80, 46], [176, 80, 46], [128, 50, 52], [128, 104, 50]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" ${O}/>`).join('')}${[[80, 80, 46], [176, 80, 46], [128, 50, 52], [128, 104, 50]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r - 4}" fill="${c}"/>`).join('')}`, head: { x: 128, y: 170, r: 36 } },
      pumpkin: { s: `<path d="M128 56 Q124 30 140 20" stroke="#3a8a3a" stroke-width="12" fill="none" stroke-linecap="round"/><path d="M140 30 Q170 20 176 44 Q150 50 140 30Z" fill="#5ad05a" ${O4}/>${[-50, -25, 0, 25, 50].map(dx => `<ellipse cx="${128 + dx}" cy="150" rx="${54 - Math.abs(dx) * 0.4}" ry="82" fill="${c}" ${O}/>`).join('')}<ellipse cx="128" cy="150" rx="40" ry="82" fill="${c}" ${O}/>`, head: { x: 128, y: 146, r: 60 } },
      flower: { s: `<path d="M128 150 L128 232" stroke="#3a8a3a" stroke-width="12"/><path d="M128 200 Q90 180 80 200 Q100 214 128 204Z" fill="#5ad05a" ${O4}/>${Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; return `<ellipse cx="${128 + Math.cos(a) * 62}" cy="${100 + Math.sin(a) * 62}" rx="30" ry="22" fill="${c}" ${O4} transform="rotate(${(a * 180) / Math.PI} ${128 + Math.cos(a) * 62} ${100 + Math.sin(a) * 62})"/>`; }).join('')}<circle cx="128" cy="100" r="52" fill="#ffe680" ${O}/>`, head: { x: 128, y: 100, r: 50 } },
    };
    const k = kinds[L.kind] || kinds.flower;
    return { back: '', body: k.s, head: k.head, hand: { x: 196, y: 180 }, wing: { x: 128, y: 140 }, hatY: 20 };
  },
  golem(L, c) {
    const d = dark(c, 0.3);
    return {
      back: '',
      body: `<rect x="78" y="200" width="40" height="34" rx="10" fill="${d}" ${O}/><rect x="138" y="200" width="40" height="34" rx="10" fill="${d}" ${O}/>
        <rect x="50" y="122" width="156" height="94" rx="22" fill="${c}" ${O}/>
        <path d="M70 150 L100 160 L96 190 M160 140 L180 170 L150 196" stroke="${d}" stroke-width="5" fill="none"/>
        <rect x="14" y="128" width="44" height="70" rx="18" fill="${c}" ${O}/><rect x="198" y="128" width="44" height="70" rx="18" fill="${c}" ${O}/>
        <rect x="70" y="44" width="116" height="96" rx="26" fill="${c}" ${O}/>
        <path d="M84 60 L100 76 M170 62 L160 82" stroke="${d}" stroke-width="5"/>${shine(96, 62, 18, 8)}`,
      head: { x: 128, y: 94, r: 50 }, hand: { x: 220, y: 166 }, wing: { x: 128, y: 140 },
    };
  },
  bug(L, c) {
    const legs = L.eyes === 'many' ? 4 : 3;
    let ls = '';
    for (let i = 0; i < legs; i++) for (const s of [-1, 1]) ls += `<path d="M${128 + s * 40} ${160 + i * 22} Q${128 + s * 84} ${140 + i * 26} ${128 + s * 96} ${190 + i * 16}" stroke="${INK}" stroke-width="7" fill="none" stroke-linecap="round"/>`;
    return {
      back: ls,
      body: `<ellipse cx="128" cy="182" rx="58" ry="52" fill="${c}" ${O}/>
        <path d="M128 132 L128 232" stroke="${dark(c, 0.35)}" stroke-width="5"/>
        ${pattern(L.pat, 128, 182, 58, 52, c)}${shine(98, 160, 16, 8)}
        <path d="M100 66 Q86 24 66 20 M156 66 Q170 24 190 20" stroke="${INK}" stroke-width="6" fill="none" stroke-linecap="round"/>
        <circle cx="66" cy="20" r="9" fill="${light(c, 0.4)}" ${O4}/><circle cx="190" cy="20" r="9" fill="${light(c, 0.4)}" ${O4}/>
        <ellipse cx="128" cy="96" rx="54" ry="46" fill="${dark(c, 0.15)}" ${O}/>`,
      head: { x: 128, y: 96, r: 50 }, hand: { x: 196, y: 172 }, wing: { x: 128, y: 150 },
    };
  },
};

function drawYokai(y) {
  const L = parseLook(y.look);
  const rnd = seeded(y.id);
  const c = y.color;
  const b = (BODY[L.t] || BODY.blob)(L, c, rnd);
  const h = b.head;
  const iris = lum(c) > 0.75 ? '#3a5ab0' : INK;
  const a = aura(y.rank, c);
  // 頭の上の飾り（帽子・ツノ）は顔の上に重ねる
  const hy = b.hatY ? b.hatY + h.r * 0.85 : h.y;
  const top = horns(L.horns, h.x, hy, h.r) + hat(L.hat, h.x, hy, h.r, c);
  const faceSvg = b.noFace ? '' : b.noMouth ? eyes(L, h.x, h.y, h.r, iris) + (L.eyes === 'angry' ? '' : blush(h.x, h.y, h.r)) : face(L, h.x, h.y, h.r, iris);
  const body = `${a.back}<ellipse cx="128" cy="238" rx="60" ry="10" fill="#000" opacity="0.25"/>
    ${wings(L.wings, b.wing.x, b.wing.y, c)}${b.back}${b.body}${b.after || ''}${faceSvg}${top}
    ${weapon(L.acc, b.hand.x, b.hand.y, c)}${effects(L.fx, rnd)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><defs>${a.defs}</defs>${body}</svg>`;
}

module.exports = { drawYokai };
