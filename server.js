// オニバスターズ: 4人協力ボスバトルのゲームサーバー
// HTTP で public/ を配信し、WebSocket でサーバー権威のゲームループを回す。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const TICK_RATE = 30;              // シミュレーション回数/秒
const SEND_RATE = 15;              // 状態送信回数/秒
const DT = 1 / TICK_RATE;
const ARENA = { w: 1600, h: 1000 };
const MAX_PLAYERS = 4;

// ---------- ロール定義 ----------
const ROLES = {
  fighter: { name: 'ファイター', hp: 120, speed: 230, atkDmg: 14, atkRange: 80, atkCd: 0.35, skillCd: 5, color: '#ff6b4a' },
  tank:    { name: 'タンク',     hp: 220, speed: 190, atkDmg: 8,  atkRange: 75, atkCd: 0.5,  skillCd: 9, color: '#4a8bff' },
  healer:  { name: 'ヒーラー',   hp: 100, speed: 220, atkDmg: 6,  atkRange: 420, atkCd: 0.5, skillCd: 8, color: '#5be07a' },
  ranger:  { name: 'レンジャー', hp: 90,  speed: 240, atkDmg: 9,  atkRange: 520, atkCd: 0.3, skillCd: 6, color: '#f5c542' },
};
const ULT_MAX = 100;
const REVIVE_TIME = 3;
const REVIVE_RANGE = 70;

// ---------- 静的ファイル配信 ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const PUBLIC_DIR = path.join(__dirname, 'public');

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- ユーティリティ ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const rand = (a, b) => a + Math.random() * (b - a);
let nextId = 1;
const genId = () => nextId++;

function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); } while (rooms.has(code));
  return code;
}

// 点 p が 中心 c・向き angle・幅 w・長さ len の矩形に入っているか
function inRect(p, c, angle, len, w) {
  const dx = p.x - c.x, dy = p.y - c.y;
  const lx = dx * Math.cos(angle) + dy * Math.sin(angle);
  const ly = -dx * Math.sin(angle) + dy * Math.cos(angle);
  return lx >= 0 && lx <= len && Math.abs(ly) <= w / 2;
}

