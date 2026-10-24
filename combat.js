// 妖怪の攻撃・強攻撃・スキルの中身（サーバー側）。種類と割り当ては public/attacks.js。
const S = require('./public/shared.js');
const A = require('./public/attacks.js');

const DT = 1 / 30;
const PLAYER_R = 18;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const R = v => Math.round(v);

// 点 e が p から角度 a の方向へ長さ len・幅 w の帯に入っているか
function inBand(e, p, a, len, w) {
  const dx = e.x - p.x, dy = e.y - p.y;
  const along = dx * Math.cos(a) + dy * Math.sin(a), side = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a));
  return along >= -10 && along <= len && side <= w / 2;
}
// 壁に当たるまでの距離
function rayLen(map, x, y, a, max) {
  for (let d = 0; d <= max; d += 12) if (!S.isFree(map, x + Math.cos(a) * d, y + Math.sin(a) * d, 2)) return d;
  return max;
}

// ---------- 当てる ----------
function dmgMul(p) { return p.atkUpT > 0 ? 1.3 : 1; }

function hit(room, p, e, amount, el) {
  if (!e || e.hp <= 0) return 0;
  room.damageOni(p, e, amount);
  if (el) applyElement(room, p, e, amount, el);
  return amount;
}
function applyElement(room, p, e, amount, el) {
  const isPatrol = !!e.isPatrol;
  switch (el) {
    case 'fire': addDot(e, amount * 0.175, 2, p); break; // 2秒で当てたダメージの35%
    case 'poison': addDot(e, amount * 0.15, 3, p); break;
    case 'ice': slow(e, 0.55, 1.2); break;
    case 'water': slow(e, 0.75, 0.8); break;
    case 'thunder':
      if (isPatrol) e.stunT = Math.max(e.stunT || 0, 0.4);
      // ボス鬼も一瞬しびれる。ずっと止まらないように、しびれたあと2秒はしびれない
      else if (e.hp > 0 && room.time >= (e.stunReadyAt || 0)) { e.stunT = Math.max(e.stunT || 0, 0.4); e.stunReadyAt = room.time + 2.4; }
      break;
    case 'wind': knock(room, e, p, isPatrol ? 34 : 12); break; // ボス鬼は重いので少しだけ
    case 'dark': room.healPlayer(p, amount * 0.08); break;
    case 'light': if (!isPatrol && e.hp > 0) room.damageOni(p, e, amount * 0.2); break;
    case 'earth': if (e.hp > 0) room.damageOni(p, e, amount * 0.15); break;
    case 'flower': {
      const ally = room.activePlayers().filter(q => dist(q, p) < 300).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (ally) room.healPlayer(ally, amount * 0.06);
      break;
    }
  }
}
function addDot(e, dps, t, owner) { (e.dots = e.dots || []).push({ dps, t, owner: owner.id }); }
function slow(e, mul, t) { if (!(e.slowT > 0) || mul <= (e.slowMul || 1)) { e.slowMul = mul; } e.slowT = Math.max(e.slowT || 0, t); }
function knock(room, e, from, d) {
  const a = Math.atan2(e.y - from.y, e.x - from.x);
  e.x += Math.cos(a) * d; e.y += Math.sin(a) * d;
  S.collide(room.map, e, room.enemyR(e));
}
function stunPatrol(e, t) { if (e.isPatrol) e.stunT = Math.max(e.stunT || 0, t); else slow(e, 0.6, t); }

function enemiesInCircle(room, x, y, r) { return room.enemies().filter(e => Math.hypot(e.x - x, e.y - y) <= r + room.enemyR(e)); }
function hitCircle(room, p, x, y, r, amount, el) { let sum = 0; for (const e of enemiesInCircle(room, x, y, r)) sum += hit(room, p, e, amount, el); return sum; }
function hitArc(room, p, a, range, half, amount, el) {
  let sum = 0;
  for (const e of room.enemies()) {
    const d = dist(p, e) - room.enemyR(e);
    if (d <= range && (d < 30 || angleDiff(Math.atan2(e.y - p.y, e.x - p.x), a) <= half)) sum += hit(room, p, e, amount, el);
  }
  return sum;
}
function nearest(room, from, range, exclude) {
  let best = null, bd = range;
  for (const e of room.enemies()) { if (exclude && exclude.has(e)) continue; const d = dist(from, e); if (d < bd) { bd = d; best = e; } }
  return best;
}
const color = el => A.ELEMENT[el].color;

