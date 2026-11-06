// 三鬼合戦: ボス鬼3体が同時に出るモードの、出てくる鬼の決め方と「合体技」
// 二鬼合体技（全78種類）: 2体が近くにいると出す。ならび方（lay）・当たったときの効果（eff）・残るもの（hz）の組み合わせで、それぞれ別の技にする
// 三鬼奥義（全286種類）: 3体がそろうと出す。3体の「はたらき」が1つに合わさった大技（三角形のまん中だけ一瞬安全）
'use strict';
const crypto = require('crypto');

// 出てくる鬼（赤鬼・青鬼・黒鬼は出ない。双子鬼は1体で2体分なので出さない。鬼神・真は鬼神が覚醒したときだけ）
const POOL = ['gold', 'white', 'fuurai', 'kishin', 'yakubyo', 'kage', 'nue', 'kyubi', 'toki', 'gasha', 'amanojaku', 'gokuou', 'hyakki'];
const SEAL = { gold: '金', white: '氷', fuurai: '雷', kishin: '神', yakubyo: '疫', kage: '影', nue: '闇', kyubi: '狐', toki: '刻', gasha: '骨', amanojaku: '逆', gokuou: '獄', hyakki: '魂' };
// 三鬼奥義で、それぞれの鬼が足す効果
const SIG = { gold: ['knock'], white: ['slow'], fuurai: ['shock'], kishin: [], yakubyo: ['curse'], kage: ['drain'], nue: ['dark'], kyubi: ['charm'], toki: ['slow'], gasha: ['knock'], amanojaku: ['rev'], gokuou: [], hyakki: ['curse'] };
const SIG_HZ = { kishin: 'fire', gokuou: 'fire', yakubyo: 'poison', white: 'ice' };
const HP_MUL = 2.4, DMG_MUL = 2.0; // 強さ: ふつうのボスの体力2.4倍・攻撃2倍（神2体で倒せてしまったので強くした）

