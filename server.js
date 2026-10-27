// 鬼バスターズ: 鬼の世界から鬼玉を集めて脱出する協力ゲームのサーバー
// HTTP で public/ を配信し、WebSocket でサーバー権威のゲームループを回す。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const S = require('./public/shared.js');
const Combat = require('./combat.js');
const Ranking = require('./ranking.js');
// テスト用: TEST_WEEK=3 で、今週を第4回（救助ランキング）として動かす
if (process.env.TEST_WEEK) { const w = +process.env.TEST_WEEK; S.weekIndex = () => w; }
const A = Combat.A;

const PORT = process.env.PORT || 3000;
const TICK_RATE = 30;              // シミュレーション回数/秒
const SEND_RATE = 15;              // 状態送信回数/秒
const DT = 1 / TICK_RATE;
const MAX_PLAYERS = 4;
const TIME_LIMIT = +process.env.TIME_LIMIT || 300; // 制限時間（秒）
const BONUS_RATE = process.env.BONUS_RATE != null ? +process.env.BONUS_RATE : 0.3; // 乱入ボスが来る確率
const SHIN_RATE = process.env.SHIN_RATE != null ? +process.env.SHIN_RATE : 0.1;    // 鬼神を倒したとき、鬼神・真が目覚める確率

const PLAYER_R = 18;
const PATROL_R = 22;
const BOSS_R = 46;
const REVIVE_TIME = 3;
const REVIVE_RANGE = 70;
const DASH_MUL = 1.4;               // ダッシュでボス鬼をギリギリ振り切れる速さ
const BOSS_CHASE = 255;            // ボス鬼の追いかける速さ（どの妖怪の歩きより速い）
const DEMO_AI = !!process.env.DEMO_AI; // デモ撮影用（自動で戦う・ボスと見回り鬼が近くに出る）
const NOTICE_RANGE = 300;        // 攻撃してきた相手に見回り鬼が気づける距離（見張りの視界と同じ）
const ESCAPE_TIME = 1.5;           // 襖の前で攻撃ボタンを長押しする時間
const ESCAPE_RANGE = 80;
const DAMA_RESPAWN = 2;            // 鬼玉が1個湧き直す間隔（秒）
// 開始時の演出（ボス鬼が街に到着する映像）とカウントダウン。この間はゲームを止める
const INTRO_MOVIE = process.env.NO_INTRO ? 0 : 4.5;
const COUNTDOWN = process.env.NO_INTRO ? 0 : 5;
const STAMINA_MAX = 100;

// ---------- 静的ファイル配信 ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const PUBLIC_DIR = path.join(__dirname, 'public');

// 公開中のバージョン（画面のファイルの中身から作る）。変わるとアプリに「更新」ボタンが出る
const crypto = require('crypto');
function computeVersion() {
  const h = crypto.createHash('sha1');
  for (const f of ['index.html', 'style.css', 'music.js', 'yokai.js', 'attacks.js', 'shared.js', 'stages.js', 'title.js', 'gacha.js', 'game.js', 'sw.js', 'art/manifest.json', 'whatsnew.json']) {
    try { h.update(fs.readFileSync(path.join(PUBLIC_DIR, f))); } catch {}
  }
  h.update(fs.readFileSync(__filename));
  for (const f of ['combat.js', 'ranking.js']) h.update(fs.readFileSync(path.join(__dirname, f))); // サーバーだけの変更（ボス鬼の強さなど）でも新しい版にする
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
  // 週替わりランキング: /ranking?pid=...&week=prev（先週）／week=3（第4回。終わった週の結果も見られる）
  if (urlPath === '/ranking') {
    const q = new URL(req.url, 'http://x').searchParams, w = q.get('week'), cur = S.weekIndex();
    const idx = w === 'prev' ? cur - 1 : /^\d{1,4}$/.test(w || '') ? Math.min(cur, +w) : cur;
    Ranking.board(idx, cleanPid(q.get('pid'))).then(b => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(b));
    }, e => { console.error(e); res.writeHead(500); res.end('{}'); });
    return;
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
  // A*。作業用の配列は毎回作らずに使い回す（メモリの掃除を減らして軽くするため。結果は同じ）
  path(sx, sy, tx, ty) {
    const C = this.cols, N = this.free.length;
    const [sc, sr] = this.nearestFree(...this.cellOf(sx, sy));
    const [tc, tr] = this.nearestFree(...this.cellOf(tx, ty));
    const start = sr * C + sc, goal = tr * C + tc;
    if (start === goal) return [{ x: tx, y: ty }];
    if (!this.g) { this.g = new Float32Array(N); this.from = new Int32Array(N); this.seen = new Uint32Array(N); this.done = new Uint32Array(N); this.stamp = 0; this.hf = new Float64Array(64); this.hi = new Int32Array(64); }
    if (++this.stamp === 0xffffffff) { this.seen.fill(0); this.done.fill(0); this.stamp = 1; }
    const g = this.g, from = this.from, seen = this.seen, done = this.done, st = this.stamp;
    const G = i => (seen[i] === st ? g[i] : Infinity);
    // 二分ヒープ（f の小さい順）
    let hf = this.hf, hi = this.hi, hn = 0;
    const push = (i, f) => {
      if (hn === hf.length) { const nf = new Float64Array(hn * 2), ni = new Int32Array(hn * 2); nf.set(hf); ni.set(hi); hf = this.hf = nf; hi = this.hi = ni; }
      let k = hn++;
      hf[k] = f; hi[k] = i;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (hf[p] <= hf[k]) break;
        const tf = hf[p]; hf[p] = hf[k]; hf[k] = tf; const ti = hi[p]; hi[p] = hi[k]; hi[k] = ti;
        k = p;
      }
    };
    const pop = () => {
      const top = hi[0];
      hn--;
      if (hn > 0) {
        hf[0] = hf[hn]; hi[0] = hi[hn]; let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1; let m = k;
          if (l < hn && hf[l] < hf[m]) m = l;
          if (r < hn && hf[r] < hf[m]) m = r;
          if (m === k) break;
          const tf = hf[m]; hf[m] = hf[k]; hf[k] = tf; const ti = hi[m]; hi[m] = hi[k]; hi[k] = ti;
          k = m;
        }
      }
      return top;
    };
    // 距離の見積もり。Math.hypot は遅いので、同じ値を表にしておいて引く
    if (!this.hyp) { this.hyp = new Float64Array(C * this.rows); for (let y = 0; y < this.rows; y++) for (let x = 0; x < C; x++) this.hyp[y * C + x] = Math.hypot(x, y); }
    const hyp = this.hyp;
    const h = i => hyp[Math.abs(Math.floor(i / C) - tr) * C + Math.abs((i % C) - tc)];
    seen[start] = st; g[start] = 0; from[start] = -1; push(start, h(start));
    while (hn) {
      const cur = pop();
      if (cur === goal) break;
      if (done[cur] === st) continue;
      done[cur] = st;
      const cc = cur % C, cr = Math.floor(cur / C);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nc = cc + dx, nr = cr + dy;
        if (nc < 0 || nr < 0 || nc >= C || nr >= this.rows) continue;
        const ni = nr * C + nc;
        if (!this.free[ni]) continue;
        if (dx && dy && (!this.free[cr * C + nc] || !this.free[nr * C + cc])) continue; // 角をすり抜けない
        const ng = G(cur) + (dx && dy ? 1.414 : 1);
        if (ng < G(ni)) { seen[ni] = st; g[ni] = ng; from[ni] = cur; push(ni, ng + h(ni)); }
      }
    }
    if (seen[goal] !== st || goal === start) return [{ x: tx, y: ty }];
    const pts = [];
    for (let i = goal; i !== start; i = from[i]) pts.push({ x: ((i % C) + 0.5) * S.CELL, y: (Math.floor(i / C) + 0.5) * S.CELL });
    pts.reverse();
    pts[pts.length - 1] = { x: tx, y: ty };
    return pts;
  }
}