// 弾を撃つ（o: pierce, homing, boomerang, bounce, heal, healAmt, lob, aoe, chain, drain ...）
function shoot(room, p, a, speed, dmg, life, r, el, o = {}) {
  room.projectiles.push({ id: room.newId(), owner: p.id, x: p.x, y: p.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, dmg, life, r, c: o.c || color(el), el, t: 0, hits: new Set(), ...o });
}
// 地点へ投げる（着いたら爆発）
function lob(room, p, a, distance, dmg, aoe, el, o = {}) {
  const speed = 520, life = Math.max(0.2, distance / speed);
  shoot(room, p, a, speed, dmg, life, o.r || 12, el, { lob: true, aoe, ...o });
}
function beam(room, p, a, len, w, amount, el, o = {}) {
  const L = rayLen(room.map, p.x, p.y, a, len);
  let sum = 0;
  for (const e of room.enemies()) if (inBand(e, p, a, L, w + room.enemyR(e))) sum += hit(room, p, e, amount, el);
  if (o.heal) for (const q of room.activePlayers()) if (q !== p && inBand(q, p, a, L, w + PLAYER_R)) room.healPlayer(q, o.heal);
  room.events.push({ k: 'beam', x: R(p.x), y: R(p.y), x2: R(p.x + Math.cos(a) * L), y2: R(p.y + Math.sin(a) * L), w: o.big ? w : Math.max(8, w * 0.5), c: o.heal ? '#7dff9a' : color(el) });
  return sum;
}
function zone(room, p, x, y, r, life, o) {
  room.zones.push({ id: room.newId(), owner: p.id, x, y, r, life, tick: 0, ...o });
}