// [名前, ならび方, 効果, 残るもの, 予告の見た目]
// ならび方: cage=人を囲む檻（出口1か所） chase=鬼から人へ続く列 rain=まわりに降る spokes=鬼から放射状の光線 ring=鬼のまわりの輪
//           judge=1人に3回 pincer=2体のあいだ cross=人の上で十字 parade=横切る行列 nova=2体のまん中に大爆発
const PAIRS = {
  'gold|white': ['金氷の牢', 'cage', ['slow'], 'ice', 'ice'],
  'gold|fuurai': ['雷槍突撃', 'chase', ['shock'], null, 'bolt'],
  'gold|kishin': ['黄金獄輪', 'spokes', [], 'fire', 'fire'],
  'gold|yakubyo': ['腐金の行進', 'chase', ['curse'], 'poison', 'curse'],
  'gold|kage': ['影武者の鎧', 'rain', ['drain'], null, 'shade'],
  'gold|nue': ['闇金の帳', 'chase', ['dark'], null, 'dark'],
  'gold|kyubi': ['千両狐火', 'judge', ['charm'], null, 'charm'],
  'gold|toki': ['黄金時計', 'chase', ['slow'], null, 'clock'],
  'gold|gasha': ['金剛骨掌', 'rain', ['knock'], null, 'hand'],
  'gold|amanojaku': ['あべこべ黄金', 'cross', ['rev'], null, 'mimic'],
  'gold|gokuou': ['金棒裁き', 'judge', ['knock'], 'fire', 'fire'],
  'gold|hyakki': ['黄金行列', 'parade', ['knock'], null, 'soul'],
  'white|fuurai': ['氷嵐雷鳴', 'rain', ['slow', 'shock'], 'ice', 'ice'],
  'white|kishin': ['凍獄大なぎ', 'spokes', ['slow'], 'ice', 'ice'],
  'white|yakubyo': ['凍える疫', 'rain', ['curse', 'freeze'], null, 'curse'],
  'white|kage': ['氷影', 'rain', ['freeze'], 'ice', 'ice'],
  'white|nue': ['白闇', 'nova', ['dark', 'slow'], null, 'dark'],
  'white|kyubi': ['雪狐の幻', 'rain', ['charm', 'slow'], null, 'charm'],
  'white|toki': ['凍結時', 'nova', ['slow'], 'ice', 'clock'],
  'white|gasha': ['氷骨墜', 'rain', ['freeze'], 'ice', 'hand'],
  'white|amanojaku': ['逆さ雪', 'nova', ['pull', 'slow'], null, 'ice'],
  'white|gokuou': ['寒獄の裁き', 'cage', ['freeze'], 'ice', 'ice'],
  'white|hyakki': ['雪女行列', 'parade', ['slow'], 'ice', 'ice'],
  'fuurai|kishin': ['雷神大薙', 'spokes', ['shock'], null, 'bolt'],
  'fuurai|yakubyo': ['疫風', 'parade', ['curse', 'knock'], 'poison', 'curse'],
  'fuurai|kage': ['雷影分身', 'chase', ['shock'], null, 'bolt'],
  'fuurai|nue': ['雷鳴の闇', 'rain', ['dark', 'shock'], null, 'bolt'],
  'fuurai|kyubi': ['狐の嫁入り', 'rain', ['charm', 'shock'], null, 'bolt'],
  'fuurai|toki': ['時雷', 'judge', ['shock'], null, 'clock'],
  'fuurai|gasha': ['骨嵐', 'spokes', ['knock'], null, 'wind'],
  'fuurai|amanojaku': ['逆風', 'nova', ['pull'], null, 'wind'],
  'fuurai|gokuou': ['雷刑', 'judge', ['shock'], null, 'bolt'],
  'fuurai|hyakki': ['百鬼嵐行', 'ring', ['knock'], null, 'wind'],
  'kishin|yakubyo': ['疫獄', 'ring', ['curse'], 'poison', 'curse'],
  'kishin|kage': ['影の大なぎ', 'spokes', ['drain'], null, 'shade'],
  'kishin|nue': ['冥闇なぎ払い', 'spokes', ['dark'], null, 'dark'],
  'kishin|kyubi': ['九尾大輪', 'spokes9', ['charm'], 'fire', 'fire'],
  'kishin|toki': ['巻き戻しなぎ', 'spokes2', ['slow'], 'fire', 'clock'],
  'kishin|gasha': ['骨断大なぎ', 'cross', ['knock'], 'fire', 'hand'],
  'kishin|amanojaku': ['逆回り大輪', 'spokes', ['rev'], 'fire', 'mimic'],
  'kishin|gokuou': ['閻魔大薙', 'ring', [], 'fire', 'fire'],
  'kishin|hyakki': ['百鬼大薙', 'spokes', ['curse'], null, 'soul'],
  'yakubyo|kage': ['影疫', 'rain', ['curse', 'drain'], 'poison', 'curse'],
  'yakubyo|nue': ['瘴気の闇', 'rain', ['dark', 'curse'], 'poison', 'dark'],
  'yakubyo|kyubi': ['毒狐の魅了', 'judge', ['charm', 'curse'], 'poison', 'charm'],
  'yakubyo|toki': ['刻毒', 'judge', ['curse', 'slow'], 'poison', 'clock'],
  'yakubyo|gasha': ['死骨の疫', 'rain', ['curse'], 'poison', 'hand'],
  'yakubyo|amanojaku': ['逆さ疫', 'nova', ['curse', 'rev'], 'poison', 'curse'],
  'yakubyo|gokuou': ['疫の裁き', 'judge', ['curse'], 'poison', 'curse'],
  'yakubyo|hyakki': ['疫病神行列', 'parade', ['curse'], 'poison', 'soul'],
  'kage|nue': ['闇影', 'rain', ['dark', 'drain'], null, 'dark'],
  'kage|kyubi': ['影狐', 'rain', ['charm', 'drain'], null, 'charm'],
  'kage|toki': ['影の再生', 'chase', ['drain', 'slow'], null, 'clock'],
  'kage|gasha': ['影骨', 'rain', ['drain', 'knock'], null, 'hand'],
  'kage|amanojaku': ['あべこべ影', 'cross', ['rev', 'drain'], null, 'mimic'],
  'kage|gokuou': ['影の罪状', 'judge', ['drain'], null, 'shade'],
  'kage|hyakki': ['影百鬼', 'parade', ['drain'], null, 'shade'],
  'nue|kyubi': ['闇夜の狐火', 'rain', ['dark', 'charm'], null, 'dark'],
  'nue|toki': ['長い夜', 'nova', ['dark', 'slow'], null, 'clock'],
  'nue|gasha': ['闇の巨骨', 'rain', ['dark', 'knock'], null, 'hand'],
  'nue|amanojaku': ['さかさま闇', 'nova', ['dark', 'rev'], null, 'mimic'],
  'nue|gokuou': ['闇裁き', 'judge', ['dark'], null, 'dark'],
  'nue|hyakki': ['百鬼夜行・闇', 'parade', ['dark'], null, 'soul'],
  'kyubi|toki': ['幻時', 'chase', ['charm', 'slow'], null, 'clock'],
  'kyubi|gasha': ['骨狐', 'rain', ['charm', 'knock'], null, 'hand'],
  'kyubi|amanojaku': ['化かし合い', 'cross', ['charm', 'rev'], null, 'mimic'],
  'kyubi|gokuou': ['傾城の裁き', 'judge', ['charm'], 'fire', 'charm'],
  'kyubi|hyakki': ['狐の行列', 'ring', ['charm'], 'fire', 'fire'],
  'toki|gasha': ['止まる骨', 'pincer', ['freeze'], null, 'hand'],
  'toki|amanojaku': ['逆さ時計', 'judge', ['rev', 'slow'], null, 'clock'],
  'toki|gokuou': ['刻限の裁き', 'judge', ['slow'], null, 'clock'],
  'toki|hyakki': ['無限行列', 'parade', ['slow'], null, 'soul'],
  'gasha|amanojaku': ['逆さ骨', 'rain', ['rev', 'knock'], null, 'hand'],
  'gasha|gokuou': ['地獄の骨牢', 'cage', ['knock'], 'fire', 'hand'],
  'gasha|hyakki': ['骸骨行列', 'parade', ['knock'], null, 'hand'],
  'amanojaku|gokuou': ['逆裁き', 'judge', ['rev'], 'fire', 'mimic'],
  'amanojaku|hyakki': ['あべこべ行列', 'parade', ['rev'], null, 'mimic'],
  'gokuou|hyakki': ['地獄の大行列', 'ring', ['curse'], 'fire', 'fire'],
};
const key = (a, b) => (POOL.indexOf(a) < POOL.indexOf(b) ? `${a}|${b}` : `${b}|${a}`);
const sorted = ts => ts.slice().sort((a, b) => POOL.indexOf(a) - POOL.indexOf(b));
const SUF = ['陣', '葬', '界', '禍', '獄', '嵐', '滅', '殺'];
function tripleName(types) {
  const t = sorted(types), h = BigInt('0x' + crypto.createHash('md5').update(t.join('')).digest('hex'));
  return '三鬼奥義・' + t.map(x => SEAL[x]).join('') + SUF[Number(h % BigInt(SUF.length))];
}

