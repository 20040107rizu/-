// コードで描くゲームの絵（SVG）。tools/render-art.js で PNG にして public/art/ に書き出す。
// キャラは 256×256 の枠に、足元が y=236 付近にくるように描く。
const INK = '#2a1020';
const YOKAI = require('../public/yokai.js');
const { drawYokai } = require('./yokai-gen');
const O = `stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"`;
const O4 = `stroke="${INK}" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"`;

const svg = (body, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><defs>${defs}</defs>${body}</svg>`;

// 目: (cx, cy) 大きさ r、黒目の向き lx, ly
const eye = (cx, cy, r = 13, lx = 0, ly = 1, iris = INK) => `
  <ellipse cx="${cx}" cy="${cy}" rx="${r * 0.82}" ry="${r}" fill="#fff" ${O4}/>
  <ellipse cx="${cx + lx * r * 0.2}" cy="${cy + ly * r * 0.2}" rx="${r * 0.5}" ry="${r * 0.62}" fill="${iris}"/>
  <circle cx="${cx + lx * r * 0.2 - r * 0.2}" cy="${cy + ly * r * 0.2 - r * 0.28}" r="${r * 0.2}" fill="#fff"/>`;
const blush = (cx, cy) => `<ellipse cx="${cx}" cy="${cy}" rx="9" ry="5" fill="#ff7aa8" opacity="0.55"/>`;
const shine = (cx, cy, rx, ry, rot = -25) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" opacity="0.4" transform="rotate(${rot} ${cx} ${cy})"/>`;
const sparkle = (x, y, s, c = '#fff6a0') => `<path d="M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s}Z" fill="${c}" stroke="${INK}" stroke-width="2"/>`;

// ---------- 鬼（怖い見た目） ----------
// 光る目: 黄色い白目に縦長の瞳、周りがぼんやり光る
const oniEye = (cx, cy, rx, ry, side, glow, pupil = '#1a0000') => `
  <ellipse cx="${cx}" cy="${cy}" rx="${rx * 1.6}" ry="${ry * 1.8}" fill="${glow}" opacity="0.55" filter="url(#eyeGlow)"/>
  <path d="M${cx - rx} ${cy + ry * 0.2} Q${cx} ${cy - ry * 1.3} ${cx + rx} ${cy - ry * (side > 0 ? 0.2 : -0.2)} Q${cx} ${cy + ry} ${cx - rx} ${cy + ry * 0.2}Z" fill="#ffe14a" ${O4}/>
  <ellipse cx="${cx + side * rx * 0.1}" cy="${cy}" rx="${rx * 0.18}" ry="${ry * 0.75}" fill="${pupil}"/>`;
const oniDefs = `<filter id="eyeGlow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6"/></filter>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>`;

const oniPatrol = () => svg(`
  <ellipse cx="128" cy="238" rx="56" ry="10" fill="#000" opacity="0.3"/>
  <rect x="94" y="200" width="28" height="34" rx="10" fill="#4a3a7a" ${O}/><rect x="134" y="200" width="28" height="34" rx="10" fill="#4a3a7a" ${O}/>
  <path d="M72 216 L84 138 L172 138 L184 216Z" fill="#2a1a3a" ${O}/>
  <path d="M84 138 L128 182 L172 138" stroke="#c8242a" stroke-width="8" fill="none"/>
  <path d="M90 198 L166 198" stroke="#c8242a" stroke-width="5" stroke-dasharray="10 6"/>
  <path d="M188 150 L206 150 L206 128" ${O} fill="none"/>
  <circle cx="207" cy="174" r="30" fill="#ff5a2a" opacity="0.45" filter="url(#soft)"/>
  <rect x="190" y="150" width="34" height="46" rx="14" fill="#c8242a" ${O}/>
  <rect x="196" y="144" width="22" height="8" fill="${INK}"/><rect x="196" y="194" width="22" height="8" fill="${INK}"/>
  <path d="M60 164 L44 150 M60 176 L40 172" ${O}/>
  <circle cx="72" cy="168" r="16" fill="#8a6ac8" ${O}/><circle cx="190" cy="146" r="14" fill="#8a6ac8" ${O}/>
  <path d="M64 160 L58 150 M72 156 L70 144 M80 160 L84 150" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
  <ellipse cx="128" cy="96" rx="60" ry="54" fill="#8a6ac8" ${O}/>
  <path d="M110 48 Q120 0 136 -2 Q130 26 146 50Z" fill="#e8d6a0" ${O}/>
  <path d="M110 40 L132 32 M114 28 L132 22" stroke="#a08a60" stroke-width="3"/>
  <path d="M70 90 Q66 50 104 46 Q94 60 98 72 Q82 70 70 90Z M186 90 Q190 50 152 46 Q162 60 158 72 Q174 70 186 90Z" fill="#1a1020"/>
  <path d="M84 70 L122 86 L120 94 L84 82Z M172 70 L134 86 L136 94 L172 82Z" fill="${INK}"/>
  ${oniEye(104, 98, 16, 11, -1, '#ff2a2a', '#c80000')}${oniEye(152, 98, 16, 11, 1, '#ff2a2a', '#c80000')}
  <path d="M120 64 L124 74 M136 64 L132 74" stroke="#5a3a8a" stroke-width="4" stroke-linecap="round"/>
  <path d="M94 124 Q128 150 162 124 L156 136 L148 128 L140 140 L132 128 L124 140 L116 128 L108 140 L100 128Z" fill="#fff" ${O4}/>
  <rect x="150" y="118" width="34" height="14" rx="7" fill="#c8c8d8" ${O4}/><circle cx="184" cy="125" r="9" fill="#c8c8d8" ${O4}/>
  <path d="M196 108 Q214 98 224 106 M200 92 Q218 80 232 86" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M150 74 L166 92" stroke="#c8242a" stroke-width="4" stroke-linecap="round"/>`, oniDefs);

// ボス鬼（赤鬼・青鬼・黒鬼）: skin 肌、shade 影、mane たてがみ、glow 目の光
function oniBoss({ skin, shade, mane, glow, pupil, aura }) {
  return svg(`
  ${aura ? `<circle cx="128" cy="120" r="118" fill="${aura}" opacity="0.55" filter="url(#soft)"/>` : ''}
  <ellipse cx="128" cy="240" rx="88" ry="12" fill="#000" opacity="0.35"/>
  <path d="M196 232 L234 36" stroke="${INK}" stroke-width="32" stroke-linecap="round"/>
  <path d="M196 232 L234 36" stroke="#4a4a5a" stroke-width="22" stroke-linecap="round"/>
  ${[50, 80, 110, 140, 168].map(t => { const y = 232 - t * 1.12, x = 196 + t * 0.22; return `<path d="M${x - 14} ${y} L${x - 30} ${y - 8} L${x - 13} ${y - 12}Z M${x + 13} ${y - 6} L${x + 30} ${y - 14} L${x + 13} ${y - 18}Z" fill="#d8d8e8" ${O4}/>`; }).join('')}
  <rect x="76" y="196" width="42" height="40" rx="12" fill="${shade}" ${O}/><rect x="138" y="196" width="42" height="40" rx="12" fill="${shade}" ${O}/>
  <path d="M78 232 L84 222 L90 232 M146 232 L152 222 L158 232" stroke="#f6e6b0" stroke-width="5" stroke-linejoin="round" fill="none"/>
  <path d="M56 142 Q56 106 128 102 Q200 106 200 142 L194 206 L62 206Z" fill="${skin}" ${O}/>
  <path d="M88 126 Q108 140 124 128 M132 128 Q148 140 168 126 M128 140 L128 176 M100 160 Q112 168 124 160 M132 160 Q144 168 156 160" stroke="${shade}" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M150 118 L176 146 M156 116 L170 132" stroke="#f0d0c0" stroke-width="4" stroke-linecap="round" opacity="0.8"/>
  <path d="M62 176 L194 176 L198 214 L58 214Z" fill="#ffcc33" ${O}/>
  <path d="M78 178 L86 212 M102 178 L98 212 M128 178 L132 212 M152 178 L148 212 M176 178 L180 212" stroke="${INK}" stroke-width="7"/>
  <circle cx="40" cy="162" r="26" fill="${skin}" ${O}/><circle cx="204" cy="170" r="26" fill="${skin}" ${O}/>
  <path d="M26 150 L18 138 M38 146 L36 132 M50 150 L56 138" stroke="#f6e6b0" stroke-width="6" stroke-linecap="round"/>
  <path d="M58 76 Q34 10 6 2 Q30 46 40 92Z M198 76 Q222 10 250 2 Q226 46 216 92Z" fill="#f6e6b0" ${O}/>
  <path d="M30 34 L46 30 M22 20 L36 14 M226 34 L210 30 M234 20 L220 14" stroke="#b09a6a" stroke-width="4"/>
  <path d="M36 96 Q24 36 128 22 Q232 36 220 96 L206 62 L194 86 L178 54 L166 82 L150 46 L128 78 L106 46 L90 82 L78 54 L62 86 L50 62Z" fill="${mane}" ${O}/>
  <ellipse cx="128" cy="106" rx="78" ry="64" fill="${skin}" ${O}/>
  <path d="M60 70 Q96 50 122 78 L116 96 Q96 78 64 84Z M196 70 Q160 50 134 78 L140 96 Q160 78 192 84Z" fill="${mane}" ${O4}/>
  <path d="M118 70 L124 84 M138 70 L132 84 M128 62 L128 78" stroke="${shade}" stroke-width="5" stroke-linecap="round"/>
  ${oniEye(96, 100, 22, 14, -1, glow, pupil)}${oniEye(160, 100, 22, 14, 1, glow, pupil)}
  <path d="M116 112 Q128 104 140 112 L136 124 L120 124Z" fill="${shade}" ${O4}/>
  <path d="M74 132 Q128 190 182 132 Q154 146 128 146 Q102 146 74 132Z" fill="#3a0008" ${O}/>
  <path d="M82 136 L90 150 L98 140 L106 152 L114 142 L122 154 L128 144 L134 154 L142 142 L150 152 L158 140 L166 150 L174 136" fill="#fff" ${O4}/>
  <path d="M92 160 L96 136 L104 158Z M152 158 L160 136 L164 160Z" fill="#fff" ${O4}/>
  <path d="M168 66 L188 92 M174 64 L180 74" stroke="#f0d0c0" stroke-width="4" stroke-linecap="round" opacity="0.8"/>`, oniDefs);
}
const BOSS_LOOK = {
  red:   { skin: '#d02a2a', shade: '#7a0a14', mane: '#1a0a14', glow: '#ffb000', pupil: '#1a0000' },
  blue:  { skin: '#2a5ad8', shade: '#142a7a', mane: '#0a0a2a', glow: '#ff3a2a', pupil: '#5a0000' },
  black: { skin: '#2a2030', shade: '#0a0610', mane: '#5a1a5a', glow: '#ff2a2a', pupil: '#000', aura: '#8a2ad8' },
};

// ---------- アイテム ----------
const ITEM = {
  trap: () => svg(`<ellipse cx="128" cy="170" rx="96" ry="44" fill="#5a5a6a" ${O}/><ellipse cx="128" cy="158" rx="80" ry="34" fill="#9aa0b0" ${O}/>
    <ellipse cx="128" cy="154" rx="46" ry="18" fill="#ffe14a" ${O4}/>
    <path d="M140 40 L96 130 L128 130 L110 210 L170 104 L138 104 L160 40Z" fill="#ffe14a" ${O}/>
    <path d="M40 120 L64 106 L56 132 L80 120 M216 120 L192 106 L200 132 L176 120" stroke="#fff27a" stroke-width="7" fill="none" stroke-linejoin="round"/>`),
  bomb: () => svg(`<circle cx="120" cy="150" r="80" fill="#2a2a3a" ${O}/>${shine(90, 110, 22, 12)}
    <rect x="132" y="56" width="40" height="34" rx="6" fill="#5a5a6a" ${O} transform="rotate(30 152 73)"/>
    <path d="M168 58 Q190 30 210 40" stroke="#c8a060" stroke-width="8" fill="none" stroke-linecap="round"/>
    <path d="M210 40 L222 18 L226 40 L248 36 L228 48 L238 66 L218 52 L206 66 L210 46Z" fill="#ffb030" ${O4}/>
    <circle cx="104" cy="156" r="18" fill="#fff"/><circle cx="136" cy="156" r="18" fill="#fff"/><circle cx="104" cy="158" r="7" fill="#2a2a3a"/><circle cx="136" cy="158" r="7" fill="#2a2a3a"/>
    <path d="M104 190 L136 190 M112 184 L112 196 M128 184 L128 196" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`),
  punch: () => svg(`<path d="M20 104 L60 104 M14 136 L56 136 M24 168 L60 168" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity="0.8"/>
    <rect x="62" y="96" width="70" height="80" rx="14" fill="#7a8aa0" ${O}/>
    <path d="M128 70 Q228 66 232 136 Q232 200 160 200 L128 200Z" fill="#c8d4e4" ${O}/>
    <path d="M168 74 L168 130 M196 80 L196 130 M222 100 L222 132" stroke="#7a8aa0" stroke-width="6"/>
    <path d="M128 140 Q170 132 196 150" ${O} fill="none"/>
    <circle cx="96" cy="136" r="12" fill="#ff5a3a" ${O4}/>${shine(178, 96, 16, 8)}`),
  stamina: () => svg(`<rect x="88" y="20" width="80" height="34" rx="8" fill="#e8323a" ${O}/>
    <path d="M78 64 Q78 50 100 50 L156 50 Q178 50 178 64 L184 220 Q184 240 160 240 L96 240 Q72 240 72 220Z" fill="#5be0ff" ${O}/>
    <rect x="84" y="110" width="88" height="80" rx="10" fill="#fff" ${O4}/>
    <path d="M140 118 L108 156 L130 156 L116 184 L152 144 L130 144 L144 118Z" fill="#ffd23a" ${O4}/>${shine(96, 80, 8, 20, 0)}`),
  onigiri: () => svg(`<path d="M128 26 Q170 26 210 150 Q232 220 128 224 Q24 220 46 150 Q86 26 128 26Z" fill="#fff" ${O}/>
    <path d="M70 160 L186 160 L196 222 Q128 232 60 222Z" fill="#1a3a2a" ${O}/>
    ${eye(104, 120, 13)}${eye(152, 120, 13)}${blush(84, 142)}${blush(172, 142)}
    <path d="M116 144 Q128 156 140 144" ${O4} fill="none"/>
    <circle cx="96" cy="70" r="4" fill="#e8e0d0"/><circle cx="160" cy="84" r="4" fill="#e8e0d0"/><circle cx="128" cy="56" r="4" fill="#e8e0d0"/>`),
  jimmy: () => svg(`<circle cx="128" cy="128" r="104" fill="#b08cff" opacity="0.45" ${O}/>
    <circle cx="128" cy="128" r="78" fill="none" stroke="#e0d0ff" stroke-width="6" stroke-dasharray="14 12"/>
    <path d="M92 170 Q88 96 128 90 Q168 96 164 170 L152 160 L140 172 L128 160 L116 172 L104 160Z" fill="#fff" opacity="0.85" ${O4}/>
    <circle cx="114" cy="124" r="7" fill="${INK}"/><circle cx="142" cy="124" r="7" fill="${INK}"/>
    ${shine(86, 70, 26, 12)}${sparkle(208, 50, 14)}${sparkle(44, 200, 10)}`),
};

// ---------- 繰り返し模様 ----------
const tiles = {
  ground: () => {
    let s = `<rect width="256" height="256" fill="#2e2236"/>`;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
      const x = c * 64 - (r % 2) * 32, y = r * 64;
      for (const dx of [0, 256]) s += `<rect x="${x + 4 + dx - (x < 0 ? 0 : 0)}" y="${y + 4}" width="56" height="56" rx="12" fill="#382a42"/><rect x="${x + 10 + dx}" y="${y + 8}" width="30" height="8" rx="4" fill="#44344e"/>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">${s}</svg>`;
  },
  roof: () => {
    let s = `<rect width="256" height="256" fill="#3a2048"/>`;
    for (let r = 0; r < 8; r++) for (let c = -1; c < 9; c++) {
      const x = c * 32 + (r % 2) * 16, y = r * 32;
      s += `<path d="M${x} ${y + 30} Q${x + 16} ${y - 2} ${x + 32} ${y + 30}" fill="#55306a" stroke="#22102e" stroke-width="4"/>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">${s}</svg>`;
  },
};

// 書き出す絵の一覧: [保存先キー, SVG, 出力サイズ]
function all() {
  const out = [];
  // 妖怪は tools/yokai-gen.js が look 指定から組み合わせて描く
  for (const y of YOKAI) out.push([`yokai/${y.id}`, drawYokai(y), 192]);
  out.push(['oni/patrol', oniPatrol(), 256]);
  for (const [type, look] of Object.entries(BOSS_LOOK)) out.push([`oni/boss-${type}`, oniBoss(look), 384]);
  for (const [id, f] of Object.entries(ITEM)) out.push([`item/${id}`, f(), 128]);
  out.push(['scene/ground', tiles.ground(), 256]);
  out.push(['scene/roof', tiles.roof(), 256]);
  return out;
}

module.exports = { all };