// 経路にそって移動（見通せるなら直進）
function moveAlong(room, e, grid, tx, ty, speed, r) {
  if (e.slowT > 0) speed *= e.slowMul || 0.6; // 氷・水などで遅くなっている
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
    this.bossSel = 'red';  // ホストが選んだボス鬼
    this.challengeOn = false; // 今週のチャレンジで出撃する
    this.watchers = new Set(); // 観戦している人の接続
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.ws.readyState === 1) { p.ws.send(data); load.bytes += data.length; }
    for (const w of this.watchers) if (w.readyState === 1) { w.send(data); load.bytes += data.length; }
  }

  // 途中から観戦する人（つなぎ直した人）に、今のバトルの様子を送る
  watchStart(ws, watch = true) {
    ws.send(JSON.stringify({
      t: 'start', seed: this.map.seed, stage: this.stage, timeLimit: this.timeLimit, fusuma: this.fusuma, boss: this.boss.type, movie: 0, countdown: 0, watch, rejoin: !watch,
      dama: this.dama.map(d => ({ id: d.id, x: Math.round(d.x), y: Math.round(d.y), v: d.v })),
    }));
  }

  lobbyInfo() {
    return {
      t: 'lobby', code: this.code, state: this.state, boss: this.bossSel, challenge: this.challengeOn, week: S.weekIndex(),
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, yokai: p.yokai, host: p.host, totsu: p.totsu, lv: p.lv, title: p.title, away: !!p.away || undefined })),
    };
  }

  addPlayer(ws, name, yokai, pid, totsu, title, lv) {
    const p = {
      id: genId(), ws, pid, totsu: cleanTotsu(totsu), lv: cleanLv(lv), title: cleanTitle(title), name: cleanName(name) || 'プレイヤー', yokai: usableYokai(yokai) ? yokai : 'nekomata',
      host: this.players.size === 0, x: 0, y: 0, face: 0,
      input: { mx: 0, my: 0, atk: false, strong: false, item: false, dash: false, skill: false, ult: false }, prevItem: false,
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
    // デモ撮影用: 仲間のボットを足す（DEMO_BOTS=3 で4人チーム）
    if (DEMO_AI && process.env.DEMO_BOTS && !this.demoBots) {
      this.demoBots = true;
      const fake = { readyState: 3, send() {}, close() {} };
      const team = (process.env.DEMO_TEAM || 'kappa,karasutengu,yukionna').split(',');
      for (let k = 0; k < +process.env.DEMO_BOTS; k++) this.addPlayer(fake, ['カッパ丸', 'テング', 'ユキ'][k] || 'ボット', team[k % team.length], null);
    }
    if (DEMO_AI && process.env.DEMO_YOKAI) this.players.values().next().value.yokai = process.env.DEMO_YOKAI;
    this.state = 'battle';
    this.time = 0;
    // 1回でもバトルに行った人はフレンド一覧に出す
    for (const p of this.players.values()) if (p.pid) { touchPlayer(p.pid, p.name, p.yokai, p.title); known.get(p.pid).played = true; }
    // 今週のランキングが「チャレンジ」で、ホストが選んでいたら、ステージ・ボス・しばりを固定する
    this.weekIdx = S.weekIndex();
    this.theme = S.themeOf(this.weekIdx);
    this.challenge = this.challengeOn && this.theme.key === 'challenge' ? this.theme : null;
    this.timeLimit = this.challenge && this.challenge.rule === 'short' ? Math.min(180, TIME_LIMIT) : TIME_LIMIT;
    this.timeLeft = this.timeLimit;
    this.bossKillT = null;
    this.anyDown = false; this.blizKill = false; // レジェンドの試練用
    this.introT = INTRO_MOVIE + COUNTDOWN;
    this.events = [];
    this.projectiles = [];
    this.telegraphs = [];
    this.zones = [];
    this.turrets = [];
    this.traps = [];
    this.bombs = [];
    this.result = null;
    const seed = Math.floor(Math.random() * 1e9);
    this.stage = process.env.TEST_STAGE || (this.challenge ? this.challenge.stage : S.pickStage());
    this.map = S.generateCity(seed);
    this.gridS = new Grid(this.map, PATROL_R + 4);
    this.gridB = new Grid(this.map, BOSS_R + 4);
    const n = this.players.size;

    // 出発地点: 参加者ごとにバラバラの場所から
    const spawns = [];
    for (const p of this.players.values()) {
      const sp = this.farFromAll(this.gridS, spawns, 1400);
      spawns.push(sp);
      const st = S.yokaiStats(p.yokai, p.totsu, p.lv);
      Object.assign(p, {
        stats: st, x: sp.x, y: sp.y, face: 0,
        hp: st.hp, maxHp: st.hp, atkT: 0, strongT: 0, down: false, reviveProg: 0, escaped: false,
        shieldT: 0, dashT: 0, dashDir: 0, invulT: 0, stamina: STAMINA_MAX, exhausted: false, staminaT: 0, invisT: 0,
        item: null, dama: 0, dmgDealt: 0, prevItem: true, escProg: 0,
        skillT: 0, atkUpT: 0, spdUpT: 0, leap: null, flurry: null, comboN: 0, dodge: false, jump: 0,
        spotted: false, revives: 0, kills: 0, bossDmg: 0, // ランキング用の記録
        seenByPatrol: false, atKill: null, judge: null, // レジェンドの試練用（見回り鬼に見つかったか・ボスを倒した瞬間の様子）
        legend: !!S.YOKAI_BY_ID[p.yokai].legend, passive: S.YOKAI_BY_ID[p.yokai].passive || null, ult: 0, ultBusyUntil: 0, nyoi: null, diveLeft: 0, // レジェンド（ultBusyUntil は前のバトルの時刻が残るとゲージがたまらないので必ず戻す）
      });
      S.collide(this.map, p, PLAYER_R);
      if (DEMO_AI) { p.maxHp *= +(process.env.DEMO_PHP || 5); p.hp = p.maxHp; p.ultBoost = Number(process.env.DEMO_ULT_BOOST || 1); }
    }
    const spawn = spawns[0];

    // 襖（出発地点から遠いところ）
    this.fusuma = process.env.TEST_FUSUMA_NEAR ? { x: spawn.x, y: spawn.y } : this.farFromAll(this.gridS, spawns, 1800);

    // 鬼玉
    this.dama = [];
    const damaCount = 60 + 20 * n;
    for (let k = 0; k < damaCount; k++) this.dama.push({ id: genId(), v: 1, ...this.gridS.randomFreePoint() });
    for (const d of this.dama) { d.x += rand(-15, 15); d.y += rand(-15, 15); }
    // 取られた鬼玉は、少しずつ別の場所に湧き直す（街に出ている数はこの上限まで）
    this.damaCap = damaCount;
    this.damaRespawnT = DAMA_RESPAWN;

    // アイテム
    this.items = [];
    this.itemCap = 7 + n;
    for (let k = 0; k < this.itemCap; k++) this.spawnItem();
    this.itemRespawnT = 40;

    // 見回り鬼
    this.patrols = [];
    for (let k = 0; k < 12 + 2 * n; k++) this.spawnPatrol(spawns);

    // ボス鬼
    const bp = this.farFromAll(this.gridB, spawns, 1800);
    const type = process.env.TEST_BOSS || (this.challenge ? this.challenge.boss : this.bossSel);
    const kind = S.BOSSES[type];
    if (kind.time && !this.challenge) { this.timeLimit = kind.time; this.timeLeft = kind.time; } // 隠しボスは制限時間が長い
    this.mainType = type;       // 選んだボス（結果・解放・封印・ランキングはこのボスで決める）
    this.mainDown = false;
    this.drop = null;           // これから空から降ってくるボス（乱入・ボスラッシュの次・百鬼王・鬼神・真）
    this.bonusBoss = null; this.shinBoss = null;
    if (kind.rush) {
      // 百鬼王: 7体のボスを体力1/3で順番に倒すと、最後に百鬼王が降ってくる
      const st = DEMO_AI ? Math.min(kind.rush.length - 1, +process.env.DEMO_RUSH || 0) : 0; // 撮影用: とちゅうのボスから始める
      this.boss = this.makeBoss(kind.rush[st], bp, kind.rushHp);
      this.boss.rushStep = st;
      this.mainBoss = null;
    } else {
      this.boss = this.makeBoss(type, bp);
      this.mainBoss = this.boss;
    }
    this.firstBoss = this.boss;
    this.ring = null; // 鬼神の最後の形態: だんだんせまくなる安全な輪
    if (DEMO_AI) this.demoPlace(spawns[0]);

    this.broadcast({
      t: 'start', seed, stage: this.stage, timeLimit: this.timeLimit, challenge: !!this.challenge, fusuma: this.fusuma, boss: type, movie: INTRO_MOVIE, countdown: COUNTDOWN,
      dama: this.dama.map(d => ({ id: d.id, x: Math.round(d.x), y: Math.round(d.y), v: d.v })),
    });
  }

  // points のどれからも minD 以上離れた場所（見つからなければ一番離れた場所）
  farFromAll(grid, points, minD) {
    let best = null, bestD = -1;
    for (let k = 0; k < 300; k++) {
      const p = grid.randomFreePoint();
      const d = points.length ? Math.min(...points.map(q => dist(p, q))) : Infinity;
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
    const p = this.farFromAll(this.gridS, awayFrom, 700);
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
    if (e === this.boss && this.bossArmor(e) && src) {
      // 金の鎧: 正面からは35%しか効かない。背中からは1.3倍
      const off = angleDiff(Math.atan2(src.y - e.y, src.x - e.x), e.face);
      if (off < 1.1) { amount *= 0.35; if (Math.random() < 0.25) this.events.push({ k: 'clang', x: Math.round(e.x + rand(-20, 20)), y: Math.round(e.y - 60) }); }
      else if (off > 2.2) amount *= 1.3;
    }
    e.hp = Math.max(0, e.hp - amount);
    e.hitFlash = 0.1;
    if (src) { src.dmgDealt += amount; if (!e.isPatrol) src.bossDmg += amount; }
    this.events.push({ k: 'dmg', x: Math.round(e.x + rand(-20, 20)), y: Math.round(e.y - 30), v: Math.round(amount) });
    // 攻撃された見回り鬼は、攻撃した人が近くに見えているときだけ気づく
    // （竜巻・追尾弾・砲台・燃焼などで遠くや壁の向こうから当てたときは、攻撃が来た方を振り向くだけ）
    if (e.isPatrol && e.hp > 0 && e.state !== 'alert' && src && this.visibleTo(src)) {
      if (dist(e, src) < NOTICE_RANGE && S.lineOfSight(this.map, e, src)) this.alertPatrol(e, src);
      else e.face = Math.atan2(src.y - e.y, src.x - e.x);
    }
    if (e.hp <= 0) {
      if (e.isPatrol && src) src.kills++;
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
    if (p.passive === 'bossGuard') amount *= 0.7; // ウラ: ボス鬼からのダメージ -30%
    p.hp -= amount;
    this.events.push({ k: 'hurt', x: Math.round(p.x), y: Math.round(p.y - 30), v: Math.round(amount), id: p.id });
    if (p.hp <= 0) { p.hp = 0; p.down = true; p.reviveProg = 0; this.anyDown = true; this.events.push({ k: 'down', id: p.id }); }
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

  // デモ撮影用: ボス鬼と見回り鬼3体を、出発地点の近くの見えるところに置く
  demoPlace(sp) {
    const near = (lo, hi, grid) => {
      for (let k = 0; k < 3000; k++) { const q = grid.randomFreePoint(); const d = dist(q, sp); if (d > lo && d < hi && S.lineOfSight(this.map, q, sp)) return q; }
      return grid.randomFreePoint();
    };
    Object.assign(this.boss, near(380, 560, this.gridB), { state: 'engage', target: [...this.players.values()][0].id });
    // 仲間のボットは自分の近くから
    for (const p of [...this.players.values()].slice(1)) { Object.assign(p, near(60, 200, this.gridS)); }
    if (process.env.DEMO_SIM) return; // 試練がクリアできるかの検証: ボスの強さ・見回り鬼の場所はそのまま
    this.boss.maxHp = this.boss.hp = this.boss.maxHp * 5; // 撮影中にすぐ倒れないように
    // 特別な仕組みを早く見せる（DEMO_HP=0.5 で体力を減らした状態から、DEMO_FAST=1 で吹雪・型の切りかえを早く）
    if (process.env.DEMO_HP) { this.boss.hp = this.boss.maxHp * +process.env.DEMO_HP; }
    if (process.env.DEMO_FAST) Object.assign(this.boss, { blizT: 4, modeT: 7 });
    for (const e of this.patrols.slice(0, 3)) Object.assign(e, near(220, 480, this.gridS));
  }

  // ---- デモ撮影用の自動操作（DEMO_AI=1）: いちばん近い鬼に向かって攻撃し、必殺技がたまったら使う ----
  demoInput(p) {
    if (p.down || p.escaped) return;
    const b = this.boss && this.boss.hp > 0 ? this.boss : null;
    const t = b && (dist(b, p) < 1200 || process.env.DEMO_SIM) ? b : this.nearestEnemy(p, 1500) || b; // 検証のときはボスだけをねらう
    const role = S.YOKAI_BY_ID[p.yokai].role;
    const want = role === 'fighter' || role === 'tank' ? 85 : 260;
    let mx = 0, my = 0;
    if (t) {
      const d = dist(t, p), a = Math.atan2(t.y - p.y, t.x - p.x);
      if (d > want + 40) { mx = Math.cos(a); my = Math.sin(a); }
      else if (d < want - 60) { mx = -Math.cos(a); my = -Math.sin(a); }
      else { mx = Math.cos(a + Math.PI / 2) * 0.6; my = Math.sin(a + Math.PI / 2) * 0.6; } // まわりこむ
    }
    // 検証用（DEMO_COLLECT=人数）: 前から決めた人数は鬼玉を集める役。ボスが倒れたら全員で集める
    if (process.env.DEMO_COLLECT && ([...this.players.values()].indexOf(p) < +process.env.DEMO_COLLECT || !b)) {
      let best = null, bd = Infinity;
      for (const d of this.dama) { if (d.taken) continue; const dd = dist(d, p) / (d.v > 1 ? 4 : 1); if (dd < bd) { bd = dd; best = d; } } // どデカい鬼玉を優先
      if (best) {
        if (!p._goal || p._goal !== best || (p._pathT -= DT) <= 0) { p._goal = best; p._path = this.gridS.path(p.x, p.y, best.x, best.y); p._pathT = 0.5; }
        const wp = p._path && p._path[0];
        if (wp && Math.hypot(wp.x - p.x, wp.y - p.y) < 20) p._path.shift();
        const g = (p._path && p._path[0]) || best, a = Math.atan2(g.y - p.y, g.x - p.x);
        mx = Math.cos(a); my = Math.sin(a);
      }
    }
    p.input = { mx, my, atk: !!t, strong: !!t && this.time > 1.5, item: false, dash: false, skill: this.time % 6 < 0.1, ult: this.time > 3 };
    // 獄王の裁きは、自分にくだったときだけ守る（撮影で仕組みが見えるように）
    if (p.judge && p === this.players.values().next().value) {
      if (p.judge.k === 'noAtk') Object.assign(p.input, { atk: false, strong: false, skill: false, ult: false });
      if (p.judge.k === 'noMove') Object.assign(p.input, { mx: 0, my: 0, dash: false });
    }
  }

  // ---- 見回り鬼 ----
  alertPatrol(e, target) {
    e.state = 'alert'; e.target = target.id; e.lostT = 0; e.path = null;
    target.spotted = true;
    target.seenByPatrol = true;
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
    if (p.passive === 'nightDash' && p.dashing) return false; // ジャージーデビル: ダッシュ中は見つからない
    if (p.passive === 'sneak' && e.isPatrol) range *= 0.5;    // ヌラリヒョン: 見回り鬼の見える距離が半分
    const d = dist(e, p);
    if (d > range) return false;
    if (d > 70 && angleDiff(Math.atan2(p.y - e.y, p.x - e.x), e.face) > halfAngle) return false;
    return S.lineOfSight(this.map, e, p);
  }

  updatePatrols() {
    for (const e of this.patrols) {
      e.isPatrol = true;
      e.hitFlash = Math.max(0, e.hitFlash - DT);
      if (e.hp > 0 && e.stunT > 0) { e.stunT -= DT; continue; } // 雷・盾の一撃でしびれている
      if (e.hp <= 0) {
        e.respawnT -= DT;
        if (e.respawnT <= 0) {
          const p = this.farFromAll(this.gridS, this.activePlayers(), 900);
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
  makeBoss(type, pos, hpMul = 1) {
    const kind = S.BOSSES[type], n = this.players.size;
    // 金鬼から先はチームで挑むボス。1人・2人でも体力は3人分（ひとりで倒すのは、ほぼむり）
    const hp = Math.round((1500 + 1100 * (kind.team ? Math.max(n, 3) : n)) * kind.hp * hpMul); // 2人なら赤鬼4255・青鬼6475・黒鬼9620
    // 百鬼王は鬼神の2段階目、鬼神・真は3段階目の技をはじめから使う
    const phase = type === 'shin' ? 3 : type === 'hyakki' ? 2 : 1;
    return {
      x: pos.x, y: pos.y, hp, maxHp: hp, type, kind, name: kind.name, face: 0,
      state: 'wander', stateT: 0, path: null, wanderTo: null, target: null, huntBy: null, lostT: 0,
      stunT: 0, chargeDir: 0, hitFlash: 0, atkT: 2,
      blizT: 14, bliz: 0,           // 白鬼: 吹雪
      mode: 'wind', modeT: 12, boltT: 2, // 風雷鬼: 風の型・雷の型
      phase, sweep: null, sweepT: phase > 1 ? 4 : 0, // 鬼神: 変身の段階・大なぎ払い
      judgeT: 6,                    // 獄王: 次の裁きまで
    };
  }
  godLike(b) { return b.type === 'kishin' || b.type === 'hyakki' || b.type === 'shin'; } // 鬼神の技を使うボス

  killBoss() {
    const b = this.boss;
    this.events.push({ k: 'bossDown', x: Math.round(b.x), y: Math.round(b.y) });
    if (b === this.mainBoss) {
      this.mainDown = true;
      this.bossKillT = this.time;
      this.blizKill = b.bliz > 0; // 吹雪の中でとどめをさした
      // 試練は倒した瞬間の様子で決める（倒したあとに見つかったり倒れたりしても大丈夫）
      this.anyDownAtKill = this.anyDown;
      for (const p of this.players.values()) p.atKill = { seen: p.seenByPatrol, dama: p.dama };
      // 隠し: 鬼神を倒すと、まれに鬼神・真が目覚める（そのときは乱入はなし）
      if (b.type === 'kishin' && Math.random() < SHIN_RATE) this.drop = { type: 'shin', kind: 'shin', wait: 4, t: 3.6 };
      else if (!b.kind.hidden) this.maybeBonus();
    }
    // 百鬼王のボスラッシュ: 次のボス、7体倒したら百鬼王
    if (b.rushStep != null) {
      const k = S.BOSSES.hyakki, i = b.rushStep + 1;
      this.drop = i < k.rush.length ? { type: k.rush[i], kind: 'rush', wait: 0, t: 2.5, hpMul: k.rushHp, step: i } : { type: 'hyakki', kind: 'final', wait: 3, t: 3.6 };
    }
    for (const p of this.players.values()) p.judge = null; // 獄王の裁きもおしまい
    this.dropDama(b.x, b.y, 1, b.kind.drop * (b.rushStep != null ? 0.4 : 1)); // ラッシュ中のボスの鬼玉は少なめ
    this.telegraphs = [];
    this.ring = null;
  }

  // 乱入ボス（プレイヤーには知らせていない仕組み）:
  // 残り2分以上でボスを倒すと、30%で新しいボス鬼が空から降ってくる。ひとりなら赤鬼・青鬼・黒鬼、2人以上ならすべての鬼から
  maybeBonus() {
    if (this.timeLeft < 120 || Math.random() >= BONUS_RATE) return;
    const pool = (this.players.size === 1 ? ['red', 'blue', 'black'] : S.BOSS_ORDER).filter(k => k !== this.mainType && !S.BOSSES[k].hidden); // 隠しボスは乱入しない
    const type = pool[Math.floor(Math.random() * pool.length)];
    this.drop = { type, kind: 'bonus', wait: 5, t: 3.2 }; // 倒してから5秒たったらカットイン、カットインのあいだ待ってから降らせる
  }
  // 空からボスを降らせる（乱入・ボスラッシュの次のボス・百鬼王・鬼神・真）
  updateDrop() {
    const dr = this.drop;
    if (!dr) return;
    if (dr.wait > 0) {
      if ((dr.wait -= DT) <= 0) this.events.push({ k: 'bonusBoss', type: dr.type, mode: dr.kind }); // カットイン
      return;
    }
    if ((dr.t -= DT) > 0) return;
    this.drop = null;
    // まだ戦っている仲間のだれかの近くに、見えるところへ降らせる
    const ps = this.activePlayers(), t = ps[Math.floor(Math.random() * ps.length)];
    if (!t) return;
    let pos = null;
    for (let k = 0; k < 2000 && !pos; k++) { const q = this.gridB.randomFreePoint(); const d = dist(q, t); if (d > 330 && d < 520 && S.lineOfSight(this.map, q, t)) pos = q; }
    pos = pos || this.gridB.randomFreePoint();
    const b = this.boss = this.makeBoss(dr.type, pos, dr.hpMul || 1);
    Object.assign(b, { state: 'engage', target: t.id, atkT: 2.5 });
    let label = null;
    if (dr.kind === 'bonus') this.bonusBoss = b;
    if (dr.kind === 'rush') { b.rushStep = dr.step; label = `百鬼王のしもべ ${b.name}（${dr.step + 1}/${S.BOSSES.hyakki.rush.length}）`; }
    if (dr.kind === 'final') { this.mainBoss = b; label = '百鬼王が降臨した！'; }
    if (dr.kind === 'shin') {
      this.shinBoss = b; label = '鬼神・真が目覚めた！';
      this.timeLeft += 180; // 目覚めたら制限時間が3分ふえる
      this.ring = { x: b.x, y: b.y, r: 1700, min: 600 };
    }
    this.events.push({ k: 'bossDrop', type: dr.type, x: Math.round(pos.x), y: Math.round(pos.y), label, extra: dr.kind === 'shin' ? 180 : 0 });
  }

  // ---- 獄王の裁き ----
  // 12秒ごと（怒ると9秒）に、だれか1人に「攻撃するな」「動くな」「仲間を助けよ」の裁きをくだす。やぶると大ダメージ
  startJudge(b) {
    const ps = this.activePlayers().filter(p => !p.judge);
    if (!ps.length) return;
    const me0 = this.players.values().next().value;
    const p = DEMO_AI && process.env.DEMO_JUDGE_ME && ps.includes(me0) ? me0 : ps[Math.floor(Math.random() * ps.length)]; // 撮影用: 自分に裁き
    const someoneDown = [...this.players.values()].some(q => q.down && !q.escaped);
    const kinds = someoneDown ? ['noAtk', 'noMove', 'save', 'save'] : ['noAtk', 'noMove'];
    const k = kinds[Math.floor(Math.random() * kinds.length)];
    p.judge = { k, t: k === 'save' ? 10 : 7, warn: 1.5, dmg: 42 * b.kind.dmg };
    this.events.push({ k: 'judge', id: p.id, j: k });
  }
  updateJudges() {
    for (const p of this.players.values()) {
      const j = p.judge;
      if (!j) continue;
      if (p.down || p.escaped) { p.judge = null; continue; }
      if (j.warn > 0) { j.warn -= DT; continue; } // 予告のあいだは大丈夫
      const inp = p.input;
      const broke = j.k === 'noAtk' ? inp.atk || inp.strong || inp.skill || inp.ult
        : j.k === 'noMove' ? Math.hypot(inp.mx, inp.my) > 0.2 || inp.dash : false;
      if (broke) { // 裁きをやぶった
        p.judge = null;
        this.damagePlayer(p, j.dmg);
        this.events.push({ k: 'judgeHit', id: p.id, x: Math.round(p.x), y: Math.round(p.y) });
        continue;
      }
      if (j.k === 'save' && ![...this.players.values()].some(q => q.down && !q.escaped)) { p.judge = null; this.events.push({ k: 'judgeOk', id: p.id }); continue; } // 仲間が起きた
      if ((j.t -= DT) > 0) continue;
      p.judge = null;
      if (j.k === 'save') { // 助けられなかった: 全員にダメージ
        for (const q of this.activePlayers()) this.damagePlayer(q, j.dmg * 0.6);
        this.events.push({ k: 'judgeHit', id: p.id, x: Math.round(p.x), y: Math.round(p.y), all: true });
      } else this.events.push({ k: 'judgeOk', id: p.id });
    }
  }

  updateBoss() {
    const b = this.boss;
    if (!b || b.hp <= 0) return;
    b.hitFlash = Math.max(0, b.hitFlash - DT);
    if (b.stunT > 0) { b.stunT -= DT; return; }
    // 体力が半分を切ると怒る（攻撃の間隔が短くなる）
    if (!b.rage && b.hp < b.maxHp / 2) { b.rage = true; this.events.push({ k: 'rage', x: Math.round(b.x), y: Math.round(b.y) }); }
    this.bossSpecial(b);

    // 自分の目で見つけたら戦闘
    if (b.state !== 'engage' && b.state !== 'charging' && b.state !== 'windup') {
      for (const p of this.activePlayers()) {
        if (this.canSee(b, p, 380, Math.PI)) { b.state = 'engage'; b.target = p.id; b.lostT = 0; b.path = null; p.spotted = true; break; }
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
        if (b.stateT <= 0) { b.state = 'engage'; b.atkT = rand(1.2, 2.0) * b.kind.atkGap * (b.rage ? 0.75 : 1); }
        break;
      case 'charging': {
        b.stateT -= DT;
        const px = b.x, py = b.y;
        b.x += Math.cos(b.chargeDir) * 600 * DT; b.y += Math.sin(b.chargeDir) * 600 * DT;
        S.collide(this.map, b, BOSS_R);
        for (const p of this.activePlayers()) if (!p.chargeHit && dist(p, b) < BOSS_R + PLAYER_R) { this.damagePlayer(p, 45 * b.kind.dmg); p.chargeHit = true; }
        const blocked = Math.hypot(b.x - px, b.y - py) < 600 * DT * 0.5;
        if (b.stateT <= 0 || blocked) { b.state = 'engage'; b.atkT = rand(1.2, 1.8) * b.kind.atkGap * (b.rage ? 0.75 : 1); if (blocked) this.events.push({ k: 'boom', x: Math.round(b.x), y: Math.round(b.y), r: 60 }); }
        break;
      }
    }
  }

  // 金の鎧があるか（金鬼は怒ったあと、鬼神は2段階目から）
  bossArmor(b) { return (b.type === 'gold' && b.rage) || (this.godLike(b) && b.phase >= 2); }

  // 金鬼から先のボスの、それぞれの仕組み
  bossSpecial(b) {
    if (b.type === 'white') this.blizzard(b, 8, 22);
    if (b.type === 'fuurai') {
      // 12秒ごとに 風の型 ⇔ 雷の型。雷の型のときは、町じゅうの全員の足もとに雷が落ちる
      if ((b.modeT -= DT) <= 0) { b.mode = b.mode === 'wind' ? 'thunder' : 'wind'; b.modeT = 12; b.boltT = 1; this.events.push({ k: 'mode', m: b.mode }); }
      if (b.mode === 'thunder' && (b.boltT -= DT) <= 0) { b.boltT = b.rage ? 2.2 : 3; this.thunderBolts(b); }
    }
    if (b.type === 'gokuou' && (b.judgeT -= DT) <= 0) { b.judgeT = b.rage ? 9 : 12; this.startJudge(b); }
    if (this.godLike(b)) {
      // すべてのボス鬼の技を使う。体力で3段階に変身して、使う技が増える（百鬼王・鬼神・真は段階が決まっている）
      //  1段階目: 赤鬼・青鬼・黒鬼の技 ＋ 風雷鬼の突風と雷
      //  2段階目: ＋ 金鬼の鎧・白鬼の吹雪・地獄の大なぎ払い
      //  3段階目: ＋ だんだんせまくなる赤い輪
      const ph = b.type !== 'kishin' ? b.phase : b.hp > b.maxHp * 0.66 ? 1 : b.hp > b.maxHp * 0.33 ? 2 : 3;
      if (ph > b.phase) {
        b.phase = ph; b.stunT = 1.2; // 変身のあいだは少し止まる
        this.events.push({ k: 'phase', n: ph, x: Math.round(b.x), y: Math.round(b.y) });
        if (ph === 2) { b.sweepT = 3; b.blizT = 10; }
        if (ph === 3) this.ring = { x: b.x, y: b.y, r: 1500, min: 600 }; // 変身した場所を中心に、約35秒でせまくなる（鬼神のまわりに閉じこめられる）
      }
      if ((b.boltT -= DT) <= 0) { b.boltT = b.phase === 3 ? 5 : 7; this.thunderBolts(b); }
      if (b.phase >= 2) {
        this.blizzard(b, 6, 28);
        if (!b.sweep && (b.sweepT -= DT) <= 0 && b.state !== 'charging') this.startSweep(b);
      }
      if (b.sweep) this.updateSweep(b);
    }
  }

  // 吹雪: every 秒ごとに len 秒。ボスの姿が消えて、攻撃の予告だけ見える
  blizzard(b, len, every) {
    if (b.bliz > 0) { if ((b.bliz -= DT) <= 0) { b.bliz = 0; this.events.push({ k: 'blizEnd' }); } }
    else if ((b.blizT -= DT) <= 0) { b.bliz = len; b.blizT = every; this.events.push({ k: 'bliz' }); }
  }
  // 雷: 町じゅうの全員の足もとに落ちる
  thunderBolts(b) {
    for (const p of this.activePlayers()) {
      const a = Math.random() * Math.PI * 2, r = rand(0, 60);
      this.telegraphs.push({ id: genId(), shape: 'circle', x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r, r: 80, t: 1.1, max: 1.1, dmg: 26 * b.kind.dmg, c: 'bolt', bolt: true });
    }
  }

  // 地獄の大なぎ払い: 鬼神のまわりを長い光線が1周する。建物のうしろにかくれるか、回避でよける
  startSweep(b) {
    b.sweep = { a0: Math.random() * Math.PI * 2, dir: Math.random() < 0.5 ? 1 : -1, t: 0, warn: 1.6, spin: 3.2, len: 1000, hit: new Set() };
    b.state = 'windup'; b.stateT = b.sweep.warn + b.sweep.spin + 0.3; // そのあいだは動かない
    this.events.push({ k: 'sweep', x: Math.round(b.x), y: Math.round(b.y) });
  }
  sweepAngle(sw) { return sw.a0 + sw.dir * Math.max(0, (sw.t - sw.warn) / sw.spin) * Math.PI * 2; }
  updateSweep(b) {
    const sw = b.sweep;
    sw.t += DT;
    if (sw.t >= sw.warn + sw.spin) { b.sweep = null; b.sweepT = b.phase === 3 ? 13 : 16; return; }
    if (sw.t < sw.warn) return;
    const a = this.sweepAngle(sw);
    for (const p of this.activePlayers()) {
      if (sw.hit.has(p.id)) continue;
      const d = dist(p, b), off = Math.atan2(p.y - b.y, p.x - b.x) - a;
      if (d > sw.len + PLAYER_R || Math.cos(off) <= 0 || Math.abs(d * Math.sin(off)) > 46 + PLAYER_R) continue;
      if (!S.lineOfSight(this.map, b, p)) continue; // 建物のうしろは安全
      sw.hit.add(p.id);
      this.damagePlayer(p, 45 * b.kind.dmg);
    }
  }

  // 鬼神の最後の形態: 輪がだんだんせまくなり、外にいると体力がへる
  updateRing() {
    const g = this.ring;
    if (!g) return;
    g.r = Math.max(g.min, g.r - 26 * DT);
    for (const p of this.activePlayers()) if (dist(p, g) > g.r) { p.ringT = (p.ringT || 0) + DT; if (p.ringT >= 0.5) { p.ringT = 0; this.damagePlayer(p, 9); } }
  }

  bossAttack(t) {
    const b = this.boss;
    let roll = Math.random();
    const warn = b.kind.warn;
    b.face = Math.atan2(t.y - b.y, t.x - b.x);
    // 風雷鬼（風の型）: 前に向かって大きな突風。当たると吹き飛ばされる
    const allMoves = this.godLike(b) || b.type === 'gokuou'; // すべてのボス鬼の技を使うボス
    if ((b.type === 'fuurai' && b.mode === 'wind' && roll < 0.45) || (allMoves && roll >= 0.3 && roll < 0.5)) {
      this.telegraphs.push({ id: genId(), shape: 'rect', x: b.x, y: b.y, a: b.face, len: 720, w: 220, t: warn + 0.15, max: warn + 0.15, dmg: 24 * b.kind.dmg, knock: 300, c: 'wind' });
      b.state = 'windup'; b.stateT = warn + 0.45;
      return;
    }
    // 鬼神: 乱れ打ち（段階が進むと数が増える）・突風・赤鬼の技を全部使う
    if (allMoves && roll < 0.3) {
      const k = 4 + b.phase;
      for (let i = 0; i < k; i++) {
        const a = i / k * Math.PI * 2 + Math.random(), r = i === 0 ? 0 : rand(60, 190);
        this.telegraphs.push({ id: genId(), shape: 'circle', x: t.x + Math.cos(a) * r, y: t.y + Math.sin(a) * r, r: 95, t: warn + i * 0.1, max: warn + i * 0.1, dmg: 32 * b.kind.dmg });
      }
      b.state = 'windup'; b.stateT = warn + 0.5;
      return;
    }
    if (allMoves) roll = Math.random(); // 残りはたたきつけ・突進・まわりへの攻撃
    // 怒り状態の青鬼・黒鬼は、まわりにいくつも落とす「乱れ打ち」も使う
    else if (b.rage && b.type !== 'red' && roll < 0.3) {
      const k = b.type === 'black' ? 5 : 3;
      for (let i = 0; i < k; i++) {
        const a = i / k * Math.PI * 2 + Math.random(), r = i === 0 ? 0 : rand(60, 170);
        this.telegraphs.push({ id: genId(), shape: 'circle', x: t.x + Math.cos(a) * r, y: t.y + Math.sin(a) * r, r: 95, t: warn + i * 0.12, max: warn + i * 0.12, dmg: 32 * b.kind.dmg });
      }
      b.state = 'windup'; b.stateT = warn + 0.5;
      return;
    }
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
        if (!hit) continue;
        this.damagePlayer(p, tg.dmg);
        if (tg.knock && !p.down) { // 突風: 向きにそって吹き飛ばす
          const a = tg.shape === 'rect' ? tg.a : Math.atan2(p.y - tg.y, p.x - tg.x);
          p.x += Math.cos(a) * tg.knock; p.y += Math.sin(a) * tg.knock;
          S.collide(this.map, p, PLAYER_R);
        }
      }
      this.events.push({ k: tg.bolt ? 'bolt' : tg.knock ? 'gust' : 'boom', x: Math.round(tg.x), y: Math.round(tg.y), r: tg.r, a: tg.a });
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
    this.projectiles.push({ id: genId(), owner: p.id, x: p.x, y: p.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, dmg, life, r, c, t: 0, hits: new Set(), ...extra });
  }
  newId() { return genId(); }

  updatePlayer(p) {
    const st = p.stats;
    for (const k of ['atkT', 'strongT', 'skillT', 'shieldT', 'invulT', 'staminaT', 'invisT', 'atkUpT', 'spdUpT']) p[k] = Math.max(0, p[k] - DT);
    if (p.down || p.escaped) return;
    const inp = p.input;

    // ダッシュ（押している間）とスタミナ
    const moving = Math.hypot(inp.mx, inp.my) > 0.15;
    let dashing = false;
    if (inp.dash && moving && p.staminaT > 0) dashing = true;
    else if (inp.dash && moving && !p.exhausted && p.stamina > 0) {
      dashing = true;
      p.stamina = Math.max(0, p.stamina - (p.passive === 'stamina' ? 21 : 35) * DT); // ソンゴクウ: 減りにくい
      if (p.stamina <= 0) p.exhausted = true;
    }
    if (!dashing) {
      p.stamina = Math.min(STAMINA_MAX, p.stamina + 22 * DT);
      if (p.exhausted && p.stamina >= 30) p.exhausted = false;
    }
    p.dashing = dashing;

    if (Combat.preMove(this, p)) {
      // 大ジャンプ中など
    } else if (p.dashT > 0) {
      p.dashT -= DT;
      p.x += Math.cos(p.dashDir) * 700 * DT;
      p.y += Math.sin(p.dashDir) * 700 * DT;
      Combat.dashHit(this, p);
      if (p.dashT <= 0) p.dodge = false;
    } else {
      let mx = inp.mx, my = inp.my;
      const m = Math.hypot(mx, my);
      if (m > 1) { mx /= m; my /= m; }
      const spd = st.speed * (dashing ? DASH_MUL : 1) * (p.spdUpT > 0 ? 1.15 : 1);
      p.x += mx * spd * DT; p.y += my * spd * DT;
      if (m > 0.15) p.face = Math.atan2(my, mx);
    }
    S.collide(this.map, p, PLAYER_R);

    const at = A.of(p.yokai);
    const target = this.nearestEnemy(p, A.NORMAL[at.normal].range + 150);
    const aim = target ? Math.atan2(target.y - p.y, target.x - p.x) : p.face;
    // 通常攻撃・強攻撃・スキル（中身は combat.js）
    const busy = p.leap || p.dashT > 0;
    if (inp.atk && p.atkT <= 0 && !busy) Combat.normal(this, p, aim, target);
    if (inp.strong && p.strongT <= 0 && !busy) Combat.strong(this, p, aim, target);
    if (inp.skill && p.skillT <= 0 && !p.leap) Combat.skill(this, p, aim);
    if (p.legend) {
      if (!(this.time < p.ultBusyUntil)) p.ult = Math.min(Combat.ULT_MAX, p.ult + (st.name === 'ヒーラー' ? 2.4 : 1.0) * DT * (p.ultBoost || 1)); // 時間でも少しずつたまる（ヒーラーは多め）
      if (inp.ult && p.ult >= Combat.ULT_MAX && !busy) Combat.ultimate(this, p, aim);
    }

    // アイテム（押した瞬間に使う）
    if (inp.item && !p.prevItem && p.item) this.useItem(p, aim);
    p.prevItem = inp.item;

    // 拾う
    for (const d of this.dama) {
      if (!d.taken && Math.hypot(d.x - p.x, d.y - p.y) < 32) {
        d.taken = true; p.dama += d.v;
        if (p.passive === 'orbHeal') this.healPlayer(p, 5 * Math.min(d.v, 8)); // クルピラ: 鬼玉で少し回復
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
    this.damaRespawnT -= DT;
    if (this.damaRespawnT <= 0) {
      this.damaRespawnT = DAMA_RESPAWN;
      if (this.dama.filter(d => d.v === 1).length < this.damaCap) {
        // 誰かのすぐ近くには湧かない
        const near = [...this.players.values()].filter(p => !p.escaped);
        const d = { id: genId(), v: 1, ...this.farFromAll(this.gridS, near, 400) };
        this.dama.push(d);
        this.events.push({ k: 'da', id: d.id, x: Math.round(d.x), y: Math.round(d.y), v: 1 });
      }
    }
    this.itemRespawnT -= DT;
    if (this.itemRespawnT <= 0) { this.itemRespawnT = 40; if (this.items.length < this.itemCap) this.spawnItem(); }
  }

  updateRevive() {
    for (const p of this.players.values()) {
      if (!p.down || p.escaped) continue;
      const helpers = this.activePlayers().filter(q => q !== p && dist(p, q) < REVIVE_RANGE);
      const helper = helpers.length > 0;
      if (helper) p.reviveProg += DT * (helpers.some(q => q.passive === 'reviver') ? 2 : 1); // メリュジーヌ: 起こす速さ2倍 else p.reviveProg = Math.max(0, p.reviveProg - DT * 0.5);
      if (p.reviveProg >= REVIVE_TIME) {
        p.down = false; p.hp = p.maxHp * 0.4; p.reviveProg = 0; p.invulT = 2;
        for (const q of this.activePlayers()) if (q !== p && dist(p, q) < REVIVE_RANGE) q.revives++; // 起こした人に記録
        this.events.push({ k: 'revive', id: p.id });
      }
    }
  }

  tick() {
    if (this.state !== 'battle') return;
    if (this.introT > 0) { this.introT -= DT; return; }
    this.time += DT;
    this.timeLeft -= DT;
    if (DEMO_AI) for (const p of this.players.values()) this.demoInput(p);
    for (const p of this.players.values()) this.updatePlayer(p);
    this.updateRevive();
    this.updatePatrols();
    this.updateDrop();
    this.updateBoss();
    this.updateJudges();
    this.updateTelegraphs();
    this.updateRing();
    this.updateItemsOnField();
    Combat.updateProjectiles(this);
    Combat.updateEffects(this);
    // 全員が脱出 or 倒れた、または時間切れで終了
    const remaining = [...this.players.values()].filter(p => !p.escaped && !p.down);
    if (this.timeLeft <= 0 || remaining.length === 0) this.finish();
  }

  finish() {
    this.state = 'result';
    // ガチャ（または経験値）は、みんなで集めた鬼玉の合計そのままで引く
    const team = [...this.players.values()].reduce((a, p) => a + p.dama, 0);
    const players = [...this.players.values()].map(p => ({
      id: p.id, name: p.name, yokai: p.yokai, escaped: p.escaped, dama: p.dama, dmg: Math.round(p.dmgDealt),
      // 脱出できなかった人も引けるが、その人だけ鬼玉が半分になる
      count: p.escaped ? team : Math.floor(team / 2),
      gacha: rollGacha(p.escaped ? team : team / 2),
      // レジェンドの封印の欠片と試練（封印の地でボスを倒したとき）
      seal: S.sealDrop({ stage: this.stage, boss: this.mainType, bossDown: this.mainDown, seen: p.atKill ? p.atKill.seen : true, anyDown: this.anyDownAtKill, blizKill: this.blizKill, dama: p.atKill ? p.atKill.dama : 0 }),
    }));
    const bn = this.bonusBoss, sh = this.shinBoss;
    this.lastResult = { t: 'result', players, team, boss: this.mainType, bossDown: this.mainDown, bonus: bn ? { type: bn.type, down: bn.hp <= 0 } : undefined, shin: sh ? { down: sh.hp <= 0 } : undefined };
    this.broadcast(this.lastResult);
    for (const p of this.players.values()) p.missedResult = !!p.away; // 通信が切れていた人には、つなぎ直したときに送る
    this.watchers.clear(); // 観戦はここまで（観戦していた人は結果を見てホームへ）
    this.recordRanking(players);
  }

  // 週替わりランキングに、このバトルの記録を足す
  recordRanking(results) {
    const th = this.theme, n = this.players.size;
    const entries = [...this.players.values()].filter(p => p.pid).map(p => {
      const r = results.find(x => x.id === p.id);
      let value = null, detail = null;
      switch (th.key) {
        case 'dama': value = p.dama; break;
        case 'bossTime':
          if (n === 1 && this.mainType === th.boss && this.bossKillT != null) value = this.bossKillT; // ひとりで出撃したときのタイムだけ
          break;
        case 'challenge':
          if (this.challenge) { value = r.count; detail = `${p.escaped ? '脱出' : '鬼玉半分'}・${n}人`; }
          break;
        case 'rescue': value = p.revives; break;
        case 'stealth': value = p.escaped && !p.spotted ? 1 : 0; break;
        case 'patrol': value = p.kills; break;
        case 'bossDmg': value = Math.round(p.bossDmg); break;
        case 'meister': value = p.yokai === th.yokai ? p.dama : 0; break;
      }
      return { pid: p.pid, name: p.name, yokai: p.yokai, title: p.title, value: value || null, detail };
    });
    Ranking.record(this.weekIdx, entries).catch(e => console.error(e));
  }

  snapshot() {
    const b = this.boss;
    const snap = {
      t: 'state', timeLeft: +this.timeLeft.toFixed(1), intro: +Math.max(0, this.introT).toFixed(2),
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, yokai: p.yokai, x: Math.round(p.x), y: Math.round(p.y), face: +p.face.toFixed(2),
        hp: Math.round(p.hp), maxHp: p.maxHp, down: p.down, rv: +(p.reviveProg / REVIVE_TIME).toFixed(2), esc: p.escaped,
        dama: p.dama, item: p.item, ep: +(p.escProg / ESCAPE_TIME).toFixed(2), stam: Math.round(p.stamina), exh: p.exhausted, inf: p.staminaT > 0, invis: p.invisT > 0,
        sh: p.shieldT > 0, dash: p.dashT > 0, run: p.dashing, atkCd: +(p.atkT / A.NORMAL[A.of(p.yokai).normal].cd).toFixed(2), stCd: +(p.strongT / A.STRONG[A.of(p.yokai).strong].cd).toFixed(2),
        skCd: +(p.skillT / A.SKILL[S.YOKAI_BY_ID[p.yokai].role].cd).toFixed(2), au: p.atkUpT > 0, su: p.spdUpT > 0, ult: p.legend ? Math.floor(p.ult) : -1, jd: p.judge ? { k: p.judge.k, t: Math.ceil(p.judge.t), w: p.judge.warn > 0 || undefined } : undefined, nyoi: p.nyoiA != null ? +p.nyoiA.toFixed(2) : undefined, jump: +(p.jump || 0).toFixed(2), dodge: !!p.dodge,
      })),
      patrols: this.patrols.filter(e => e.hp > 0).map(e => ({ id: e.id, x: Math.round(e.x), y: Math.round(e.y), face: +e.face.toFixed(2), alert: e.state === 'alert', target: e.target, hp: Math.round(e.hp), maxHp: e.maxHp, flash: e.hitFlash > 0 })),
      boss: b && b.hp > 0 ? { type: b.type, x: Math.round(b.x), y: Math.round(b.y), hp: Math.round(b.hp), maxHp: b.maxHp, face: +b.face.toFixed(2), st: b.state, stun: b.stunT > 0, target: b.state === 'hunt' || b.state === 'engage' ? b.target : null, hunt: b.state === 'hunt', flash: b.hitFlash > 0, rage: !!b.rage,
        bliz: b.bliz > 0 || undefined, mode: b.type === 'fuurai' ? b.mode : undefined, phase: this.godLike(b) ? b.phase : undefined, armor: this.bossArmor(b) || undefined,
        sweep: b.sweep ? { a: +this.sweepAngle(b.sweep).toFixed(3), w: b.sweep.t < b.sweep.warn ? +(b.sweep.t / b.sweep.warn).toFixed(2) : -1, len: b.sweep.len, dir: b.sweep.dir } : undefined } : null,
      ring: this.ring ? { x: Math.round(this.ring.x), y: Math.round(this.ring.y), r: Math.round(this.ring.r) } : null,
      items: this.items.map(it => ({ id: it.id, x: Math.round(it.x), y: Math.round(it.y), type: it.type })),
      traps: this.traps.map(t => ({ id: t.id, x: Math.round(t.x), y: Math.round(t.y) })),
      bombs: this.bombs.map(bm => ({ id: bm.id, x: Math.round(bm.x), y: Math.round(bm.y), t: +bm.t.toFixed(1) })),
      proj: this.projectiles.map(pr => ({ id: pr.id, x: Math.round(pr.x), y: Math.round(pr.y), r: pr.r, c: pr.c, punch: pr.punch, spin: pr.spin, lob: pr.lob, bomb: pr.bomb, a: +Math.atan2(pr.vy, pr.vx).toFixed(2) })),
      turrets: this.turrets.map(t => ({ id: t.id, x: Math.round(t.x), y: Math.round(t.y), c: t.c, clone: t.clone })),
      tele: this.telegraphs.map(tg => ({ id: tg.id, shape: tg.shape, x: Math.round(tg.x), y: Math.round(tg.y), r: tg.r, a: tg.a, len: tg.len, w: tg.w, c: tg.c, p: +(1 - tg.t / tg.max).toFixed(2) })),
      zones: this.zones.map(z => ({ id: z.id, x: Math.round(z.x), y: Math.round(z.y), r: z.r, kind: z.kind || 'heal', c: z.c, shape: z.shape, life: +z.life.toFixed(1) })),
      ev: this.events,
    };
    this.events = [];
    return snap;
  }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server });

// 名前: 空白（全角スペースや見えない文字）だけの名前は、名前なしとして扱う
function cleanName(v) {
  const s = String(v || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().slice(0, 10);
  return s.replace(/[\s\u3000]/g, '') ? s : '';
}

// つながっているかの確認: 30秒ごとに ping を送り、返事がない接続は切る。
// スマホのスリープや電波切れでは「切れた」という知らせが届かないことがあり、そのままだとフレンド一覧で「ホームにいる」が残り続ける
setInterval(() => {
  for (const c of wss.clients) {
    if (c.isAlive === false) { c.terminate(); continue; }
    c.isAlive = false;
    try { c.ping(); } catch {}
  }
}, +process.env.HEARTBEAT_MS || 30000);

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let room = null;
  let me = null;
  let watching = false;
  let pid = null; // フレンド機能用のプレイヤーID（端末ごと）
  const send = msg => ws.readyState === 1 && ws.send(JSON.stringify(msg));

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.t) {
      case 'hello': { // ホーム画面にいる間つないでおく接続（フレンドの一覧用）
        pid = cleanPid(msg.pid);
        if (!pid) return;
        touchPlayer(pid, msg.name, msg.yokai, msg.title);
        if (msg.prof) known.get(pid).prof = cleanProfile(msg.prof);
        presence.set(ws, pid);
        sendFriends(ws);
        break;
      }
      case 'invite': { // ロビーから、ホームにいるフレンドを誘う（相手のホーム画面の接続に届ける）
        const to = cleanPid(msg.to);
        if (!room || !me || watching || room.state !== 'lobby' || !to || to === me.pid) break;
        const key = `${me.pid || me.id}>${to}`, now = Date.now();
        if (now - (inviteAt.get(key) || 0) < 10000) break; // 同じ人を何度も誘いすぎない（10秒に1回）
        inviteAt.set(key, now);
        if (inviteAt.size > 2000) inviteAt.clear();
        let sent = 0;
        for (const [pws, id] of presence) if (id === to && pws.readyState === 1) {
          pws.send(JSON.stringify({ t: 'invited', code: room.code, from: me.name, yokai: me.yokai, title: me.title, n: room.players.size, boss: room.bossSel }));
          sent++;
        }
        send({ t: 'inviteSent', to, ok: sent > 0 });
        break;
      }
      case 'profile': { // フレンドのくわしい情報
        const id = cleanPid(msg.pid), k = id && known.get(id);
        send({ t: 'profile', pid: msg.pid, ok: !!(k && k.prof), name: k && k.name, yokai: k && k.yokai, title: k && k.title, prof: k && k.prof });
        break;
      }
      case 'watch': {
        if (room) return;
        if (draining) { send({ t: 'serverUpdate' }); return ws.close(); }
        const target = rooms.get(String(msg.code || '').toUpperCase());
        if (!target || target.state !== 'battle') return send({ t: 'error', msg: 'いまは観戦できません（バトルが終わったかも）' });
        if (target.watchers.size >= MAX_WATCHERS) return send({ t: 'error', msg: '観戦している人がいっぱいです' });
        room = target; watching = true;
        room.watchers.add(ws);
        send({ t: 'welcome', id: null, watch: true });
        room.watchStart(ws);
        break;
      }
      case 'rejoin': { // 通信が切れたあと、同じルームの自分の席にもどる
        if (room) return;
        const target = rooms.get(String(msg.code || '').toUpperCase()), id = cleanPid(msg.pid);
        const p = target && id && [...target.players.values()].find(q => q.pid === id);
        if (!p) return send({ t: 'error', msg: 'ルームがなくなりました（時間がたったか、みんなが抜けたかも）', rejoinFailed: true });
        if (p.ws && p.ws !== AWAY_WS) { const old = p.ws; p.ws = null; try { old.close(); } catch {} } // 前の接続がまだ残っていたら閉じる
        room = target; me = p; pid = id;
        p.ws = ws; p.away = null;
        send({ t: 'welcome', id: p.id, rejoin: true });
        if (room.state === 'battle') room.watchStart(ws, false);
        room.broadcast(room.lobbyInfo());
        if (room.state === 'result' && p.missedResult && room.lastResult) { p.missedResult = false; send(room.lastResult); } // 切れている間にバトルが終わっていた
        break;
      }
      case 'leave': // 自分で「ホーム」を押して抜けた（すぐに席を空ける）
        if (room && me && !watching) dropPlayer(room, me);
        room = null; me = null;
        break;
      case 'create':
      case 'join': {
        if (room) return;
        if (draining) { send({ t: 'serverUpdate' }); return ws.close(); }
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
        pid = cleanPid(msg.pid);
        if (pid) touchPlayer(pid, msg.name, msg.yokai);
        me = room.addPlayer(ws, msg.name, msg.yokai, pid, msg.totsu, msg.title, msg.lv);
        send({ t: 'welcome', id: me.id });
        room.broadcast(room.lobbyInfo());
        break;
      }
      case 'yokai':
        // レジェンドはチームで1体まで
        if (room && me && room.state === 'lobby' && isLegend(msg.id) && [...room.players.values()].some(q => q !== me && isLegend(q.yokai))) {
          send({ t: 'lobbyMsg', msg: 'レジェンドはチームで1体までです。ほかの人がもう連れています' });
          break;
        }
        if (room && me && room.state === 'lobby' && usableYokai(msg.id)) { me.yokai = msg.id; me.totsu = cleanTotsu(msg.totsu); me.lv = cleanLv(msg.lv); me.title = cleanTitle(msg.title); room.broadcast(room.lobbyInfo()); }
        break;
      case 'boss':
        if (room && me && me.host && room.state === 'lobby' && S.BOSSES[msg.type] && !S.BOSSES[msg.type].secret) { room.bossSel = msg.type; room.challengeOn = false; room.broadcast(room.lobbyInfo()); }
        break;
      case 'challenge':
        if (room && me && me.host && room.state === 'lobby') { room.challengeOn = !!msg.on && S.themeOf(S.weekIndex()).key === 'challenge'; room.broadcast(room.lobbyInfo()); }
        break;
      case 'start':
        if (room && me && me.host && room.state === 'lobby' && !draining) {
          if ([...room.players.values()].filter(p => isLegend(p.yokai)).length > 1) {
            room.broadcast({ t: 'lobbyMsg', msg: 'レジェンドはチームで1体までです。だれか1人がほかのお友達に変えてね' });
            break;
          }
          // チャレンジのしばり（ヒーラー禁止）を守っているか
          const th = S.themeOf(S.weekIndex());
          if (room.challengeOn && th.key === 'challenge' && th.rule === 'noHealer' && [...room.players.values()].some(p => S.YOKAI_BY_ID[p.yokai].role === 'healer')) {
            room.broadcast({ t: 'lobbyMsg', msg: '今週のチャレンジは「ヒーラー禁止」！ ヒーラーの妖怪を連れている人がいます' });
            break;
          }
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
          i.atk = !!msg.atk; i.strong = !!msg.strong; i.item = !!msg.item; i.dash = !!msg.dash; i.skill = !!msg.skill; i.ult = !!msg.ult;
        }
        break;
    }
  });

  ws.on('close', () => {
    presence.delete(ws);
    if (room && watching) { room.watchers.delete(ws); return; }
    if (!room || !me || me.ws !== ws) return; // me.ws がちがう = もう新しい接続でつなぎ直している
    // 通信が切れただけかもしれない（招待を送るためにアプリを裏に回した、電波が切れた など）。
    // すぐには抜けさせず、しばらく席を残して戻ってくるのを待つ
    const r = room, p = me;
    p.ws = AWAY_WS; p.away = Date.now();
    p.input = { mx: 0, my: 0, atk: false, strong: false, item: false, dash: false, skill: false, ult: false };
    r.broadcast(r.lobbyInfo());
    setTimeout(() => { if (p.away && r.players.get(p.id) === p) dropPlayer(r, p); }, REJOIN_GRACE);
  });
});

// ---------- 通信が切れた人の席 ----------
const REJOIN_GRACE = (+process.env.REJOIN_GRACE || 90) * 1000; // この秒数のあいだは席を残す
const AWAY_WS = { readyState: 3, send() {}, close() {} };       // 切れている間の、なにもしない接続
function dropPlayer(room, p) {
  room.removePlayer(p.id);
  if (room.players.size === 0) {
    rooms.delete(room.code);
    // だれもいなくなったバトルを観戦していた人はホームへ
    room.broadcast({ t: 'error', msg: 'みんながいなくなったので、観戦を終わりました' });
    for (const w of room.watchers) w.close();
  }
  else room.broadcast(room.lobbyInfo());
}

// ---------- フレンド（このゲームで遊んだ人はみんなフレンド） ----------
const MAX_WATCHERS = 8;
const known = new Map();    // pid → { name, yokai, title, seen, played, prof }
const presence = new Map(); // ホーム画面の接続 → pid
const inviteAt = new Map(); // 「誘った人>誘われた人」→ 最後に誘った時刻
const usableYokai = id => !!S.YOKAI_BY_ID[id];
const isLegend = id => !!(S.YOKAI_BY_ID[id] && S.YOKAI_BY_ID[id].legend);
// プロフィール: f=持っている妖怪の数（1けた×176）、s=[遊んだ回数, 脱出, 最高鬼玉, 集めた鬼玉]、c=倒したボス、tc=称号の数、wt=限定称号
function cleanProfile(p) {
  if (!p || typeof p !== 'object') return null;
  const n = v => Math.max(0, Math.min(1e7, Math.floor(+v || 0)));
  return {
    f: typeof p.f === 'string' && /^[0-9]{0,400}$/.test(p.f) ? p.f : '',
    s: Array.isArray(p.s) ? p.s.slice(0, 4).map(n) : [],
    c: n(p.c) & 511, tc: n(p.tc), lv: typeof p.lv === 'string' && /^[0-9a-z]{0,400}$/.test(p.lv) ? p.lv : '', fv: S.YOKAI_BY_ID[p.fv] ? p.fv : null, wt: Array.isArray(p.wt) ? p.wt.filter(t => S.weeklyTitle(t)).slice(0, 50) : [],
  };
}
const cleanTotsu = v => Math.max(0, Math.min(S.TOTSU_MAX, v | 0));
const cleanLv = v => Math.max(1, Math.min(S.LV_MAX, v | 0));
const cleanTitle = v => (S.TITLE_BY_ID[v] || S.weeklyTitle(v) ? v : null);
const cleanPid = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(v) ? v : null);
function touchPlayer(pid, name, yokai, title) {
  const k = known.get(pid) || {};
  known.set(pid, {
    ...k, // バトルに行ったか・プロフィールはそのまま残す
    name: cleanName(name) || k.name || 'プレイヤー',
    yokai: S.YOKAI_BY_ID[yokai] ? yokai : k.yokai || 'nekomata',
    title: title === undefined ? k.title || null : cleanTitle(title),
    seen: Date.now(),
  });
  if (known.size > 500) { // 古い人から忘れる
    const old = [...known.entries()].sort((a, b) => a[1].seen - b[1].seen).slice(0, known.size - 500);
    for (const [id] of old) known.delete(id);
  }
}
// それぞれの人が今どうしているか
function friendList() {
  const where = new Map();
  for (const room of rooms.values()) for (const p of room.players.values()) {
    if (!p.pid) continue;
    where.set(p.pid, { room: room.code, state: room.state, n: room.players.size, yokai: p.yokai, name: p.name });
    touchPlayer(p.pid, p.name, p.yokai, p.title);
  }
  const online = new Set(presence.values());
  // 1回もバトルに行っていない人（開いただけの人）は出さない。サーバーが再起動しても、プロフィールの遊んだ回数でわかる
  const played = k => k.played || (k.prof && k.prof.s[0] > 0);
  return [...known.entries()].filter(([, k]) => played(k)).sort((a, b) => b[1].seen - a[1].seen).slice(0, 100).map(([id, k]) => {
    const w = where.get(id);
    const status = w ? w.state : online.has(id) ? 'home' : 'off';
    return {
      pid: id, name: w ? w.name : k.name, yokai: w ? w.yokai : k.yokai, title: k.title, status, seen: k.seen,
      room: w && (w.state === 'battle' || (w.state === 'lobby' && w.n < MAX_PLAYERS)) ? w.room : null,
      n: w ? w.n : 0,
    };
  });
}
function sendFriends(ws, list = friendList()) {
  const me = presence.get(ws);
  if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'friends', list: list.filter(f => f.pid !== me), now: Date.now() }));
}
setInterval(() => {
  if (!presence.size) return;
  const list = friendList();
  for (const ws of presence.keys()) sendFriends(ws, list);
}, 3000);