function pickTypes(rnd = Math.random) {
  const a = POOL.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, 3);
}

// ---- 予告を作る道具 ----
const D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function circle(room, x, y, r, t, o) { room.telegraphs.push({ id: room.newId(), shape: 'circle', x, y, r, t, max: t, combo: 1, ...o }); }
// 中心(cx,cy)で、向き a・長さ len・はば w の長方形（予告の長方形は、はしの点からのびる形なので、はしを計算する）
function rect(room, cx, cy, a, len, w, t, o) { room.telegraphs.push({ id: room.newId(), shape: 'rect', x: cx - Math.cos(a) * len / 2, y: cy - Math.sin(a) * len / 2, a, len, w, t, max: t, combo: 1, ...o }); }
function rectFrom(room, x, y, a, len, w, t, o) { room.telegraphs.push({ id: room.newId(), shape: 'rect', x, y, a, len, w, t, max: t, combo: 1, ...o }); }

// ならび方ごとの予告
function layout(room, lay, A, B, T, o) {
  const W = 1.0; // 予告の長さの基本（秒）。合体技は長め
  const aT = Math.atan2(T.y - A.y, T.x - A.x), mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  switch (lay) {
    case 'cage': { // 人のまわりを囲む。出口は1か所だけ
      const gap = Math.random() * Math.PI * 2;
      for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; if (Math.abs(((a - gap + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.5) continue; circle(room, T.x + Math.cos(a) * 220, T.y + Math.sin(a) * 220, 70, W * 2.2, o); }
      circle(room, T.x, T.y, 130, W * 3.2, o); // しばらくしてまん中にも落ちる（出口から出よう）
      break;
    }
    case 'chase': { // 鬼から人へ、続けて落ちる
      const len = D(A, T) * 1.5 + 200;
      for (let i = 1; i <= 8; i++) { const d = (i / 8) * len; circle(room, A.x + Math.cos(aT) * d, A.y + Math.sin(aT) * d, 95, W * 1.6 + i * 0.16, o); }
      break;
    }
    case 'rain': { // 人のまわりに次々と降る
      const ps = room.activePlayers();
      for (let i = 0; i < 10; i++) { const p = ps[i % ps.length] || T; circle(room, p.x + (Math.random() - 0.5) * 380, p.y + (Math.random() - 0.5) * 380, 115, W * 1.8 + (i % 5) * 0.2, o); }
      break;
    }
    case 'spokes': case 'spokes9': case 'spokes2': { // 鬼から放射状の光線（spokes2 は2回目が逆にずれる）
      const n = lay === 'spokes9' ? 9 : 6, off = Math.random() * Math.PI;
      for (let i = 0; i < n; i++) rectFrom(room, A.x, A.y, off + (i / n) * Math.PI * 2, 760, 90, W * 2.0, o);
      for (let i = 0; i < n; i++) rectFrom(room, A.x, A.y, off + ((i + 0.5) / n) * Math.PI * 2 * (lay === 'spokes2' ? -1 : 1), 760, 90, W * 3.0, o);
      break;
    }
    case 'ring': { // 鬼のまわりの輪（内側と外側の間が危ない）
      for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; circle(room, A.x + Math.cos(a) * 320, A.y + Math.sin(a) * 320, 90, W * 2.0, o); }
      for (let i = 0; i < 14; i++) { const a = ((i + 0.5) / 14) * Math.PI * 2; circle(room, B.x + Math.cos(a) * 320, B.y + Math.sin(a) * 320, 90, W * 2.6, o); }
      break;
    }
    case 'judge': { // 1人に3回
      const p = room.activePlayers().sort(() => Math.random() - 0.5)[0] || T;
      for (let i = 0; i < 3; i++) circle(room, p.x, p.y, 150, W * 1.6 + i * 0.7, { ...o, track: p.id }); // track: 予告が出るまで、その人を追う
      break;
    }
    case 'pincer': { // 2体のあいだ
      rect(room, mid.x, mid.y, Math.atan2(B.y - A.y, B.x - A.x), D(A, B) + 200, 170, W * 2.2, o);
      circle(room, A.x, A.y, 160, W * 2.2, o); circle(room, B.x, B.y, 160, W * 2.2, o);
      break;
    }
    case 'cross': { // 人の上で十字
      const a = Math.random() * Math.PI;
      rect(room, T.x, T.y, a, 1000, 120, W * 2.0, o); rect(room, T.x, T.y, a + Math.PI / 2, 1000, 120, W * 2.0, o);
      rect(room, T.x, T.y, a + Math.PI / 4, 1000, 120, W * 2.8, o); rect(room, T.x, T.y, a - Math.PI / 4, 1000, 120, W * 2.8, o);
      break;
    }
    case 'parade': { // 横切る行列（鬼から人の方へ進む）
      for (let i = 0; i < 6; i++) { const d = i * 170; rect(room, A.x + Math.cos(aT) * d, A.y + Math.sin(aT) * d, aT + Math.PI / 2, 1000, 130, W * 1.6 + i * 0.35, o); }
      break;
    }
    case 'nova': { // 2体のまん中で大爆発
      circle(room, mid.x, mid.y, 360, W * 2.4, o);
      break;
    }
  }
}

function avgDmg(bs) { return bs.reduce((a, b) => a + b.kind.dmg, 0) / bs.length; }

function pairCombo(room, A, B) {
  const spec = PAIRS[key(A.type, B.type)];
  if (!spec) return false;
  const [name, lay, eff, hz, c] = spec;
  const T = nearestPlayer(room, { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 });
  if (!T) return false;
  const o = { dmg: 34 * avgDmg([A, B]), eff, hz, c, owner: A, knock: eff.includes('knock') ? 240 : eff.includes('pull') ? -220 : 0 };
  layout(room, lay, A, B, T, o);
  for (const b of [A, B]) { b.state = 'engage'; b.target = T.id; b.atkT = Math.max(b.atkT, 3); }
  room.events.push({ k: 'combo', n: 2, name, types: [A.type, B.type], x: Math.round((A.x + B.x) / 2), y: Math.round((A.y + B.y) / 2) });
  return true;
}

function tripleCombo(room, bs) {
  const C = { x: bs.reduce((a, b) => a + b.x, 0) / 3, y: bs.reduce((a, b) => a + b.y, 0) / 3 };
  const eff = [...new Set(bs.flatMap(b => SIG[b.type] || []))];
  const hz = bs.map(b => SIG_HZ[b.type]).find(Boolean) || null;
  const o = { dmg: 48 * avgDmg(bs), eff, hz, c: 'triple', owner: bs[0], knock: eff.includes('knock') ? 260 : 0 };
  const T = 3.6; // 長い予告
  for (const b of bs) {
    const a = Math.atan2(C.y - b.y, C.x - b.x), d = D(b, C);
    rectFrom(room, b.x, b.y, a, Math.max(0, d - 130), 170, T, o); // まん中の手前で止まる光線
    circle(room, b.x, b.y, 250, T, o);
    b.state = 'engage'; b.atkT = Math.max(b.atkT, 4);
  }
  for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; circle(room, C.x + Math.cos(a) * 560, C.y + Math.sin(a) * 560, 120, T + 0.5, o); } // 外側の大きな輪
  room.events.push({ k: 'combo', n: 3, name: tripleName(bs.map(b => b.type)), types: bs.map(b => b.type), x: Math.round(C.x), y: Math.round(C.y) });
  return true;
}

