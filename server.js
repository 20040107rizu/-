// 鬼バスターズ: 鬼の世界から鬼玉を集めて脱出する協力ゲームのサーバー
// HTTP で public/ を配信し、WebSocket でサーバー権威のゲームループを回す。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const S = require('./public/shared.js');

const PORT = process.env.PORT || 3000;
const TICK_RATE = 30;              // シミュレーション回数/秒
const SEND_RATE = 15;              // 状態送信回数/秒
const DT = 1 / TICK_RATE;
const MAX_PLAYERS = 4;
const TIME_LIMIT = +process.env.TIME_LIMIT || 240; // 制限時間（秒）

const PLAYER_R = 18;
const PATROL_R = 22;
const BOSS_R = 46;
const REVIVE_TIME = 3;
const REVIVE_RANGE = 70;
const DASH_MUL = 1.4;               // ダッシュでボス鬼をギリギリ振り切れる速さ
const BOSS_CHASE = 255;            // ボス鬼の追いかける速さ（どの妖怪の歩きより速い）
const ESCAPE_TIME = 1.5;           // 襖の前で攻撃ボタンを長押しする時間
const ESCAPE_RANGE = 80;
const STAMINA_MAX = 100;

// ---------- 静的ファイル配信 ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const PUBLIC_DIR = path.join(__dirname, 'public');

// 公開中のバージョン（画面のファイルの中身から作る）。変わるとアプリに「更新」ボタンが出る
const crypto = require('crypto');
function computeVersion() {
  const h = crypto.createHash('sha1');
  for (const f of ['index.html', 'style.css', 'yokai.js', 'shared.js', 'title.js', 'game.js', 'sw.js', 'art/manifest.json']) {
    try { h.update(fs.readFileSync(path.join(PUBLIC_DIR, f))); } catch {}
  }
  return h.digest('hex').slice(0, 10);
}
const VERSION = computeVersion();
function whatsNew() {
  try { return JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'whatsnew.json'), 'utf8')); } catch { return {}; }
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/version') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ v: VERSION, ...whatsNew() }));
  }
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const headers = { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' };
    // 画面のファイルは毎回新しいか確かめる（古いまま使い回さない）。絵は1日キャッシュ
    headers['Cache-Control'] = /\.(png|jpg|svg)$/.test(filePath) ? 'public, max-age=86400' : 'no-cache';
    if (path.basename(filePath) === 'sw.js') headers['Service-Worker-Allowed'] = '/';
    res.writeHead(200, headers);
    // index.html には版の番号を書き込む（読み込むファイルにも付けて、古いファイルが使われないようにする）
    if (path.basename(filePath) === 'index.html') data = Buffer.from(data.toString('utf8').replace(/__BUILD__/g, VERSION));
    res.end(data);
  });
});

// ---------- ユーティリティ ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const rand = (a, b) => a + Math.random() * (b - a);
const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
let nextId = 1;
const genId = () => nextId++;

function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); } while (rooms.has(code));
  return code;
}

// 点 p が 起点 c・向き angle・幅 w・長さ len の矩形に入っているか
function inRect(p, c, angle, len, w) {
  const dx = p.x - c.x, dy = p.y - c.y;
  const lx = dx * Math.cos(angle) + dy * Math.sin(angle);
  const ly = -dx * Math.sin(angle) + dy * Math.cos(angle);
  return lx >= 0 && lx <= len && Math.abs(ly) <= w / 2;
}

// ---------- 経路探索（グリッドA*） ----------
class Grid {
  constructor(map, radius) {
    this.map = map;
    this.cols = Math.ceil(map.w / S.CELL);
    this.rows = Math.ceil(map.h / S.CELL);
    this.free = new Uint8Array(this.cols * this.rows);
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      this.free[r * this.cols + c] = S.isFree(map, (c + 0.5) * S.CELL, (r + 0.5) * S.CELL, radius) ? 1 : 0;
    }
  }
  cellOf(x, y) { return [clamp(Math.floor(x / S.CELL), 0, this.cols - 1), clamp(Math.floor(y / S.CELL), 0, this.rows - 1)]; }
  nearestFree(c, r) {
    if (this.free[r * this.cols + c]) return [c, r];
    for (let d = 1; d < 10; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
      const nc = c + dx, nr = r + dy;
      if (nc >= 0 && nr >= 0 && nc < this.cols && nr < this.rows && this.free[nr * this.cols + nc]) return [nc, nr];
    }
    return [c, r];
  }
  randomFreePoint() {
    for (;;) {
      const i = Math.floor(Math.random() * this.free.length);
      if (this.free[i]) return { x: ((i % this.cols) + 0.5) * S.CELL, y: (Math.floor(i / this.cols) + 0.5) * S.CELL };
    }
  }
  path(sx, sy, tx, ty) {
    const C = this.cols;
    const [sc, sr] = this.nearestFree(...this.cellOf(sx, sy));
    const [tc, tr] = this.nearestFree(...this.cellOf(tx, ty));
    const start = sr * C + sc, goal = tr * C + tc;
    if (start === goal) return [{ x: tx, y: ty }];
    const g = new Float32Array(this.free.length).fill(Infinity);
    const from = new Int32Array(this.free.length).fill(-1);
    const closed = new Uint8Array(this.free.length);
    const heap = [];
    const push = (i, f) => {
      heap.push([f, i]);
      let k = heap.length - 1;
      while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last; let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1; let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
        }
      }
      return top;
    };
    const h = i => Math.hypot((i % C) - tc, Math.floor(i / C) - tr);
    g[start] = 0; push(start, h(start));
    while (heap.length) {
      const [, cur] = pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cc = cur % C, cr = Math.floor(cur / C);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nc = cc + dx, nr = cr + dy;
        if (nc < 0 || nr < 0 || nc >= C || nr >= this.rows) continue;
        const ni = nr * C + nc;
        if (!this.free[ni]) continue;
        if (dx && dy && (!this.free[cr * C + nc] || !this.free[nr * C + cc])) continue; // 角をすり抜けない
        const ng = g[cur] + (dx && dy ? 1.414 : 1);
        if (ng < g[ni]) { g[ni] = ng; from[ni] = cur; push(ni, ng + h(ni)); }
      }
    }
    if (from[goal] === -1) return [{ x: tx, y: ty }];
    const pts = [];
    for (let i = goal; i !== start; i = from[i]) pts.push({ x: ((i % C) + 0.5) * S.CELL, y: (Math.floor(i / C) + 0.5) * S.CELL });
    pts.reverse();
    pts[pts.length - 1] = { x: tx, y: ty };
    return pts;
  }
}