// ---------- 通常攻撃 ----------
function normal(room, p, aim, target) {
  const at = A.of(p.yokai), K = A.NORMAL[at.normal], el = at.el;
  const st = p.stats, base = st.atkDmg * K.dmg * dmgMul(p), m = st.strongMul, c = color(el);
  p.atkT = K.cd;
  p.face = aim;
  const front = (k = 0.6) => ({ x: p.x + Math.cos(aim) * K.range * k, y: p.y + Math.sin(aim) * K.range * k });
  switch (at.normal) {
    case 'slash': { const f = front(); hitCircle(room, p, f.x, f.y, K.range * 0.55, base, el); room.events.push({ k: 'slash', x: R(f.x), y: R(f.y), a: +aim.toFixed(2), c }); break; }
    case 'thrust': {
      for (const e of room.enemies()) if (inBand(e, p, aim, K.range, 44 + room.enemyR(e))) hit(room, p, e, base, el);
      room.events.push({ k: 'beam', x: R(p.x), y: R(p.y), x2: R(p.x + Math.cos(aim) * K.range), y2: R(p.y + Math.sin(aim) * K.range), w: 10, c });
      break;
    }
    case 'combo': {
      p.comboN = ((p.comboN || 0) + 1) % 3;
      const f = front(0.55), big = p.comboN === 0;
      hitCircle(room, p, f.x, f.y, K.range * 0.55, base * (big ? 2 : 1), el);
      room.events.push({ k: 'slash', x: R(f.x), y: R(f.y), a: +(aim + (p.comboN === 1 ? 0.5 : p.comboN === 2 ? -0.5 : 0)).toFixed(2), c, big });
      break;
    }
    case 'spin': hitCircle(room, p, p.x, p.y, K.range, base, el); room.events.push({ k: 'ring', x: R(p.x), y: R(p.y), r: K.range, c }); break;
    case 'wave': hitArc(room, p, aim, K.range, 0.6, base, el); room.events.push({ k: 'cone', x: R(p.x), y: R(p.y), a: +aim.toFixed(2), r: K.range, c }); break;
    case 'drainHit': { const f = front(); const d = hitCircle(room, p, f.x, f.y, K.range * 0.55, base, el); if (d) room.healPlayer(p, d * 0.15); room.events.push({ k: 'slash', x: R(f.x), y: R(f.y), a: +aim.toFixed(2), c: '#ff3a6a' }); break; }
    case 'slam': { const f = front(0.7); hitCircle(room, p, f.x, f.y, 70, base, el); room.events.push({ k: 'boom', x: R(f.x), y: R(f.y), r: 70, c }); break; }
    case 'bolt': shoot(room, p, aim, 650, base, K.range / 650, 10, el); break;
    case 'spread': for (const k of [-1, 0, 1]) shoot(room, p, aim + k * 0.22, 600, base, 0.5, 9, el); break;
    case 'orb': shoot(room, p, aim, 380, base, K.range / 380, 18, el, { pierce: true }); break;
    case 'boomerang': shoot(room, p, aim, 620, base, 1.2, 14, el, { boomerang: 0.36, pierce: true, spin: true }); break;
    case 'homing': shoot(room, p, aim, 480, base, 1.4, 10, el, { homing: 6 }); break;
    case 'beam': beam(room, p, aim, K.range, 24, base, el); break;
    case 'lob': lob(room, p, aim, target ? Math.min(dist(p, target), K.range) : K.range * 0.7, base, 70, el); break;
    case 'chain': shoot(room, p, aim, 620, base, K.range / 620, 10, el, { chain: 1 }); break;
    case 'needle': shoot(room, p, aim + (Math.random() - 0.5) * 0.08, 820, base, K.range / 820, 6, el); break;
    case 'bounce': shoot(room, p, aim, 600, base, 1.3, 10, el, { bounce: 2 }); break;
    case 'healShot': shoot(room, p, aim, 650, base, K.range / 650, 10, el, { heal: true, healAmt: 10 * m }); break;
    case 'healBeam': beam(room, p, aim, K.range, 26, base, el, { heal: 8 * m }); break;
    case 'healLob': lob(room, p, aim, target ? Math.min(dist(p, target), K.range) : K.range * 0.7, base, 80, el, { healAoe: 10 * m, c: '#9affb0' }); break;
    case 'healHoming': shoot(room, p, aim, 460, base, 1.4, 10, el, { homing: 5, heal: true, healAmt: 9 * m, c: '#b0ffd0' }); break;
    case 'healOrb': shoot(room, p, aim, 360, base, K.range / 360, 18, el, { pierce: true, healPass: 8 * m, c: '#d0ffe0' }); break;
  }
}