function nearestPlayer(room, pt) {
  let best = null, bd = 1e9;
  for (const p of room.activePlayers()) { const d = D(p, pt); if (d < bd) { bd = d; best = p; } }
  return best;
}

// 毎コマ: 合体技を出すか決める・ほかの2体がはさみうちに来る
function update(room, DT) {
  const bs = room.oni3.filter(b => b.hp > 0 && !(b.stunT > 0) && !(b.downT > 0));
  if (room.timeStopT > 0) return;
  room.pinT = (room.pinT || 0) - DT;
  if (room.pinT <= 0) { // 狩り役が見つけた人を、ほかの鬼もはさみうちにしに来る
    room.pinT = 3;
    const h = room.boss, t = h && h.hp > 0 && h.target != null ? room.players.get(h.target) : null;
    if (t) for (const b of bs) if (b !== h && b.state === 'wander' && D(b, t) < 1600 && room.bossSees(b, t)) { b.state = 'hunt'; b.target = t.id; b.path = null; }
  }
  room.comboT = (room.comboT ?? 10) - DT;
  room.triT = (room.triT ?? 25) - DT;
  if (room.comboT > 0 || room.telegraphs.some(tg => tg.combo)) return; // 合体技は1つずつ
  const rage = bs.some(b => b.rage);
  if (bs.length >= 3 && room.triT <= 0) {
    const far = Math.max(D(bs[0], bs[1]), D(bs[1], bs[2]), D(bs[0], bs[2]));
    if (far < 1200) { tripleCombo(room, bs.slice(0, 3)); room.triT = rage ? 30 : 40; room.comboT = 9; return; }
  }
  const pairs = [];
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (D(bs[i], bs[j]) < 850) pairs.push([bs[i], bs[j]]);
  if (pairs.length) { const [A, B] = pairs[Math.floor(Math.random() * pairs.length)]; if (pairCombo(room, A, B)) { room.comboT = rage ? 8 : 12; return; } }
  room.comboT = 1.5; // 近くにいなければ、少ししてまた確かめる
}

module.exports = { POOL, PAIRS, SEAL, HP_MUL, DMG_MUL, pickTypes, tripleName, update, pairCombo, tripleCombo, key };
