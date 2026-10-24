// 妖怪の絵を「体の形＋飾り」の組み合わせで描く（public/yokai.js の look 指定を使う）
// 256×256、足元が y≈236。つり目・牙・着物・属性の色に光る目で、かっこいい妖怪の絵柄にそろえている。
const Attacks = require('../public/attacks.js');

const INK = '#140a14';
const W = 5.5;
const LINE = `stroke="${INK}" stroke-width="${W}" stroke-linejoin="round" stroke-linecap="round"`;
const THIN = `stroke="${INK}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"`;

// ---------- 色の計算 ----------
function hex(c) { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function toHex([r, g, b]) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
const dark = (c, t = 0.35) => mix(c, '#000000', t);
const light = (c, t = 0.45) => mix(c, '#ffffff', t);
const lum = c => { const [r, g, b] = hex(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
// 影の色: 暗くして少し青紫に寄せる（アニメ塗り）
const shade = (c, t = 0.38) => mix(dark(c, t), '#2a1a5a', 0.18);

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
const ell = (cx, cy, rx, ry) => `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
const mirrorX = d => d.replace(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g, (m, x, y) => `${+(256 - +x).toFixed(1)} ${y}`);
const both = (d, f) => f(d) + f(mirrorX(d));

// ---------- 描く道具 ----------
// アニメ塗り: 形を影色で塗り、左上にずらした同じ形で明るい色を重ねる（右下に影ができる）
function makeKit() {
  let n = 0;
  const defs = [];
  const cel = (d, fill, o = {}) => {
    const id = 'c' + (n++);
    const dx = o.dx ?? 9, dy = o.dy ?? 7;
    defs.push(`<clipPath id="${id}"><path d="${d}"/></clipPath>`);
    return `<path d="${d}" fill="${o.sh || shade(fill)}"/>
      <g clip-path="url(#${id})"><path d="${d}" fill="${fill}" transform="translate(${-dx} ${-dy})"/>
      ${o.rim === false ? '' : `<path d="${d}" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="5" transform="translate(${dx * 0.35} ${dy * 0.35})"/>`}</g>
      <path d="${d}" fill="none" ${o.thin ? THIN : LINE}/>`;
  };
  const flat = (d, fill, thin) => `<path d="${d}" fill="${fill}" ${thin ? THIN : LINE}/>`;
  const grad = (stops, o = {}) => {
    const id = 'g' + (n++);
    defs.push(`<radialGradient id="${id}" cx="${o.cx ?? 0.5}" cy="${o.cy ?? 0.5}" r="${o.r ?? 0.5}">${stops.map(([off, c, op]) => `<stop offset="${off}" stop-color="${c}" stop-opacity="${op ?? 1}"/>`).join('')}</radialGradient>`);
    return `url(#${id})`;
  };
  return { cel, flat, grad, defs };
}

// ---------- 顔 ----------
// つり目（形はアーモンド、虹彩は属性の色に光り、瞳は縦長）
function eye(cx, cy, s, glowC, o = {}) {
  const w = (o.w || 11) * (o.k || 1), h = (o.h || 5.5) * (o.k || 1);
  const ix = cx - s * w, ox = cx + s * w, iy = cy + 2, oy = cy - 3;
  const top = `M${ix} ${iy} Q${cx} ${cy - h * 2} ${ox} ${oy}`;
  const d = `${top} Q${cx + s * w * 0.2} ${cy + h * 1.6} ${ix} ${iy}Z`;
  let out = `<path d="${d}" fill="${glowC}"/>
    <ellipse cx="${cx + s * 1.5}" cy="${cy}" rx="${1.6 * (o.k || 1)}" ry="${h * 0.9}" fill="${INK}"/>
    <circle cx="${cx - s * 3}" cy="${cy - 2}" r="${1.7 * (o.k || 1)}" fill="#fff"/>`;
  if (o.lid) out += `<path d="M${ix} ${iy} Q${cx} ${cy - h * 2} ${ox} ${oy} Q${cx} ${cy - h * 0.2} ${ix} ${iy}Z" fill="${o.lid}"/>`;
  out += `<path d="${top} L${ox + s * 5} ${oy - 4}" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;
  out += `<path d="${d}" fill="none" ${THIN}/>`;
  return out;
}
function face(L, h, glowC, rnd, o = {}) {
  const { x, y } = h;
  const sp = h.eyeSp || 17, k = h.eyeK || 1;
  const kind = L.eyes || 'normal';
  const angry = kind === 'angry';
  let s = '';
  const pair = (yy, kk, extra = {}) => [-1, 1].map(sd => eye(x + sd * sp * kk, yy, sd, glowC, { k: kk * k, ...extra })).join('');
  const brows = (yy, kk = 1) => h.noBrow ? '' : [-1, 1].map(sd => `<path d="M${x + sd * 6 * kk} ${yy + (angry ? 2 : 0)} L${x + sd * 29 * kk * k} ${yy - (angry ? 8 : 5)}" stroke="${INK}" stroke-width="${angry ? 5 : 4}" stroke-linecap="round"/>`).join('');
  switch (kind) {
    case 'none':
      // のっぺらぼう: つるんとした顔に、うっすら裂け目
      s += `<path d="M${x - 10} ${y + 2} Q${x} ${y - 2} ${x + 10} ${y + 2}" stroke="${INK}" stroke-width="2" opacity="0.35" fill="none"/>`;
      break;
    case 'one':
      s += `<path d="${ell(x, y, 15 * k, 12 * k)}" fill="#fff8e0"/><circle cx="${x}" cy="${y}" r="${9 * k}" fill="${glowC}"/>
        <ellipse cx="${x}" cy="${y}" rx="${2.6 * k}" ry="${8 * k}" fill="${INK}"/><circle cx="${x - 4 * k}" cy="${y - 4 * k}" r="${2.4 * k}" fill="#fff"/>
        <path d="${ell(x, y, 15 * k, 12 * k)}" fill="none" ${LINE}/>
        <path d="M${x - 18 * k} ${y - 16 * k} L${x + 18 * k} ${y - 12 * k}" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;
      break;
    case 'many':
      s += pair(y, 1) + brows(y - 11);
      s += eye(x, y - 18, 1, glowC, { k: 0.6 * k, w: 9 });
      s += eye(x - 26 * k, y - 14, -1, glowC, { k: 0.45 * k }) + eye(x + 26 * k, y - 14, 1, glowC, { k: 0.45 * k });
      break;
    case 'sleepy':
      // 半目: 上まぶたが重く、眠そうで不気味
      s += pair(y, 1, { lid: shade(h.skin || '#888', 0.3) }) + brows(y - 9);
      break;
    default:
      s += pair(y, 1) + brows(y - 11);
  }
  if (!h.noMouth && kind !== 'none') {
    const my = y + (h.mouthY || 24);
    if (angry || h.fangs) s += `<path d="M${x - 12} ${my - 2} Q${x} ${my + 7} ${x + 12} ${my - 2} Q${x} ${my + 2} ${x - 12} ${my - 2}Z" fill="#3a0010" ${THIN}/>
      <path d="M${x - 8} ${my} L${x - 5} ${my + 7} L${x - 3} ${my + 1}Z M${x + 8} ${my} L${x + 5} ${my + 7} L${x + 3} ${my + 1}Z" fill="#fff" stroke="${INK}" stroke-width="1.5"/>`;
    else s += `<path d="M${x - 9} ${my} Q${x - 2} ${my + 3} ${x + 9} ${my - 3}" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M${x + 4} ${my - 1} L${x + 6} ${my + 5} L${x + 8} ${my - 2}Z" fill="#fff" stroke="${INK}" stroke-width="1.5"/>`;
  }
  // 隈取り（歌舞伎のような赤い線）
  if (h.kuma && kind !== 'none') s += [-1, 1].map(sd => `<path d="M${x + sd * (sp + 13) * k} ${y - 4} Q${x + sd * (sp + 20) * k} ${y + 8} ${x + sd * (sp + 8) * k} ${y + 16}" stroke="${h.kuma}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`).join('');
  return s;
}

// ---------- 飾り ----------
function horns(kit, kind, h) {
  const { x } = h, t = h.top;
  switch (kind) {
    case 'oni': return both(`M${x - 22} ${t + 14} Q${x - 30} ${t - 10} ${x - 40} ${t - 26} Q${x - 22} ${t - 18} ${x - 10} ${t + 6}Z`, d => kit.cel(d, '#f2e6c2', { dx: 4, dy: 3, thin: true }));
    case 'goat': return both(`M${x - 22} ${t + 16} Q${x - 40} ${t - 22} ${x - 66} ${t - 2} Q${x - 70} ${t + 22} ${x - 54} ${t + 34} Q${x - 56} ${t + 12} ${x - 46} ${t + 6} Q${x - 34} ${t + 4} ${x - 12} ${t + 22}Z`, d => kit.cel(d, '#7a6458', { dx: 4, dy: 4, thin: true }));
    case 'unicorn': return kit.cel(`M${x - 8} ${t + 12} L${x} ${t - 46} L${x + 8} ${t + 12}Z`, '#ffe680', { dx: 3, dy: 2, thin: true }) + `<path d="M${x - 6} ${t - 2} L${x + 6} ${t - 8} M${x - 4} ${t - 18} L${x + 4} ${t - 24}" stroke="${INK}" stroke-width="2"/>`;
    case 'antler': return both(`M${x - 20} ${t + 14} L${x - 34} ${t - 26} M${x - 28} ${t - 8} L${x - 52} ${t - 18} M${x - 32} ${t - 18} L${x - 24} ${t - 44} M${x - 44} ${t - 15} L${x - 54} ${t - 36}`, d => `<path d="${d}" stroke="${INK}" stroke-width="11" stroke-linecap="round" fill="none"/><path d="${d}" stroke="#c8a070" stroke-width="5" stroke-linecap="round" fill="none"/>`);
    default: return '';
  }
}

function hat(kit, kind, h, c) {
  const { x } = h, t = h.top, r = h.r;
  switch (kind) {
    case 'witch': return kit.cel(`M${x - r * 1.5} ${t + 22} Q${x} ${t + 4} ${x + r * 1.5} ${t + 22} Q${x} ${t + 36} ${x - r * 1.5} ${t + 22}Z`, '#2a1e44') + kit.cel(`M${x - r * 0.75} ${t + 20} Q${x - 10} ${t - 30} ${x + 30} ${t - 70} Q${x + 40} ${t - 30} ${x + r * 0.75} ${t + 20}Z`, '#2a1e44') + `<path d="M${x - r * 0.72} ${t + 12} Q${x} ${t + 4} ${x + r * 0.72} ${t + 12}" stroke="#c8242a" stroke-width="7" fill="none"/>`;
    case 'crown': return kit.cel(`M${x - r * 0.7} ${t + 14} L${x - r * 0.8} ${t - 18} L${x - r * 0.35} ${t - 2} L${x} ${t - 32} L${x + r * 0.35} ${t - 2} L${x + r * 0.8} ${t - 18} L${x + r * 0.7} ${t + 14}Z`, '#ffcc33', { dx: 4, dy: 3 }) + `<path d="M${x} ${t - 2} L${x + 6} ${t + 6} L${x} ${t + 12} L${x - 6} ${t + 6}Z" fill="#c8242a" ${THIN}/>`;
    case 'hood': return kit.cel(`M${x - r * 1.25} ${h.y + r * 0.9} Q${x - r * 1.4} ${t - 30} ${x + 4} ${t - 34} Q${x + r * 1.4} ${t - 24} ${x + r * 1.25} ${h.y + r * 0.9} Q${x + r * 0.95} ${h.y - r * 0.2} ${x} ${h.y - r * 0.55} Q${x - r * 0.95} ${h.y - r * 0.2} ${x - r * 1.25} ${h.y + r * 0.9}Z`, dark(c, 0.3));
    case 'helmet': return kit.cel(`M${x - r * 1.08} ${h.y} Q${x - r * 1.1} ${t - 22} ${x} ${t - 24} Q${x + r * 1.1} ${t - 22} ${x + r * 1.08} ${h.y} L${x + r * 0.8} ${h.y - r * 0.32} L${x - r * 0.8} ${h.y - r * 0.32}Z`, '#7a8aa4') + both(`M${x - 8} ${t - 8} Q${x - 30} ${t - 30} ${x - 50} ${t - 40} Q${x - 30} ${t - 14} ${x - 18} ${t}Z`, d => kit.cel(d, '#ffcc33', { dx: 3, dy: 2, thin: true }));
    case 'turban': return kit.cel(`M${x - r * 1.05} ${t + 16} Q${x - r * 1.1} ${t - 22} ${x} ${t - 24} Q${x + r * 1.1} ${t - 22} ${x + r * 1.05} ${t + 16} Q${x} ${t + 4} ${x - r * 1.05} ${t + 16}Z`, '#ece4d0') + `<path d="M${x - r * 0.9} ${t + 4} Q${x} ${t - 18} ${x + r * 0.9} ${t + 4}" stroke="#c8b890" stroke-width="3" fill="none"/><path d="M${x} ${t - 14} L${x + 8} ${t - 4} L${x} ${t + 6} L${x - 8} ${t - 4}Z" fill="#2ab0d0" ${THIN}/>`;
    case 'pharaoh': return kit.cel(`M${x - r * 1.25} ${h.y + r * 1.3} L${x - r * 1.05} ${t + 6} Q${x} ${t - 26} ${x + r * 1.05} ${t + 6} L${x + r * 1.25} ${h.y + r * 1.3} L${x + r * 0.8} ${h.y + r * 1.3} L${x + r * 0.8} ${h.y - r * 0.4} L${x - r * 0.8} ${h.y - r * 0.4} L${x - r * 0.8} ${h.y + r * 1.3}Z`, '#2a4ab8') + `<path d="M${x - r} ${t + 22} L${x + r} ${t + 22} M${x - r * 1.15} ${h.y + r * 0.4} L${x - r * 0.8} ${h.y + r * 0.4} M${x + r * 1.15} ${h.y + r * 0.4} L${x + r * 0.8} ${h.y + r * 0.4}" stroke="#ffcc33" stroke-width="6"/>`;
    case 'straw': return kit.cel(`M${x - r * 1.7} ${t + 20} Q${x} ${t - 30} ${x + r * 1.7} ${t + 20} Q${x} ${t + 10} ${x - r * 1.7} ${t + 20}Z`, '#d8b860') + `<path d="M${x - r} ${t + 6} Q${x} ${t - 14} ${x + r} ${t + 6}" stroke="#8a6a2a" stroke-width="2" fill="none"/>`;
    case 'tokin': return kit.cel(`M${x - 14} ${t + 6} L${x + 14} ${t + 6} L${x + 10} ${t - 16} L${x - 10} ${t - 16}Z`, '#1a1a24', { dx: 3, dy: 2, thin: true });
    case 'top': return kit.cel(`M${x - r * 1.05} ${t + 12} Q${x} ${t} ${x + r * 1.05} ${t + 12} Q${x} ${t + 22} ${x - r * 1.05} ${t + 12}Z`, '#1a1a24') + kit.cel(`M${x - r * 0.6} ${t + 10} L${x - r * 0.65} ${t - 44} L${x + r * 0.65} ${t - 44} L${x + r * 0.6} ${t + 10}Z`, '#1a1a24') + `<path d="M${x - r * 0.62} ${t} L${x + r * 0.62} ${t}" stroke="#c8242a" stroke-width="8"/>`;
    case 'catears': return both(`M${x - 18} ${t + 10} L${x - 30} ${t - 26} L${x - 42} ${t + 22}Z`, d => kit.cel(d, c, { dx: 3, dy: 2, thin: true }));
    case 'circlet': return `<path d="M${x - r * 1.02} ${h.y - r * 0.5} Q${x} ${h.y - r * 0.95} ${x + r * 1.02} ${h.y - r * 0.5}" stroke="${INK}" stroke-width="9" fill="none"/><path d="M${x - r * 1.02} ${h.y - r * 0.5} Q${x} ${h.y - r * 0.95} ${x + r * 1.02} ${h.y - r * 0.5}" stroke="#ffcc33" stroke-width="5" fill="none"/>` + `<circle cx="${x}" cy="${h.y - r * 0.73}" r="6" fill="#ff3a3a" ${THIN}/>`;
    case 'dish': return kit.cel(ell(x, t + 6, r * 0.75, 9), '#d8f4ff', { dx: 3, dy: 2, thin: true }) + `<path d="${ell(x, t + 5, r * 0.5, 4.5)}" fill="#6ac8ff"/>`;
    default: return '';
  }
}

function wings(kit, kind, cx, cy, c) {
  switch (kind) {
    case 'bat': return both(`M${cx - 16} ${cy} Q${cx - 70} ${cy - 90} ${cx - 120} ${cy - 50} L${cx - 108} ${cy - 22} L${cx - 96} ${cy - 30} L${cx - 90} ${cy - 2} L${cx - 72} ${cy - 10} L${cx - 66} ${cy + 16} L${cx - 48} ${cy + 6} L${cx - 30} ${cy + 26}Z`, d => kit.cel(d, dark(c, 0.55), { rim: false }));
    case 'feather': return both(`M${cx - 14} ${cy + 10} Q${cx - 50} ${cy - 90} ${cx - 122} ${cy - 66} L${cx - 104} ${cy - 50} L${cx - 120} ${cy - 36} L${cx - 98} ${cy - 24} L${cx - 112} ${cy - 8} L${cx - 88} ${cy} L${cx - 96} ${cy + 18} L${cx - 70} ${cy + 18} L${cx - 70} ${cy + 36} L${cx - 46} ${cy + 30} L${cx - 28} ${cy + 44}Z`, d => kit.cel(d, lum(c) > 0.6 ? '#f4f0ec' : dark(c, 0.55)));
    case 'fairy': return both(`M${cx - 10} ${cy} Q${cx - 70} ${cy - 90} ${cx - 104} ${cy - 50} Q${cx - 90} ${cy - 10} ${cx - 10} ${cy}Z M${cx - 10} ${cy + 6} Q${cx - 70} ${cy + 20} ${cx - 76} ${cy + 50} Q${cx - 40} ${cy + 50} ${cx - 10} ${cy + 6}Z`, d => `<path d="${d}" fill="#d8f4ff" fill-opacity="0.7" ${THIN}/>`);
    default: return '';
  }
}

function tail(kit, kind, c, tip) {
  if (!kind || kind === 'none') return '';
  if (kind === 'thin') return `<path d="M108 210 C60 220 40 180 54 140 C60 124 48 110 40 116" stroke="${INK}" stroke-width="15" fill="none" stroke-linecap="round"/><path d="M108 210 C60 220 40 180 54 140 C60 124 48 110 40 116" stroke="${c}" stroke-width="7" fill="none" stroke-linecap="round"/>`;
  if (kind === 'fluffy') return kit.cel(`M110 204 C50 218 18 170 34 120 L44 136 L50 110 L60 132 Q64 170 112 186Z`, c) + `<path d="M34 120 L44 136 L50 110 L54 124 Q44 122 34 120Z" fill="${tip}"/>`;
  const n = Math.min(9, +kind.split(':')[1] || 2);
  let s = '';
  for (let i = 0; i < n; i++) {
    // 腰から扇のように広がる、炎のような毛束
    const deg = n === 2 ? (i ? -40 : -140) : -170 + (i / (n - 1)) * 160;
    s += `<g transform="rotate(${deg} 128 196)">${kit.cel(`M146 196 Q190 170 234 180 L222 190 L246 196 L222 204 L232 214 Q190 222 146 196Z`, c, { dx: 4, dy: 4, thin: true })}<path d="M222 190 L246 196 L222 204 L232 214 Q226 200 222 190Z" fill="${tip}"/></g>`;
  }
  return s;
}

function weapon(kit, kind, x, y, c, glowC) {
  switch (kind) {
    case 'sword': return `<g transform="rotate(28 ${x} ${y})">${kit.cel(`M${x - 4} ${y - 14} L${x - 5} ${y - 128} Q${x + 2} ${y - 140} ${x + 6} ${y - 128} L${x + 5} ${y - 14}Z`, '#e8f0ff', { dx: 2, dy: 0, thin: true })}
      <path d="M${x} ${y - 20} L${x + 1} ${y - 124}" stroke="${glowC}" stroke-width="2" opacity="0.8"/>
      ${kit.flat(ell(x, y - 12, 12, 4), '#ffcc33', true)}${kit.flat(`M${x - 4} ${y - 10} L${x - 4} ${y + 22} L${x + 4} ${y + 22} L${x + 4} ${y - 10}Z`, '#3a1a2a', true)}</g>`;
    case 'staff': return `<path d="M${x - 10} ${y + 50} L${x + 16} ${y - 96}" stroke="${INK}" stroke-width="11" stroke-linecap="round"/><path d="M${x - 10} ${y + 50} L${x + 16} ${y - 96}" stroke="#6a4028" stroke-width="5" stroke-linecap="round"/>
      ${kit.cel(`M${x + 16} ${y - 96} Q${x + 2} ${y - 112} ${x + 10} ${y - 128} Q${x + 24} ${y - 110} ${x + 34} ${y - 126} Q${x + 40} ${y - 104} ${x + 16} ${y - 96}Z`, '#c8a060', { dx: 2, dy: 2, thin: true })}
      <circle cx="${x + 19}" cy="${y - 112}" r="8" fill="${glowC}" ${THIN}/>`;
    case 'spear': return `<path d="M${x - 14} ${y + 50} L${x + 24} ${y - 100}" stroke="${INK}" stroke-width="10" stroke-linecap="round"/><path d="M${x - 14} ${y + 50} L${x + 24} ${y - 100}" stroke="#5a2a1a" stroke-width="4" stroke-linecap="round"/>
      ${kit.cel(`M${x + 18} ${y - 96} Q${x + 18} ${y - 120} ${x + 34} ${y - 146} Q${x + 38} ${y - 118} ${x + 30} ${y - 92}Z`, '#e8f0ff', { dx: 2, dy: 1, thin: true })}
      <path d="M${x + 18} ${y - 92} Q${x + 8} ${y - 84} ${x + 4} ${y - 70} M${x + 30} ${y - 90} Q${x + 36} ${y - 80} ${x + 30} ${y - 66}" stroke="#c8242a" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    case 'bow': return `<path d="M${x + 4} ${y - 86} Q${x + 48} ${y - 20} ${x + 4} ${y + 50}" stroke="${INK}" stroke-width="10" fill="none" stroke-linecap="round"/><path d="M${x + 4} ${y - 86} Q${x + 48} ${y - 20} ${x + 4} ${y + 50}" stroke="#2a1a1a" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M${x + 4} ${y - 86} L${x + 4} ${y + 50}" stroke="${glowC}" stroke-width="2"/>`;
    case 'hammer': return `<path d="M${x - 6} ${y + 30} L${x + 20} ${y - 60}" stroke="${INK}" stroke-width="12" stroke-linecap="round"/><path d="M${x - 6} ${y + 30} L${x + 20} ${y - 60}" stroke="#4a2a1a" stroke-width="5" stroke-linecap="round"/>
      <g transform="rotate(16 ${x + 24} ${y - 84})">${kit.cel(`M${x + 6} ${y - 60} L${x + 2} ${y - 110} Q${x + 24} ${y - 122} ${x + 46} ${y - 110} L${x + 42} ${y - 60} Q${x + 24} ${y - 52} ${x + 6} ${y - 60}Z`, '#3a3440')}
      ${[[12, -96], [36, -96], [24, -78], [12, -70], [36, -70]].map(([dx, dy]) => `<path d="M${x + dx - 4} ${y + dy} L${x + dx} ${y + dy - 7} L${x + dx + 4} ${y + dy}Z" fill="#c8c8d0" stroke="${INK}" stroke-width="1.5"/>`).join('')}</g>`;
    case 'fan': return kit.cel(`M${x} ${y} L${x - 30} ${y - 70} Q${x + 10} ${y - 104} ${x + 54} ${y - 76}Z`, '#2a2a3a') + `<path d="M${x} ${y} L${x - 8} ${y - 84} M${x} ${y} L${x + 20} ${y - 88} M${x} ${y} L${x + 42} ${y - 80}" stroke="#c8242a" stroke-width="2.5"/><circle cx="${x + 10}" cy="${y - 62}" r="10" fill="#c8242a" ${THIN}/>`;
    default: return '';
  }
}

// 属性・特徴のエフェクト（体のまわり）
function effects(kind, rnd, glowC) {
  const pts = [[34, 70], [224, 84], [26, 176], [230, 182]];
  return pts.map(([x, y], i) => {
    const s = 9 + rnd() * 6;
    switch (kind) {
      case 'fire': return `<path d="M${x} ${y + s} C${x - s * 1.1} ${y + s} ${x - s} ${y - s * 0.2} ${x - s * 0.2} ${y - s * 1.8} C${x} ${y - s * 0.6} ${x + s * 0.6} ${y - s} ${x + s * 0.5} ${y - s * 1.3} C${x + s * 1.2} ${y} ${x + s} ${y + s} ${x} ${y + s}Z" fill="${i % 2 ? '#ffb030' : '#ff4a1a'}" ${THIN}/><path d="M${x} ${y + s * 0.8} C${x - s * 0.4} ${y + s * 0.8} ${x - s * 0.4} ${y} ${x} ${y - s * 0.6} C${x + s * 0.4} ${y} ${x + s * 0.4} ${y + s * 0.8} ${x} ${y + s * 0.8}Z" fill="#fff2a0"/>`;
      case 'ice': return `<path d="M${x} ${y - s * 1.4} L${x + s * 0.5} ${y} L${x} ${y + s * 1.4} L${x - s * 0.5} ${y}Z" fill="#d8f4ff" ${THIN}/><path d="M${x - s} ${y - s * 0.6} L${x + s} ${y + s * 0.6} M${x + s} ${y - s * 0.6} L${x - s} ${y + s * 0.6}" stroke="#bfeaff" stroke-width="3" stroke-linecap="round"/>`;
      case 'leaf': return `<path d="M${x - s} ${y + s * 0.3} Q${x - s * 0.2} ${y - s * 1.3} ${x + s} ${y - s * 0.4} Q${x + s * 0.2} ${y + s * 1.1} ${x - s} ${y + s * 0.3}Z" fill="#5ac85a" ${THIN}/><path d="M${x - s} ${y + s * 0.3} L${x + s * 0.6} ${y - s * 0.3}" stroke="${INK}" stroke-width="1.5"/>`;
      case 'spark': return `<path d="M${x - s * 0.2} ${y - s * 1.6} L${x + s * 0.7} ${y - s * 0.2} L${x + s * 0.05} ${y - s * 0.1} L${x + s * 0.4} ${y + s * 1.6} L${x - s * 0.7} ${y + s * 0.1} L${x - s * 0.05} ${y}Z" fill="#fff27a" ${THIN}/>`;
      case 'star': return `<path d="M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s}Z" fill="#fff6c0" stroke="${INK}" stroke-width="2"/>`;
      default: return '';
    }
  }).join('');
}

function pattern(kind, cx, cy, rx, ry, c) {
  const d = shade(c, 0.45);
  switch (kind) {
    case 'stripes': return [-0.5, 0, 0.5].map(t => `<path d="M${cx - rx * 0.7} ${cy + ry * t - 4} L${cx - rx * 0.1} ${cy + ry * t + 6} L${cx - rx * 0.3} ${cy + ry * t - 2} L${cx + rx * 0.6} ${cy + ry * t + 2}" stroke="${d}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
    case 'spots': return [[-0.4, -0.3, 7], [0.35, -0.1, 6], [-0.1, 0.35, 7], [0.5, 0.45, 4]].map(([a, b, r]) => `<circle cx="${cx + rx * a}" cy="${cy + ry * b}" r="${r}" fill="${d}"/>`).join('');
    case 'bandage': return [-0.5, -0.1, 0.3, 0.65].map((t, i) => `<path d="M${cx - rx} ${cy + ry * t} L${cx + rx} ${cy + ry * t + (i % 2 ? 8 : -8)}" stroke="#d8ccb0" stroke-width="6"/><path d="M${cx - rx} ${cy + ry * t} L${cx + rx} ${cy + ry * t + (i % 2 ? 8 : -8)}" stroke="#a89878" stroke-width="1" opacity="0.6"/>`).join('');
    default: return '';
  }
}

// 背中の輪（雷太鼓・日輪）
function ring(kit, kind, glowC) {
  if (kind === 'drum') return `<circle cx="128" cy="112" r="92" fill="none" stroke="${INK}" stroke-width="12"/><circle cx="128" cy="112" r="92" fill="none" stroke="#a8242a" stroke-width="6"/>` +
    Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4 + 0.2; const x = 128 + Math.cos(a) * 92, y = 112 + Math.sin(a) * 92; return kit.cel(ell(x, y, 15, 15), '#d89a30', { dx: 3, dy: 3, thin: true }) + `<path d="M${x - 6} ${y - 3} Q${x} ${y - 9} ${x + 6} ${y - 3} M${x - 6} ${y + 4} Q${x} ${y - 2} ${x + 6} ${y + 4}" stroke="#a8242a" stroke-width="2" fill="none"/>`; }).join('');
  if (kind === 'sun') return `<circle cx="128" cy="100" r="96" fill="${kit.grad([[0.6, '#fff2a0', 0], [0.85, '#ffcc33', 0.9], [1, '#ff8a1a', 0]])}"/>` +
    Array.from({ length: 16 }, (_, i) => { const a = (i * Math.PI) / 8; return `<path d="M${128 + Math.cos(a - 0.06) * 80} ${100 + Math.sin(a - 0.06) * 80} L${128 + Math.cos(a) * 124} ${100 + Math.sin(a) * 124} L${128 + Math.cos(a + 0.06) * 80} ${100 + Math.sin(a + 0.06) * 80}Z" fill="#ffd84a" opacity="0.8"/>`; }).join('');
  return '';
}

// ランクのオーラ（C なし、B けむり、A 属性の炎、S 金色の炎）
function aura(kit, rank, glowC) {
  if (rank === 'C') return '';
  const flames = (n, r0, r1, col, op) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2, w = (Math.PI * 2 / n) * 0.42;
    const p = (ang, r) => `${(128 + Math.cos(ang) * r).toFixed(1)} ${(134 + Math.sin(ang) * r * 1.05).toFixed(1)}`;
    return `<path d="M${p(a - w, r0)} Q${p(a - w * 0.3, r1 * 0.85)} ${p(a + w * 0.4, r1)} Q${p(a + w * 0.2, r1 * 0.8)} ${p(a + w, r0)}Z" fill="${col}" opacity="${op}"/>`;
  }).join('');
  if (rank === 'L') {
    const rainbow = ['#ff4a4a', '#ff9a2a', '#ffe24a', '#4ae07a', '#3ac8ff', '#6a6aff', '#c85aff'];
    const multi = (n, r0, r1, op) => Array.from({ length: n }, (_, i) => flames(n, r0, r1, rainbow[i % rainbow.length], op).split('/>')[i] + '/>').join('');
    return `<circle cx="128" cy="130" r="127" fill="${kit.grad([[0.25, '#ffffff', 0.95], [0.55, '#ffe680', 0.6], [0.85, '#c85aff', 0.35], [1, '#3ac8ff', 0]])}"/>`
      + multi(21, 70, 128, 0.55) + flames(21, 62, 100, '#fff6c0', 0.35)
      + `<circle cx="128" cy="128" r="112" fill="none" stroke="#ffd23a" stroke-width="3" stroke-dasharray="2 9" opacity="0.9"/>`;
  }
  if (rank === 'B') return `<circle cx="128" cy="134" r="112" fill="${kit.grad([[0.45, glowC, 0.32], [1, glowC, 0]])}"/>`;
  if (rank === 'A') return `<circle cx="128" cy="134" r="122" fill="${kit.grad([[0.35, glowC, 0.55], [1, glowC, 0]])}"/>` + flames(14, 70, 122, glowC, 0.35);
  return `<circle cx="128" cy="130" r="126" fill="${kit.grad([[0.3, '#ffe680', 0.9], [0.75, '#ffa000', 0.45], [1, '#ff6a00', 0]])}"/>` + flames(18, 72, 126, '#ffcc33', 0.42) + flames(18, 60, 102, '#fff2a0', 0.28);
}

// ---------- 体の形 ----------
// 返り値: { back, body, front, head:{x,y,r,top,...}, hand:{x,y}, wing:{x,y} }
const ROBE_HEM = (y0, l, r, n = 7, amp = 10) => { // ぎざぎざに裂けた裾（右→左）
  let s = '';
  for (let i = 1; i <= n; i++) { const x = r - ((r - l) * i) / n; s += ` L${(x + (r - l) / n / 2).toFixed(1)} ${y0 + (i % 2 ? amp : 0)} L${x.toFixed(1)} ${y0}`; }
  return s;
};

// 人型の体（着物・袖・帯・爪のある手・脚）。頭は別に描く。
function humanoidBody(kit, L, c, rnd, o) {
  const robe = o.robe, trim = o.trim, skin = o.skin;
  const legs = both(`M104 214 L100 236 L120 236 L122 214Z`, d => kit.cel(d, o.legC || '#1e1a26', { dx: 3, dy: 2, thin: true }));
  const torso = `M96 128 Q128 118 160 128 L176 216${ROBE_HEM(216, 80, 176, 6, 12)} L80 216Z`;
  const sleeveL = `M98 132 Q70 136 58 178 L54 206 L68 194 L74 210 L84 196 Q92 172 104 156Z`;
  const claws = (x, y, s) => `<path d="M${x - 8} ${y} L${x - 10} ${y + 12} L${x - 4} ${y + 5} L${x} ${y + 15} L${x + 4} ${y + 5} L${x + 10} ${y + 12} L${x + 8} ${y}Z" fill="${skin}" ${THIN}/>`;
  const scarf = L.scarf || o.scarf || (L.role === 'ranger' && !o.noScarf) || (L.role === 'fighter' && rnd() < 0.4) ? kit.cel(`M146 126 C186 112 206 140 244 120 C232 142 212 152 190 146 C210 160 222 164 238 170 C204 180 176 162 158 140Z`, o.scarfC || '#c8242a', { dx: 5, dy: 4 }) : '';
  return {
    back: scarf,
    body: `${legs}
      ${kit.cel(sleeveL, robe, { dx: 6, dy: 5 })}${kit.cel(mirrorX(sleeveL), robe, { dx: 6, dy: 5 })}
      ${claws(66, 198)}${claws(190, 198)}
      ${kit.cel(torso, robe)}
      <path d="M108 128 L128 170 L148 128" stroke="${trim}" stroke-width="7" fill="none"/>
      <path d="M108 128 L128 170 L148 128" fill="none" ${THIN}/>
      ${pattern(L.pat, 128, 188, 40, 26, robe)}
      ${kit.cel('M90 166 L166 166 L168 182 L88 182Z', o.obi || shade(trim, 0.2), { dx: 3, dy: 3, thin: true })}
      <path d="M134 182 L142 204 L150 182Z" fill="${o.obi || shade(trim, 0.2)}" ${THIN}/>
      ${roleGear(kit, L.role, robe, trim, rnd)}
      ${o.fur ? kit.cel('M94 126 L98 142 L110 134 L118 148 L128 136 L138 148 L146 134 L158 142 L162 126 Q128 116 94 126Z', o.fur, { dx: 3, dy: 3, thin: true }) : ''}`,
    hand: { x: 190, y: 196 },
  };
}

// 役割ごとの装備: ファイター＝肩の鎧、タンク＝胴の鎧と草摺、ヒーラー＝数珠とお札、レンジャー＝マフラー（顔は口当て）
function roleGear(kit, role, robe, trim, rnd) {
  const metal = ['#3a3e4a', '#5a1e24', '#2a3a5a', '#4a3a24'][Math.floor(rnd() * 4)];
  const lace = ['#c8242a', '#ffcc33', '#e8e4f0', '#3ac8b0'][Math.floor(rnd() * 4)];
  switch (role) {
    case 'fighter':
      return both('M96 128 L68 136 L62 164 L96 156Z', d => kit.cel(d, metal, { dx: 3, dy: 3, thin: true })) +
        both('M67 146 L96 140 M64 155 L96 149', d => `<path d="${d}" stroke="${lace}" stroke-width="2.5"/>`);
    case 'tank':
      return kit.cel('M98 134 Q128 126 158 134 L162 166 L94 166Z', metal, { dx: 4, dy: 3 }) +
        `<path d="M96 146 L160 146 M95 156 L161 156" stroke="${lace}" stroke-width="2.5"/>` +
        kit.cel('M84 182 L172 182 L178 210 L78 210Z', metal, { dx: 4, dy: 3, thin: true }) +
        `<path d="M100 182 L98 210 M128 182 L128 210 M156 182 L158 210" stroke="${INK}" stroke-width="2.5"/><path d="M82 196 L174 196" stroke="${lace}" stroke-width="2.5"/>` +
        both('M96 128 L64 132 L58 170 L96 160Z', d => kit.cel(d, metal, { dx: 3, dy: 3, thin: true }));
    case 'healer':
      return Array.from({ length: 9 }, (_, i) => { const t = i / 8; const x = 106 + t * 44, y = 132 + Math.sin(t * Math.PI) * 34; return `<circle cx="${x}" cy="${y}" r="4" fill="${i === 4 ? '#c8242a' : '#6a4028'}" stroke="${INK}" stroke-width="1.5"/>`; }).join('') +
        kit.cel('M96 182 L112 182 L110 212 L98 212Z', '#f4ecd8', { dx: 2, dy: 2, thin: true }) + `<path d="M100 190 L108 190 M101 197 L107 197 M102 204 L106 204" stroke="#c8242a" stroke-width="2"/>`;
    default: return '';
  }
}

// 人の頭（とがったあご）。髪型つき
function humanHead(kit, L, c, rnd, skin, hc) {
  if (L.hc) hc = L.hc;
  // head=long: ぬらりひょんのような後ろに長い頭
  const head = L.head === 'long'
    ? `M94 82 C92 52 100 20 132 8 C168 0 176 40 162 82 C162 104 150 120 128 130 C106 120 94 104 94 82Z`
    : `M94 82 C94 50 110 40 128 40 C146 40 162 50 162 82 C162 104 150 120 128 130 C106 120 94 104 94 82Z`;
  const hairs = {
    short: `M90 88 Q86 36 128 32 Q170 36 166 88 L160 70 L152 80 L148 62 L138 74 L132 56 L122 72 L114 58 L108 76 L100 64 L96 82Z`,
    spiky: `M92 92 L70 70 L92 64 L78 36 L104 46 L106 14 L126 38 L144 8 L150 40 L176 24 L168 54 L192 58 L170 76 L164 92 L156 66 L148 80 L142 58 L132 74 L124 54 L116 74 L108 58 L102 80Z`,
    long: `M92 86 Q86 34 128 32 Q170 34 164 86 L158 64 L148 76 L144 56 L130 72 L122 54 L112 74 L104 60 L98 80Z`,
    bob: `M86 116 Q78 36 128 32 Q178 36 170 116 L160 108 L162 72 L150 66 L128 68 L104 66 L94 72 L96 108Z`,
    bun: `M90 86 Q86 40 128 38 Q170 40 166 86 L158 66 L146 76 L136 60 L124 74 L112 60 L100 78Z`,
    snake: `M90 86 Q86 42 128 40 Q170 42 166 86 Q150 64 128 64 Q106 64 90 86Z`,
  };
  const hairKind = L.hair || 'short';
  let back = '', front = '';
  if (hairKind === 'long') back = kit.cel(`M96 60 Q90 30 128 28 Q166 30 160 60 Q178 120 190 190 L172 176 L170 204 L154 172 L102 172 L86 204 L84 176 L66 190 Q78 120 96 60Z`, hc);
  if (hairKind === 'bun') back = kit.cel(ell(128, 30, 18, 15), hc, { dx: 3, dy: 3 }) + `<path d="M104 22 L156 40" stroke="#c8242a" stroke-width="4" stroke-linecap="round"/><circle cx="104" cy="22" r="5" fill="#ffcc33" ${THIN}/>`;
  if (hairKind === 'snake') back = [0, 1, 2, 3, 4].map(i => { const x = 82 + i * 23; const d = `M${x} 70 Q${x - 20} 34 ${x + 6} 14`; return `<path d="${d}" stroke="${INK}" stroke-width="14" fill="none" stroke-linecap="round"/><path d="${d}" stroke="#5a9a4a" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M${x + 6} 14 L${x + 14} 8 L${x + 12} 18Z" fill="#5a9a4a" ${THIN}/><circle cx="${x + 7}" cy="13" r="2" fill="#ffe14a"/>`; }).join('');
  if (hairs[hairKind]) front = kit.cel(hairs[hairKind], hairKind === 'snake' ? '#3a6a3a' : hc, { dx: 5, dy: 5 });
  return { back, body: kit.cel(head, skin, { dx: 7, dy: 5, rim: false }), front, head: { x: 128, y: 86, r: 34, top: 42, skin } };
}

const BODY = {
  human(kit, L, c, rnd) {
    const pale = L.skin === 'pale';
    const skin = L.skin === 'c' ? light(c, 0.1) : pale ? '#eef4f8' : ['#f2dcc8', '#e8c8a8', '#c89068', '#9a6a4a'][Math.floor(rnd() * 4)];
    const hc = pale ? '#1a1a2a' : lum(c) > 0.75 ? '#1e1626' : ['#1e1626', '#3a2420', dark(c, 0.55), '#e8e4f0'][Math.floor(rnd() * 4)];
    const robe = L.skin === 'c' ? dark(c, 0.55) : pale ? '#f2f8ff' : c;
    const trim = pale ? '#8ad8ff' : lum(robe) > 0.6 ? '#2a1a2a' : '#f4ecd8';
    const bodyP = humanoidBody(kit, L, c, rnd, { robe, trim, skin, scarfC: lum(c) > 0.5 ? '#c8242a' : light(c, 0.3), obi: pale ? '#6ab8ff' : undefined });
    const h = humanHead(kit, L, c, rnd, skin, hc);
    h.head.kuma = L.skin === 'c' ? null : (L.eyes === 'angry' || rnd() < 0.4) ? '#d8243a' : null;
    if (L.role === 'ranger' && L.nose !== 'long') {
      h.front += kit.cel('M98 104 Q128 98 158 104 L156 116 Q144 126 128 132 Q112 126 100 116Z', '#22202a', { dx: 3, dy: 2, thin: true });
      h.head.noMouth = true; h.head.kuma = null;
    }
    if (L.hair === 'bald') h.front += `<path d="M128 50 L124 60 L128 66 L132 60Z" fill="#c8242a" ${THIN}/>`;
    // 天狗の長い鼻
    const nose = L.nose === 'long' ? kit.cel(`M124 92 Q128 86 134 92 L178 112 Q182 118 174 118 L130 106Z`, skin, { dx: 3, dy: 3, thin: true }) : '';
    return { back: bodyP.back + h.back, body: bodyP.body + h.body, front: h.front, after: nose, head: h.head, hand: bodyP.hand, wing: { x: 128, y: 150 } };
  },

  beast(kit, L, c, rnd) {
    const c2 = light(c, 0.55);
    const robe = mix(c, ['#1a1426', '#4a1420', '#14284a', '#1e3a24', '#e8e0d0'][Math.floor(rnd() * 5)], 0.7);
    const bodyP = humanoidBody(kit, L, c, rnd, { robe, trim: c, skin: c, fur: c2, scarfC: '#c8242a', legC: dark(c, 0.3), noScarf: true });
    const earD = {
      cat: `M98 62 L92 22 L120 46Z`, fox: `M100 60 L86 10 L122 44Z`, dog: `M98 54 Q70 50 74 104 Q86 92 100 74Z`,
      bunny: `M112 50 Q96 0 108 -6 Q124 0 122 46Z`, bear: `M96 52 A14 14 0 1 1 112 42Z`, round: `M94 62 A12 12 0 1 1 108 50Z`, goat: `M98 64 Q70 60 66 74 Q84 80 100 74Z`,
    }[L.ears || 'round'];
    const ears = both(earD, d => kit.cel(d, c, { dx: 3, dy: 3, thin: true })) + (['cat', 'fox'].includes(L.ears) ? both(L.ears === 'fox' ? 'M102 56 L92 22 L116 46Z' : 'M101 58 L96 32 L114 48Z', d => `<path d="${d}" fill="${L.ears === 'fox' ? INK : '#d87a90'}"/>`) : '');
    // 頬の毛がとがった獣の頭
    const head = `M90 86 L80 100 L96 102 L94 114 L110 114 L128 132 L146 114 L162 114 L160 102 L176 100 L166 86 C166 56 148 42 128 42 C108 42 90 56 90 86Z`;
    const muzzle = L.snout ? `M110 100 Q128 94 146 100 L142 116 Q128 122 114 116Z` : `M114 102 Q128 97 142 102 L138 114 Q128 118 118 114Z`;
    return {
      back: bodyP.back + tail(kit, L.tail, c, c2),
      body: bodyP.body + ears + kit.cel(head, c, { dx: 7, dy: 5, rim: false }) +
        both('M92 70 L104 76 L94 80', d => `<path d="${d}" stroke="${shade(c, 0.4)}" stroke-width="3" fill="none"/>`) +
        kit.cel(muzzle, c2, { dx: 3, dy: 3, thin: true }) + `<path d="M122 101 L134 101 L128 108Z" fill="${INK}"/>` +
        pattern(L.pat, 128, 64, 30, 14, c),
      head: { x: 128, y: 86, r: 36, top: 44, skin: c, mouthY: 34, fangs: true, eyeSp: 18 },
      hand: bodyP.hand, wing: { x: 128, y: 150 },
    };
  },

  ghost(kit, L, c, rnd) {
    // フードをかぶった、裾がほつれて消えていく幽霊
    const cloth = lum(c) > 0.7 ? c : light(c, 0.15);
    const body = `M74 110 Q66 30 128 26 Q190 30 182 110 Q190 170 206 222 L190 210 L182 236 L168 214 L154 238 L140 214 L126 240 L112 214 L98 236 L86 212 L72 234 L66 212 L50 222 Q66 170 74 110Z`;
    const hair = L.hair === 'long' ? kit.cel(`M84 70 Q80 40 128 40 Q176 40 172 70 L178 170 L162 150 L156 176 L140 140 L116 140 L100 176 L94 150 L78 170Z`, '#141020') : '';
    const arms = both(`M80 130 Q50 140 34 118 L28 106 L40 112 L38 98 L48 110 L50 98 L56 116 Q66 126 84 118Z`, d => kit.cel(d, cloth, { dx: 3, dy: 3, thin: true }));
    return {
      back: '',
      body: arms + kit.cel(body, cloth, { dx: 10, dy: 6 }) +
        `<path d="M86 120 Q80 70 128 64 Q176 70 170 120 Q150 136 128 136 Q106 136 86 120Z" fill="${shade(cloth, 0.75)}" ${THIN}/>` + hair +
        `<path d="M100 170 Q110 186 104 206 M152 168 Q146 190 156 208" stroke="${shade(cloth, 0.3)}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
      head: { x: 128, y: 100, r: 36, top: 30, skin: '#000', noBrow: true, mouthY: 20, fangs: true },
      hand: { x: 214, y: 120 }, wing: { x: 128, y: 120 },
    };
  },

  wisp(kit, L, c, rnd) {
    // 人魂: 青白い炎の体
    const outer = `M128 232 C66 232 50 180 66 140 C76 112 92 98 88 60 C104 76 112 92 116 52 C132 70 138 86 150 26 C176 66 204 108 200 158 C198 204 170 232 128 232Z`;
    const inner = `M128 220 C92 220 80 186 92 160 C102 140 120 150 126 126 C138 148 170 150 172 178 C176 204 156 220 128 220Z`;
    return {
      back: `<circle cx="128" cy="160" r="110" fill="${kit.grad([[0.3, c, 0.6], [1, c, 0]])}"/>`,
      body: kit.cel(outer, c, { dx: 8, dy: 6 }) + `<path d="${inner}" fill="#f0feff"/>` +
        both('M58 130 C50 116 60 106 56 92 C70 102 74 118 68 128 C64 136 60 134 58 130Z', d => `<path d="${d}" fill="${c}" ${THIN}/>`),
      head: { x: 128, y: 170, r: 36, top: 120, skin: c, noBrow: false, fangs: true },
      hand: { x: 200, y: 170 }, wing: { x: 128, y: 150 },
    };
  },

  blob(kit, L, c) {
    const body = `M36 228 Q24 150 70 110 Q100 84 128 84 Q170 84 200 116 Q236 156 220 228 L206 220 L200 236 L186 224 Q128 240 70 224 L56 236 L50 220Z`;
    return {
      back: '',
      body: kit.cel(body, c, { dx: 12, dy: 8 }) +
        `<path d="M64 180 Q60 140 92 116" stroke="#fff" stroke-opacity="0.45" stroke-width="7" fill="none" stroke-linecap="round"/>` +
        `<path d="M196 140 Q206 160 200 172 Q192 160 196 140Z M80 214 Q86 226 80 234 Q74 226 80 214Z" fill="${shade(c, 0.2)}" ${THIN}/>` +
        pattern(L.pat, 128, 196, 70, 30, c) +
        // 大きく裂けた口
        `<path d="M86 184 Q128 214 170 184 Q128 198 86 184Z" fill="#2a0010" ${THIN}/>` +
        `<path d="M96 188 L100 198 L106 191 L112 201 L118 193 L124 203 L130 194 L136 203 L142 193 L148 201 L154 191 L160 198 L164 188" fill="#fff" stroke="${INK}" stroke-width="1.5"/>`,
      head: { x: 128, y: 148, r: 40, top: 90, skin: c, noMouth: true, eyeK: 1.15, eyeSp: 22 },
      hand: { x: 210, y: 190 }, wing: { x: 128, y: 150 },
    };
  },

  bird(kit, L, c, rnd) {
    // 烏天狗のような鳥の戦士
    const c2 = lum(c) > 0.6 ? dark(c, 0.15) : light(c, 0.25);
    const robe = lum(c) > 0.6 ? '#2a2236' : '#f0ece4';
    const bodyP = humanoidBody(kit, L, c, rnd, { robe, trim: '#c8242a', skin: '#e8b030', legC: '#1a1a20' });
    const head = `M94 88 C92 54 108 40 128 40 C150 40 164 54 162 88 C162 108 150 120 128 124 C106 120 94 108 94 88Z`;
    const crest = `M110 46 L96 14 L120 36 L124 6 L134 36 L152 12 L146 46Z`;
    const beak = `M114 96 Q128 90 142 96 L128 132Z`;
    const legs3 = L.legs === '3' ? `<path d="M128 214 L128 238" stroke="${INK}" stroke-width="9" stroke-linecap="round"/><path d="M128 214 L128 238" stroke="#e8b030" stroke-width="4" stroke-linecap="round"/>` : '';
    return {
      back: bodyP.back,
      body: bodyP.body + legs3 + kit.cel(crest, dark(c, 0.3), { dx: 3, dy: 3 }) + kit.cel(head, c, { dx: 7, dy: 5, rim: false }) +
        `<path d="M100 98 Q128 108 156 98 L150 116 Q128 124 106 116Z" fill="${c2}" opacity="0.6"/>` + kit.cel(beak, '#e8b030', { dx: 3, dy: 3, thin: true }) + `<path d="M118 104 L128 108 L138 104" stroke="${INK}" stroke-width="2" fill="none"/>`,
      head: { x: 128, y: 82, r: 34, top: 44, skin: c, noMouth: true, eyeSp: 18 },
      hand: bodyP.hand, wing: { x: 128, y: 150 },
    };
  },

  skull(kit, L, c, rnd) {
    // 骸骨の武者。目の穴の奥が光る
    const robe = '#262234';
    const bodyP = humanoidBody(kit, L, c, rnd, { robe, trim: c, skin: c, scarfC: '#6a1a2a' });
    const big = L.giant;
    const skullD = `M86 84 C84 46 106 34 128 34 C150 34 172 46 170 84 C170 100 162 106 160 116 L150 128 L106 128 L96 116 C94 106 86 100 86 84Z`;
    return {
      back: bodyP.back + (big ? `<circle cx="128" cy="120" r="110" fill="${kit.grad([[0.3, '#7ab8ff', 0.35], [1, '#7ab8ff', 0]])}"/>` : ''),
      body: bodyP.body + `<path d="M98 140 L158 140 M100 150 L156 150" stroke="${c}" stroke-width="5"/>` + kit.cel(skullD, c, { dx: 7, dy: 5, rim: false }) +
        [-1, 1].map(s => `<path d="M${128 + s * 6} 74 Q${128 + s * 30} 64 ${128 + s * 34} 82 Q${128 + s * 26} 100 ${128 + s * 8} 92Z" fill="#0a0408"/>`).join('') +
        `<path d="M122 106 L128 96 L134 106Z" fill="#0a0408"/>` +
        `<path d="M106 116 L150 116 M112 112 L112 126 M122 112 L122 128 M134 112 L134 128 M144 112 L144 126" stroke="${INK}" stroke-width="3"/>` +
        `<path d="M156 46 L148 64 L160 72" stroke="${shade(c, 0.3)}" stroke-width="2.5" fill="none"/>`,
      head: { x: 128, y: 84, r: 36, top: 38, skin: c, noFace: true },
      hand: bodyP.hand, wing: { x: 128, y: 150 },
      glowEyes: [[106, 82], [150, 82]],
    };
  },

  dragon(kit, L, c, rnd) {
    const c2 = light(c, 0.5);
    const robe = mix(dark(c, 0.55), '#1a1426', 0.3);
    const bodyP = humanoidBody(kit, L, c, rnd, { robe, trim: '#ffcc33', skin: c, legC: dark(c, 0.3) });
    const head = `M90 78 C90 48 108 36 128 36 C148 36 166 48 166 78 L168 100 Q162 122 128 130 Q94 122 88 100Z`;
    const hornD = `M104 46 Q92 18 70 10 Q86 30 90 56Z`;
    const tailD = `M156 200 C216 210 240 170 230 128 L222 140 L216 120 L208 138 C218 166 196 190 156 186Z`;
    return {
      back: bodyP.back + kit.cel(tailD, c),
      body: bodyP.body + both(hornD, d => kit.cel(d, '#f2e6c2', { dx: 3, dy: 3, thin: true })) +
        both('M92 70 L74 60 L90 82Z', d => kit.cel(d, c2, { dx: 2, dy: 2, thin: true })) +
        kit.cel(head, c, { dx: 7, dy: 5, rim: false }) +
        kit.cel(`M106 104 Q128 96 150 104 L146 122 Q128 130 110 122Z`, c2, { dx: 2, dy: 3, thin: true }) +
        `<circle cx="120" cy="108" r="2.5" fill="${INK}"/><circle cx="136" cy="108" r="2.5" fill="${INK}"/>` +
        both('M100 52 L108 46 L114 54', d => `<path d="${d}" stroke="${shade(c, 0.4)}" stroke-width="3" fill="none"/>`) +
        // ひげ
        both('M108 116 Q80 120 66 140', d => `<path d="${d}" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="${d}" stroke="${c2}" stroke-width="2" fill="none" stroke-linecap="round"/>`),
      head: { x: 128, y: 80, r: 36, top: 40, skin: c, noMouth: true, eyeSp: 18 },
      hand: bodyP.hand, wing: { x: 128, y: 150 },
    };
  },

  fish(kit, L, c, rnd) {
    const c2 = light(c, 0.45);
    const robe = mix(dark(c, 0.6), '#14202a', 0.4);
    const bodyP = humanoidBody(kit, L, c, rnd, { robe, trim: c2, skin: c, legC: dark(c, 0.35) });
    const head = `M88 84 C88 46 108 34 128 34 C148 34 168 46 168 84 C168 108 152 124 128 128 C104 124 88 108 88 84Z`;
    const fin = `M128 36 Q132 8 160 4 Q148 22 152 40Z`;
    const hair = L.hair === 'long' ? kit.cel(`M92 62 Q88 30 128 28 Q168 30 164 62 Q180 120 188 180 L170 168 L164 190 L150 160 L106 160 L92 190 L86 168 L68 180 Q76 120 92 62Z`, dark(c, 0.5)) : '';
    const shell = L.shell ? kit.cel(`M70 130 Q60 196 96 222 L160 222 Q196 196 186 130 Q128 110 70 130Z`, '#6a5030') + `<path d="M84 150 L172 150 M80 180 L176 180 M128 122 L128 220" stroke="#3a2a14" stroke-width="3"/>` : '';
    return {
      back: shell + hair + both('M92 92 Q60 84 54 110 Q72 104 90 110Z', d => kit.cel(d, dark(c, 0.15), { dx: 2, dy: 2, thin: true })),
      body: bodyP.body + kit.cel(fin, dark(c, 0.15), { dx: 3, dy: 2, thin: true }) + kit.cel(head, c, { dx: 7, dy: 5, rim: false }) +
        `<path d="M104 112 Q128 124 152 112" fill="none" stroke="${c2}" stroke-width="4"/>` +
        [0, 1, 2].map(i => `<path d="M${100 + i * 8} ${66 - i * 2} Q${104 + i * 8} ${70 - i * 2} ${100 + i * 8} ${74 - i * 2}" stroke="${shade(c, 0.35)}" stroke-width="2" fill="none"/>`).join(''),
      head: { x: 128, y: 86, r: 36, top: 36, skin: c, fangs: true, mouthY: 26 },
      hand: bodyP.hand, wing: { x: 128, y: 150 },
    };
  },

  object(kit, L, c, rnd) {
    // 付喪神: 古い道具が化けたもの。どれも牙と光る目
    const kinds = {
      sandal: () => ({ s: kit.cel(`M54 204 L202 204 L206 232 L50 232Z`, dark(c, 0.35)) + kit.cel(`M48 74 Q48 62 60 62 L196 62 Q208 62 208 74 L208 206 L48 206Z`, c) + `<path d="M128 62 L84 132 M128 62 L172 132" stroke="#a8242a" stroke-width="9" stroke-linecap="round"/>`, h: { x: 128, y: 150 } }),
      kettle: () => ({ s: `<path d="M86 70 Q128 30 170 70" stroke="${INK}" stroke-width="9" fill="none"/>` + kit.cel(`M196 140 Q240 126 236 92 L224 96 Q224 120 194 124Z`, c, { thin: true }) + kit.cel(ell(128, 78, 42, 12), dark(c, 0.2), { thin: true }) + kit.cel(`M54 152 Q54 82 128 82 Q202 82 202 152 Q202 232 128 232 Q54 232 54 152Z`, c) + `<path d="M58 196 Q128 214 198 196" stroke="${shade(c, 0.4)}" stroke-width="5" fill="none"/>`, h: { x: 128, y: 140 } }),
      mirror: () => ({ s: kit.cel(`M110 196 L146 196 L150 236 L106 236Z`, '#6a4028') + kit.cel(ell(128, 128, 84, 84), '#d8a830') + `<circle cx="128" cy="128" r="66" fill="${c}" ${LINE}/><path d="M88 106 Q100 80 130 72" stroke="#fff" stroke-opacity="0.6" stroke-width="8" fill="none" stroke-linecap="round"/>`, h: { x: 128, y: 132 } }),
      drum: () => ({ s: kit.cel(`M48 100 L48 200 Q128 238 208 200 L208 100Z`, c) + kit.cel(ell(128, 100, 80, 26), '#efe2c8', { thin: true }) + [62, 92, 122, 152, 182].map(x => `<circle cx="${x + 6}" cy="${x === 62 || x === 182 ? 176 : 188}" r="5" fill="#ffcc33" ${THIN}/>`).join('') + `<path d="M128 100 m-20 0 a20 10 0 1 0 40 0 a20 10 0 1 0 -40 0" fill="none" stroke="#a8242a" stroke-width="4"/>`, h: { x: 128, y: 150 } }),
      lamp: () => ({ s: `<rect x="94" y="26" width="68" height="20" rx="5" fill="${INK}"/><rect x="94" y="216" width="68" height="20" rx="5" fill="${INK}"/>` + kit.cel(`M98 42 Q42 66 42 130 Q42 194 98 218 L158 218 Q214 194 214 130 Q214 66 158 42Z`, c, { dx: 10, dy: 6 }) + `<path d="M50 96 Q128 110 206 96 M44 136 Q128 150 212 136 M52 176 Q128 190 204 176" stroke="${shade(c, 0.3)}" stroke-width="3.5" fill="none"/><path d="M60 80 Q50 120 64 170" stroke="#fff" stroke-opacity="0.4" stroke-width="7" fill="none" stroke-linecap="round"/>`, h: { x: 128, y: 120 } }),
      umbrella: () => ({ s: kit.cel(`M118 160 L138 160 L140 224 L116 224Z`, '#e8d0b0', { thin: true }) + kit.cel(`M106 224 L150 224 L154 238 L102 238Z`, '#6a3a24', { thin: true }) + kit.cel(`M14 168 Q36 50 128 20 Q220 50 242 168 L214 156 L196 172 L170 154 L150 170 L128 152 L106 170 L86 154 L60 172 L42 156Z`, c, { dx: 10, dy: 8 }) + `<path d="M128 22 L128 150 M128 22 Q92 80 86 154 M128 22 Q164 80 170 154 M128 22 Q60 70 42 156 M128 22 Q196 70 214 156" stroke="${shade(c, 0.35)}" stroke-width="3" fill="none"/><circle cx="128" cy="16" r="8" fill="#d8a830" ${THIN}/>`, h: { x: 128, y: 104 } }),
    };
    const k = (kinds[L.kind] || kinds.lamp)();
    const tongue = L.tongue || L.kind === 'umbrella' ? kit.cel(`M120 ${k.h.y + 34} Q116 ${k.h.y + 80} 136 ${k.h.y + 92} Q150 ${k.h.y + 76} 136 ${k.h.y + 34}Z`, '#e8405a', { dx: 2, dy: 2, thin: true }) : '';
    return {
      back: '', body: k.s + tongue,
      head: { x: k.h.x, y: k.h.y, r: 40, top: k.h.y - 60, skin: c, fangs: true, mouthY: 30, eyeK: 1.2, eyeSp: 22 },
      hand: { x: 206, y: 180 }, wing: { x: 128, y: 140 },
    };
  },

  plant(kit, L, c, rnd) {
    const kinds = {
      mushroom: () => ({ s: kit.cel(`M92 130 Q86 200 98 232 L158 232 Q170 200 164 130Z`, '#efe2c8') + kit.cel(`M22 142 Q16 36 128 26 Q240 36 234 142 L210 132 L196 146 L176 134 L156 148 L128 136 L100 148 L80 134 L60 146 L46 132Z`, c, { dx: 10, dy: 8 }) + [[70, 88, 13], [128, 56, 11], [186, 90, 13], [100, 116, 8], [160, 118, 8]].map(([x, y, r]) => `<path d="${ell(x, y, r, r * 0.8)}" fill="#f4ecd8" ${THIN}/>`).join(''), h: { x: 128, y: 178 } }),
      tree: () => ({ s: kit.cel(`M94 120 L88 232 L60 238 L100 236 L128 226 L156 236 L196 238 L168 232 L162 120Z`, '#6a4428') + `<path d="M104 150 Q110 190 102 220 M150 140 Q144 180 156 214" stroke="#3a2414" stroke-width="3" fill="none"/>` + both('M96 150 Q60 140 40 108 L52 112 L44 94 L60 110 Q72 128 98 134Z', d => kit.cel(d, '#6a4428', { dx: 3, dy: 3, thin: true })) + kit.cel(`M48 100 Q30 60 70 40 Q86 10 128 14 Q170 10 186 40 Q226 60 208 100 Q214 130 180 132 Q160 146 128 136 Q96 146 76 132 Q42 130 48 100Z`, c, { dx: 10, dy: 8 }), h: { x: 128, y: 172 } }),
      pumpkin: () => ({ s: `<path d="M128 56 Q124 30 142 18" stroke="#2a6a2a" stroke-width="11" fill="none" stroke-linecap="round"/>` + kit.cel(`M140 30 Q174 18 180 46 Q150 50 140 30Z`, '#4ab04a', { thin: true }) + kit.cel(`M128 58 Q200 50 218 130 Q222 210 128 228 Q34 210 38 130 Q56 50 128 58Z`, c, { dx: 12, dy: 8 }) + `<path d="M128 60 Q100 140 128 226 M128 60 Q156 140 128 226 M90 66 Q60 140 88 220 M166 66 Q196 140 168 220" stroke="${shade(c, 0.3)}" stroke-width="4" fill="none"/>`, h: { x: 128, y: 140 }, carved: true }),
      flower: () => ({ s: `<path d="M128 150 L128 234" stroke="#2a6a2a" stroke-width="10"/>` + kit.cel(`M128 204 Q90 184 74 206 Q100 220 128 210Z`, '#4ab04a', { thin: true }) + Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; const x = 128 + Math.cos(a) * 60, y = 98 + Math.sin(a) * 60; return `<path d="M${128 + Math.cos(a) * 30} ${98 + Math.sin(a) * 30} Q${x + Math.cos(a + 1.2) * 24} ${y + Math.sin(a + 1.2) * 24} ${128 + Math.cos(a) * 88} ${98 + Math.sin(a) * 88} Q${x + Math.cos(a - 1.2) * 24} ${y + Math.sin(a - 1.2) * 24} ${128 + Math.cos(a) * 30} ${98 + Math.sin(a) * 30}Z" fill="${c}" ${THIN}/>`; }).join('') + kit.cel(ell(128, 98, 46, 46), '#f2c84a'), h: { x: 128, y: 100 } }),
    };
    const k = (kinds[L.kind] || kinds.flower)();
    const carved = k.carved ? `<path d="M96 120 L116 132 L98 142Z M160 120 L140 132 L158 142Z" fill="#ffd23a" ${THIN}/><path d="M90 168 L102 176 L110 166 L120 178 L128 168 L136 178 L146 166 L154 176 L166 168 Q128 206 90 168Z" fill="#ffd23a" ${THIN}/>` : '';
    return {
      back: '', body: k.s + carved,
      head: { x: k.h.x, y: k.h.y, r: 36, top: 20, skin: c, fangs: true, mouthY: 24, eyeSp: 18 },
      noFace: !!k.carved, hand: { x: 200, y: 176 }, wing: { x: 128, y: 140 },
    };
  },

  golem(kit, L, c, rnd, glowC) {
    const d = shade(c, 0.35);
    if (L.kind === 'wall') {
      // ぬりかべ: 石垣の壁
      const wall = `M40 40 L216 40 L220 226 L36 226Z`;
      return {
        back: '',
        body: both('M80 214 L76 236 L114 236 L112 214Z', p => kit.cel(p, d, { thin: true })) + kit.cel(wall, c, { dx: 12, dy: 8 }) +
          `<path d="M40 84 L216 84 M38 128 L218 128 M38 172 L218 172 M96 40 L96 84 M160 40 L160 84 M70 84 L70 128 M128 84 L128 128 M188 84 L188 128 M100 128 L100 172 M158 128 L158 172 M70 172 L70 226 M128 172 L128 226 M186 172 L186 226" stroke="${d}" stroke-width="4"/>` +
          both('M38 120 L12 126 L8 160 L38 156Z', p => kit.cel(p, c, { dx: 3, dy: 3, thin: true })) +
          `<path d="M60 60 L80 70 L74 90 M180 150 L196 170 L186 196" stroke="${glowC}" stroke-width="3" fill="none" opacity="0.8"/>`,
        head: { x: 128, y: 108, r: 46, top: 44, skin: c, eyeK: 1.3, eyeSp: 26, fangs: true, mouthY: 34 },
        hand: { x: 210, y: 150 }, wing: { x: 128, y: 140 },
      };
    }
    const giant = L.kind === 'giant';
    const crack = `stroke="${glowC}" stroke-width="3" fill="none" opacity="0.9"`;
    return {
      back: giant ? `<path d="M30 236 Q128 200 226 236" stroke="#5a8a3a" stroke-width="12" fill="none" opacity="0.6"/>` : '',
      body: both('M78 200 L74 236 L118 236 L116 200Z', p => kit.cel(p, d, { thin: true })) +
        kit.cel(`M50 128 L76 112 L180 112 L206 128 L200 214 L56 214Z`, c, { dx: 12, dy: 8 }) +
        both('M50 126 L18 132 L10 196 L24 212 L50 206 L58 150Z', p => kit.cel(p, c, { dx: 6, dy: 5 })) +
        both('M14 196 L12 214 M22 202 L22 220 M32 206 L34 222', p => `<path d="${p}" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`) +
        `<path d="M76 140 L100 156 L94 186 M164 132 L182 162 L156 196" ${crack}/>` +
        kit.cel(`M84 50 L106 34 L150 34 L172 50 L176 112 L150 128 L106 128 L80 112Z`, c, { dx: 8, dy: 6 }) +
        `<path d="M98 46 L110 58 M164 52 L154 70" ${crack}/>`,
      head: { x: 128, y: 84, r: 40, top: 36, skin: c, fangs: true, mouthY: 28, eyeSp: 19 },
      hand: { x: 222, y: 170 }, wing: { x: 128, y: 140 },
    };
  },

  bug(kit, L, c, rnd) {
    const legs = L.eyes === 'many' ? 4 : 3;
    let ls = '';
    for (let i = 0; i < legs; i++) for (const s of [-1, 1]) { const d = `M${128 + s * 40} ${150 + i * 22} L${128 + s * 84} ${128 + i * 24} L${128 + s * 100} ${190 + i * 14}`; ls += `<path d="${d}" stroke="${INK}" stroke-width="9" fill="none" stroke-linejoin="round" stroke-linecap="round"/><path d="${d}" stroke="${dark(c, 0.3)}" stroke-width="3.5" fill="none" stroke-linejoin="round"/>`; }
    return {
      back: ls,
      body: kit.cel(`M70 156 Q70 116 128 112 Q186 116 186 156 Q186 214 128 232 Q70 214 70 156Z`, c, { dx: 10, dy: 8 }) +
        `<path d="M128 114 L128 230" stroke="${shade(c, 0.5)}" stroke-width="4"/>` + pattern(L.pat, 128, 172, 56, 50, c) +
        both('M108 64 Q96 30 74 18', d => `<path d="${d}" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>`) +
        kit.cel(`M84 90 Q84 52 128 50 Q172 52 172 90 Q172 120 128 126 Q84 120 84 90Z`, dark(c, 0.25), { dx: 7, dy: 5, rim: false }) +
        both('M104 118 Q96 136 110 144 L114 128Z', d => kit.cel(d, '#e8dcc0', { dx: 2, dy: 2, thin: true })),
      head: { x: 128, y: 88, r: 36, top: 50, skin: c, noMouth: true, eyeK: 1.1 },
      hand: { x: 200, y: 170 }, wing: { x: 128, y: 140 },
    };
  },
};

function drawYokai(y) {
  const L = parseLook(y.look);
  L.role = y.role;
  const rnd = seeded(y.id);
  const c = y.color;
  const kit = makeKit();
  const el = Attacks.ELEMENT[y.el || Attacks.of(y.id).el];
  const glowC = el ? el.color : '#ffcc33';
  const b = (BODY[L.t] || BODY.blob)(kit, L, c, rnd, glowC);
  const h = b.head;
  const top = horns(kit, L.horns, h) + hat(kit, L.hat, h, c);
  let faceSvg = b.noFace || h.noFace ? '' : face(L, h, glowC, rnd);
  if (b.glowEyes) faceSvg = b.glowEyes.map(([x, yy]) => `<circle cx="${x}" cy="${yy}" r="9" fill="${kit.grad([[0, '#fff', 1], [0.35, glowC, 1], [1, glowC, 0]])}"/>`).join('');
  const cloud = L.cloud ? kit.cel('M60 236 Q50 214 74 214 Q78 198 100 206 Q116 192 136 204 Q158 194 170 210 Q196 206 194 226 Q206 240 186 244 L74 244 Q52 246 60 236Z', '#fff6d8', { dx: 6, dy: 4 }) : '';
  const body = `${aura(kit, y.rank, glowC)}${ring(kit, L.ring, glowC)}
    ${cloud || '<ellipse cx="128" cy="238" rx="62" ry="9" fill="#000" opacity="0.35"/>'}
    ${wings(kit, L.wings, b.wing.x, b.wing.y, c)}${b.back}${b.body}${faceSvg}${b.front || ''}${b.after || ''}${top}
    ${weapon(kit, L.acc, b.hand.x, b.hand.y, c, glowC)}${effects(L.fx, rnd, glowC)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><defs>${kit.defs.join('')}</defs>${body}</svg>`;
}

module.exports = { drawYokai };