// ---------- 強攻撃 ----------
function strong(room, p, aim, target) {
  const at = A.of(p.yokai), K = A.STRONG[at.strong], el = at.el;
  const m = p.stats.strongMul, P = 30 * m * dmgMul(p), c = color(el);
  p.strongT = K.cd;
  const tgtDist = target ? Math.min(dist(p, target), K.range) : K.range * 0.7;
  const tp = { x: p.x + Math.cos(aim) * tgtDist, y: p.y + Math.sin(aim) * tgtDist };
  S.collide(room.map, tp, 20);
  room.events.push({ k: 'strong', id: p.id, name: at.strongName, c });
  switch (at.strong) {
    case 'dashSlash': p.dashT = 0.25; p.dashDir = aim; p.dashHits = new Set(); p.dashDmg = P * 1.3; p.dashEl = el; p.dodge = false; break;
    case 'charge': p.dashT = 0.4; p.dashDir = aim; p.dashHits = new Set(); p.dashDmg = P * 1.2; p.dashEl = el; p.dodge = false; p.dashKnock = true; break;
    case 'drain': { const d = hitArc(room, p, aim, 120, 0.9, P * 1.6, el); if (d) room.healPlayer(p, d * 0.4); room.events.push({ k: 'cone', x: R(p.x), y: R(p.y), a: +aim.toFixed(2), r: 120, c: '#ff3a6a' }); break; }
    case 'leap': p.leap = { sx: p.x, sy: p.y, tx: tp.x, ty: tp.y, t: 0, dur: 0.45, dmg: P * 1.5, el }; break;
    case 'blink': {
      // 狙った敵の少し先まで移動し、通り道とたどり着いた場所の敵を斬る
      const want = target ? Math.min(dist(p, target) + 50, K.range) : K.range;
      const L = Math.max(0, Math.min(want, rayLen(room.map, p.x, p.y, aim, K.range) - 24));
      const from = { x: p.x, y: p.y };
      const hitSet = new Set();
      for (const e of room.enemies()) if (inBand(e, from, aim, L, 60 + room.enemyR(e))) { hitSet.add(e); hit(room, p, e, P * 1.3, el); }
      p.x += Math.cos(aim) * L; p.y += Math.sin(aim) * L; S.collide(room.map, p, PLAYER_R);
      p.invulT = Math.max(p.invulT, 0.3);
      for (const e of enemiesInCircle(room, p.x, p.y, 110)) if (!hitSet.has(e)) hit(room, p, e, P * 1.3, el);
      room.events.push({ k: 'blink', x: R(from.x), y: R(from.y), x2: R(p.x), y2: R(p.y), c });
      break;
    }
    case 'tornado': zone(room, p, p.x, p.y, 70, 2.5, { kind: 'dmg', vx: Math.cos(aim) * 220, vy: Math.sin(aim) * 220, tickDmg: P * 0.3, every: 0.25, el, pull: 1, c, shape: 'tornado' }); break;
    case 'flurry': p.flurry = { n: 6, t: 0, aim, dmg: P * 0.35, el }; break;
    case 'quake': { for (const e of enemiesInCircle(room, p.x, p.y, 170)) { hit(room, p, e, P * 1.2, el); slow(e, 0.5, 1.5); } room.events.push({ k: 'ring', x: R(p.x), y: R(p.y), r: 170, c }); room.events.push({ k: 'boom', x: R(p.x), y: R(p.y), r: 90, c }); break; }
    case 'shieldBash': { for (const e of room.enemies()) { const d = dist(p, e) - room.enemyR(e); if (d <= 130 && angleDiff(Math.atan2(e.y - p.y, e.x - p.x), aim) <= 0.8) { hit(room, p, e, P * 1.1, el); stunPatrol(e, 1.5); } } room.events.push({ k: 'cone', x: R(p.x), y: R(p.y), a: +aim.toFixed(2), r: 130, c: '#c8d8ff' }); break; }
    case 'vortex': zone(room, p, tp.x, tp.y, 160, 1.2, { kind: 'dmg', tickDmg: P * 0.25, every: 0.2, el, pull: 3, endBoom: P * 0.8, c, shape: 'vortex' }); break;
    case 'freeze': { for (const e of enemiesInCircle(room, p.x, p.y, 220)) { hit(room, p, e, P * 0.6, el); slow(e, 0.4, 3); } room.events.push({ k: 'ring', x: R(p.x), y: R(p.y), r: 220, c: '#bfeaff' }); break; }
    case 'meteor': zone(room, p, tp.x, tp.y, 150, 0.9, { kind: 'mark', endBoom: P * 2.2, el, c }); break;
    case 'healZone': zone(room, p, p.x, p.y, 140, 5, { kind: 'heal', every: 0.5, amt: 8 * m }); break;
    case 'lifeLink': for (const q of room.activePlayers()) { room.healPlayer(q, 30 * m); room.events.push({ k: 'ring', x: R(q.x), y: R(q.y), r: 60, c: '#7dff9a' }); } break;
    case 'regenAura': zone(room, p, p.x, p.y, 120, 6, { kind: 'heal', every: 0.5, amt: 5 * m, follow: p.id }); break;
    case 'drainBeam': { const d = beam(room, p, aim, K.range, 30, P * 1.4, el, { heal: 10 * m, big: true }); if (d) room.healPlayer(p, d * 0.3); break; }
    case 'triple': for (const k of [-1, 0, 1]) shoot(room, p, aim + k * 0.18, 800, P * 0.75, 0.8, 13, el); break;
    case 'laser': beam(room, p, aim, K.range, 44, P * 2.0, el, { big: true }); break;
    case 'barrage': { const heal = S.YOKAI_BY_ID[p.yokai].role === 'healer'; for (let k = 0; k < 12; k++) shoot(room, p, (k * Math.PI) / 6, 520, P * 0.5, 0.7, 11, el, heal ? { heal: true, healAmt: 6 * m } : {}); break; }
    case 'multiHoming': for (let k = 0; k < 5; k++) shoot(room, p, aim + (k - 2) * 0.45, 420, P * 0.6, 2, 9, el, { homing: 5 }); break;
    case 'thunder': {
      const hitList = room.enemies().filter(e => dist(p, e) < K.range).sort((a, b) => dist(p, a) - dist(p, b)).slice(0, 3);
      for (const e of hitList) { hit(room, p, e, P * 1.2, el); room.events.push({ k: 'bolt', x: R(e.x), y: R(e.y), c: '#fff27a' }); }
      break;
    }
    case 'poison': zone(room, p, tp.x, tp.y, 130, 4, { kind: 'dmg', tickDmg: P * 0.25, every: 0.5, el, c, shape: 'cloud' }); break;
    case 'turret': room.turrets.push({ id: room.newId(), owner: p.id, x: p.x, y: p.y, life: 6, t: 0, dmg: P * 0.35, el, c }); break;
  }
}