// ---------- 更新時の入れ替え ----------
// Render は新しいサーバーに切り替えたあと、古いサーバーに SIGTERM を送ってくる。
// プレイ中の部屋があれば試合が終わるまで動かし続け、終わった部屋から順に「サーバー更新」を伝えて閉じる。
const DRAIN_MAX = (+process.env.DRAIN_MAX || 295) * 1000;
let draining = false, drainStart = 0, exiting = false;
function startDrain() {
  if (draining) return;
  draining = true; drainStart = Date.now();
  const playing = [...rooms.values()].filter(r => r.state === 'battle').length;
  console.log(`更新のため終了準備: プレイ中の部屋 ${playing}`);
  server.close();
}
function drainStep() {
  for (const [code, room] of rooms) {
    if (room.state === 'battle') continue;
    // ロビー・結果画面の部屋は、新しいサーバーで入り直してもらう
    room.broadcast({ t: 'serverUpdate' });
    for (const p of room.players.values()) setTimeout(() => p.ws.close(), 300);
    rooms.delete(code);
  }
  if (!exiting && (rooms.size === 0 || Date.now() - drainStart > DRAIN_MAX)) {
    exiting = true;
    console.log('終了します');
    setTimeout(() => process.exit(0), 500);
  }
}

// ---------- 負荷の記録（LOAD_STATS=1 のとき5秒ごとにログ） ----------
const load = { ticks: 0, tickMs: 0, maxMs: 0, bytes: 0, cpu: process.cpuUsage(), at: Date.now(), lagMax: 0, last: Date.now() };
if (process.env.LOAD_STATS) setInterval(() => {
  const cpu = process.cpuUsage(load.cpu), wall = Date.now() - load.at;
  const battles = [...rooms.values()].filter(r => r.state === 'battle').length;
  console.log(`[負荷] 部屋${rooms.size}（バトル中${battles}） 人数${[...rooms.values()].reduce((a, r) => a + r.players.size, 0)} フレンド接続${presence.size}`
    + ` | 1回の計算 平均${(load.tickMs / Math.max(1, load.ticks)).toFixed(2)}ms 最大${load.maxMs.toFixed(1)}ms 遅れ最大${load.lagMax}ms`
    + ` | CPU ${(((cpu.user + cpu.system) / 1000 / wall) * 100).toFixed(1)}%（1コア） メモリ${Math.round(process.memoryUsage().rss / 1048576)}MB 送信${Math.round(load.bytes / 1024 / (wall / 1000))}KB/秒`);
  Object.assign(load, { ticks: 0, tickMs: 0, maxMs: 0, bytes: 0, cpu: process.cpuUsage(), at: Date.now(), lagMax: 0 });
}, 5000);