// 経路にそって移動（見通せるなら直進）
function moveAlong(room, e, grid, tx, ty, speed, r) {
  if (S.lineOfSight(room.map, e, { x: tx, y: ty }) && clearPath(room.map, e, { x: tx, y: ty }, r)) {
    e.path = null;
    stepToward(e, tx, ty, speed);
  } else {
    e.repathT = (e.repathT || 0) - DT;
    if (!e.path || !e.path.length || e.repathT <= 0) { e.path = grid.path(e.x, e.y, tx, ty); e.repathT = 0.6; }
    const wp = e.path[0];
    if (wp) {
      stepToward(e, wp.x, wp.y, speed);
      if (Math.hypot(wp.x - e.x, wp.y - e.y) < 14) e.path.shift();
    }
  }
  S.collide(room.map, e, r);
}
// 太さ r の体で通れるか（左右の端の線でも見通しを確認）
function clearPath(map, a, b, r) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
  const ox = Math.cos(ang) * r, oy = Math.sin(ang) * r;
  return S.lineOfSight(map, { x: a.x + ox, y: a.y + oy }, { x: b.x + ox, y: b.y + oy }) &&
         S.lineOfSight(map, { x: a.x - ox, y: a.y - oy }, { x: b.x - ox, y: b.y - oy });
}
function stepToward(e, tx, ty, speed) {
  const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
  if (d < 1) return;
  const s = Math.min(d, speed * DT);
  e.x += (dx / d) * s; e.y += (dy / d) * s;
  e.face = Math.atan2(dy, dx);
}

// ---------- ガチャ ----------
function rollGacha(count) {
  const ball = S.rollBall(count);
  let x = Math.random(), rank = ball.ranks[0][0];
  for (const [r, w] of ball.ranks) { if (x < w) { rank = r; break; } x -= w; }
  const pool = S.YOKAI.filter(y => y.rank === rank);
  const y = pool[Math.floor(Math.random() * pool.length)];
  return { ball: ball.key, rank, yokai: y.id };
}