// ---------- スキル（タイプごと） ----------
function skill(room, p, aim) {
  const role = S.YOKAI_BY_ID[p.yokai].role, K = A.SKILL[role], m = p.stats.strongMul;
  p.skillT = K.cd;
  const inp = p.input;
  switch (K.key) {
    case 'dodge': {
      const mv = Math.hypot(inp.mx, inp.my) > 0.15;
      p.dashT = 0.2; p.dashDir = mv ? Math.atan2(inp.my, inp.mx) : p.face + Math.PI; p.dodge = true; p.dashHits = new Set();
      room.events.push({ k: 'dodge', id: p.id });
      break;
    }
    case 'buff':
      // 重ねがけなし: 効果中にかけても強くならず、残り時間が戻るだけ
      for (const q of room.activePlayers()) if (dist(q, p) < 260) {
        q.atkUpT = Math.max(q.atkUpT || 0, 8); q.spdUpT = Math.max(q.spdUpT || 0, 8);
        room.events.push({ k: 'buff', id: q.id });
      }
      break;
    case 'shield':
      p.shieldT = Math.max(p.shieldT, 4);
      room.events.push({ k: 'ring', x: R(p.x), y: R(p.y), r: 70, c: '#8ab8ff' });
      break;
    case 'bomb': {
      const t = nearest(room, p, 420);
      lob(room, p, aim, t ? Math.min(dist(p, t), 320) : 260, 70 * m, 130, null, { c: '#2a2a3a', r: 14, bomb: true });
      break;
    }
  }
}

// ---------- 毎フレーム ----------
// 移動の前に呼ぶ。true を返したら通常の移動をしない（ジャンプ中など）
function preMove(room, p) {
  if (p.leap) {
    const L = p.leap;
    L.t += DT;
    const k = Math.min(1, L.t / L.dur);
    p.x = L.sx + (L.tx - L.sx) * k; p.y = L.sy + (L.ty - L.sy) * k;
    p.invulT = Math.max(p.invulT, 0.1);
    p.jump = Math.sin(k * Math.PI);
    if (k >= 1) {
      p.leap = null; p.jump = 0;
      hitCircle(room, p, p.x, p.y, 150, L.dmg, L.el);
      room.events.push({ k: 'boom', x: R(p.x), y: R(p.y), r: 150, c: color(L.el), big: true });
    }
    return true;
  }
  if (p.flurry) {
    const F = p.flurry;
    F.t -= DT;
    if (F.t <= 0) {
      F.t = 0.1; F.n--;
      const a = F.aim + (Math.random() - 0.5) * 0.8;
      const fx = p.x + Math.cos(a) * 55, fy = p.y + Math.sin(a) * 55;
      hitCircle(room, p, fx, fy, 60, F.dmg, F.el);
      room.events.push({ k: 'slash', x: R(fx), y: R(fy), a: +a.toFixed(2), c: color(F.el) });
      if (F.n <= 0) p.flurry = null;
    }
  }
  return false;
}