// ---------- ルーム ----------
const rooms = new Map();

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map(); // id -> player
    this.state = 'lobby';     // lobby | battle | result
    this.resetBattle();
  }

  resetBattle() {
    this.boss = null;
    this.minions = [];
    this.projectiles = [];
    this.telegraphs = [];  // 予兆（赤いエリア）
    this.zones = [];       // 回復エリアなど
    this.events = [];      // クライアント演出用の単発イベント
    this.time = 0;
    this.result = null;
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.ws.readyState === 1) p.ws.send(data);
  }

  lobbyInfo() {
    return {
      t: 'lobby', code: this.code, state: this.state,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, role: p.role, host: p.host })),
    };
  }

  addPlayer(ws, name, role) {
    const p = {
      id: genId(), ws, name: (name || 'プレイヤー').slice(0, 10), role: ROLES[role] ? role : 'fighter',
      host: this.players.size === 0, x: 0, y: 0, face: 0, input: { mx: 0, my: 0, ax: 0, ay: 0, atk: false, skill: false, ult: false },
    };
    this.players.set(p.id, p);
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    this.players.delete(id);
    if (p && p.host && this.players.size) this.players.values().next().value.host = true;
  }

  start() {
    this.resetBattle();
    this.state = 'battle';
    const n = this.players.size;
    let i = 0;
    for (const p of this.players.values()) {
      const r = ROLES[p.role];
      Object.assign(p, {
        x: 300, y: ARENA.h / 2 - 120 + i * 80, face: 0, hp: r.hp, maxHp: r.hp,
        atkT: 0, skillT: 0, ult: 0, down: false, reviveProg: 0, shieldT: 0, dashT: 0, dashDir: 0,
        dmgDealt: 0, healDone: 0,
      });
      i++;
    }
    const bossHp = 1600 + 900 * n;
    this.boss = {
      x: ARENA.w - 400, y: ARENA.h / 2, r: 70, hp: bossHp, maxHp: bossHp, name: '大鬼オニガシラ',
      speed: 90, state: 'idle', stateT: 1.5, target: null, face: Math.PI, tauntT: 0, tauntBy: null,
      chargeDir: 0, enraged: false, hitFlash: 0,
    };
  }

  // ---- ダメージ処理 ----
  damageBoss(p, amount) {
    const b = this.boss;
    if (!b || b.hp <= 0) return;
    b.hp = Math.max(0, b.hp - amount);
    b.hitFlash = 0.1;
    p.dmgDealt += amount;
    p.ult = Math.min(ULT_MAX, p.ult + amount * 0.25);
    this.events.push({ k: 'dmg', x: b.x + rand(-30, 30), y: b.y - b.r, v: Math.round(amount) });
  }

  damageMinion(p, m, amount) {
    m.hp -= amount;
    p.ult = Math.min(ULT_MAX, p.ult + amount * 0.2);
    p.dmgDealt += amount;
    this.events.push({ k: 'dmg', x: m.x, y: m.y - m.r, v: Math.round(amount) });
  }

  // 範囲内の敵すべてにダメージ
  hitEnemiesInCircle(p, x, y, radius, amount) {
    const b = this.boss;
    if (b && Math.hypot(b.x - x, b.y - y) <= radius + b.r) this.damageBoss(p, amount);
    for (const m of this.minions) if (Math.hypot(m.x - x, m.y - y) <= radius + m.r) this.damageMinion(p, m, amount);
  }

  damagePlayer(p, amount) {
    if (p.down || p.dashT > 0) return;
    if (p.shieldT > 0) amount *= 0.3;
    p.hp -= amount;
    this.events.push({ k: 'hurt', x: p.x, y: p.y - 30, v: Math.round(amount), id: p.id });
    if (p.hp <= 0) { p.hp = 0; p.down = true; p.reviveProg = 0; this.events.push({ k: 'down', id: p.id }); }
  }

  healPlayer(src, p, amount) {
    if (p.down) return;
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + amount);
    const healed = p.hp - before;
    if (healed > 0) {
      src.healDone += healed;
      src.ult = Math.min(ULT_MAX, src.ult + healed * 0.3);
      this.events.push({ k: 'heal', x: p.x, y: p.y - 30, v: Math.round(healed) });
    }
  }

  nearestEnemy(p, maxRange) {
    let best = null, bestD = maxRange;
    const cands = [...this.minions];
    if (this.boss && this.boss.hp > 0) cands.push(this.boss);
    for (const e of cands) {
      const d = dist(p, e) - e.r;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  // ---- プレイヤー更新 ----
  updatePlayer(p) {
    const r = ROLES[p.role];
    p.atkT = Math.max(0, p.atkT - DT);
    p.skillT = Math.max(0, p.skillT - DT);
    p.shieldT = Math.max(0, p.shieldT - DT);

    if (p.down) return;

    const inp = p.input;
    if (p.dashT > 0) {
      p.dashT -= DT;
      p.x += Math.cos(p.dashDir) * 700 * DT;
      p.y += Math.sin(p.dashDir) * 700 * DT;
      // ダッシュ斬りは通過した敵に当たる
      if (!p.dashHit) {
        const b = this.boss;
        if (b && dist(p, b) < b.r + 40) { this.damageBoss(p, 45); p.dashHit = true; }
      }
    } else {
      let mx = inp.mx, my = inp.my;
      const m = Math.hypot(mx, my);
      if (m > 1) { mx /= m; my /= m; }
      p.x += mx * r.speed * DT;
      p.y += my * r.speed * DT;
      if (m > 0.15) p.face = Math.atan2(my, mx);
    }
    p.x = clamp(p.x, 20, ARENA.w - 20);
    p.y = clamp(p.y, 20, ARENA.h - 20);

    // 攻撃時は近くの敵を自動で向く（スマホ向けオートエイム）
    const target = this.nearestEnemy(p, r.atkRange + 200);
    const aimAngle = target ? Math.atan2(target.y - p.y, target.x - p.x) : p.face;

    if (inp.atk && p.atkT <= 0) {
      p.atkT = r.atkCd;
      p.face = aimAngle;
      if (p.role === 'fighter' || p.role === 'tank') {
        const ax = p.x + Math.cos(aimAngle) * r.atkRange * 0.6;
        const ay = p.y + Math.sin(aimAngle) * r.atkRange * 0.6;
        this.hitEnemiesInCircle(p, ax, ay, r.atkRange * 0.55, r.atkDmg);
        this.events.push({ k: 'slash', x: ax, y: ay, a: aimAngle, c: r.color });
      } else {
        this.projectiles.push({
          id: genId(), owner: p.id, x: p.x, y: p.y, vx: Math.cos(aimAngle) * 650, vy: Math.sin(aimAngle) * 650,
          dmg: r.atkDmg, life: r.atkRange / 650, r: 10, c: r.color, friendly: true,
        });
      }
    }

    if (inp.skill && p.skillT <= 0) {
      p.skillT = r.skillCd;
      switch (p.role) {
        case 'fighter': // ダッシュ斬り（無敵つき）
          p.dashT = 0.25; p.dashDir = target ? aimAngle : p.face; p.dashHit = false;
          this.events.push({ k: 'dash', id: p.id });
          break;
        case 'tank': // 挑発 + シールド
          p.shieldT = 4;
          if (this.boss) { this.boss.tauntT = 5; this.boss.tauntBy = p.id; }
          this.events.push({ k: 'taunt', x: p.x, y: p.y });
          break;
        case 'healer': // 回復エリア
          this.zones.push({ id: genId(), owner: p.id, x: p.x, y: p.y, r: 140, life: 5, tick: 0, c: r.color });
          break;
        case 'ranger': // 3方向ショット
          for (let k = -1; k <= 1; k++) {
            const a = aimAngle + k * 0.18;
            this.projectiles.push({
              id: genId(), owner: p.id, x: p.x, y: p.y, vx: Math.cos(a) * 800, vy: Math.sin(a) * 800,
              dmg: 22, life: 0.8, r: 13, c: '#fff27a', friendly: true,
            });
          }
          break;
      }
    }

    if (inp.ult && p.ult >= ULT_MAX) {
      p.ult = 0;
      this.events.push({ k: 'ult', id: p.id, role: p.role, x: p.x, y: p.y });
      switch (p.role) {
        case 'fighter': this.hitEnemiesInCircle(p, p.x, p.y, 260, 180); break;
        case 'tank':
          for (const q of this.players.values()) q.shieldT = 6;
          this.hitEnemiesInCircle(p, p.x, p.y, 200, 90);
          break;
        case 'healer':
          for (const q of this.players.values()) {
            if (q.down) { q.down = false; q.hp = q.maxHp * 0.5; this.events.push({ k: 'revive', id: q.id }); }
            else this.healPlayer(p, q, q.maxHp);
          }
          break;
        case 'ranger':
          for (let k = 0; k < 16; k++) {
            const a = (Math.PI * 2 * k) / 16;
            this.projectiles.push({ id: genId(), owner: p.id, x: p.x, y: p.y, vx: Math.cos(a) * 700, vy: Math.sin(a) * 700, dmg: 30, life: 1.2, r: 16, c: '#ffffff', friendly: true });
          }
          if (this.boss) this.damageBoss(p, 80);
          break;
      }
    }
  }

  // ---- 復活（倒れた仲間の近くに立つ） ----
  updateRevive() {
    for (const p of this.players.values()) {
      if (!p.down) continue;
      const helper = [...this.players.values()].some(q => q !== p && !q.down && dist(p, q) < REVIVE_RANGE);
      if (helper) p.reviveProg += DT; else p.reviveProg = Math.max(0, p.reviveProg - DT * 0.5);
      if (p.reviveProg >= REVIVE_TIME) {
        p.down = false; p.hp = p.maxHp * 0.4; p.reviveProg = 0;
        this.events.push({ k: 'revive', id: p.id });
      }
    }
  }

  // ---- ボスAI ----
  alivePlayers() { return [...this.players.values()].filter(p => !p.down); }

  pickTarget() {
    const b = this.boss;
    const alive = this.alivePlayers();
    if (!alive.length) return null;
    if (b.tauntT > 0) {
      const t = this.players.get(b.tauntBy);
      if (t && !t.down) return t;
    }
    return alive.reduce((a, c) => (dist(c, b) < dist(a, b) ? c : a));
  }

  updateBoss() {
    const b = this.boss;
    if (!b || b.hp <= 0) return;
    b.tauntT = Math.max(0, b.tauntT - DT);
    b.hitFlash = Math.max(0, b.hitFlash - DT);
    if (!b.enraged && b.hp < b.maxHp * 0.35) {
      b.enraged = true; b.speed = 130;
      this.events.push({ k: 'enrage' });
    }
    const spd = b.enraged ? 1.4 : 1;
    b.stateT -= DT * spd;
    const target = this.pickTarget();

    if (b.state === 'idle' || b.state === 'chase') {
      if (target) {
        const a = Math.atan2(target.y - b.y, target.x - b.x);
        b.face = a;
        if (dist(b, target) > b.r + 60) {
          b.x += Math.cos(a) * b.speed * DT;
          b.y += Math.sin(a) * b.speed * DT;
        }
      }
      if (b.stateT <= 0 && target) this.chooseBossAttack(target);
    } else if (b.state === 'charging') {
      // 突進中
      b.x += Math.cos(b.chargeDir) * 650 * DT;
      b.y += Math.sin(b.chargeDir) * 650 * DT;
      for (const p of this.alivePlayers()) {
        if (!p.chargeHit && dist(p, b) < b.r + 20) { this.damagePlayer(p, 35); p.chargeHit = true; }
      }
      if (b.stateT <= 0 || b.x < b.r || b.x > ARENA.w - b.r || b.y < b.r || b.y > ARENA.h - b.r) {
        b.state = 'idle'; b.stateT = 1.4;
      }
    } else if (b.state === 'windup') {
      if (b.stateT <= 0) { b.state = 'idle'; b.stateT = rand(1.0, 1.8); }
    }
    b.x = clamp(b.x, b.r, ARENA.w - b.r);
    b.y = clamp(b.y, b.r, ARENA.h - b.r);
  }

  chooseBossAttack(target) {
    const b = this.boss;
    const roll = Math.random();
    const warn = b.enraged ? 0.9 : 1.2; // 予兆の長さ
    if (roll < 0.3) {
      // 叩きつけ: 狙ったプレイヤーの足元に赤い円
      const targets = b.enraged ? this.alivePlayers() : [target];
      for (const t of targets) this.telegraphs.push({ id: genId(), shape: 'circle', x: t.x, y: t.y, r: 110, t: warn, max: warn, dmg: 30 });
      b.state = 'windup'; b.stateT = warn + 0.3;
    } else if (roll < 0.55) {
      // 突進: 予兆の矩形のあと突っ込む
      const a = Math.atan2(target.y - b.y, target.x - b.x);
      b.face = a; b.chargeDir = a;
      this.telegraphs.push({ id: genId(), shape: 'rect', x: b.x, y: b.y, a, len: 650, w: b.r * 2, t: warn, max: warn, dmg: 0, then: 'charge' });
      for (const p of this.players.values()) p.chargeHit = false;
      b.state = 'windup'; b.stateT = warn + 0.1;
    } else if (roll < 0.8) {
      // 衝撃波: ボス周囲のドーナツ
      this.telegraphs.push({ id: genId(), shape: 'ring', x: b.x, y: b.y, r: 300, inner: 0, t: warn + 0.2, max: warn + 0.2, dmg: 40, follow: true });
      b.state = 'windup'; b.stateT = warn + 0.5;
    } else {
      // 子分召喚 + 鬼火弾
      const n = 2 + (b.enraged ? 1 : 0);
      for (let i = 0; i < n; i++) {
        this.minions.push({ id: genId(), x: b.x + rand(-120, 120), y: b.y + rand(-120, 120), r: 24, hp: 60, maxHp: 60, atkT: 1, speed: 120 });
      }
      for (let k = 0; k < 12; k++) {
        const a = (Math.PI * 2 * k) / 12;
        this.projectiles.push({ id: genId(), x: b.x, y: b.y, vx: Math.cos(a) * 280, vy: Math.sin(a) * 280, dmg: 12, life: 3, r: 14, c: '#b45cff', friendly: false });
      }
      b.state = 'windup'; b.stateT = 1.0;
    }
  }

  updateTelegraphs() {
    const b = this.boss;
    for (const tg of this.telegraphs) {
      if (tg.follow && b) { tg.x = b.x; tg.y = b.y; }
      tg.t -= DT * (b && b.enraged ? 1.4 : 1);
      if (tg.t > 0) continue;
      if (tg.then === 'charge' && b) {
        b.state = 'charging'; b.stateT = 1.0;
        continue;
      }
      for (const p of this.alivePlayers()) {
        let hit = false;
        if (tg.shape === 'circle' || tg.shape === 'ring') hit = dist(p, tg) <= tg.r;
        else if (tg.shape === 'rect') hit = inRect(p, tg, tg.a, tg.len, tg.w);
        if (hit) this.damagePlayer(p, tg.dmg);
      }
      this.events.push({ k: 'boom', shape: tg.shape, x: tg.x, y: tg.y, r: tg.r });
    }
    this.telegraphs = this.telegraphs.filter(tg => tg.t > 0);
  }

  updateMinions() {
    for (const m of this.minions) {
      m.atkT -= DT;
      const alive = this.alivePlayers();
      if (!alive.length) continue;
      const t = alive.reduce((a, c) => (dist(c, m) < dist(a, m) ? c : a));
      const d = dist(m, t);
      if (d > m.r + 20) {
        m.x += ((t.x - m.x) / d) * m.speed * DT;
        m.y += ((t.y - m.y) / d) * m.speed * DT;
      } else if (m.atkT <= 0) {
        m.atkT = 1.2;
        this.damagePlayer(t, 8);
      }
    }
    this.minions = this.minions.filter(m => m.hp > 0);
  }

  updateProjectiles() {
    for (const pr of this.projectiles) {
      pr.x += pr.vx * DT; pr.y += pr.vy * DT; pr.life -= DT;
      if (pr.friendly) {
        const owner = this.players.get(pr.owner);
        if (!owner) { pr.life = 0; continue; }
        const b = this.boss;
        if (b && b.hp > 0 && dist(pr, b) < b.r + pr.r) { this.damageBoss(owner, pr.dmg); pr.life = 0; continue; }
        for (const m of this.minions) if (dist(pr, m) < m.r + pr.r) { this.damageMinion(owner, m, pr.dmg); pr.life = 0; break; }
        // ヒーラーの通常弾は味方に当たると回復
        if (pr.life > 0 && owner.role === 'healer') {
          for (const q of this.players.values()) {
            if (q !== owner && !q.down && dist(pr, q) < 22 + pr.r && q.hp < q.maxHp) { this.healPlayer(owner, q, 10); pr.life = 0; break; }
          }
        }
      } else {
        for (const p of this.alivePlayers()) if (dist(pr, p) < 20 + pr.r) { this.damagePlayer(p, pr.dmg); pr.life = 0; break; }
      }
    }
    this.projectiles = this.projectiles.filter(pr => pr.life > 0 && pr.x > -50 && pr.x < ARENA.w + 50 && pr.y > -50 && pr.y < ARENA.h + 50);
  }

  updateZones() {
    for (const z of this.zones) {
      z.life -= DT; z.tick -= DT;
      if (z.tick <= 0) {
        z.tick = 0.5;
        const owner = this.players.get(z.owner);
        if (owner) for (const q of this.players.values()) if (dist(q, z) <= z.r) this.healPlayer(owner, q, 8);
      }
    }
    this.zones = this.zones.filter(z => z.life > 0);
  }

  tick() {
    if (this.state !== 'battle') return;
    this.time += DT;
    for (const p of this.players.values()) this.updatePlayer(p);
    this.updateRevive();
    this.updateBoss();
    this.updateTelegraphs();
    this.updateMinions();
    this.updateProjectiles();
    this.updateZones();

    if (this.boss.hp <= 0) this.finish(true);
    else if (this.players.size && this.alivePlayers().length === 0) this.finish(false);
  }

  finish(win) {
    this.state = 'result';
    this.result = {
      win, time: Math.round(this.time),
      players: [...this.players.values()].map(p => ({ name: p.name, role: p.role, dmg: Math.round(p.dmgDealt), heal: Math.round(p.healDone) })),
    };
    this.broadcast({ t: 'result', ...this.result });
  }

  snapshot() {
    const b = this.boss;
    const snap = {
      t: 'state', time: this.time,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, role: p.role, x: Math.round(p.x), y: Math.round(p.y), face: +p.face.toFixed(2),
        hp: Math.round(p.hp), maxHp: p.maxHp, ult: Math.round(p.ult), down: p.down, rv: +(p.reviveProg / REVIVE_TIME).toFixed(2),
        sh: p.shieldT > 0, atkCd: +(p.atkT / ROLES[p.role].atkCd).toFixed(2), skCd: +(p.skillT / ROLES[p.role].skillCd).toFixed(2), dash: p.dashT > 0,
      })),
      boss: b && { x: Math.round(b.x), y: Math.round(b.y), r: b.r, hp: Math.round(b.hp), maxHp: b.maxHp, name: b.name, face: +b.face.toFixed(2), enraged: b.enraged, st: b.state, flash: b.hitFlash > 0, taunt: b.tauntT > 0 },
      minions: this.minions.map(m => ({ id: m.id, x: Math.round(m.x), y: Math.round(m.y), r: m.r, hp: m.hp, maxHp: m.maxHp })),
      proj: this.projectiles.map(pr => ({ id: pr.id, x: Math.round(pr.x), y: Math.round(pr.y), r: pr.r, c: pr.c })),
      tele: this.telegraphs.map(tg => ({ id: tg.id, shape: tg.shape, x: Math.round(tg.x), y: Math.round(tg.y), r: tg.r, a: tg.a, len: tg.len, w: tg.w, p: +(1 - tg.t / tg.max).toFixed(2) })),
      zones: this.zones.map(z => ({ id: z.id, x: Math.round(z.x), y: Math.round(z.y), r: z.r, c: z.c })),
      ev: this.events,
    };
    this.events = [];
    return snap;
  }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  let room = null;
  let me = null;
  const send = msg => ws.readyState === 1 && ws.send(JSON.stringify(msg));

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.t) {
      case 'create':
      case 'join': {
        if (room) return;
        let target;
        if (msg.t === 'create') {
          target = new Room(genRoomCode());
          rooms.set(target.code, target);
        } else {
          target = rooms.get(String(msg.code || '').toUpperCase());
          if (!target) return send({ t: 'error', msg: 'ルームが見つかりません' });
          if (target.players.size >= MAX_PLAYERS) return send({ t: 'error', msg: 'ルームが満員です' });
          if (target.state !== 'lobby') return send({ t: 'error', msg: 'バトル中のため参加できません' });
        }
        room = target;
        me = room.addPlayer(ws, msg.name, msg.role);
        send({ t: 'welcome', id: me.id, arena: ARENA, roles: ROLES, ultMax: ULT_MAX });
        room.broadcast(room.lobbyInfo());
        break;
      }
      case 'role':
        if (room && me && room.state === 'lobby' && ROLES[msg.role]) { me.role = msg.role; room.broadcast(room.lobbyInfo()); }
        break;
      case 'start':
        if (room && me && me.host && room.state !== 'battle') {
          room.start();
          room.broadcast(room.lobbyInfo());
        }
        break;
      case 'toLobby':
        if (room && me && me.host && room.state === 'result') { room.state = 'lobby'; room.broadcast(room.lobbyInfo()); }
        break;
      case 'input':
        if (me) {
          const i = me.input;
          i.mx = clamp(+msg.mx || 0, -1, 1);
          i.my = clamp(+msg.my || 0, -1, 1);
          i.atk = !!msg.atk; i.skill = !!msg.skill; i.ult = !!msg.ult;
        }
        break;
      case 'ping':
        send({ t: 'pong', ts: msg.ts });
        break;
    }
  });

  ws.on('close', () => {
    if (!room || !me) return;
    room.removePlayer(me.id);
    if (room.players.size === 0) rooms.delete(room.code);
    else room.broadcast(room.lobbyInfo());
  });
});

// ---------- ゲームループ ----------
let sendAcc = 0;
setInterval(() => {
  sendAcc += DT;
  const doSend = sendAcc >= 1 / SEND_RATE;
  if (doSend) sendAcc = 0;
  for (const room of rooms.values()) {
    room.tick();
    if (doSend && room.state === 'battle') room.broadcast(room.snapshot());
  }
}, 1000 / TICK_RATE);

server.listen(PORT, () => console.log(`オニバスターズ server: http://localhost:${PORT}`));