// ---------- ルーム ----------
const rooms = new Map();

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.state = 'lobby'; // lobby | battle | result
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.ws.readyState === 1) p.ws.send(data);
  }

  lobbyInfo() {
    return {
      t: 'lobby', code: this.code, state: this.state,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, yokai: p.yokai, host: p.host })),
    };
  }

  addPlayer(ws, name, yokai) {
    const p = {
      id: genId(), ws, name: (name || 'プレイヤー').slice(0, 10), yokai: S.YOKAI_BY_ID[yokai] ? yokai : 'nekomata',
      host: this.players.size === 0, x: 0, y: 0, face: 0,
      input: { mx: 0, my: 0, atk: false, strong: false, item: false, dash: false }, prevItem: false,
    };
    this.players.set(p.id, p);
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    this.players.delete(id);
    if (p && p.host && this.players.size) this.players.values().next().value.host = true;
  }

  // ---- バトル開始 ----
  start() {
    this.state = 'battle';
    this.time = 0;
    this.timeLeft = TIME_LIMIT;
    this.events = [];
    this.projectiles = [];
    this.telegraphs = [];
    this.zones = [];
    this.traps = [];
    this.bombs = [];
    this.result = null;
    const seed = Math.floor(Math.random() * 1e9);
    this.map = S.generateCity(seed);
    this.gridS = new Grid(this.map, PATROL_R + 4);
    this.gridB = new Grid(this.map, BOSS_R + 4);
    const n = this.players.size;

    // 出発地点
    const spawn = this.gridS.randomFreePoint();
    let i = 0;
    for (const p of this.players.values()) {
      const st = S.yokaiStats(p.yokai);
      Object.assign(p, {
        stats: st, x: spawn.x + (i % 2) * 40 - 20, y: spawn.y + Math.floor(i / 2) * 40 - 20, face: 0,
        hp: st.hp, maxHp: st.hp, atkT: 0, strongT: 0, down: false, reviveProg: 0, escaped: false,
        shieldT: 0, dashT: 0, dashDir: 0, invulT: 0, stamina: STAMINA_MAX, exhausted: false, staminaT: 0, invisT: 0,
        item: null, dama: 0, dmgDealt: 0, prevItem: true, escProg: 0,
      });
      S.collide(this.map, p, PLAYER_R);
      i++;
    }

    // 襖（出発地点から遠いところ）
    this.fusuma = process.env.TEST_FUSUMA_NEAR ? { x: spawn.x, y: spawn.y } : this.farPoint(this.gridS, spawn, 2600);

    // 鬼玉
    this.dama = [];
    const damaCount = 60 + 20 * n;
    for (let k = 0; k < damaCount; k++) this.dama.push({ id: genId(), v: 1, ...this.gridS.randomFreePoint() });
    for (const d of this.dama) { d.x += rand(-15, 15); d.y += rand(-15, 15); }

    // アイテム
    this.items = [];
    this.itemCap = 7 + n;
    for (let k = 0; k < this.itemCap; k++) this.spawnItem();
    this.itemRespawnT = 40;

    // 見回り鬼
    this.patrols = [];
    for (let k = 0; k < 12 + 2 * n; k++) this.spawnPatrol(spawn);

    // ボス鬼
    const bp = this.farPoint(this.gridB, spawn, 2400);
    const type = process.env.TEST_BOSS || S.pickBoss();
    const kind = S.BOSSES[type];
    const bossHp = Math.round((5000 + 1500 * n) * kind.hp);
    this.boss = {
      x: bp.x, y: bp.y, hp: bossHp, maxHp: bossHp, type, kind, name: kind.name, face: 0,
      state: 'wander', stateT: 0, path: null, wanderTo: null, target: null, huntBy: null, lostT: 0,
      stunT: 0, chargeDir: 0, hitFlash: 0, atkT: 2,
    };

    this.broadcast({
      t: 'start', seed, timeLimit: TIME_LIMIT, fusuma: this.fusuma, boss: type,
      dama: this.dama.map(d => ({ id: d.id, x: Math.round(d.x), y: Math.round(d.y), v: d.v })),
    });
  }

  farPoint(grid, from, minD) {
    let best = null, bestD = -1;
    for (let k = 0; k < 200; k++) {
      const p = grid.randomFreePoint();
      const d = dist(p, from);
      if (d >= minD) return p;
      if (d > bestD) { bestD = d; best = p; }
    }
    return best;
  }

  spawnItem() {
    const types = Object.keys(S.ITEMS);
    this.items.push({ id: genId(), type: types[Math.floor(Math.random() * types.length)], ...this.gridS.randomFreePoint() });
  }

  spawnPatrol(awayFrom) {
    const p = this.farPoint(this.gridS, awayFrom, 600);
    this.patrols.push({
      id: genId(), x: p.x, y: p.y, face: rand(0, Math.PI * 2), hp: 100, maxHp: 100,
      state: 'patrol', target: null, lostT: 0, wanderTo: null, path: null, whistleT: 0, hitFlash: 0,
    });
  }

  activePlayers() { return [...this.players.values()].filter(p => !p.down && !p.escaped); }
  visibleTo(p) { return !p.down && !p.escaped && p.invisT <= 0; }

  // ---- ダメージ ----
  damageOni(src, e, amount) {
    if (e.hp <= 0) return;
    e.hp = Math.max(0, e.hp - amount);
    e.hitFlash = 0.1;
    if (src) src.dmgDealt += amount;
    this.events.push({ k: 'dmg', x: Math.round(e.x + rand(-20, 20)), y: Math.round(e.y - 30), v: Math.round(amount) });
    // 攻撃された見回り鬼は攻撃者に気づく
    if (e.isPatrol && e.hp > 0 && e.state !== 'alert' && src && this.visibleTo(src)) this.alertPatrol(e, src);
    if (e.hp <= 0) {
      if (e.isPatrol) this.killPatrol(e);
      else this.killBoss();
    }
  }

  enemies() {
    const list = this.patrols.filter(p => p.hp > 0);
    if (this.boss && this.boss.hp > 0) list.push(this.boss);
    return list;
  }
  enemyR(e) { return e === this.boss ? BOSS_R : PATROL_R; }

  hitEnemiesInCircle(src, x, y, radius, amount) {
    for (const e of this.enemies()) if (Math.hypot(e.x - x, e.y - y) <= radius + this.enemyR(e)) this.damageOni(src, e, amount);
  }

  damagePlayer(p, amount) {
    if (p.down || p.escaped || p.dashT > 0 || p.invulT > 0) return;
    if (p.shieldT > 0) amount *= 0.3;
    p.hp -= amount;
    this.events.push({ k: 'hurt', x: Math.round(p.x), y: Math.round(p.y - 30), v: Math.round(amount), id: p.id });
    if (p.hp <= 0) { p.hp = 0; p.down = true; p.reviveProg = 0; this.events.push({ k: 'down', id: p.id }); }
  }

  healPlayer(p, amount) {
    if (p.down || p.escaped) return;
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + amount);
    if (p.hp > before) this.events.push({ k: 'heal', x: Math.round(p.x), y: Math.round(p.y - 30), v: Math.round(p.hp - before) });
  }

  // 鬼玉を落とす（v はその玉1個の価値。ボス鬼は v の大きい「どデカい鬼玉」1個）
  dropDama(x, y, n, v = 1) {
    for (let k = 0; k < n; k++) {
      const d = { id: genId(), x: x + rand(-40, 40), y: y + rand(-40, 40), v };
      S.collide(this.map, d, v > 1 ? 30 : 10);
      this.dama.push(d);
      this.events.push({ k: 'da', id: d.id, x: Math.round(d.x), y: Math.round(d.y), v });
    }
  }

  // ---- 見回り鬼 ----
  alertPatrol(e, target) {
    e.state = 'alert'; e.target = target.id; e.lostT = 0; e.path = null;
    this.events.push({ k: 'whistle', id: e.id, target: target.id });
    // ボス鬼に報告
    const b = this.boss;
    if (b && b.hp > 0 && b.state !== 'engage') { b.state = 'hunt'; b.target = target.id; b.huntBy = e.id; b.path = null; }
  }

  calmPatrol(e) {
    e.state = 'patrol'; e.target = null; e.path = null; e.wanderTo = null;
    const b = this.boss;
    if (b && b.huntBy === e.id) { b.huntBy = null; if (b.state === 'hunt') { b.state = 'wander'; b.target = null; b.path = null; } }
  }

  killPatrol(e) {
    this.events.push({ k: 'oniDown', x: Math.round(e.x), y: Math.round(e.y) });
    this.calmPatrol(e); // 伝達はここで途切れる
    this.dropDama(e.x, e.y, 3 + Math.floor(Math.random() * 3)); // 3〜5個
    e.respawnT = 25;
  }

  canSee(e, p, range, halfAngle) {
    if (!this.visibleTo(p)) return false;
    const d = dist(e, p);
    if (d > range) return false;
    if (d > 70 && angleDiff(Math.atan2(p.y - e.y, p.x - e.x), e.face) > halfAngle) return false;
    return S.lineOfSight(this.map, e, p);
  }

  updatePatrols() {
    for (const e of this.patrols) {
      e.isPatrol = true;
      e.hitFlash = Math.max(0, e.hitFlash - DT);
      if (e.hp <= 0) {
        e.respawnT -= DT;
        if (e.respawnT <= 0) {
          const ap = this.activePlayers();
          const p = this.farPoint(this.gridS, ap[0] || { x: 0, y: 0 }, 900);
          Object.assign(e, { x: p.x, y: p.y, hp: e.maxHp, state: 'patrol', target: null, path: null, wanderTo: null });
        }
        continue;
      }
      if (e.state === 'patrol') {
        if (!e.wanderTo || dist(e, e.wanderTo) < 30) { e.wanderTo = this.gridS.randomFreePoint(); e.path = null; }
        moveAlong(this, e, this.gridS, e.wanderTo.x, e.wanderTo.y, 105, PATROL_R);
        for (const p of this.activePlayers()) {
          if (this.canSee(e, p, 300, 0.65)) { this.alertPatrol(e, p); break; }
        }
      } else if (e.state === 'alert') {
        const t = this.players.get(e.target);
        if (!t || !this.visibleTo(t)) { this.calmPatrol(e); continue; }
        // 攻撃はせず、笛を吹きながら追いかける
        if (dist(e, t) > 60) moveAlong(this, e, this.gridS, t.x, t.y, 195, PATROL_R);
        else e.face = Math.atan2(t.y - e.y, t.x - e.x);
        e.whistleT -= DT;
        if (e.whistleT <= 0) { e.whistleT = 1.2; this.events.push({ k: 'whistle', id: e.id, target: t.id, quiet: true }); }
        if (S.lineOfSight(this.map, e, t) && dist(e, t) < 520) e.lostT = 0;
        else if ((e.lostT += DT) > 5) this.calmPatrol(e);
        // ボスへの報告を続ける
        const b = this.boss;
        if (b && b.hp > 0 && b.state === 'wander') { b.state = 'hunt'; b.target = t.id; b.huntBy = e.id; }
      }
    }
  }

  // ---- ボス鬼 ----
  killBoss() {
    const b = this.boss;
    this.events.push({ k: 'bossDown', x: Math.round(b.x), y: Math.round(b.y) });
    this.dropDama(b.x, b.y, 1, b.kind.drop);
    this.telegraphs = [];
  }

  updateBoss() {
    const b = this.boss;
    if (!b || b.hp <= 0) return;
    b.hitFlash = Math.max(0, b.hitFlash - DT);
    if (b.stunT > 0) { b.stunT -= DT; return; }

    // 自分の目で見つけたら戦闘
    if (b.state !== 'engage' && b.state !== 'charging' && b.state !== 'windup') {
      for (const p of this.activePlayers()) {
        if (this.canSee(b, p, 380, Math.PI)) { b.state = 'engage'; b.target = p.id; b.lostT = 0; b.path = null; break; }
      }
    }

    const t = b.target != null ? this.players.get(b.target) : null;
    switch (b.state) {
      case 'wander':
        if (!b.wanderTo || dist(b, b.wanderTo) < 40) { b.wanderTo = this.gridB.randomFreePoint(); b.path = null; }
        moveAlong(this, b, this.gridB, b.wanderTo.x, b.wanderTo.y, 95, BOSS_R);
        break;
      case 'hunt': // 見回り鬼の報告で居場所を知っている
        if (!t || !this.visibleTo(t)) { b.state = 'wander'; b.target = null; b.huntBy = null; break; }
        moveAlong(this, b, this.gridB, t.x, t.y, BOSS_CHASE, BOSS_R);
        break;
      case 'engage': {
        if (!t || !this.visibleTo(t)) { b.state = b.huntBy ? 'hunt' : 'wander'; if (!b.huntBy) b.target = null; break; }
        const sees = S.lineOfSight(this.map, b, t) && dist(b, t) < 520;
        if (sees) b.lostT = 0;
        else if ((b.lostT += DT) > 3) { b.state = b.huntBy ? 'hunt' : 'wander'; if (!b.huntBy) b.target = null; break; }
        if (dist(b, t) > 130) moveAlong(this, b, this.gridB, t.x, t.y, BOSS_CHASE, BOSS_R);
        else b.face = Math.atan2(t.y - b.y, t.x - b.x);
        b.atkT -= DT;
        if (b.atkT <= 0 && sees && dist(b, t) < 420) this.bossAttack(t);
        break;
      }
      case 'windup':
        b.stateT -= DT;
        if (b.stateT <= 0) { b.state = 'engage'; b.atkT = rand(1.2, 2.0) * b.kind.atkGap; }
        break;
      case 'charging': {
        b.stateT -= DT;
        const px = b.x, py = b.y;
        b.x += Math.cos(b.chargeDir) * 600 * DT; b.y += Math.sin(b.chargeDir) * 600 * DT;
        S.collide(this.map, b, BOSS_R);
        for (const p of this.activePlayers()) if (!p.chargeHit && dist(p, b) < BOSS_R + PLAYER_R) { this.damagePlayer(p, 45 * b.kind.dmg); p.chargeHit = true; }
        const blocked = Math.hypot(b.x - px, b.y - py) < 600 * DT * 0.5;
        if (b.stateT <= 0 || blocked) { b.state = 'engage'; b.atkT = rand(1.2, 1.8) * b.kind.atkGap; if (blocked) this.events.push({ k: 'boom', x: Math.round(b.x), y: Math.round(b.y), r: 60 }); }
        break;
      }
    }
  }

  bossAttack(t) {
    const b = this.boss;
    const roll = Math.random();
    const warn = 1.0;
    b.face = Math.atan2(t.y - b.y, t.x - b.x);
    if (roll < 0.4) {
      this.telegraphs.push({ id: genId(), shape: 'circle', x: t.x, y: t.y, r: 110, t: warn, max: warn, dmg: 40 * b.kind.dmg });
      b.state = 'windup'; b.stateT = warn + 0.3;
    } else if (roll < 0.7) {
      b.chargeDir = b.face;
      this.telegraphs.push({ id: genId(), shape: 'rect', x: b.x, y: b.y, a: b.face, len: 520, w: BOSS_R * 2, t: warn, max: warn, dmg: 0, then: 'charge' });
      for (const p of this.players.values()) p.chargeHit = false;
      b.state = 'windup'; b.stateT = warn + 0.2;
    } else {
      this.telegraphs.push({ id: genId(), shape: 'circle', x: b.x, y: b.y, r: 230, t: warn + 0.2, max: warn + 0.2, dmg: 35 * b.kind.dmg, follow: true });
      b.state = 'windup'; b.stateT = warn + 0.5;
    }
  }

  updateTelegraphs() {
    const b = this.boss;
    for (const tg of this.telegraphs) {
      if (b && b.stunT > 0) continue; // しびれている間は止まる
      if (tg.follow && b) { tg.x = b.x; tg.y = b.y; }
      tg.t -= DT;
      if (tg.t > 0) continue;
      if (tg.then === 'charge') { if (b && b.hp > 0) { b.state = 'charging'; b.stateT = 0.85; } continue; }
      for (const p of this.activePlayers()) {
        const hit = tg.shape === 'rect' ? inRect(p, tg, tg.a, tg.len, tg.w) : dist(p, tg) <= tg.r;
        if (hit) this.damagePlayer(p, tg.dmg);
      }
      this.events.push({ k: 'boom', x: Math.round(tg.x), y: Math.round(tg.y), r: tg.r });
    }
    this.telegraphs = this.telegraphs.filter(tg => tg.t > 0);
  }

  // ---- プレイヤー ----
  nearestEnemy(p, maxRange) {
    let best = null, bestD = maxRange;
    for (const e of this.enemies()) {
      const d = dist(p, e) - this.enemyR(e);
      if (d < bestD && S.lineOfSight(this.map, p, e)) { bestD = d; best = e; }
    }
    return best;
  }

  shoot(p, angle, speed, dmg, life, r, c, extra) {
    this.projectiles.push({ id: genId(), owner: p.id, x: p.x, y: p.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, dmg, life, r, c, ...extra });
  }

  updatePlayer(p) {
    const st = p.stats;
    for (const k of ['atkT', 'strongT', 'shieldT', 'invulT', 'staminaT', 'invisT']) p[k] = Math.max(0, p[k] - DT);
    if (p.down || p.escaped) return;
    const inp = p.input;

    // ダッシュ（押している間）とスタミナ
    const moving = Math.hypot(inp.mx, inp.my) > 0.15;
    let dashing = false;
    if (inp.dash && moving && p.staminaT > 0) dashing = true;
    else if (inp.dash && moving && !p.exhausted && p.stamina > 0) {
      dashing = true;
      p.stamina = Math.max(0, p.stamina - 35 * DT);
      if (p.stamina <= 0) p.exhausted = true;
    }
    if (!dashing) {
      p.stamina = Math.min(STAMINA_MAX, p.stamina + 22 * DT);
      if (p.exhausted && p.stamina >= 30) p.exhausted = false;
    }
    p.dashing = dashing;

    if (p.dashT > 0) {
      p.dashT -= DT;
      p.x += Math.cos(p.dashDir) * 700 * DT;
      p.y += Math.sin(p.dashDir) * 700 * DT;
      for (const e of this.enemies()) {
        if (!p.dashHits.has(e) && dist(p, e) < this.enemyR(e) + 40) { p.dashHits.add(e); this.damageOni(p, e, 40 * st.strongMul); }
      }
    } else {
      let mx = inp.mx, my = inp.my;
      const m = Math.hypot(mx, my);
      if (m > 1) { mx /= m; my /= m; }
      const spd = st.speed * (dashing ? DASH_MUL : 1);
      p.x += mx * spd * DT; p.y += my * spd * DT;
      if (m > 0.15) p.face = Math.atan2(my, mx);
    }
    S.collide(this.map, p, PLAYER_R);

    const target = this.nearestEnemy(p, st.atkRange + 150);
    const aim = target ? Math.atan2(target.y - p.y, target.x - p.x) : p.face;

    // 通常攻撃
    if (inp.atk && p.atkT <= 0) {
      p.atkT = st.atkCd;
      p.face = aim;
      if (p.stats.atkRange < 200) {
        const ax = p.x + Math.cos(aim) * st.atkRange * 0.6, ay = p.y + Math.sin(aim) * st.atkRange * 0.6;
        this.hitEnemiesInCircle(p, ax, ay, st.atkRange * 0.55, st.atkDmg);
        this.events.push({ k: 'slash', x: Math.round(ax), y: Math.round(ay), a: +aim.toFixed(2) });
      } else {
        const c = S.YOKAI_BY_ID[p.yokai].color;
        this.shoot(p, aim, 650, st.atkDmg, st.atkRange / 650, 10, c, { heal: S.YOKAI_BY_ID[p.yokai].role === 'healer' });
      }
    }

    // 強攻撃
    if (inp.strong && p.strongT <= 0) {
      p.strongT = st.strongCd;
      const role = S.YOKAI_BY_ID[p.yokai].role;
      const m = st.strongMul;
      if (role === 'fighter') {
        p.dashT = 0.25; p.dashDir = aim; p.dashHits = new Set();
      } else if (role === 'tank') {
        p.shieldT = 3;
        this.hitEnemiesInCircle(p, p.x, p.y, 170, 30 * m);
        this.events.push({ k: 'ring', x: Math.round(p.x), y: Math.round(p.y), r: 170, c: '#8aa0ff' });
      } else if (role === 'healer') {
        this.zones.push({ id: genId(), x: p.x, y: p.y, r: 140, life: 5, tick: 0, amt: 8 * m });
      } else {
        for (let k = -1; k <= 1; k++) this.shoot(p, aim + k * 0.18, 800, 22 * m, 0.8, 13, '#fff27a');
      }
    }

    // アイテム（押した瞬間に使う）
    if (inp.item && !p.prevItem && p.item) this.useItem(p, aim);
    p.prevItem = inp.item;

    // 拾う
    for (const d of this.dama) {
      if (!d.taken && Math.hypot(d.x - p.x, d.y - p.y) < 32) {
        d.taken = true; p.dama += d.v;
        this.events.push({ k: 'dg', id: d.id, by: p.id, v: d.v });
      }
    }
    if (!p.item) {
      for (const it of this.items) {
        if (!it.taken && Math.hypot(it.x - p.x, it.y - p.y) < 34) {
          it.taken = true; p.item = it.type;
          this.events.push({ k: 'pick', id: p.id, item: it.type });
          break;
        }
      }
    }

    // 脱出: 襖の前で攻撃ボタンを長押し（うっかりぶつかって出ないように）
    if (inp.atk && Math.hypot(this.fusuma.x - p.x, this.fusuma.y - p.y) < ESCAPE_RANGE) p.escProg += DT;
    else p.escProg = 0;
    if (p.escProg >= ESCAPE_TIME) {
      p.escaped = true; p.escProg = 0;
      this.events.push({ k: 'escape', id: p.id });
      for (const e of this.patrols) if (e.target === p.id) this.calmPatrol(e);
    }
  }

  useItem(p, aim) {
    const type = p.item;
    p.item = null;
    this.events.push({ k: 'use', id: p.id, item: type, x: Math.round(p.x), y: Math.round(p.y) });
    switch (type) {
      case 'trap': this.traps.push({ id: genId(), x: p.x, y: p.y, life: 40 }); break;
      case 'bomb': this.bombs.push({ id: genId(), owner: p.id, x: p.x, y: p.y, t: 3 }); break;
      case 'punch': this.shoot(p, aim, 620, 90, 0.8, 26, '#9ab0c8', { punch: true }); break;
      case 'stamina': p.staminaT = 10; p.stamina = STAMINA_MAX; p.exhausted = false; break;
      case 'onigiri': { const lost = p.maxHp - p.hp; p.hp = p.maxHp; this.events.push({ k: 'heal', x: Math.round(p.x), y: Math.round(p.y - 30), v: Math.round(lost) }); break; } // 必ず全回復
      case 'jimmy':
        p.invisT = 10;
        for (const e of this.patrols) if (e.target === p.id) this.calmPatrol(e);
        break;
    }
  }

  updateItemsOnField() {
    const b = this.boss;
    for (const tr of this.traps) {
      tr.life -= DT;
      if (b && b.hp > 0 && b.stunT <= 0 && dist(tr, b) < BOSS_R + 20) {
        tr.life = 0; b.stunT = 6;
        if (b.state === 'charging' || b.state === 'windup') b.state = 'engage';
        this.events.push({ k: 'stun', x: Math.round(b.x), y: Math.round(b.y) });
      }
    }
    this.traps = this.traps.filter(t => t.life > 0);

    for (const bm of this.bombs) {
      bm.t -= DT;
      if (bm.t > 0) continue;
      const owner = this.players.get(bm.owner);
      this.hitEnemiesInCircle(owner, bm.x, bm.y, 170, 250);
      for (const q of this.activePlayers()) if (dist(q, bm) < 170) this.damagePlayer(q, 50); // 仲間も巻き込む
      this.events.push({ k: 'boom', x: Math.round(bm.x), y: Math.round(bm.y), r: 170, big: true });
    }
    this.bombs = this.bombs.filter(b => b.t > 0);

    this.items = this.items.filter(it => !it.taken);
    this.dama = this.dama.filter(d => !d.taken);
    this.itemRespawnT -= DT;
    if (this.itemRespawnT <= 0) { this.itemRespawnT = 40; if (this.items.length < this.itemCap) this.spawnItem(); }
  }

  updateRevive() {
    for (const p of this.players.values()) {
      if (!p.down || p.escaped) continue;
      const helper = this.activePlayers().some(q => q !== p && dist(p, q) < REVIVE_RANGE);
      if (helper) p.reviveProg += DT; else p.reviveProg = Math.max(0, p.reviveProg - DT * 0.5);
      if (p.reviveProg >= REVIVE_TIME) {
        p.down = false; p.hp = p.maxHp * 0.4; p.reviveProg = 0; p.invulT = 2;
        this.events.push({ k: 'revive', id: p.id });
      }
    }
  }

  updateProjectiles() {
    for (const pr of this.projectiles) {
      pr.x += pr.vx * DT; pr.y += pr.vy * DT; pr.life -= DT;
      if (!S.isFree(this.map, pr.x, pr.y, 1)) { pr.life = 0; continue; }
      const owner = this.players.get(pr.owner);
      for (const e of this.enemies()) {
        if (dist(pr, e) < this.enemyR(e) + pr.r) { this.damageOni(owner, e, pr.dmg); pr.life = 0; break; }
      }
      // ヒーラーの弾は味方に当たると回復
      if (pr.life > 0 && pr.heal) {
        for (const q of this.activePlayers()) {
          if (q.id !== pr.owner && dist(pr, q) < PLAYER_R + pr.r && q.hp < q.maxHp) { this.healPlayer(q, 10 * (owner ? owner.stats.strongMul : 1)); pr.life = 0; break; }
        }
      }
    }
    this.projectiles = this.projectiles.filter(pr => pr.life > 0);
  }

  updateZones() {
    for (const z of this.zones) {
      z.life -= DT; z.tick -= DT;
      if (z.tick <= 0) { z.tick = 0.5; for (const q of this.activePlayers()) if (dist(q, z) <= z.r) this.healPlayer(q, z.amt); }
    }
    this.zones = this.zones.filter(z => z.life > 0);
  }

  tick() {
    if (this.state !== 'battle') return;
    this.time += DT;
    this.timeLeft -= DT;
    for (const p of this.players.values()) this.updatePlayer(p);
    this.updateRevive();
    this.updatePatrols();
    this.updateBoss();
    this.updateTelegraphs();
    this.updateItemsOnField();
    this.updateProjectiles();
    this.updateZones();
    // 全員が脱出 or 倒れた、または時間切れで終了
    const remaining = [...this.players.values()].filter(p => !p.escaped && !p.down);
    if (this.timeLeft <= 0 || remaining.length === 0) this.finish();
  }

  finish() {
    this.state = 'result';
    const players = [...this.players.values()].map(p => ({
      id: p.id, name: p.name, yokai: p.yokai, escaped: p.escaped, dama: p.dama, dmg: Math.round(p.dmgDealt),
      gacha: p.escaped ? rollGacha(p.dama) : null,
    }));
    this.broadcast({ t: 'result', players });
  }

  snapshot() {
    const b = this.boss;
    const snap = {
      t: 'state', timeLeft: +this.timeLeft.toFixed(1),
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, yokai: p.yokai, x: Math.round(p.x), y: Math.round(p.y), face: +p.face.toFixed(2),
        hp: Math.round(p.hp), maxHp: p.maxHp, down: p.down, rv: +(p.reviveProg / REVIVE_TIME).toFixed(2), esc: p.escaped,
        dama: p.dama, item: p.item, ep: +(p.escProg / ESCAPE_TIME).toFixed(2), stam: Math.round(p.stamina), exh: p.exhausted, inf: p.staminaT > 0, invis: p.invisT > 0,
        sh: p.shieldT > 0, dash: p.dashT > 0, run: p.dashing, atkCd: +(p.atkT / p.stats.atkCd).toFixed(2), stCd: +(p.strongT / p.stats.strongCd).toFixed(2),
      })),
      patrols: this.patrols.filter(e => e.hp > 0).map(e => ({ id: e.id, x: Math.round(e.x), y: Math.round(e.y), face: +e.face.toFixed(2), alert: e.state === 'alert', target: e.target, hp: Math.round(e.hp), maxHp: e.maxHp, flash: e.hitFlash > 0 })),
      boss: b && b.hp > 0 ? { type: b.type, x: Math.round(b.x), y: Math.round(b.y), hp: Math.round(b.hp), maxHp: b.maxHp, face: +b.face.toFixed(2), st: b.state, stun: b.stunT > 0, target: b.state === 'hunt' || b.state === 'engage' ? b.target : null, hunt: b.state === 'hunt', flash: b.hitFlash > 0 } : null,
      items: this.items.map(it => ({ id: it.id, x: Math.round(it.x), y: Math.round(it.y), type: it.type })),
      traps: this.traps.map(t => ({ id: t.id, x: Math.round(t.x), y: Math.round(t.y) })),
      bombs: this.bombs.map(bm => ({ id: bm.id, x: Math.round(bm.x), y: Math.round(bm.y), t: +bm.t.toFixed(1) })),
      proj: this.projectiles.map(pr => ({ id: pr.id, x: Math.round(pr.x), y: Math.round(pr.y), r: pr.r, c: pr.c, punch: pr.punch, a: +Math.atan2(pr.vy, pr.vx).toFixed(2) })),
      tele: this.telegraphs.map(tg => ({ id: tg.id, shape: tg.shape, x: Math.round(tg.x), y: Math.round(tg.y), r: tg.r, a: tg.a, len: tg.len, w: tg.w, p: +(1 - tg.t / tg.max).toFixed(2) })),
      zones: this.zones.map(z => ({ id: z.id, x: Math.round(z.x), y: Math.round(z.y), r: z.r })),
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
          if (target.state !== 'lobby') return send({ t: 'error', msg: 'プレイ中のため参加できません' });
        }
        room = target;
        me = room.addPlayer(ws, msg.name, msg.yokai);
        send({ t: 'welcome', id: me.id });
        room.broadcast(room.lobbyInfo());
        break;
      }
      case 'yokai':
        if (room && me && room.state === 'lobby' && S.YOKAI_BY_ID[msg.id]) { me.yokai = msg.id; room.broadcast(room.lobbyInfo()); }
        break;
      case 'start':
        if (room && me && me.host && room.state === 'lobby') {
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
          i.atk = !!msg.atk; i.strong = !!msg.strong; i.item = !!msg.item; i.dash = !!msg.dash;
        }
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
    try { room.tick(); } catch (e) { console.error(e); }
    if (doSend && room.state === 'battle') room.broadcast(room.snapshot());
  }
}, 1000 / TICK_RATE);

if (require.main === module) server.listen(PORT, () => console.log(`鬼バスターズ server: http://localhost:${PORT}`));
module.exports = { Room, rollGacha, server };