// ダッシュ中（突進斬り・体当たり）の当たり
function dashHit(room, p) {
  if (p.dodge) return;
  for (const e of room.enemies()) {
    if (!p.dashHits.has(e) && dist(p, e) < room.enemyR(e) + 40) {
      p.dashHits.add(e);
      hit(room, p, e, p.dashDmg || 40, p.dashEl);
      if (p.dashKnock && e.isPatrol) knock(room, e, p, 80);
    }
  }
}

function updateProjectiles(room) {
  const map = room.map;
  for (const pr of room.projectiles) {
    pr.t += DT;
    const owner = room.players.get(pr.owner);
    // 追尾
    if (pr.homing) {
      const tgt = nearest(room, pr, 500);
      if (tgt) {
        const sp = Math.hypot(pr.vx, pr.vy), cur = Math.atan2(pr.vy, pr.vx), want = Math.atan2(tgt.y - pr.y, tgt.x - pr.x);
        const d = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
        const na = cur + Math.max(-pr.homing * DT, Math.min(pr.homing * DT, d));
        pr.vx = Math.cos(na) * sp; pr.vy = Math.sin(na) * sp;
      }
    }
    // ブーメラン: 一定時間で持ち主に戻る
    if (pr.boomerang && pr.t > pr.boomerang && owner) {
      if (!pr.back) { pr.back = true; pr.hits = new Set(); }
      const a = Math.atan2(owner.y - pr.y, owner.x - pr.x), sp = Math.hypot(pr.vx, pr.vy);
      pr.vx = Math.cos(a) * sp; pr.vy = Math.sin(a) * sp;
      if (dist(pr, owner) < 26) pr.life = 0;
    }
    const nx = pr.x + pr.vx * DT, ny = pr.y + pr.vy * DT;
    pr.life -= DT;
    if (!S.isFree(map, nx, ny, 1) && !pr.lob) {
      if (pr.bounce > 0) {
        pr.bounce--;
        if (!S.isFree(map, nx, pr.y, 1)) pr.vx = -pr.vx;
        if (!S.isFree(map, pr.x, ny, 1)) pr.vy = -pr.vy;
        continue;
      }
      if (pr.boomerang && !pr.back) { pr.t = pr.boomerang; continue; }
      pr.life = 0; continue;
    }
    pr.x = nx; pr.y = ny;
    if (pr.lob) {
      if (pr.life <= 0) explodeLob(room, pr, owner);
      continue;
    }
    // 敵に当たる
    for (const e of room.enemies()) {
      if (pr.hits.has(e) || dist(pr, e) >= room.enemyR(e) + pr.r) continue;
      pr.hits.add(e);
      if (owner) hit(room, owner, e, pr.dmg, pr.el); else room.damageOni(null, e, pr.dmg);
      if (pr.chain && owner) {
        const next = nearest(room, e, 260, pr.hits);
        if (next) { hit(room, owner, next, pr.dmg * 0.7, pr.el); room.events.push({ k: 'beam', x: R(e.x), y: R(e.y), x2: R(next.x), y2: R(next.y), w: 5, c: pr.c }); }
      }
      if (!pr.pierce) { pr.life = 0; break; }
    }
    // 仲間を回復
    if (pr.life > 0 && (pr.heal || pr.healPass)) {
      for (const q of room.activePlayers()) {
        if (q.id === pr.owner || pr.hits.has(q) || dist(pr, q) >= PLAYER_R + pr.r || q.hp >= q.maxHp) continue;
        if (pr.healPass) { pr.hits.add(q); room.healPlayer(q, pr.healPass); }
        else { room.healPlayer(q, pr.healAmt || 10); pr.life = 0; break; }
      }
    }
  }
  room.projectiles = room.projectiles.filter(pr => pr.life > 0);
}