// ---------- ゲームループ ----------
let sendAcc = 0;
setInterval(() => {
  const t0 = performance.now();
  const now = Date.now(); load.lagMax = Math.max(load.lagMax, now - load.last - Math.round(1000 / TICK_RATE)); load.last = now; // 予定より遅れたか
  sendAcc += DT;
  const doSend = sendAcc >= 1 / SEND_RATE;
  if (doSend) sendAcc = 0;
  for (const room of rooms.values()) {
    try { room.tick(); } catch (e) { console.error(e); }
    if (doSend && room.state === 'battle') room.broadcast(room.snapshot());
  }
  if (draining) drainStep();
  const ms = performance.now() - t0; load.ticks++; load.tickMs += ms; load.maxMs = Math.max(load.maxMs, ms);
}, 1000 / TICK_RATE / (+process.env.SIM_SPEED || 1)); // SIM_SPEED: 検証用に早回し

if (require.main === module) {
  server.listen(PORT, () => console.log(`鬼バスターズ server: http://localhost:${PORT}`));
  // ランキングに記録がある人（最近バトルに行った人）をフレンドとして思い出す
  Ranking.recentPlayers(S.weekIndex()).then(list => {
    let n = 0;
    for (const r of list) {
      if (!r.pid || known.has(r.pid)) continue; // 新しい記録が先に来るので、同じ人の古い週の記録は飛ばす
      n++;
      known.set(r.pid, { name: cleanName(r.name) || 'プレイヤー', yokai: S.YOKAI_BY_ID[r.yokai] ? r.yokai : 'nekomata', title: cleanTitle(r.title), seen: Date.parse(r.updated_at) || 0, played: true });
    }
    if (n) console.log(`フレンドを ${n} 人読み込みました`);
  });
  process.on('SIGTERM', startDrain);
  process.on('SIGINT', startDrain);
}
module.exports = { Room, rollGacha, server };
