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
const angryEye = (cx, cy, r, side, iris = INK) => eye(cx, cy, r, -side * 0.3, 0.6, iris) +
  `<path d="M${cx - r * 1.1} ${cy - r * (side > 0 ? 1.5 : 0.9)} L${cx + r * 1.1} ${cy - r * (side > 0 ? 0.9 : 1.5)}" ${O} fill="none"/>`;
const blush = (cx, cy) => `<ellipse cx="${cx}" cy="${cy}" rx="9" ry="5" fill="#ff7aa8" opacity="0.55"/>`;
const glow = (id, cx, cy, r, c, op = 0.6) => `<radialGradient id="${id}"><stop offset="0" stop-color="${c}" stop-opacity="${op}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id})"/>`;
const shadow = (cx = 128, w = 60) => `<ellipse cx="${cx}" cy="238" rx="${w}" ry="10" fill="#000" opacity="0.25"/>`;
const shine = (cx, cy, rx, ry, rot = -25) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" opacity="0.4" transform="rotate(${rot} ${cx} ${cy})"/>`;
const sparkle = (x, y, s, c = '#fff6a0') => `<path d="M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s}Z" fill="${c}" stroke="${INK}" stroke-width="2"/>`;

// ランクの後光
function aura(rank, color) {
  if (rank === 'S') return {
    defs: `<radialGradient id="aura"><stop offset="0.35" stop-color="#ffe680" stop-opacity="0.9"/><stop offset="1" stop-color="#ffb000" stop-opacity="0"/></radialGradient>`,
    body: `<circle cx="128" cy="128" r="124" fill="url(#aura)"/>` +
      Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6; return `<path d="M128 128 L${128 + Math.cos(a - 0.08) * 126} ${128 + Math.sin(a - 0.08) * 126} L${128 + Math.cos(a + 0.08) * 126} ${128 + Math.sin(a + 0.08) * 126}Z" fill="#fff3a0" opacity="0.35"/>`; }).join(''),
    top: sparkle(30, 40, 12) + sparkle(222, 60, 10) + sparkle(214, 200, 8),
  };
  if (rank === 'A') return {
    defs: `<radialGradient id="aura"><stop offset="0.4" stop-color="${color}" stop-opacity="0.55"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
    body: `<circle cx="128" cy="130" r="120" fill="url(#aura)"/>`,
    top: sparkle(36, 52, 9, '#ffffff') + sparkle(220, 70, 7, '#ffffff'),
  };
  return { defs: '', body: '', top: '' };
}
const withAura = (rank, color, defs, body) => { const a = aura(rank, color); return svg(a.body + body + a.top, a.defs + defs); };

// ---------- 妖怪 ----------
const Y = {};

Y.nekomata = () => svg(`${shadow()}
  <path d="M96 200 C40 196 30 140 52 112 C62 100 74 112 64 124 C52 142 60 176 100 184Z" fill="#ff9a5c" ${O}/>
  <path d="M100 210 C46 222 18 186 26 156 C30 142 46 148 42 162 C38 186 64 200 100 196Z" fill="#ff9a5c" ${O}/>
  <circle cx="54" cy="114" r="9" fill="#fff" ${O4}/><circle cx="32" cy="156" r="9" fill="#fff" ${O4}/>
  <ellipse cx="108" cy="228" rx="20" ry="11" fill="#ffb27a" ${O}/><ellipse cx="150" cy="228" rx="20" ry="11" fill="#ffb27a" ${O}/>
  <ellipse cx="129" cy="188" rx="46" ry="42" fill="#ff8a4a" ${O}/>
  <ellipse cx="129" cy="196" rx="28" ry="26" fill="#fff1e0"/>
  <path d="M70 62 L78 18 L110 50Z" fill="#ff8a4a" ${O}/><path d="M186 62 L178 18 L146 50Z" fill="#ff8a4a" ${O}/>
  <path d="M80 54 L84 32 L100 48Z" fill="#ffb0c0"/><path d="M176 54 L172 32 L156 48Z" fill="#ffb0c0"/>
  <ellipse cx="128" cy="98" rx="66" ry="56" fill="#ff8a4a" ${O}/>
  <path d="M100 52 L108 70 L116 50 M140 50 L148 70 L156 52" stroke="#c85a20" stroke-width="5" fill="none" stroke-linecap="round"/>
  ${shine(98, 70, 16, 8)}
  ${eye(104, 96, 15, 0.4, 0.3)}${eye(152, 96, 15, -0.2, 0.3)}
  ${blush(86, 118)}${blush(170, 118)}
  <path d="M120 118 Q128 126 136 118 M128 114 L128 122" ${O4} fill="none"/>
  <path d="M118 122 Q124 130 128 122 Q132 130 138 122" ${O4} fill="none"/>
  <path d="M60 108 L84 112 M60 122 L84 118 M196 108 L172 112 M196 122 L172 118" ${O4}/>
  <circle cx="76" cy="168" r="18" fill="#ffb27a" ${O}/><circle cx="182" cy="156" r="18" fill="#ffb27a" ${O}/>
  <path d="M70 162 L76 170 L82 162 M176 150 L182 158 L188 150" ${O4} fill="none"/>
  <path d="M196 136 L208 128 M200 152 L214 150 M194 120 L200 108" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`);

Y.kasabou = () => svg(`${shadow(128, 40)}
  <path d="M112 236 L144 236 L148 226 L108 226Z" fill="#8a5a3a" ${O}/>
  <rect x="118" y="160" width="20" height="70" rx="9" fill="#f2d6b0" ${O}/>
  <path d="M18 168 Q40 50 128 24 Q216 50 238 168 Q210 152 184 168 Q156 150 128 168 Q100 150 72 168 Q46 152 18 168Z" fill="#7a8aff" ${O}/>
  <path d="M128 26 L128 166 M128 26 Q90 80 72 166 M128 26 Q166 80 184 166 M128 26 Q60 70 18 166 M128 26 Q196 70 238 166" stroke="#4a58c8" stroke-width="4" fill="none"/>
  <path d="M46 150 Q60 120 80 112" stroke="#fff" stroke-width="6" opacity="0.45" fill="none" stroke-linecap="round"/>
  <circle cx="128" cy="20" r="9" fill="#e8c050" ${O4}/>
  <circle cx="128" cy="98" r="34" fill="#fff" ${O}/>
  <circle cx="132" cy="104" r="18" fill="${INK}"/><circle cx="124" cy="94" r="7" fill="#fff"/>
  <path d="M96 62 Q128 50 160 62" ${O} fill="none"/>
  <path d="M112 142 Q128 154 144 142" ${O4} fill="#5a1020"/>
  <path d="M124 146 Q122 182 140 190 Q150 178 136 146Z" fill="#ff5a7a" ${O4}/>
  <path d="M30 118 L6 100 M226 118 L250 100" stroke="#4a58c8" stroke-width="6" stroke-linecap="round"/>`);

Y.chochin = () => svg(`${shadow(128, 46)}
  ${glow("g1", 128, 130, 124, "#ffb050", 0.7)}
  <rect x="96" y="20" width="64" height="20" rx="6" fill="${INK}"/>
  <rect x="96" y="216" width="64" height="20" rx="6" fill="${INK}"/>
  <path d="M100 36 Q42 60 42 128 Q42 196 100 220 L156 220 Q214 196 214 128 Q214 60 156 36Z" fill="#ffb35c" ${O}/>
  <path d="M60 70 Q128 82 196 70 M48 104 Q128 116 208 104 M46 140 Q128 152 210 140 M54 176 Q128 188 202 176" stroke="#e07a2a" stroke-width="4" fill="none"/>
  ${shine(76, 86, 14, 26, 15)}
  ${eye(104, 108, 14, 0, 0.4)}${eye(152, 108, 14, 0, 0.4)}
  ${blush(82, 134)}${blush(174, 134)}
  <path d="M96 140 Q128 186 160 140Z" fill="#7a1a20" ${O}/>
  <path d="M112 158 Q128 176 144 158 Q128 168 112 158Z" fill="#ff6a7a"/>
  <path d="M44 128 Q20 120 22 100 M212 128 Q236 120 234 100" ${O} fill="none"/>
  <circle cx="22" cy="96" r="9" fill="#ffd8a0" ${O4}/><circle cx="234" cy="96" r="9" fill="#ffd8a0" ${O4}/>
  ${sparkle(226, 40, 11, '#9affb0')}${sparkle(34, 190, 9, '#9affb0')}`);

Y.hitodama = () => svg(`${shadow(128, 36)}
  ${glow("g1", 128, 150, 116, "#7ae6ff", 0.7)}
  <path d="M128 228 C70 228 54 176 70 140 C82 112 96 104 92 70 C110 84 116 98 118 60 C136 78 140 96 150 40 C172 76 196 110 196 156 C196 200 168 228 128 228Z" fill="#9ef0ff" ${O}/>
  <path d="M128 214 C90 214 80 180 92 156 C104 136 124 148 128 130 C140 150 170 150 172 176 C176 200 156 214 128 214Z" fill="#dafbff"/>
  ${eye(106, 166, 15, 0.3, 0.2, '#2a5aa0')}${eye(152, 166, 15, -0.3, 0.2, '#2a5aa0')}
  ${blush(90, 190)}${blush(168, 190)}
  <path d="M118 194 Q128 204 138 194" ${O4} fill="none"/>
  <path d="M206 104 C200 92 210 82 206 70 C220 80 228 94 222 106 C218 116 208 114 206 104Z" fill="#4ac8ff" ${O4}/>
  <path d="M40 120 C36 110 44 102 40 92 C52 100 58 112 52 122 C48 130 42 128 40 120Z" fill="#4ac8ff" ${O4}/>`);

Y.kappado = () => svg(`${shadow()}
  <ellipse cx="128" cy="186" rx="62" ry="46" fill="#a0703a" ${O}/>
  <path d="M80 170 L176 170 M88 196 L168 196" stroke="#6a4520" stroke-width="5"/>
  <ellipse cx="106" cy="228" rx="18" ry="10" fill="#3fcf8e" ${O}/><ellipse cx="152" cy="228" rx="18" ry="10" fill="#3fcf8e" ${O}/>
  <ellipse cx="128" cy="190" rx="40" ry="38" fill="#3fcf8e" ${O}/>
  <ellipse cx="128" cy="198" rx="24" ry="24" fill="#e8f5a0"/>
  <path d="M190 172 L234 72" stroke="#2a8a4a" stroke-width="16" stroke-linecap="round"/>
  <path d="M190 172 L234 72" stroke="#7ae07a" stroke-width="9" stroke-linecap="round"/>
  <path d="M182 176 L202 164" ${O} />
  <circle cx="186" cy="174" r="14" fill="#3fcf8e" ${O}/>
  <circle cx="70" cy="180" r="14" fill="#3fcf8e" ${O}/>
  <ellipse cx="128" cy="98" rx="62" ry="56" fill="#3fcf8e" ${O}/>
  <path d="M70 80 Q74 50 92 58 Q96 40 114 50 Q128 36 142 50 Q160 40 164 58 Q182 50 186 80" fill="#1a6a4a" ${O}/>
  <ellipse cx="128" cy="52" rx="34" ry="12" fill="#e8f8ff" ${O}/><ellipse cx="128" cy="50" rx="22" ry="6" fill="#8ad8ff"/>
  <path d="M72 84 Q128 70 184 84" stroke="#e8323a" stroke-width="10" fill="none" stroke-linecap="round"/>
  ${angryEye(106, 102, 13, -1)}${angryEye(150, 102, 13, 1)}
  <path d="M110 126 Q128 116 146 126 Q138 146 128 146 Q118 146 110 126Z" fill="#ffd24a" ${O4}/>
  ${shine(92, 76, 12, 6)}`);

Y.nurikabe = () => svg(`${shadow(128, 76)}
  <rect x="80" y="210" width="34" height="24" rx="8" fill="#9a8a70" ${O}/><rect x="142" y="210" width="34" height="24" rx="8" fill="#9a8a70" ${O}/>
  <rect x="40" y="30" width="176" height="190" rx="28" fill="#c8b894" ${O}/>
  <path d="M44 74 L212 74 M44 118 L212 118 M44 162 L212 162 M100 34 L100 74 M160 34 L160 74 M70 74 L70 118 M130 74 L130 118 M190 74 L190 118 M100 118 L100 162 M160 118 L160 162 M70 162 L70 216 M130 162 L130 216 M190 162 L190 216" stroke="#9a8a6a" stroke-width="4"/>
  <rect x="40" y="30" width="176" height="190" rx="28" fill="none" ${O}/>
  ${shine(76, 54, 22, 8, -5)}
  <path d="M40 136 Q128 156 216 136" stroke="#e8e0c0" stroke-width="12" fill="none"/>
  <path d="M40 136 Q128 156 216 136" stroke="#c84a3a" stroke-width="4" fill="none" stroke-dasharray="10 8"/>
  ${angryEye(100, 98, 14, -1)}${angryEye(156, 98, 14, 1)}
  <path d="M108 128 Q128 120 148 128" ${O} fill="none"/>
  <rect x="10" y="120" width="36" height="34" rx="14" fill="#b8a884" ${O}/><rect x="210" y="120" width="36" height="34" rx="14" fill="#b8a884" ${O}/>`);

Y.yukinko = () => svg(`${shadow(128, 50)}
  <path d="M80 228 L94 130 L162 130 L176 228Z" fill="#eaf6ff" ${O}/>
  <path d="M128 130 L100 228 M128 130 L156 228" stroke="#a8d8ff" stroke-width="4"/>
  <rect x="88" y="150" width="80" height="18" rx="4" fill="#6ab8ff" ${O4}/>
  <path d="M94 134 L62 184 L84 190Z M162 134 L194 184 L172 190Z" fill="#d8eeff" ${O}/>
  <circle cx="128" cy="86" r="52" fill="#1a1a3a" ${O}/>
  <path d="M80 92 Q82 128 104 132 L152 132 Q174 128 176 92Z" fill="#1a1a3a"/>
  <ellipse cx="128" cy="96" rx="40" ry="38" fill="#fff4f8" ${O}/>
  <path d="M88 86 Q96 56 128 54 Q160 56 168 86 Q150 70 128 72 Q106 70 88 86Z" fill="#1a1a3a"/>
  ${eye(112, 100, 11, 0, 0.3, '#3a6ac8')}${eye(146, 100, 11, 0, 0.3, '#3a6ac8')}
  ${blush(100, 118)}${blush(158, 118)}
  <path d="M122 122 Q128 126 134 122" ${O4} fill="none"/>
  <circle cx="160" cy="54" r="10" fill="#8ad8ff" ${O4}/>
  ${['M34 60', 'M212 110', 'M44 170', 'M210 30'].map((m, i) => { const [x, y] = m.slice(1).split(' ').map(Number); const s = 12 - i * 1.5; return `<path d="M${x - s} ${y} L${x + s} ${y} M${x} ${y - s} L${x} ${y + s} M${x - s * 0.7} ${y - s * 0.7} L${x + s * 0.7} ${y + s * 0.7} M${x - s * 0.7} ${y + s * 0.7} L${x + s * 0.7} ${y - s * 0.7}" stroke="#bfeaff" stroke-width="4" stroke-linecap="round"/>`; }).join('')}`);

Y.tenguri = () => svg(`${shadow()}
  <path d="M78 120 Q20 90 12 140 Q40 132 50 150 Q60 130 86 150Z" fill="#2a2a3a" ${O}/>
  <path d="M178 120 Q236 90 244 140 Q216 132 206 150 Q196 130 170 150Z" fill="#2a2a3a" ${O}/>
  <path d="M86 228 L96 140 L160 140 L170 228Z" fill="#f4f0e8" ${O}/>
  <circle cx="110" cy="150" r="9" fill="#ff7a3a" ${O4}/><circle cx="146" cy="150" r="9" fill="#ff7a3a" ${O4}/>
  <path d="M100 196 L156 196" stroke="#2a2a3a" stroke-width="10"/>
  <ellipse cx="128" cy="96" rx="50" ry="48" fill="#e05050" ${O}/>
  <path d="M120 104 Q128 100 136 104 L196 132 Q200 140 190 140 L132 120Z" fill="#e05050" ${O}/>
  <path d="M104 40 L152 40 L146 58 L110 58Z" fill="#2a2a3a" ${O}/>
  ${angryEye(108, 90, 11, -1)}${angryEye(148, 90, 11, 1)}
  <path d="M90 116 Q100 124 110 118" ${O4} fill="none"/>
  <path d="M196 196 Q230 150 220 110 Q186 130 186 176Z" fill="#7ad07a" ${O}/>
  <path d="M190 192 L216 124" stroke="#3a8a3a" stroke-width="4"/>
  <path d="M30 196 Q50 186 70 196 M24 214 Q52 202 76 214" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.8"/>`);

Y.raijin = () => withAura('A', '#ffe14a', '', `${shadow()}
  <circle cx="128" cy="108" r="86" fill="none" stroke="#c84a3a" stroke-width="8"/>
  ${Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; const x = 128 + Math.cos(a) * 86, y = 108 + Math.sin(a) * 86; return `<circle cx="${x}" cy="${y}" r="14" fill="#e8b040" ${O4}/><circle cx="${x}" cy="${y}" r="5" fill="#c84a3a"/>`; }).join('')}
  <path d="M90 196 L166 196 L174 228 L82 228Z" fill="#ffd23a" ${O}/>
  <path d="M100 200 L104 224 M120 200 L118 226 M140 200 L144 226 M158 200 L156 224" stroke="${INK}" stroke-width="5"/>
  <ellipse cx="128" cy="172" rx="40" ry="32" fill="#ffd8b0" ${O}/>
  <ellipse cx="128" cy="102" rx="50" ry="48" fill="#ffd8b0" ${O}/>
  <path d="M74 96 L64 50 L92 72 L96 30 L116 62 L128 22 L140 62 L160 30 L164 72 L192 50 L182 96 Q170 66 128 64 Q86 66 74 96Z" fill="#ffe14a" ${O}/>
  <path d="M96 66 L90 44 L106 60Z M160 66 L166 44 L150 60Z" fill="#fff" ${O4}/>
  ${angryEye(108, 104, 12, -1)}${angryEye(148, 104, 12, 1)}
  <path d="M112 128 Q128 140 144 128" ${O4} fill="#7a1a20"/>
  <circle cx="70" cy="170" r="17" fill="#ffd8b0" ${O}/><circle cx="186" cy="170" r="17" fill="#ffd8b0" ${O}/>
  <path d="M40 150 L58 160 L48 168 L68 182 M216 150 L198 160 L208 168 L188 182" stroke="#fff27a" stroke-width="6" fill="none" stroke-linejoin="round"/>`);

Y.gashadoku = () => withAura('A', '#7ab8ff', '', `${shadow(128, 70)}
  <path d="M80 232 L86 176 L170 176 L176 232Z" fill="#3a3a5a" ${O}/>
  <path d="M86 196 L170 196 M84 214 L172 214" stroke="#8a8ab0" stroke-width="5"/>
  <rect x="84" y="150" width="88" height="40" rx="10" fill="#5a5a8a" ${O}/>
  <path d="M100 150 L100 190 M128 150 L128 190 M156 150 L156 190" stroke="#8a8ab0" stroke-width="4"/>
  <path d="M10 120 Q10 92 40 92 L70 92 Q80 140 70 214 L40 214 Q10 214 10 186Z" fill="#f0ead8" ${O}/>
  <path d="M28 110 L28 196 M50 104 L52 206" stroke="#c8c0a8" stroke-width="5"/>
  <ellipse cx="128" cy="102" rx="56" ry="54" fill="#f4f0e4" ${O}/>
  <path d="M66 82 Q70 40 128 34 Q186 40 190 82 Z" fill="#3a3a5a" ${O}/>
  <path d="M100 40 Q80 4 66 10 Q86 24 108 44 M156 40 Q176 4 190 10 Q170 24 148 44" fill="#ffd23a" ${O4}/>
  <ellipse cx="104" cy="104" rx="16" ry="18" fill="${INK}"/><ellipse cx="152" cy="104" rx="16" ry="18" fill="${INK}"/>
  <circle cx="104" cy="104" r="8" fill="#7ad8ff"/><circle cx="152" cy="104" r="8" fill="#7ad8ff"/>
  <path d="M122 126 L128 116 L134 126Z" fill="${INK}"/>
  <path d="M96 140 L160 140 M104 134 L104 146 M116 134 L116 148 M128 134 L128 148 M140 134 L140 148 M152 134 L152 146" stroke="${INK}" stroke-width="4"/>
  <circle cx="200" cy="170" r="16" fill="#f4f0e4" ${O}/>`);

Y.hakutaku = () => withAura('A', '#c8ffda', '', `${shadow()}
  <path d="M70 230 Q64 150 128 140 Q192 150 186 230Z" fill="#fff" ${O}/>
  ${[[100, 180], [156, 180], [128, 206], [92, 214], [164, 214]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="9" ry="6" fill="#fff" ${O4}/><circle cx="${x}" cy="${y}" r="3.5" fill="#c84a8a"/>`).join('')}
  <path d="M70 230 Q64 150 128 140 Q192 150 186 230" fill="none" stroke="#ffc8ec" stroke-width="6" opacity="0.8"/>
  <path d="M84 70 Q60 30 70 10 Q84 40 100 58Z M172 70 Q196 30 186 10 Q172 40 156 58Z" fill="#f6e6b0" ${O}/>
  <ellipse cx="128" cy="98" rx="54" ry="50" fill="#fff8fc" ${O}/>
  <path d="M74 98 Q68 50 128 44 Q188 50 182 98 Q170 70 150 66 Q128 80 106 66 Q86 70 74 98Z" fill="#ffc8ec" ${O}/>
  <path d="M76 98 Q64 150 84 170 M180 98 Q192 150 172 170" stroke="#ffc8ec" stroke-width="14" fill="none" stroke-linecap="round"/>
  ${eye(108, 104, 12, 0, 0.3, '#3a9a6a')}${eye(148, 104, 12, 0, 0.3, '#3a9a6a')}
  <ellipse cx="128" cy="76" rx="6" ry="8" fill="#fff" ${O4}/><circle cx="128" cy="77" r="3" fill="#3a9a6a"/>
  ${blush(94, 122)}${blush(162, 122)}
  <path d="M120 126 Q128 132 136 126" ${O4} fill="none"/>
  ${sparkle(40, 130, 10, '#9affb0')}${sparkle(214, 150, 12, '#9affb0')}`);

Y.kitsunebi = () => withAura('A', '#ff9a2e', '', `${shadow()}
  ${Array.from({ length: 9 }, (_, i) => { const a = Math.PI * (1.08 + i * 0.105); const d = (Math.atan2(Math.sin(a), Math.cos(a)) * 180) / Math.PI; const cx = 128 + Math.cos(a) * 70, cy = 186 + Math.sin(a) * 70, tx = 128 + Math.cos(a) * 112, ty = 186 + Math.sin(a) * 112; return `<ellipse cx="${cx}" cy="${cy}" rx="50" ry="17" fill="#ff9a2e" ${O4} transform="rotate(${d} ${cx} ${cy})"/><circle cx="${tx}" cy="${ty}" r="12" fill="#fff4e0" ${O4}/>`; }).join('')}
  <path d="M92 228 Q88 160 128 150 Q168 160 164 228Z" fill="#ff9a2e" ${O}/>
  <path d="M110 228 Q108 180 128 172 Q148 180 146 228Z" fill="#fff4e0"/>
  <path d="M82 70 L72 20 L112 52Z M174 70 L184 20 L144 52Z" fill="#ff9a2e" ${O}/>
  <path d="M86 58 L82 34 L102 52Z M170 58 L174 34 L154 52Z" fill="${INK}"/>
  <path d="M74 104 Q74 54 128 50 Q182 54 182 104 Q170 140 128 146 Q86 140 74 104Z" fill="#ff9a2e" ${O}/>
  <path d="M96 118 Q128 150 160 118 Q150 140 128 142 Q106 140 96 118Z" fill="#fff4e0"/>
  <path d="M96 100 Q108 92 120 100 M136 100 Q148 92 160 100" ${O} fill="none"/>
  <path d="M124 122 L132 122 L128 128Z" fill="${INK}"/>
  <path d="M104 74 L110 84 M152 74 L146 84" stroke="#c83a1a" stroke-width="5" stroke-linecap="round"/>
  <path d="M198 120 Q232 170 198 220" stroke="#c83a1a" stroke-width="8" fill="none" stroke-linecap="round"/>
  <path d="M198 120 L198 220" stroke="#fff27a" stroke-width="3"/>
  ${[[40, 70], [222, 60], [30, 200]].map(([x, y]) => `<path d="M${x} ${y + 16} C${x - 14} ${y + 16} ${x - 14} ${y} ${x} ${y - 16} C${x + 14} ${y} ${x + 14} ${y + 16} ${x} ${y + 16}Z" fill="#6ae0ff" ${O4}/>`).join('')}`);

Y.susanoo = () => withAura('S', '#5c7cff', '', `${shadow()}
  <path d="M60 80 Q20 140 40 220 Q70 180 76 140Z M196 80 Q236 140 216 220 Q186 180 180 140Z" fill="#3a5ad8" ${O}/>
  <path d="M84 230 L92 150 L164 150 L172 230Z" fill="#e8f0ff" ${O}/>
  <path d="M92 150 L128 190 L164 150 L156 176 L128 200 L100 176Z" fill="#ffd23a" ${O4}/>
  <path d="M96 210 L160 210" stroke="#3a5ad8" stroke-width="10"/>
  <path d="M200 160 L232 18" stroke="#c8d8ff" stroke-width="14" stroke-linecap="round"/>
  <path d="M200 160 L232 18" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
  <path d="M186 162 L216 170" stroke="#ffd23a" stroke-width="10" stroke-linecap="round"/>
  <circle cx="196" cy="174" r="15" fill="#ffd8b0" ${O}/>
  <ellipse cx="128" cy="100" rx="50" ry="50" fill="#ffd8b0" ${O}/>
  <path d="M70 110 Q60 40 128 34 Q196 40 186 110 Q178 70 160 64 L150 82 L138 62 L128 84 L118 62 L106 82 L96 64 Q78 70 70 110Z" fill="#3a5ad8" ${O}/>
  <path d="M96 58 L128 44 L160 58" stroke="#ffd23a" stroke-width="8" fill="none" stroke-linecap="round"/>
  ${angryEye(108, 108, 12, -1, '#2a4ab8')}${angryEye(148, 108, 12, 1, '#2a4ab8')}
  <path d="M116 134 Q128 140 140 134" ${O4} fill="none"/>
  <path d="M24 96 Q44 84 40 66 M226 230 Q206 210 222 196" stroke="#bfe0ff" stroke-width="6" fill="none" stroke-linecap="round"/>`);

Y.daidara = () => withAura('S', '#7a5c3a', '', `${shadow(128, 90)}
  <rect x="74" y="200" width="44" height="34" rx="12" fill="#6a4a2a" ${O}/><rect x="138" y="200" width="44" height="34" rx="12" fill="#6a4a2a" ${O}/>
  <path d="M40 120 Q40 60 128 54 Q216 60 216 120 L210 208 Q128 222 46 208Z" fill="#8a643a" ${O}/>
  <path d="M60 150 Q90 160 110 150 M150 170 Q170 160 196 172 M70 190 Q100 184 120 196" stroke="#6a4a2a" stroke-width="5" fill="none"/>
  <path d="M40 72 L56 30 L72 72Z M180 66 L198 20 L216 66Z" fill="#3a9a4a" ${O}/>
  <rect x="52" y="70" width="8" height="12" fill="#6a4a2a"/><rect x="194" y="64" width="8" height="12" fill="#6a4a2a"/>
  <path d="M100 52 Q128 20 156 52" fill="#4ab85a" ${O}/>
  <ellipse cx="128" cy="104" rx="56" ry="40" fill="#a07a4a" ${O}/>
  <ellipse cx="104" cy="104" rx="14" ry="10" fill="#ffe14a" ${O4}/><ellipse cx="152" cy="104" rx="14" ry="10" fill="#ffe14a" ${O4}/>
  <circle cx="104" cy="104" r="4" fill="${INK}"/><circle cx="152" cy="104" r="4" fill="${INK}"/>
  <path d="M86 88 L118 94 M170 88 L138 94" ${O} fill="none"/>
  <path d="M108 128 L148 128" ${O} fill="none"/>
  <circle cx="30" cy="170" r="30" fill="#8a643a" ${O}/><circle cx="226" cy="170" r="30" fill="#8a643a" ${O}/>
  <path d="M18 160 L42 164 M20 178 L40 178 M238 160 L214 164 M236 178 L216 178" stroke="#6a4a2a" stroke-width="4"/>`);

Y.amaterasu = () => withAura('S', '#fff27a', '', `${shadow()}
  <circle cx="128" cy="96" r="76" fill="#ffd23a" opacity="0.6" ${O4}/>
  ${Array.from({ length: 16 }, (_, i) => { const a = (i * Math.PI) / 8; return `<path d="M${128 + Math.cos(a) * 78} ${96 + Math.sin(a) * 78} L${128 + Math.cos(a) * 96} ${96 + Math.sin(a) * 96}" stroke="#ffb000" stroke-width="6" stroke-linecap="round"/>`; }).join('')}
  <path d="M74 232 Q76 150 128 140 Q180 150 182 232Z" fill="#fff" ${O}/>
  <path d="M74 232 Q80 176 102 160 L102 232Z M182 232 Q176 176 154 160 L154 232Z" fill="#e8323a" ${O4}/>
  <path d="M106 146 L128 176 L150 146" stroke="#ffd23a" stroke-width="8" fill="none"/>
  <circle cx="128" cy="196" r="16" fill="#c8e8ff" ${O4}/>${shine(122, 190, 5, 3)}
  <path d="M74 100 Q70 160 64 200 L92 200 Q86 150 88 100Z M182 100 Q186 160 192 200 L164 200 Q170 150 168 100Z" fill="#1a1a2a" ${O4}/>
  <ellipse cx="128" cy="102" rx="44" ry="44" fill="#fff4ec" ${O}/>
  <path d="M82 104 Q78 54 128 50 Q178 54 174 104 Q160 72 128 70 Q96 72 82 104Z" fill="#1a1a2a" ${O}/>
  <path d="M110 60 L128 40 L146 60" fill="#ffd23a" ${O4}/>
  <path d="M104 106 Q112 100 120 106 M136 106 Q144 100 152 106" ${O} fill="none"/>
  ${blush(98, 120)}${blush(158, 120)}
  <path d="M122 124 Q128 130 134 124" ${O4} fill="none"/>`);

Y.yatagarasu = () => withAura('S', '#3a2a5c', '', `${shadow()}
  <path d="M100 130 Q40 60 4 90 Q30 100 22 120 Q44 116 46 138 Q66 128 72 150 Q90 136 104 160Z" fill="#2a2040" ${O}/>
  <path d="M156 130 Q216 60 252 90 Q226 100 234 120 Q212 116 210 138 Q190 128 184 150 Q166 136 152 160Z" fill="#2a2040" ${O}/>
  <path d="M30 104 L60 120 M44 126 L70 136 M226 104 L196 120 M212 126 L186 136" stroke="#5a4a80" stroke-width="4"/>
  <path d="M104 214 L98 236 M128 216 L128 238 M152 214 L158 236" stroke="#e8a030" stroke-width="7" stroke-linecap="round"/>
  <ellipse cx="128" cy="170" rx="44" ry="50" fill="#2a2040" ${O}/>
  <circle cx="128" cy="172" r="20" fill="#ffd23a" ${O4}/>
  ${Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; return `<path d="M${128 + Math.cos(a) * 22} ${172 + Math.sin(a) * 22} L${128 + Math.cos(a) * 30} ${172 + Math.sin(a) * 30}" stroke="#ffd23a" stroke-width="4" stroke-linecap="round"/>`; }).join('')}
  <circle cx="128" cy="92" r="44" fill="#2a2040" ${O}/>
  <path d="M120 98 L176 112 L120 120Z" fill="#e8a030" ${O}/>
  ${angryEye(108, 86, 11, -1, '#e8323a')}${angryEye(146, 86, 11, 1, '#e8323a')}
  <path d="M110 50 Q118 30 130 48 Q138 28 148 50" fill="#2a2040" ${O4}/>`);

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
  for (const [id, f] of Object.entries(Y)) out.push([`yokai/${id}`, f(), 256]);
  // 手描きでない妖怪は tools/yokai-gen.js で組み合わせて描く
  for (const y of YOKAI) if (!Y[y.id]) out.push([`yokai/${y.id}`, drawYokai(y), 192]);
  out.push(['oni/patrol', oniPatrol(), 256]);
  for (const [type, look] of Object.entries(BOSS_LOOK)) out.push([`oni/boss-${type}`, oniBoss(look), 384]);
  for (const [id, f] of Object.entries(ITEM)) out.push([`item/${id}`, f(), 128]);
  out.push(['scene/ground', tiles.ground(), 256]);
  out.push(['scene/roof', tiles.roof(), 256]);
  return out;
}

module.exports = { all };