function explodeLob(room, pr, owner) {
  const p = owner || { id: pr.owner, x: pr.x, y: pr.y };
  for (const e of enemiesInCircle(room, pr.x, pr.y, pr.aoe)) owner ? hit(room, owner, e, pr.dmg, pr.el) : room.damageOni(null, e, pr.dmg);
  if (pr.healAoe) for (const q of room.activePlayers()) if (dist(q, pr) < pr.aoe + PLAYER_R) room.healPlayer(q, pr.healAoe);
  room.events.push({ k: 'boom', x: R(pr.x), y: R(pr.y), r: pr.aoe, c: pr.healAoe ? '#9affb0' : pr.bomb ? '#ff6a3d' : pr.c, big: pr.bomb });
  void p;
}

function updateEffects(room) {
  // 敵の状態（燃える・毒・遅くなる・しびれ）
  for (const e of room.enemies()) {
    if (e.slowT > 0) { e.slowT -= DT; if (e.slowT <= 0) e.slowMul = 1; }
    if (e.dots && e.dots.length) {
      e.dotAcc = (e.dotAcc || 0) + DT;
      if (e.dotAcc >= 0.5) {
        e.dotAcc = 0;
        for (const d of e.dots) { const owner = room.players.get(d.owner); room.damageOni(owner || null, e, d.dps * 0.5); d.t -= 0.5; }
        e.dots = e.dots.filter(d => d.t > 0);
      }
    }
  }
  // エリア（回復・ダメージ・吸い込み・隕石の目印）
  for (const z of room.zones) {
    z.life -= DT;
    if (z.follow) { const f = room.players.get(z.follow); if (f && !f.down && !f.escaped) { z.x = f.x; z.y = f.y; } }
    if (z.vx) { z.x += z.vx * DT; z.y += z.vy * DT; if (!S.isFree(room.map, z.x, z.y, 4)) { z.vx = -z.vx * 0.5; z.vy = -z.vy * 0.5; } }
    const owner = room.players.get(z.owner);
    if (z.pull) for (const e of enemiesInCircle(room, z.x, z.y, z.r)) if (e.isPatrol) { const a = Math.atan2(z.y - e.y, z.x - e.x); e.x += Math.cos(a) * z.pull * 30 * DT; e.y += Math.sin(a) * z.pull * 30 * DT; }
    z.tick -= DT;
    if (z.tick <= 0) {
      z.tick = z.every || 0.5;
      if (z.kind === 'dmg' && owner) hitCircle(room, owner, z.x, z.y, z.r, z.tickDmg, z.el);
      else if (z.kind !== 'dmg' && z.kind !== 'mark') for (const q of room.activePlayers()) if (dist(q, z) <= z.r) room.healPlayer(q, z.amt);
    }
    if (z.life <= 0 && z.endBoom && owner) {
      hitCircle(room, owner, z.x, z.y, z.r, z.endBoom, z.el);
      room.events.push({ k: 'boom', x: R(z.x), y: R(z.y), r: z.r, c: z.c, big: true });
    }
  }
  room.zones = room.zones.filter(z => z.life > 0);
  // 砲台
  for (const t of room.turrets) {
    t.life -= DT; t.t -= DT;
    const owner = room.players.get(t.owner);
    if (t.t <= 0 && owner) {
      const e = nearest(room, t, 450);
      if (e) { t.t = 0.5; shoot(room, { id: t.owner, x: t.x, y: t.y }, Math.atan2(e.y - t.y, e.x - t.x), 700, t.dmg, 0.7, 8, t.el); }
    }
  }
  room.turrets = room.turrets.filter(t => t.life > 0);
}

module.exports = { normal, strong, skill, preMove, dashHit, updateProjectiles, updateEffects, A };
