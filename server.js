// 鬼バスターズ: 鬼の世界から鬼玉を集めて脱出する協力ゲームのサーバー
// HTTP で public/ を配信し、WebSocket でサーバー権威のゲームループを回す。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const S = require('./public/shared.js');
const Combat = require('./combat.js');
const Ranking = require('./ranking.js');
const Sanki = require('./sanki.js'); // 三鬼合戦（ボス鬼3体）
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
const SHIN_RATE = process.env.SHIN_RATE != null ? +process.env.SHIN_RATE : 0.3;    // 鬼神を倒したとき、鬼神・真が目覚める確率

const PLAYER_R = 18;
const PATROL_R = 22;
const BOSS_R = 46;
const GIMMICK_ELS = ['fire', 'ice', 'thunder', 'wind', 'water', 'dark', 'light', 'earth', 'flower']; // 九尾鬼の9本の尾
const NUE_FORMS = { monkey: { name: '猿', weak: 'fire', spd: 1.3 }, tiger: { name: '虎', weak: 'thunder', gap: 0.8 }, snake: { name: '蛇', weak: 'ice' } };
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
const zlib = require('zlib');
function computeVersion() {
  const h = crypto.createHash('sha1');
  for (const f of ['index.html', 'style.css', 'music.js', 'yokai.js', 'attacks.js', 'shared.js', 'stages.js', 'title.js', 'gacha.js', 'game.js', 'sw.js', 'art/manifest.json', 'whatsnew.json', 'changelog.json']) {
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
    return sendJSON(req, res, { v: VERSION, ...whatsNew() });
  }
  if (urlPath === '/wsstats') return sendJSON(req, res, wsStats); // 圧縮が使えているかの確認用
  // スマホで起きた描画のエラー（不具合を調べるため。新しい20件だけ覚える）
  if (urlPath === '/clienterr' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { if (body.length < 2000) body += c; });
    req.on('end', () => { try { const e = JSON.parse(body); clientErrs.unshift({ t: new Date().toISOString(), v: String(e.v).slice(0, 20), y: String(e.y).slice(0, 20), b: String(e.b).slice(0, 20), m: String(e.m).slice(0, 600) }); clientErrs.length = Math.min(clientErrs.length, 20); } catch {} res.writeHead(204); res.end(); });
    return;
  }
  if (urlPath === '/clienterrs') return sendJSON(req, res, clientErrs);
  // 週替わりランキング: /ranking?pid=...&week=prev（先週）／week=3（第4回。終わった週の結果も見られる）
  if (urlPath === '/ranking') {
    const q = new URL(req.url, 'http://x').searchParams, w = q.get('week'), cur = S.weekIndex();
    const idx = w === 'prev' ? cur - 1 : /^\d{1,4}$/.test(w || '') ? Math.min(cur, +w) : cur;
    Ranking.board(idx, cleanPid(q.get('pid'))).then(b => {
      sendJSON(req, res, b);
    }, e => { console.error(e); res.writeHead(500); res.end('{}'); });
    return;
  }
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  // 通信量を減らす: 文字のファイルは gzip で圧縮し、ETag で「変わっていなければ送らない（304）」
  //  ?v=版 や ?h=ハッシュ 付きのファイルは中身が変わると URL も変わるので、長くキャッシュしてよい
  loadFile(filePath, (err, f) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const versioned = /[?&](v|h)=/.test(req.url) && path.basename(filePath) !== 'index.html';
    const headers = { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', ETag: f.etag, Vary: 'Accept-Encoding' };
    headers['Cache-Control'] = versioned ? 'public, max-age=31536000, immutable' : /\.(png|jpg|svg)$/.test(filePath) ? 'public, max-age=86400' : 'no-cache';
    if (path.basename(filePath) === 'sw.js') headers['Service-Worker-Allowed'] = '/';
    if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, headers); return res.end(); }
    const gz = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (gz) headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    res.end(gz ? f.gz : f.data);
  });
});
// 1分ごとに見に来る JSON（版の確認・ランキング）: 変わっていなければ 304 で中身を送らない。送るときは圧縮
function sendJSON(req, res, obj) {
  const body = Buffer.from(JSON.stringify(obj)), etag = '"' + crypto.createHash('sha1').update(body).digest('base64').slice(0, 20) + '"';
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', ETag: etag, Vary: 'Accept-Encoding' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  const gz = body.length > 512 && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (gz) headers['Content-Encoding'] = 'gzip';
  res.writeHead(200, headers);
  res.end(gz ? zlib.gzipSync(body) : body);
}
// ファイルの中身・圧縮版・ETag を覚えておく（ファイルが書きかわったら読み直す）
const fileCache = new Map();
function loadFile(filePath, cb) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) return cb(err || new Error('not file'));
    const c = fileCache.get(filePath);
    if (c && c.mtime === st.mtimeMs) return cb(null, c);
    fs.readFile(filePath, (err2, data) => {
      if (err2) return cb(err2);
      // index.html には版の番号を書き込む（読み込むファイルにも付けて、古いファイルが使われないようにする）
      if (path.basename(filePath) === 'index.html') data = Buffer.from(data.toString('utf8').replace(/__BUILD__/g, VERSION));
      const text = /\.(js|css|html|json|svg|txt)$/.test(filePath);
      const f = { mtime: st.mtimeMs, data, gz: text && data.length > 512 ? zlib.gzipSync(data, { level: 9 }) : null, etag: '"' + crypto.createHash('sha1').update(data).digest('base64').slice(0, 20) + '"' };
      fileCache.set(filePath, f);
      cb(null, f);
    });
  });
}

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

  // Render は WebSocket の圧縮（permessage-deflate）を通さないので、大きいメッセージはゲーム側で圧縮して送る（約1/4）
  broadcast(msg) {
    const data = JSON.stringify(msg);
    let zipped = null;
    const out = ws => {
      if (ws.readyState !== 1) return;
      if (ws.zip && data.length > 400) { zipped = zipped || zlib.deflateRawSync(data, { level: 6 }); ws.send(zipped); load.bytes += zipped.length; }
      else { ws.send(data); load.bytes += data.length; }
    };
    for (const p of this.players.values()) out(p.ws);
    for (const w of this.watchers) out(w);
  }

  // 途中から観戦する人（つなぎ直した人）に、今のバトルの様子を送る
  watchStart(ws, watch = true) {
    ws.send(JSON.stringify({
      t: 'start', seed: this.map.seed, stage: this.stage, timeLimit: this.timeLimit, fusuma: this.fusuma, boss: this.boss.type, movie: 0, countdown: 0, watch, rejoin: !watch,
      dama: this.dama.map(d => ({ id: d.id, x: Math.round(d.x), y: Math.round(d.y), v: d.v, b: d.b })),
    }));
  }

  lobbyInfo() {
    return {
      t: 'lobby', code: this.code, state: this.state, boss: this.bossSel, challenge: this.challengeOn, week: S.weekIndex(),
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, yokai: p.yokai, host: p.host, totsu: p.totsu, lv: p.lv, cs: p.charmList.length ? p.charmList : undefined, title: p.title, away: !!p.away || undefined, gw: this.state === 'result' && !p.viewed && !p.away ? 1 : undefined })), // gw: まだガチャ中
    };
  }

  addPlayer(ws, name, yokai, pid, totsu, title, lv, ch, cs) {
    const p = {
      id: genId(), ws, pid, totsu: cleanTotsu(totsu), lv: cleanLv(lv), charm: cleanCharm(ch), charmList: cleanCharmList(cs), title: cleanTitle(title), name: cleanName(name) || 'プレイヤー', yokai: usableYokai(yokai) ? yokai : 'nekomata',
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
    this.anyDown = false; this.blizKill = false; this.shinClean = false; // レジェンドの試練用
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
        hp: Math.round(st.hp * (1 + (p.charm.hp || 0))), maxHp: Math.round(st.hp * (1 + (p.charm.hp || 0))), ch: p.charm, atkT: 0, // お守り: 体力
        strongT: 0, down: false, reviveProg: 0, escaped: false,
        shieldT: 0, dashT: 0, dashDir: 0, invulT: 0, stamina: STAMINA_MAX, exhausted: false, staminaT: 0, invisT: 0,
        item: null, dama: 0, dmgDealt: 0, prevItem: true, escProg: 0,
        skillT: 0, atkUpT: 0, spdUpT: 0, leap: null, flurry: null, comboN: 0, dodge: false, jump: 0,
        spotted: false, revives: 0, kills: 0, bossDmg: 0, // ランキング用の記録
        seenByPatrol: false, atKill: null, judge: null, // レジェンドの試練用（見回り鬼に見つかったか・ボスを倒した瞬間の様子）
        legend: !!(S.YOKAI_BY_ID[p.yokai].legend || S.YOKAI_BY_ID[p.yokai].god), godFighter: !!(S.YOKAI_BY_ID[p.yokai].god && S.YOKAI_BY_ID[p.yokai].role === 'fighter'), standUsed: false, auraT: 0, judgeHits: 0, dragonT: 0, fly: false, critT: 0, skyT: 0, regenT: 0, bondT: 0, trickUsed: false, yomiUses: 0, mimicDodge: 0, ownShade: 0, decoyHits: 0, weakDmg: 0, orbFrac: 0, gutsUsed: false, revT: 0, charmT: 0, curseT: 0, curseTick: 0, raT: 0, eye: false, eyeT: 0, autoRevT: 0, downs: 0, shinDowns: null, passive: S.YOKAI_BY_ID[p.yokai].passive || null, ult: 0, ultBusyUntil: 0, nyoi: null, diveLeft: 0, // レジェンド（ultBusyUntil は前のバトルの時刻が残るとゲージがたまらないので必ず戻す）
      });
      S.collide(this.map, p, PLAYER_R);
      if (DEMO_AI) { p.maxHp *= +(process.env.DEMO_PHP || 5); p.hp = p.maxHp; p.ultBoost = Number(process.env.DEMO_ULT_BOOST || 1); }
    }
    // ソンゴクウ: いつも分身が1体ついてきて一緒に攻撃する
    for (const p of this.players.values()) if (p.passive === 'stamina') {
      const el = S.YOKAI_BY_ID[p.yokai].el;
      this.turrets.push({ id: this.newId(), owner: p.id, x: p.x, y: p.y, life: 1e9, t: 1, dmg: 30 * p.stats.strongMul * 0.12, el, c: '#ffcc33', clone: p.yokai, follow: 1.5 });
    }
    this.ultGainTeam = [...this.players.values()].some(p => p.passive === 'sneak') ? 1.3 : 1; // ヌラリヒョンがいると、みんなの必殺技ゲージがたまりやすい
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
    this.oni3 = null; this.hazards = []; this.sankiAll = false; this.comboT = 10; this.triT = 25;
    if (kind.sanki) {
      // 三鬼合戦: ちがう種類のボス鬼3体を、はなれた場所に出す（強さ1.5倍）
      const types = process.env.TEST_SANKI ? process.env.TEST_SANKI.split(',') : Sanki.pickTypes();
      const pts = [bp];
      for (let i = 1; i < 3; i++) { let q = null; for (let k = 0; k < 400 && !q; k++) { const c = this.gridB.randomFreePoint(); if (pts.every(o => dist(o, c) > 1000) && spawns.every(s => dist(s, c) > 1200)) q = c; } pts.push(q || this.gridB.randomFreePoint()); }
      this.oni3 = types.map((t, i) => this.makeBoss(t, pts[i], Sanki.HP_MUL, Sanki.DMG_MUL));
      this.boss = this.oni3[0];
      this.mainBoss = null;
      for (const b of this.oni3) if (b.kind.gimmick) this.gimmickSetup(b);
    } else if (kind.rush) {
      // 百鬼王: 7体のボスを体力1/3で順番に倒すと、最後に百鬼王が降ってくる
      const st = DEMO_AI ? Math.min(kind.rush.length - 1, +process.env.DEMO_RUSH || 0) : 0; // 撮影用: とちゅうのボスから始める
      this.boss = this.makeBoss(kind.rush[st], bp, kind.rushHp);
      this.boss.rushStep = st;
      this.mainBoss = null;
    } else {
      this.boss = this.makeBoss(type, bp);
      this.mainBoss = this.boss;
    }
    this.boss2 = null; this.shades = []; this.decoys = [];
    this.curseCleared = 0; this.rewound = 0; this.twinFin = {}; this.revealT = 0; this.timeStopT = 0;
    this.luckTeam = [...this.players.values()].some(p => S.YOKAI_BY_ID[p.yokai].passive === 'luckgod'); // ガネーシャ
    if ([...this.players.values()].some(p => S.YOKAI_BY_ID[p.yokai].passive === 'chronos')) { this.timeLimit += 30; this.timeLeft += 30; } // クロノス: 制限時間 +30秒
    if (kind.gimmick && !this.oni3) this.gimmickSetup(this.boss);
    this.firstBoss = this.boss;
    this.ring = null; // 鬼神の最後の形態: だんだんせまくなる安全な輪
    if (DEMO_AI) this.demoPlace(spawns[0]);
    if (this.boss2) { this.boss2.x = this.boss.x + 170; this.boss2.y = this.boss.y; S.collide(this.map, this.boss2, BOSS_R); } // 双子鬼は2体ならんで出る

    this.broadcast({
      t: 'start', seed, stage: this.stage, timeLimit: this.timeLimit, challenge: !!this.challenge, fusuma: this.fusuma, boss: type, movie: INTRO_MOVIE, countdown: COUNTDOWN, sanki: this.oni3 ? this.oni3.map(b => b.type) : undefined,
      dama: this.dama.map(d => ({ id: d.id, x: Math.round(d.x), y: Math.round(d.y), v: d.v, b: d.b })),
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
      id: genId(), x: p.x, y: p.y, face: rand(0, Math.PI * 2), hp: 120, maxHp: 120, // 見回り鬼の体力（少し強く: 100→120）
      state: 'patrol', target: null, lostT: 0, wanderTo: null, path: null, whistleT: 0, hitFlash: 0,
    });
  }

  activePlayers() { return [...this.players.values()].filter(p => !p.down && !p.escaped); }
  visibleTo(p) { return !p.down && !p.escaped && p.invisT <= 0 && !p.away; } // 通信が切れている人は鬼に見つからない

  // ---- ダメージ ----
  damageOni(src, e, amount) {
    if (e.hp <= 0 || e.downT > 0) return; // 倒れている双子鬼には効かない
    if (e.weakT > 0) { amount *= 2; if (src) src.weakDmg += amount; } // がしゃどくろ王: 手をたたいたあとは弱点
    if (e.isDecoy && src) src.decoyHits++;
    if (e.isBoss && this.bossArmor(e) && src) {
      // 金の鎧: 正面からは35%しか効かない（鬼神は60%）。背中からは1.3倍
      const off = angleDiff(Math.atan2(src.y - e.y, src.x - e.x), e.face);
      if (off < 1.1) { amount *= e.type === 'kishin' ? 0.6 : 0.35; if (Math.random() < 0.25) this.events.push({ k: 'clang', x: Math.round(e.x + rand(-20, 20)), y: Math.round(e.y - 60) }); }
      else if (off > 2.2) amount *= 1.3;
    }
    if (src && src.passive === 'godArmor') amount *= 1.3; // オニガミ: 鬼殺しの力（鬼へのダメージ +30%）
    if (src && src.passive === 'backstab' && e.isBoss) { const off = angleDiff(Math.atan2(src.y - e.y, src.x - e.x), e.face); amount *= off > 2.0 ? 1.6 : off > 1.1 ? 1.2 : 1; } // オーディン: 背中から +60%、横から +20%
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
      if (e.isPatrol) this.killPatrol(e, src);
      else if (e.isShade || e.isDecoy) this.killMinor(e, src);
      else if (e.twinPair) this.twinDown(e, src);
      else this.killBoss(e);
    }
  }

  enemies() {
    const list = this.patrols.filter(p => p.hp > 0);
    for (const b of this.allBosses()) if (!(b.downT > 0)) list.push(b);
    for (const e of this.shades) if (e.hp > 0) list.push(e);
    for (const e of this.decoys) if (e.hp > 0) list.push(e);
    return list;
  }
  // いま生きているボス鬼ぜんぶ（ふつうは1体・双子鬼は2体・三鬼合戦は3体）
  allBosses() { return (this.oni3 ? this.oni3 : [this.boss, this.boss2]).filter(b => b && b.hp > 0); }
  bossOfType(t) { return this.allBosses().find(b => b.type === t) || null; }
  enemyR(e) { return e.isBoss || e.isDecoy ? BOSS_R * (e.big ? 1.8 : 1) : PATROL_R; }

  hitEnemiesInCircle(src, x, y, radius, amount) {
    for (const e of this.enemies()) if (Math.hypot(e.x - x, e.y - y) <= radius + this.enemyR(e)) this.damageOni(src, e, amount);
  }

  damagePlayer(p, amount) {
    if (p.down || p.escaped || p.dashT > 0 || p.invulT > 0 || p.away) return; // 通信が切れている間はダメージを受けない（電波が悪くても急に倒れないように）
    if (p.shieldT > 0) amount *= 0.3;
    if (p.passive === 'nightDash' && p.dashing) return; // ジャージーデビル: 飛んでいるあいだは当たらない
    if (p.passive === 'bossGuard') amount *= p.hp < p.maxHp / 2 ? 0.49 : 0.7; // ウラ: ボス鬼からのダメージ -30%（体力が半分を切ると、さらに -30%）
    if (p.passive === 'godArmor') amount *= 0.65; // オニガミ: 金の鎧
    if (p.passive === 'underlord') amount *= 1 - 0.4 * (1 - p.hp / p.maxHp); // ハデス: 冥王の鎧
    if (p.ch && p.ch.guard > 0) amount *= 1 - p.ch.guard; // お守り: 鉄壁
    if (p.passive === 'trickster' && !p.trickUsed && p.hp - amount <= 0) { // ロキ: 化かし（分身と入れかわってよける）
      p.trickUsed = true; p.invulT = 1.5;
      this.events.push({ k: 'ring', x: Math.round(p.x), y: Math.round(p.y), r: 100, c: '#7aff9a' });
      const a = Math.random() * Math.PI * 2; p.x += Math.cos(a) * 150; p.y += Math.sin(a) * 150; S.collide(this.map, p, PLAYER_R);
      return;
    }
    if (p.ch && p.ch.guts && !p.gutsUsed && p.hp - amount <= 0) { p.gutsUsed = true; p.hp = 1; p.invulT = 1.5; this.events.push({ k: 'ring', x: Math.round(p.x), y: Math.round(p.y), r: 100, c: '#ffd23a' }); return; } // お守り: 根性
    if (p.eye && amount >= 20) { p.eye = false; p.invulT = Math.max(p.invulT, 0.5); this.events.push({ k: 'ring', x: Math.round(p.x), y: Math.round(p.y), r: 90, c: '#c8a0ff' }); return; } // シヴァの第三の目で防いだ
    if (p.passive === 'lastStand' && !p.standUsed && p.hp - amount <= 0) { // ジョカ: 1度だけ耐える
      p.standUsed = true; p.hp = 1; p.invulT = 2;
      this.events.push({ k: 'ring', x: Math.round(p.x), y: Math.round(p.y), r: 120, c: '#7dffd8' });
      return;
    }
    p.hp -= amount;
    this.events.push({ k: 'hurt', x: Math.round(p.x), y: Math.round(p.y - 30), v: Math.round(amount), id: p.id });
    if (p.hp <= 0 && p.passive === 'yomi' && p.yomiUses < 2) { p.yomiUses++; p.autoRevT = 10; } // イザナミ: 黄泉の主（10秒で自分で起きる）
    else if (p.hp <= 0 && this.activePlayers().some(q => q !== p && q.passive === 'lastStand')) { // ジョカの五色の石: 倒れた場所に回復の石。5秒で自動で起きる
      p.autoRevT = 5;
      this.zones.push({ id: this.newId(), owner: p.id, x: p.x, y: p.y, r: 110, life: 5, tick: 0, amt: 8, every: 0.5, kind: 'heal', c: '#7dffd8' });
    }
    if (p.hp <= 0) { p.hp = 0; p.down = true; p.downs = (p.downs || 0) + 1; p.reviveProg = 0; this.anyDown = true; this.events.push({ k: 'down', id: p.id }); }
  }

  healPlayer(p, amount) {
    if (p.down || p.escaped) return;
    if (p.curseT > 0) { p.curseT = 0; this.curseCleared = (this.curseCleared || 0) + 1; this.events.push({ k: 'curseOff', id: p.id }); } // 疫病鬼の呪いは回復で消える
    if (amount > 0 && this.activePlayers().some(q => q.passive === 'immortal' && dist(p, q) < 300)) p.atkUpT = Math.max(p.atkUpT || 0, 5); // 西王母: 桃の香り
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + amount);
    if (p.hp > before) this.events.push({ k: 'heal', x: Math.round(p.x), y: Math.round(p.y - 30), v: Math.round(p.hp - before) });
  }

  // 鬼玉を落とす（v はその玉1個の価値。ボス鬼は v の大きい「どデカい鬼玉」1個）
  dropDama(x, y, n, v = 1, b) {
    for (let k = 0; k < n; k++) {
      const d = { id: genId(), x: x + rand(-40, 40), y: y + rand(-40, 40), v, b }; // b: 落としたボス鬼（どデカい鬼玉の色）
      S.collide(this.map, d, v > 1 ? 30 : 10);
      this.dama.push(d);
      this.events.push({ k: 'da', id: d.id, x: Math.round(d.x), y: Math.round(d.y), v, b });
    }
  }

  // デモ撮影用: ボス鬼と見回り鬼3体を、出発地点の近くの見えるところに置く
  demoPlace(sp) {
    const near = (lo, hi, grid) => {
      for (let k = 0; k < 3000; k++) { const q = grid.randomFreePoint(); const d = dist(q, sp); if (d > lo && d < hi && S.lineOfSight(this.map, q, sp)) return q; }
      return grid.randomFreePoint();
    };
    Object.assign(this.boss, near(380, 560, this.gridB), { state: 'engage', target: [...this.players.values()][0].id });
    if (this.oni3) for (const o of this.oni3) if (o !== this.boss) Object.assign(o, near(450, 700, this.gridB)); // 三鬼合戦の撮影: 3体とも近くに
    // 仲間のボットは自分の近くから
    for (const p of [...this.players.values()].slice(1)) { Object.assign(p, near(60, 200, this.gridS)); }
    if (process.env.DEMO_SIM) return; // 試練がクリアできるかの検証: ボスの強さ・見回り鬼の場所はそのまま
    this.boss.maxHp = this.boss.hp = this.boss.maxHp * 5; // 撮影中にすぐ倒れないように
    // 特別な仕組みを早く見せる（DEMO_HP=0.5 で体力を減らした状態から、DEMO_FAST=1 で吹雪・型の切りかえを早く）
    if (process.env.DEMO_HP) { this.boss.hp = this.boss.maxHp * +process.env.DEMO_HP; }
    if (process.env.DEMO_FAST) Object.assign(this.boss, { blizT: 4, modeT: 7 });
    for (const e of this.patrols.slice(0, 3)) Object.assign(e, near(220, 480, this.gridS));
    if (process.env.DEMO_DAMA) { for (const d of this.dama.slice(0, 8)) Object.assign(d, near(80, 300, this.gridS)); const q = near(150, 260, this.gridS); this.dama.push({ id: genId(), x: q.x, y: q.y, v: 50, b: process.env.DEMO_DAMA }); } // 鬼玉の見た目の確認用
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
    // ボス鬼に報告（ウラの近くの見回り鬼は、鬼の王がこわくて報告できない）
    const b = this.boss;
    if (this.uraNear(e)) return;
    if (b && b.hp > 0 && b.state !== 'engage') { b.state = 'hunt'; b.target = target.id; b.huntBy = e.id; b.path = null; }
  }

  // オニガミの手下（見回り鬼）: 3体まで、15秒
  minionCount(god) { return this.turrets.filter(t => t.minion && t.owner === god.id).length; }
  makeMinion(god, e) {
    const n = this.minionCount(god);
    if (n >= 3) return false;
    this.turrets.push({ id: this.newId(), owner: god.id, x: e.x, y: e.y, life: 15, t: 0.5, dmg: 30 * god.stats.strongMul * 0.15, el: 'fire', c: '#ffd23a', minion: true, follow: [1.2, -1.2, 2.6][n] });
    this.events.push({ k: 'ring', x: Math.round(e.x), y: Math.round(e.y), r: 70, c: '#ffd23a' });
    return true;
  }
  uraNear(e, r = 400) { for (const p of this.activePlayers()) if (p.passive === 'bossGuard' && dist(p, e) < r) return true; return false; }
  calmPatrol(e) {
    e.state = 'patrol'; e.target = null; e.path = null; e.wanderTo = null;
    const b = this.boss;
    if (b && b.huntBy === e.id) { b.huntBy = null; if (b.state === 'hunt') { b.state = 'wander'; b.target = null; b.path = null; } }
  }

  patrolDrop() { const k = S.BOSSES[this.mainType] || S.BOSSES.red; return 3 + Math.floor((k.drop || 50) / 70); }
  killPatrol(e, src) {
    this.events.push({ k: 'oniDown', x: Math.round(e.x), y: Math.round(e.y) });
    if (src && src.passive === 'nightDash' && src.legend) src.ult = Math.min(Combat.ULT_MAX, src.ult + 25); // ジャージーデビル: 鬼を狩るほど必殺技がたまる
    if (src && src.passive === 'godArmor') this.makeMinion(src, e); // オニガミ: 倒した見回り鬼も手下になる
    if (src && src.passive === 'kuniumi') this.zones.push({ id: genId(), owner: src.id, x: e.x, y: e.y, r: 120, life: 5, tick: 0, amt: 8, every: 0.5, kind: 'heal', c: '#fff2a0' }); // イザナギ: 国生み（回復の島）
    this.calmPatrol(e); // 伝達はここで途切れる
    this.dropDama(e.x, e.y, this.patrolDrop() + Math.floor(Math.random() * 3)); // 強いボスの戦いほど多い（赤鬼 3〜5個 … 天邪鬼 9〜11個）
    e.respawnT = 25;
  }

  canSee(e, p, range, halfAngle) {
    if (p.away) return false;
    if (e.seeAll ? (p.down || p.escaped) : !this.visibleTo(p)) return false; // 天邪鬼: 消えていても見える
    if (e.seeAll) { const d = dist(e, p); return d <= range && S.lineOfSight(this.map, e, p); }
    if (e.seeThrough) return dist(e, p) <= range * 1.3; // がしゃどくろ王: 建物の上からのぞきこむ
    if (p.passive === 'nightDash' && p.dashing) return false; // ジャージーデビル: ダッシュ中は見つからない
    if (p.passive === 'godArmor' && e.isPatrol) return false;   // オニガミ: 見回り鬼は鬼の神を見ても報告しない（こわくて逃げる）
    if (p.passive === 'sneak') range *= e.isPatrol ? 0.5 : 0.6; // ヌラリヒョン: 見回り鬼の見える距離が半分、ボス鬼からも見つかりにくい
    const d = dist(e, p);
    if (d > range) return false;
    if (d > 70 && angleDiff(Math.atan2(p.y - e.y, p.x - e.x), e.face) > halfAngle) return false;
    return S.lineOfSight(this.map, e, p);
  }

  updatePatrols() {
    // 一気にたくさん倒されても（ゼウスの雷など）、見回り鬼は一定数（6割）まではすぐ（2〜5秒で順番に）湧きなおす
    const dead = this.patrols.filter(e => e.hp <= 0).sort((x, y) => x.respawnT - y.respawnT);
    const need = Math.ceil(this.patrols.length * 0.6) - (this.patrols.length - dead.length);
    for (let i = 0; i < need && i < dead.length; i++) dead[i].respawnT = Math.min(dead[i].respawnT, 2 + i * 0.6);
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
      // オニガミ（鬼の神）の近くに来た見回り鬼は、その場でひれふして手下になる（鬼玉は落とさない）。手下が3体いるときは逃げていく
      const near = this.activePlayers().find(p => p.passive === 'godArmor' && dist(p, e) < 220);
      if (near && this.makeMinion(near, e)) {
        if (e.state === 'alert') this.calmPatrol(e);
        e.hp = 0; e.respawnT = 25;
        this.events.push({ k: 'gimmick', g: 'kneel', id: near.id });
        continue;
      }
      if (e.state === 'patrol') {
        if (!e.wanderTo || dist(e, e.wanderTo) < 30) { e.wanderTo = this.gridS.randomFreePoint(); e.path = null; }
        const god = this.activePlayers().find(p => p.passive === 'godArmor' && dist(p, e) < 260);
        if (god && !e.fleeing) { const a = Math.atan2(e.y - god.y, e.x - god.x); e.wanderTo = { x: clamp(e.x + Math.cos(a) * 500, 40, this.map.w - 40), y: clamp(e.y + Math.sin(a) * 500, 40, this.map.h - 40) }; e.path = null; e.fleeing = true; }
        if (!god) e.fleeing = false;
        moveAlong(this, e, this.gridS, e.wanderTo.x, e.wanderTo.y, god ? 170 : 105, PATROL_R);
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
        if (b && b.hp > 0 && b.state === 'wander' && !this.uraNear(e)) { b.state = 'hunt'; b.target = t.id; b.huntBy = e.id; }
      }
    }
  }

  // ---- ボス鬼 ----
  makeBoss(type, pos, hpMul = 1, dmgMul = 1) {
    let kind = S.BOSSES[type]; const n = this.players.size;
    if (dmgMul !== 1) kind = { ...kind, dmg: kind.dmg * dmgMul }; // 三鬼合戦: 攻撃も強い
    // 金鬼から先はチームで挑むボス。1人・2人でも体力は3人分（ひとりで倒すのは、ほぼむり）
    const hp = Math.round((1500 + 1100 * (kind.team ? Math.max(n, 3) : n)) * kind.hp * hpMul); // 2人なら赤鬼4255・青鬼6475・黒鬼9620
    // 百鬼王は鬼神の2段階目、鬼神・真は3段階目の技をはじめから使う
    const phase = type === 'shin' ? 3 : type === 'hyakki' ? 2 : 1;
    return {
      x: pos.x, y: pos.y, hp, maxHp: hp, type, kind, name: kind.name, face: 0, isBoss: true,
      state: 'wander', stateT: 0, path: null, wanderTo: null, target: null, huntBy: null, lostT: 0,
      stunT: 0, chargeDir: 0, hitFlash: 0, atkT: 2,
      blizT: 14, bliz: 0,           // 白鬼: 吹雪
      mode: 'wind', modeT: 12, boltT: 2, // 風雷鬼: 風の型・雷の型
      phase, sweep: null, sweepT: phase > 1 ? 4 : 0, // 鬼神: 変身の段階・大なぎ払い
      judgeT: 6,                    // 獄王: 次の裁きまで
    };
  }
  godLike(b) { return b.type === 'kishin' || b.type === 'hyakki' || b.type === 'shin'; } // 鬼神の技を使うボス

  killBoss(b = this.boss) {
    if (this.oni3) return this.killSanki(b);
    this.events.push({ k: 'bossDown', x: Math.round(b.x), y: Math.round(b.y) });
    if (b.type === 'shin') this.shinClean = !this.anyDown; // 神の試練: だれも倒れずに鬼神・真を倒したか
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
    for (const p of this.players.values()) { p.judge = null; p.revT = 0; p.charmT = 0; p.curseT = 0; } // 獄王の裁き・さかさま・魅了・呪いもおしまい
    if (b === this.mainBoss) { this.boss2 = null; this.shades = []; this.decoys = []; }
    this.dropDama(b.x, b.y, 1, b.kind.drop * (b.rushStep != null ? 0.4 : 1), b.type); // ラッシュ中のボスの鬼玉は少なめ
    this.telegraphs = [];
    this.ring = null;
  }

  // 三鬼合戦: 1体倒れた。のこりの鬼が狩り役を引きつぐ。3体（覚醒した鬼神・真も）ぜんぶ倒すと全滅ボーナス
  killSanki(b) {
    b.hp = 0;
    this.events.push({ k: 'bossDown', x: Math.round(b.x), y: Math.round(b.y), name: b.name });
    this.dropDama(b.x, b.y, 1, b.kind.drop, b.type);
    this.telegraphs = this.telegraphs.filter(tg => tg.owner !== b);
    if (b.type === 'kage') this.shades = [];
    if (b.type === 'kyubi') { this.decoys = []; for (const p of this.players.values()) p.charmT = 0; }
    if (b.type === 'gokuou') for (const p of this.players.values()) p.judge = null;
    if (b.type === 'amanojaku') for (const p of this.players.values()) p.revT = 0;
    if (b.type === 'yakubyo') for (const p of this.players.values()) p.curseT = 0;
    if (this.godLike(b)) this.ring = null;
    if (b.type === 'shin') this.shinClean = !this.anyDown;
    if (b.type === 'kishin' && Math.random() < SHIN_RATE) this.drop = { type: 'shin', kind: 'shin', wait: 4, t: 3.6, sanki: true }; // 鬼神は覚醒することがある
    const alive = this.oni3.filter(o => o.hp > 0);
    if (b === this.boss && alive.length) this.boss = alive[0];
    if (!alive.length && !this.drop) {
      this.mainDown = true; this.sankiAll = true;
      this.bossKillT = this.time;
      this.anyDownAtKill = this.anyDown;
      for (const p of this.players.values()) p.atKill = { seen: p.seenByPatrol, dama: p.dama };
      this.dropDama(b.x, b.y, 1, 900, 'shin'); // 全滅ボーナス
      this.events.push({ k: 'sankiAll', x: Math.round(b.x), y: Math.round(b.y) });
    }
  }

  // 乱入ボス（プレイヤーには知らせていない仕組み）:
  // 残り2分以上でボスを倒すと、30%で新しいボス鬼が空から降ってくる。ひとりなら赤鬼・青鬼・黒鬼、2人以上ならすべての鬼から
  maybeBonus() {
    if (this.timeLeft < 120 || Math.random() >= BONUS_RATE) return;
    const pool = (this.players.size === 1 ? ['red', 'blue', 'black'] : S.BOSS_ORDER).filter(k => k !== this.mainType && !S.BOSSES[k].hidden && !S.BOSSES[k].gimmick); // 隠しボスは乱入しない
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
    const b = dr.sanki ? this.makeBoss(dr.type, pos, Sanki.HP_MUL, Sanki.DMG_MUL) : (this.boss = this.makeBoss(dr.type, pos, dr.hpMul || 1));
    if (dr.sanki) { this.oni3.push(b); if (!(this.boss && this.boss.hp > 0)) this.boss = b; }
    Object.assign(b, { state: 'engage', target: t.id, atkT: 2.5 });
    let label = null;
    if (dr.kind === 'bonus') this.bonusBoss = b;
    if (dr.kind === 'rush') { b.rushStep = dr.step; label = `百鬼王のしもべ ${b.name}（${dr.step + 1}/${S.BOSSES.hyakki.rush.length}）`; }
    if (dr.kind === 'final') { this.mainBoss = b; label = '百鬼王が降臨した！'; }
    if (dr.kind === 'shin') {
      this.shinBoss = b; label = '鬼神・真が目覚めた！';
      for (const q of this.players.values()) q.shinDowns = q.down ? -1 : (q.downs || 0); // 神の試練: 鬼神・真との戦いで倒れたか
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
        this.damagePlayer(p, j.dmg); p.judgeHits++;
        this.events.push({ k: 'judgeHit', id: p.id, x: Math.round(p.x), y: Math.round(p.y) });
        continue;
      }
      if (j.k === 'save' && ![...this.players.values()].some(q => q.down && !q.escaped)) { p.judge = null; this.events.push({ k: 'judgeOk', id: p.id }); continue; } // 仲間が起きた
      if ((j.t -= DT) > 0) continue;
      p.judge = null;
      if (j.k === 'save') { // 助けられなかった: 全員にダメージ
        for (const q of this.activePlayers()) { this.damagePlayer(q, j.dmg * 0.6); q.judgeHits++; }
        this.events.push({ k: 'judgeHit', id: p.id, x: Math.round(p.x), y: Math.round(p.y), all: true });
      } else this.events.push({ k: 'judgeOk', id: p.id });
    }
  }

  updateBoss() {
    const b = this.boss;
    if (!b || b.hp <= 0) return;
    b.hitFlash = Math.max(0, b.hitFlash - DT);
    if (b.downT > 0) { // 双子鬼: 倒れている。時間内にもう片方を倒さないと起き上がる
      if ((b.downT -= DT) <= 0) { b.hp = b.maxHp * 0.5; b.downT = 0; this.events.push({ k: 'twinRevive', x: Math.round(b.x), y: Math.round(b.y), name: b.name }); }
      return;
    }
    if (b.weakT > 0) b.weakT -= DT;
    if (b.stunT > 0) { b.stunT -= DT; return; }
    // 体力が半分を切ると怒る（攻撃の間隔が短くなる）
    if (!b.rage && b.hp < b.maxHp / 2) { b.rage = true; this.events.push({ k: 'rage', x: Math.round(b.x), y: Math.round(b.y) }); }
    this.bossSpecial(b);

    // 自分の目で見つけたら戦闘
    if (b.state !== 'engage' && b.state !== 'charging' && b.state !== 'windup') {
      // 天邪鬼は、消えている人・かくれるのが得意な人からねらう
      const ps = b.seeAll ? this.activePlayers().sort((p, q) => (q.invisT > 0 || q.passive === 'sneak') - (p.invisT > 0 || p.passive === 'sneak')) : this.activePlayers();
      for (const p of ps) {
        if (this.canSee(b, p, 380, Math.PI)) { b.state = 'engage'; b.target = p.id; b.lostT = 0; b.path = null; p.spotted = true; break; }
      }
    }

    const t = b.target != null ? this.players.get(b.target) : null;
    switch (b.state) {
      case 'wander':
        if (!b.wanderTo || dist(b, b.wanderTo) < 40) { b.wanderTo = this.gridB.randomFreePoint(); b.path = null; }
        moveAlong(this, b, this.gridB, b.wanderTo.x, b.wanderTo.y, 95 * (b.spdMul || 1), BOSS_R);
        break;
      case 'hunt': // 見回り鬼の報告で居場所を知っている
        if (!t || !this.bossSees(b, t)) { b.state = 'wander'; b.target = null; b.huntBy = null; break; }
        moveAlong(this, b, this.gridB, t.x, t.y, BOSS_CHASE * (b.spdMul || 1), BOSS_R);
        break;
      case 'engage': {
        if (!t || !this.bossSees(b, t)) { b.state = b.huntBy ? 'hunt' : 'wander'; if (!b.huntBy) b.target = null; break; }
        const sees = (b.seeThrough || S.lineOfSight(this.map, b, t)) && dist(b, t) < 520;
        if (sees) b.lostT = 0;
        else if ((b.lostT += DT) > 3) { b.state = b.huntBy ? 'hunt' : 'wander'; if (!b.huntBy) b.target = null; break; }
        if (dist(b, t) > 130) moveAlong(this, b, this.gridB, t.x, t.y, BOSS_CHASE * (b.spdMul || 1), BOSS_R);
        else b.face = Math.atan2(t.y - b.y, t.x - b.x);
        b.atkT -= DT;
        if (b.atkT <= 0 && sees && dist(b, t) < 420) this.bossAttack(t);
        break;
      }
      case 'windup':
        b.stateT -= DT;
        if (b.stateT <= 0) { b.state = 'engage'; b.atkT = rand(1.2, 2.0) * b.kind.atkGap * this.rageGap(b); }
        break;
      case 'charging': {
        b.stateT -= DT;
        const px = b.x, py = b.y;
        b.x += Math.cos(b.chargeDir) * 600 * DT; b.y += Math.sin(b.chargeDir) * 600 * DT;
        S.collide(this.map, b, BOSS_R);
        for (const p of this.activePlayers()) if (!p.chargeHit && dist(p, b) < BOSS_R + PLAYER_R) { this.damagePlayer(p, 45 * b.kind.dmg); p.chargeHit = true; this.onBossHit(p, {}); }
        const blocked = Math.hypot(b.x - px, b.y - py) < 600 * DT * 0.5;
        if (b.stateT <= 0 || blocked) { b.state = 'engage'; b.atkT = rand(1.2, 1.8) * b.kind.atkGap * this.rageGap(b); if (blocked) this.events.push({ k: 'boom', x: Math.round(b.x), y: Math.round(b.y), r: 60 }); }
        break;
      }
    }
  }

  bossSnap(b) {
    return { type: b.type, x: Math.round(b.x), y: Math.round(b.y), hp: Math.round(b.hp), maxHp: b.maxHp, face: +b.face.toFixed(2), st: b.state, stun: b.stunT > 0, target: b.state === 'hunt' || b.state === 'engage' ? b.target : null, hunt: b.state === 'hunt', flash: b.hitFlash > 0, rage: !!b.rage,
      bliz: b.bliz > 0 || undefined, mode: b.type === 'fuurai' ? b.mode : undefined, phase: this.godLike(b) ? b.phase : undefined, armor: this.bossArmor(b) || undefined,
      sweep: b.sweep ? { a: +this.sweepAngle(b.sweep).toFixed(3), w: b.sweep.t < b.sweep.warn ? +(b.sweep.t / b.sweep.warn).toFixed(2) : -1, len: b.sweep.len, dir: b.sweep.dir } : undefined,
      // 鬼神のあとの8体
      name: b.name !== b.kind.name ? b.name : undefined, form: b.form, immune: b.immune, weak: b.weakT > 0 || undefined, down: b.downT > 0 ? +b.downT.toFixed(1) : undefined,
      rew: b.rew ? +b.rew.t.toFixed(1) : undefined, big: b.big || undefined, rune: (b.dots || []).filter(d => d.rune).length || undefined };
  }
  // ======== 鬼神のあとの8体の仕組み ========
  gimmickSetup(b) {
    const t = b.type;
    if (t === 'yakubyo') b.cloudT = 8;
    if (t === 'kage') b.shadeT = 5;
    if (t === 'nue') { b.form = 'monkey'; b.formT = 15; this.applyForm(b); }
    if (t === 'twin') {
      b.name = b.kind.twinName; b.twinPair = true; b.comboT = 14;
      const b2 = this.makeBoss('twin2', { x: b.x + 170, y: b.y });
      S.collide(this.map, b2, BOSS_R);
      b2.twinPair = true;
      this.boss2 = b2;
    }
    if (t === 'kyubi') { b.decoyT = 6; b.charmT = 8; b.tailT = 9; b.immune = GIMMICK_ELS[0]; }
    if (t === 'toki') { b.stealT = 18; b.rewT = 22; b.handT = 4; b.handI = 0; }
    if (t === 'gasha') { b.clapT = 8; b.weakT = 0; b.seeThrough = true; b.spdMul = 0.6; b.big = true; }
    if (t === 'amanojaku') { b.revT = 10; b.seeAll = true; b.mimic = null; }
  }
  applyForm(b) { const f = NUE_FORMS[b.form]; b.spdMul = f.spd || 1; b.gapMul = f.gap || 1; }
  gimmickSpecial(b) {
    const ps = this.activePlayers(), pick = () => ps[Math.floor(Math.random() * ps.length)];
    switch (b.type) {
      case 'yakubyo': // 呪いの霧: 何人かの足もとに。当たると呪われる
        if ((b.cloudT -= DT) <= 0 && ps.length) {
          b.cloudT = b.rage ? 7 : 10;
          for (const p of ps.slice(0, 3)) this.telegraphs.push({ id: genId(), shape: 'circle', x: p.x, y: p.y, r: 115, t: 1.1, max: 1.1, dmg: 14 * b.kind.dmg, curse: true, c: 'curse' });
          this.events.push({ k: 'gimmick', g: 'cloud' });
        }
        break;
      case 'kage': // 影: みんなの妖怪の影が出てくる
        if ((b.shadeT -= DT) <= 0) {
          b.shadeT = 24;
          for (const p of ps) if (!this.shades.some(e => e.hp > 0 && e.of === p.id)) {
            const a = Math.random() * Math.PI * 2, e = { id: genId(), isShade: true, of: p.id, yokai: p.yokai, x: b.x + Math.cos(a) * 140, y: b.y + Math.sin(a) * 140, hp: Math.round(b.maxHp * 0.06), face: 0, atkT: 2, ultT: 10 + Math.random() * 4, hitFlash: 0, stunT: 0 };
            e.maxHp = e.hp; S.collide(this.map, e, PATROL_R); this.shades.push(e);
          }
          this.events.push({ k: 'gimmick', g: 'shade' });
        }
        break;
      case 'nue': // 3つの姿: 猿（速い・炎に弱い）、虎（攻撃が速い・雷に弱い）、蛇（遠くから見えない・氷に弱い）
        if ((b.formT -= DT) <= 0) {
          const keys = Object.keys(NUE_FORMS); b.form = keys[(keys.indexOf(b.form) + 1) % keys.length]; b.formT = 15; this.applyForm(b);
          this.events.push({ k: 'gimmick', g: 'form', form: b.form });
        }
        break;
      case 'twin': { // 合体技「雷の竜巻」: 2体が近いとき
        const b2 = this.boss2;
        if (b2 && b2.hp > 0 && !(b.downT > 0) && !(b2.downT > 0) && (b.comboT -= DT) <= 0) {
          b.comboT = 14;
          if (dist(b, b2) < 520) {
            const mx = (b.x + b2.x) / 2, my = (b.y + b2.y) / 2;
            this.telegraphs.push({ id: genId(), shape: 'circle', x: mx, y: my, r: 270, t: 1.3, max: 1.3, dmg: 42 * b.kind.dmg, c: 'bolt' });
            this.events.push({ k: 'gimmick', g: 'combo' });
          }
        }
        break;
      }
      case 'kyubi':
        if ((b.decoyT -= DT) <= 0) { // 分身の術: 偽者8体。本物はどこかへ入れかわる
          b.decoyT = 18;
          this.decoys = [];
          const slots = Array.from({ length: 9 }, (_, i) => { const a = i / 9 * Math.PI * 2; return { x: b.x + Math.cos(a) * 230, y: b.y + Math.sin(a) * 230 }; });
          const real = Math.floor(Math.random() * 9);
          slots.forEach((q, i) => {
            if (i === real) { b.x = q.x; b.y = q.y; S.collide(this.map, b, BOSS_R); return; }
            const e = { id: genId(), isDecoy: true, x: q.x, y: q.y, hp: 1, maxHp: 1, face: 0, life: 14, wanderTo: null, hitFlash: 0, stunT: 0 };
            S.collide(this.map, e, BOSS_R); this.decoys.push(e);
          });
          this.events.push({ k: 'gimmick', g: 'decoy', x: Math.round(b.x), y: Math.round(b.y) });
        }
        if ((b.charmT -= DT) <= 0 && ps.length) { // 魅了: ハートの光線。当たると九尾鬼のほうへ歩いてしまう
          b.charmT = b.rage ? 8 : 11;
          const t = pick(), a = Math.atan2(t.y - b.y, t.x - b.x);
          this.telegraphs.push({ id: genId(), shape: 'rect', x: b.x, y: b.y, a, len: 640, w: 80, t: 0.9, max: 0.9, dmg: 8 * b.kind.dmg, charm: true, c: 'charm' });
        }
        if ((b.tailT -= DT) <= 0) { // 九つの属性: 光っている尾の属性は効かない
          b.tailT = 9;
          b.immune = GIMMICK_ELS[(GIMMICK_ELS.indexOf(b.immune) + 1 + Math.floor(Math.random() * 8)) % 9];
          this.events.push({ k: 'gimmick', g: 'tail', el: b.immune });
        }
        break;
      case 'toki':
        if ((b.stealT -= DT) <= 0) { // 時間を奪う
          b.stealT = 18;
          if (this.timeLeft > 40 && !this.hasPassive('chronos')) { this.timeLeft -= 10; this.events.push({ k: 'gimmick', g: 'steal' }); } // クロノスがいると時間をうばえない
        }
        if (!b.rew && (b.rewT -= DT) <= 0) { b.rew = { hp: b.hp, t: 8 }; this.events.push({ k: 'gimmick', g: 'rewindStart' }); } // 8秒後に時を戻す（それまでに大ダメージで止める）
        if (b.rew && (b.rew.t -= DT) <= 0) {
          if (this.hasPassive('chronos')) this.events.push({ k: 'gimmick', g: 'rewindFail' }); // クロノス: 巻き戻しが効かない
          else if (b.hp > b.rew.hp - b.maxHp * 0.1) { b.hp = Math.max(b.hp, b.rew.hp); this.rewound = (this.rewound || 0) + 1; this.events.push({ k: 'gimmick', g: 'rewind' }); }
          else this.events.push({ k: 'gimmick', g: 'rewindFail' });
          b.rew = null; b.rewT = 24;
        }
        if ((b.handT -= DT) <= 0) { // 時計の針: 12時→3時→6時→9時の順に
          b.handT = b.rage ? 1.4 : 1.8;
          const a = -Math.PI / 2 + (b.handI++ % 4) * Math.PI / 2;
          this.telegraphs.push({ id: genId(), shape: 'rect', x: b.x, y: b.y, a, len: 680, w: 84, t: 1.0, max: 1.0, dmg: 26 * b.kind.dmg, c: 'clock' });
        }
        break;
      case 'gasha':
        if ((b.clapT -= DT) <= 0 && ps.length) { // 手をたたく: 大きな手が2つ落ちてくる。たたいたあと5秒は弱点
          b.clapT = b.rage ? 7 : 9;
          for (const p of ps.slice(0, 2)) this.telegraphs.push({ id: genId(), shape: 'circle', x: p.x + rand(-40, 40), y: p.y + rand(-40, 40), r: 150, t: 1.3, max: 1.3, dmg: 48 * b.kind.dmg, clap: true, c: 'hand' });
          if (ps.length === 1) this.telegraphs.push({ id: genId(), shape: 'circle', x: ps[0].x + rand(-220, 220), y: ps[0].y + rand(-220, 220), r: 150, t: 1.3, max: 1.3, dmg: 48 * b.kind.dmg, clap: true, c: 'hand' });
          this.events.push({ k: 'gimmick', g: 'clap' });
        }
        break;
      case 'amanojaku':
        if ((b.revT -= DT) <= 0) { // さかさまの呪い
          b.revT = b.rage ? 11 : 14;
          for (const p of ps) if (dist(p, b) < 900 && p.passive !== 'trickster' && !this.warded(p)) p.revT = 5; // ロキ・西王母のそばの人には効かない
          this.events.push({ k: 'gimmick', g: 'reverse' });
        }
        if (b.mimic && (b.mimic.t -= DT) <= 0) { // まねっこ: さっきの必殺技を撃ち返す
          const t = this.players.get(b.mimic.id);
          if (t && !t.down && !t.escaped) {
            this.telegraphs.push({ id: genId(), shape: 'circle', x: t.x, y: t.y, r: 230, t: 1.0, max: 1.0, dmg: 55 * b.kind.dmg, c: 'mimic', tid: t.id });
            this.events.push({ k: 'gimmick', g: 'mimic', name: b.mimic.name });
          }
          b.mimic = null;
        }
        break;
    }
  }
  // 双子鬼: 片方が倒れたら、ひとりなら6秒・2人以上なら3秒以内にもう片方も倒す
  twinDown(e, src) {
    this.twinFin = this.twinFin || {}; this.twinFin[e.type] = src ? src.id : null; // イザナギ・イザナミの試練: だれがとどめをさしたか
    const other = e === this.boss ? this.boss2 : this.boss;
    if (other && other.downT > 0) {
      const main = this.boss;
      if (this.boss2) this.boss2.hp = 0;
      main.hp = 0; main.downT = 0;
      this.boss2 = null;
      this.killBoss();
      return;
    }
    e.hp = 1; e.downT = this.players.size === 1 ? 6 : 3; e.downMax = e.downT; e.state = 'wander'; e.target = null;
    this.telegraphs = this.telegraphs.filter(tg => (tg.owner || this.boss) !== e);
    this.events.push({ k: 'twinDown', x: Math.round(e.x), y: Math.round(e.y), name: e.name, t: e.downT });
  }
  killMinor(e, src) {
    e.hp = 0;
    this.events.push({ k: e.isDecoy ? 'poof' : 'oniDown', x: Math.round(e.x), y: Math.round(e.y) });
    if (e.isShade) {
      this.dropDama(e.x, e.y, 1 + Math.ceil(this.patrolDrop() / 3));
      if (src && src.id === e.of) { // 自分の影を自分で倒すとボーナス
        src.ownShade++;
        src.atkUpT = Math.max(src.atkUpT || 0, 8); this.healPlayer(src, src.maxHp * 0.3);
        this.events.push({ k: 'gimmick', g: 'ownShade', id: src.id });
      }
      this.shades = this.shades.filter(x => x !== e);
    } else this.decoys = this.decoys.filter(x => x !== e);
  }
  updateShades() {
    const b = this.boss;
    for (const e of this.shades) {
      if (e.hp <= 0) continue;
      e.hitFlash = Math.max(0, e.hitFlash - DT);
      if (e.stunT > 0) { e.stunT -= DT; continue; }
      let t = this.players.get(e.of);
      if (!t || t.down || t.escaped) t = this.activePlayers().sort((p, q) => dist(p, e) - dist(q, e))[0];
      if (!t) continue;
      const d = dist(e, t), a = Math.atan2(t.y - e.y, t.x - e.x);
      e.face = a;
      if (d > 70) { e.x += Math.cos(a) * 170 * DT; e.y += Math.sin(a) * 170 * DT; S.collide(this.map, e, PATROL_R); }
      if ((e.atkT -= DT) <= 0 && d < 110) { e.atkT = 1.7; this.telegraphs.push({ id: genId(), shape: 'circle', x: t.x, y: t.y, r: 75, t: 0.7, max: 0.7, dmg: 16 * (b ? b.kind.dmg : 2.5) }); }
      const y = S.YOKAI_BY_ID[e.yokai];
      if ((y.legend || y.god) && (e.ultT -= DT) <= 0) { // 影は同じ必殺技（の影）を使ってくる
        e.ultT = 14;
        this.telegraphs.push({ id: genId(), shape: 'circle', x: e.x, y: e.y, r: 210, t: 1.0, max: 1.0, dmg: 34 * (b ? b.kind.dmg : 2.5), c: 'shade' });
        this.events.push({ k: 'gimmick', g: 'shadeUlt', name: y.ultName });
      }
    }
  }
  updateDecoys() {
    const b = this.boss;
    for (const e of this.decoys) {
      if ((e.life -= DT) <= 0) { e.hp = 0; continue; }
      if (!e.wanderTo || dist(e, e.wanderTo) < 30) e.wanderTo = { x: (b ? b.x : e.x) + rand(-320, 320), y: (b ? b.y : e.y) + rand(-320, 320) };
      const a = Math.atan2(e.wanderTo.y - e.y, e.wanderTo.x - e.x);
      e.face = a; e.x += Math.cos(a) * 95 * DT; e.y += Math.sin(a) * 95 * DT; S.collide(this.map, e, BOSS_R);
    }
    this.decoys = this.decoys.filter(e => e.hp > 0);
  }
  // 疫病鬼の呪い: 少しずつ体力がへり、近くの仲間にうつる。回復で消える
  updateCurse(p) {
    if (!(p.curseT > 0) || p.away) return;
    p.curseT -= DT;
    if ((p.curseTick -= DT) <= 0) {
      p.curseTick = 1;
      p.hp = Math.max(1, p.hp - p.maxHp * 0.025);
      for (const q of this.activePlayers()) if (q !== p && !(q.curseT > 0) && dist(p, q) < 110) { q.curseT = 8; q.curseTick = 1; this.events.push({ k: 'curse', id: q.id }); }
    }
  }
  // 西王母: 近くの仲間は半分の確率で状態異常にかからない
  warded(p) { return this.activePlayers().some(q => q.passive === 'immortal' && dist(p, q) < 300) && Math.random() < 0.5; }
  onBossHit(p, tg) {
    if (p.down) return;
    const b = tg.owner || this.boss;
    if ((tg.charm || tg.curse || (b && b.type === 'yakubyo')) && this.warded(p)) return;
    if (tg.charm && p.passive === 'trickster') return; // ロキには魅了が効かない
    if ((tg.curse || (b && b.type === 'yakubyo')) && !(p.curseT > 0)) { p.curseT = 8; p.curseTick = 1; this.events.push({ k: 'curse', id: p.id }); }
    if (tg.charm) { p.charmT = 3; this.events.push({ k: 'charm', id: p.id }); }
  }
  hasPassive(k) { return [...this.players.values()].some(p => p.passive === k && !p.escaped); }
  bossSees(b, t) { return b.seeAll ? !t.down && !t.escaped && !t.away : this.visibleTo(t); }
  // さかさまの呪い・魅了で、入力を変えたものを使う（p.input そのものは書きかえない）
  effInput(p) {
    const inp = p.input;
    if (p.charmT > 0) {
      const b = this.bossOfType('kyubi') || this.boss;
      if (this.activePlayers().some(q => q !== p && dist(p, q) < 60)) { p.charmT = 0; this.events.push({ k: 'charmFree', id: p.id }); return inp; } // 仲間がふれると目がさめる
      if (b && b.hp > 0) { const a = Math.atan2(b.y - p.y, b.x - p.x); return { ...inp, mx: Math.cos(a), my: Math.sin(a), atk: false, strong: false, skill: false, ult: false, dash: false }; }
    }
    if (p.revT > 0) return { ...inp, mx: -inp.mx, my: -inp.my };
    return inp;
  }
  // 属性で効き方が変わるボス（combat.js の hit から呼ぶ）
  elemMul(e, el) {
    if (e.type === 'kyubi' && el && el === e.immune) return 0.1;
    if (e.type === 'nue' && e.form) return el && el === NUE_FORMS[e.form].weak ? 1.6 : 0.85;
    return 1;
  }

  // 怒ると攻撃の間隔が短くなる（鬼神は変身で技が増えるので、怒りでは速くならない）
  rageGap(b) { return (b.rage && b.type !== 'kishin' ? 0.75 : 1) * (this.uraNear(b, 320) ? 1.3 : 1) * (b.gapMul || 1); } // ウラの近くでは攻撃がおそくなる
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
    if (b.kind.gimmick) this.gimmickSpecial(b);
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
      if ((b.boltT -= DT) <= 0) { b.boltT = b.phase === 3 && b.type !== 'kishin' ? 5 : 7; this.thunderBolts(b); }
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
    if (sw.t >= sw.warn + sw.spin) { b.sweep = null; b.sweepT = b.phase === 3 && b.type !== 'kishin' ? 13 : 16; return; }
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
    for (const p of this.activePlayers()) if (dist(p, g) > g.r) { p.ringT = (p.ringT || 0) + DT; if (p.ringT >= 0.5) { p.ringT = 0; this.damagePlayer(p, this.boss && this.boss.type === 'kishin' ? 6 : 9); } }
  }

  bossAttack(t) {
    const b = this.boss;
    // 三鬼合戦: 大技の予告が同時に出るのは2体まで
    if (this.oni3 && this.oni3.filter(o => o !== b && o.hp > 0 && (o.state === 'windup' || o.state === 'charging')).length >= 2) { b.atkT = 0.6; return; }
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
    for (const tg of this.telegraphs) {
      const b = tg.owner || this.boss;
      if (b && b.stunT > 0) continue; // しびれている間は止まる
      if (tg.follow && b) { tg.x = b.x; tg.y = b.y; }
      if (tg.track && tg.t > 0.6) { const tp = this.players.get(tg.track); if (tp && !tp.down && !tp.escaped) { tg.x = tp.x; tg.y = tp.y; } } // 合体技の「裁き」: 予告が決まるまで、その人を追う
      tg.t -= DT * (this.activePlayers().some(q => q.passive === 'chronos' && dist(q, tg) < 320) ? 0.77 : 1); // クロノス: 未来視（予告が長い）
      if (tg.t > 0) continue;
      if (tg.then === 'charge') { if (b && b.hp > 0) { b.state = 'charging'; b.stateT = 0.85; } continue; }
      if (tg.clap && b && b.hp > 0 && !(b.weakT > 0)) { b.weakT = 5; this.events.push({ k: 'weak' }); } // がしゃどくろ王: 手をたたいたあとは弱点
      if (tg.tid) { const t = this.players.get(tg.tid); if (t && !t.down && !t.escaped && !(dist(t, tg) <= tg.r)) t.mimicDodge++; } // ロキの試練: まねっこをよけた
      for (const p of this.activePlayers()) {
        const hit = tg.shape === 'rect' ? inRect(p, tg, tg.a, tg.len, tg.w) : dist(p, tg) <= tg.r;
        if (!hit) continue;
        if (tg.knock && p.passive === 'seaking') { this.damagePlayer(p, tg.dmg); this.onBossHit(p, tg); continue; } // ポセイドン: 吹き飛ばされない
        this.damagePlayer(p, tg.dmg);
        this.onBossHit(p, tg);
        if (tg.eff && !p.down) this.applyEff(p, tg.eff);
        if (tg.knock && !p.down) { // 突風: 向きにそって吹き飛ばす
          const a = tg.shape === 'rect' ? tg.a : Math.atan2(p.y - tg.y, p.x - tg.x);
          p.x += Math.cos(a) * tg.knock; p.y += Math.sin(a) * tg.knock;
          S.collide(this.map, p, PLAYER_R);
        }
      }
      if (tg.hz) this.hazards.push({ k: tg.hz, x: tg.x + (tg.shape === 'rect' ? Math.cos(tg.a) * tg.len / 2 : 0), y: tg.y + (tg.shape === 'rect' ? Math.sin(tg.a) * tg.len / 2 : 0), r: tg.shape === 'rect' ? Math.min(160, tg.w * 1.2) : tg.r * 0.9, t: 5, dps: 12 * (b ? b.kind.dmg : 3) });
      this.events.push({ k: tg.bolt || tg.c === 'bolt' ? 'bolt' : tg.knock > 0 ? 'gust' : 'boom', x: Math.round(tg.x), y: Math.round(tg.y), r: tg.r, a: tg.a, c: tg.combo ? tg.c : undefined });
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
    for (const k of ['atkT', 'strongT', 'skillT', 'shieldT', 'invulT', 'staminaT', 'invisT', 'atkUpT', 'spdUpT', 'dragonT', 'raT', 'revT', 'charmT', 'critT', 'skyT', 'regenT', 'bondT', 'slowT', 'frozenT', 'darkT']) p[k] = Math.max(0, (p[k] || 0) - DT);
    if (p.down || p.escaped) return;
    this.updateCurse(p);
    p.inDark = this.allBosses().some(b => b.type === 'nue' || b.bliz > 0) || p.critT > 0 || p.darkT > 0; // ツクヨミ: 暗い場所
    if (p.regenT > 0) this.healPlayer(p, p.maxHp * 0.04 * DT); // 西王母の不老の桃
    if (p.ch && p.ch.regen > 0) { p.hp = Math.min(p.maxHp, p.hp + p.maxHp * p.ch.regen * DT); } // お守り: 自然回復（呪いは消えない）
    if (p.passive === 'kuniumi' || p.passive === 'yomi') { // 夫婦の絆: イザナギとイザナミが近くにいる
      const mate = this.activePlayers().find(q => q !== p && (q.passive === (p.passive === 'kuniumi' ? 'yomi' : 'kuniumi')) && dist(p, q) < 400);
      if (mate) { p.bondT = 0.5; p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.01 * DT); }
    }
    if (p.passive === 'sunAura' && (p.auraT -= DT) <= 0) { // ラー: まわりの仲間が少しずつ回復
      p.auraT = 1;
      for (const q of this.activePlayers()) if (dist(p, q) < 320) { this.healPlayer(q, q.maxHp * 0.015); q.raT = 1.3; } // ＋太陽の光: 攻撃力 +15%
    }
    if (p.passive === 'fury' && (p.eyeT = (p.eyeT || 0) - DT) <= 0) { // シヴァの第三の目: 8秒ごとに、近くの仲間が次の大きな攻撃を1回防ぐ
      p.eyeT = 8;
      for (const q of this.activePlayers()) if (dist(p, q) < 280 && !q.eye) { q.eye = true; this.events.push({ k: 'ring', x: Math.round(q.x), y: Math.round(q.y), r: 60, c: '#c8a0ff' }); }
    }
    const inp = this.effInput(p); // さかさまの呪い・魅了で入力が変わる

    // ダッシュ（押している間）とスタミナ
    const moving = Math.hypot(inp.mx, inp.my) > 0.15;
    let dashing = false;
    if (inp.dash && moving && p.staminaT > 0) dashing = true;
    else if (inp.dash && moving && !p.exhausted && p.stamina > 0) {
      dashing = true;
      if (p.passive !== 'stamina') p.stamina = Math.max(0, p.stamina - 35 * DT); // ソンゴクウ（きんと雲）はスタミナが減らない
      if (p.stamina <= 0) p.exhausted = true;
    }
    if (!dashing) {
      p.stamina = Math.min(STAMINA_MAX, p.stamina + 22 * DT);
      if (p.exhausted && p.stamina >= 30) p.exhausted = false;
    }
    p.dashing = dashing;
    // 空を飛んで建物を越えられる: ソンゴクウ（きんと雲）とジャージーデビルのダッシュ中、メリュジーヌの竜の姿
    const wasFly = p.fly;
    p.fly = (dashing && (p.passive === 'stamina' || p.passive === 'nightDash' || p.passive === 'shock')) || p.dragonT > 0; // ＋ゼウスの雷雲

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
      const spd = st.speed * (dashing ? DASH_MUL : 1) * (p.spdUpT > 0 ? 1.15 : 1) * (p.frozenT > 0 ? 0 : p.slowT > 0 ? 0.55 : 1); // 合体技: こおる・遅くなる
      p.x += mx * spd * DT; p.y += my * spd * DT;
      if (m > 0.15) p.face = Math.atan2(my, mx);
    }
    if (p.fly) { p.x = clamp(p.x, PLAYER_R, this.map.w - PLAYER_R); p.y = clamp(p.y, PLAYER_R, this.map.h - PLAYER_R); }
    else S.collide(this.map, p, PLAYER_R); // 建物の上でおりたら、いちばん近い道へ
    if (wasFly && !p.fly) p.invulT = Math.max(p.invulT, 0.3);

    const at = A.of(p.yokai);
    const target = this.nearestEnemy(p, A.NORMAL[at.normal].range + 150);
    const aim = target ? Math.atan2(target.y - p.y, target.x - p.x) : p.face;
    // 通常攻撃・強攻撃・スキル（中身は combat.js）
    const busy = p.leap || p.dashT > 0;
    if (inp.atk && p.atkT <= 0 && !busy) Combat.normal(this, p, aim, target);
    if (inp.strong && p.strongT <= 0 && !busy) Combat.strong(this, p, aim, target);
    if (inp.skill && p.skillT <= 0 && !p.leap) Combat.skill(this, p, aim);
    if (p.legend) {
      if (!(this.time < p.ultBusyUntil)) p.ult = Math.min(Combat.ULT_MAX, p.ult + (st.name === 'ヒーラー' ? 2.4 : 1.0) * DT * (p.ultBoost || 1) * (this.ultGainTeam || 1)); // 時間でも少しずつたまる（ヒーラーは多め）
      if (inp.ult && p.ult >= Combat.ULT_MAX && !busy) {
        Combat.ultimate(this, p, aim);
        const bb = this.bossOfType('amanojaku') || this.boss; // 天邪鬼: 必殺技をまねして撃ち返してくる
        if (bb && bb.hp > 0 && bb.type === 'amanojaku' && !bb.mimic) bb.mimic = { t: 2.5, id: p.id, name: S.YOKAI_BY_ID[p.yokai].ultName };
      }
    }

    // アイテム（押した瞬間に使う）
    if (inp.item && !p.prevItem && p.item) this.useItem(p, aim);
    p.prevItem = inp.item;

    // 拾う（ガネーシャは幸運の神: まわりの鬼玉を遠くから引きよせて拾う）
    const reach = 32; // ガネーシャも拾える範囲はみんなと同じ（必殺技でマップ中の鬼玉を集める）
    for (const d of this.dama) {
      if (!d.taken && Math.hypot(d.x - p.x, d.y - p.y) < reach) {
        d.taken = true;
        { const mul = (this.luckTeam ? 1.2 : 1) * (p.ch ? 1 + p.ch.orb : 1); p.orbFrac += d.v * mul; const n = Math.floor(p.orbFrac); p.orbFrac -= n; p.dama += n; } // ガネーシャ（幸運の神）・お守り（鬼玉）
        if (p.passive === 'orbHeal') this.healPlayer(p, 3 * Math.min(d.v, 8)); // クルピラ: 鬼玉で少し回復（1個3・どデカい鬼玉24まで）
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
      case 'punch': this.shoot(p, aim, 620, 500, 0.8, 26, '#9ab0c8', { punch: true }); break;
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
      for (const b of this.allBosses()) if (tr.life > 0 && b.stunT <= 0 && dist(tr, b) < BOSS_R + 20) {
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
      this.hitEnemiesInCircle(owner, bm.x, bm.y, 170, 1000);
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
      const auto = p.autoRevT > 0 && (p.autoRevT -= DT) <= 0; // ジョカの石で起きる
      const helpers = this.activePlayers().filter(q => q !== p && dist(p, q) < REVIVE_RANGE);
      const helper = helpers.length > 0;
      if (helper) p.reviveProg += DT * (helpers.some(q => q.passive === 'reviver') ? 2 : 1); // メリュジーヌ: 起こす速さ2倍
      else p.reviveProg = Math.max(0, p.reviveProg - DT * 0.5);
      if (auto || p.reviveProg >= REVIVE_TIME) {
        p.down = false; p.hp = p.maxHp * 0.4; p.reviveProg = 0; p.invulT = 2;
        if (this.activePlayers().some(q => q.passive === 'reviver' && dist(p, q) < REVIVE_RANGE * 1.5)) { p.invulT = 5; p.atkUpT = Math.max(p.atkUpT || 0, 5); } // メリュジーヌの加護: 5秒無敵＋攻撃アップ
        for (const q of this.activePlayers()) if (q !== p && dist(p, q) < REVIVE_RANGE) q.revives++; // 起こした人に記録
        for (const q of this.activePlayers()) if (q.passive === 'underlord') this.healPlayer(q, q.maxHp * 0.2); // ハデス: 魂の帰還
        this.events.push({ k: 'revive', id: p.id });
      }
    }
  }

  otherBosses() { return this.oni3 ? this.oni3.filter(b => b !== this.boss && b.hp > 0) : this.boss2 && this.boss2.hp > 0 ? [this.boss2] : []; }
  // 三鬼合戦では、その種類のボスを this.boss にして呼ぶ（影・偽者・裁きは、その鬼のもの）
  withBoss(type, fn) {
    const b = this.oni3 && this.bossOfType(type);
    if (!b || b === this.boss) return fn();
    const main = this.boss; this.boss = b; try { fn(); } finally { this.boss = main; }
  }
  // 合体技のあとに残る毒の沼・氷の床・地獄の炎
  updateHazards() {
    for (const h of this.hazards) {
      h.t -= DT; h.tick = (h.tick || 0) - DT;
      if (h.tick > 0) continue;
      h.tick = 0.5;
      for (const p of this.activePlayers()) {
        if (dist(p, h) > h.r) continue;
        if (h.k === 'ice') p.slowT = Math.max(p.slowT || 0, 1);
        else this.damagePlayer(p, h.dps * 0.5);
      }
    }
    this.hazards = this.hazards.filter(h => h.t > 0);
  }
  // 合体技の効果: slow=遅くなる freeze=こおる shock=しびれる rev=さかさま charm=魅了 curse=呪い dark=暗やみ drain=必殺技ゲージが減る
  applyEff(p, eff) {
    for (const e of eff) {
      if (e === 'slow') p.slowT = Math.max(p.slowT || 0, 3.5);
      else if (e === 'freeze') p.frozenT = Math.max(p.frozenT || 0, 1.3);
      else if (e === 'shock') p.frozenT = Math.max(p.frozenT || 0, 0.7);
      else if (e === 'dark') p.darkT = Math.max(p.darkT || 0, 6);
      else if (e === 'drain') { if (p.legend) p.ult = Math.max(0, p.ult - 25); }
      else if (this.warded(p)) continue;
      else if (e === 'rev') { p.revT = Math.max(p.revT || 0, 4); this.events.push({ k: 'rev', id: p.id }); }
      else if (e === 'charm' && p.passive !== 'trickster') { p.charmT = 3; this.events.push({ k: 'charm', id: p.id }); }
      else if (e === 'curse' && !(p.curseT > 0)) { p.curseT = 8; p.curseTick = 1; this.events.push({ k: 'curse', id: p.id }); }
    }
  }

  tick() {
    if (this.state !== 'battle') return;
    if (this.introT > 0) { this.introT -= DT; return; }
    this.time += DT;
    this.timeLeft -= DT;
    if (this.revealT > 0) this.revealT -= DT;
    if (this.timeStopT > 0) this.timeStopT -= DT;
    if (DEMO_AI) for (const p of this.players.values()) this.demoInput(p);
    for (const p of this.players.values()) this.updatePlayer(p);
    this.updateRevive();
    this.updatePatrols();
    this.updateDrop();
    { const n0 = this.telegraphs.length; this.updateBoss(); if (this.oni3) for (let i = n0; i < this.telegraphs.length; i++) this.telegraphs[i].owner = this.telegraphs[i].owner || this.boss; }
    // 双子鬼のもう片方・三鬼合戦のほかの2体も同じように動かす（ボスの処理は this.boss を見るので、入れかえて呼ぶ）
    for (const ob of this.otherBosses()) {
      const main = this.boss, n0 = this.telegraphs.length;
      this.boss = ob; this.updateBoss(); this.boss = main;
      for (let i = n0; i < this.telegraphs.length; i++) this.telegraphs[i].owner = this.telegraphs[i].owner || ob;
    }
    if (this.oni3) Sanki.update(this, DT);
    this.withBoss('kage', () => this.updateShades());
    this.withBoss('kyubi', () => this.updateDecoys());
    this.withBoss('gokuou', () => this.updateJudges());
    this.updateHazards();
    this.updateTelegraphs();
    this.updateRing();
    this.updateItemsOnField();
    Combat.updateProjectiles(this);
    Combat.updateEffects(this);
    // 全員が脱出 or 倒れた、または時間切れで終了
    const remaining = [...this.players.values()].filter(p => !p.escaped && (!p.down || p.autoRevT > 0)); // イザナミ・ジョカの石で起きる人がいれば、まだ終わらない
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
      gacha: rollGacha((p.escaped ? team : team / 2) + (this.luckTeam ? 150 : 0)), // ガネーシャ: 富の神（1つ上の色が出やすい）
      // レジェンドの封印の欠片と試練（封印の地でボスを倒したとき）
      god: this.godResult(p),
      seal: S.sealDrop({ stage: this.stage, boss: this.mainType, bossDown: this.mainDown, seen: p.atKill ? p.atKill.seen : true, anyDown: this.anyDownAtKill, blizKill: this.blizKill, dama: p.atKill ? p.atKill.dama : 0 }),
    }));
    const bn = this.bonusBoss, sh = this.shinBoss;
    this.lastResult = { t: 'result', players, team, luck: this.luckTeam || undefined, sanki: this.oni3 ? { all: this.sankiAll, types: this.oni3.map(b => b.type), down: this.oni3.filter(b => b.hp <= 0).length } : undefined, boss: this.mainType, bossDown: this.mainDown, bonus: bn ? { type: bn.type, down: bn.hp <= 0 } : undefined, shin: sh ? { down: sh.hp <= 0 } : undefined };
    this.broadcast(this.lastResult);
    for (const p of this.players.values()) { p.missedResult = !!p.away; p.viewed = false; } // 通信が切れていた人には、つなぎ直したときに送る。viewed: ガチャを引き終わって結果を見たか
    this.broadcast(this.lobbyInfo());
    this.watchers.clear(); // 観戦はここまで（観戦していた人は結果を見てホームへ）
    this.recordRanking(players);
  }

  // 神の欠片と神の試練（隠しボスを倒したときだけ。持っているかどうかは各自の端末で判定する）
  godResult(p) {
    const main = this.mainDown && (this.mainType === 'gokuou' || this.mainType === 'hyakki');
    const shin = this.shinBoss && this.shinBoss.hp <= 0;
    const gim = this.mainDown && S.BOSSES[this.mainType].gimmick; // 鬼神のあとの8体からも欠片が出る
    let frag = 0;
    if (main) frag += this.anyDownAtKill ? 1 : 2;
    if (shin) frag += this.shinClean ? 2 : 1;
    if (gim) frag += this.anyDownAtKill ? 1 : 2;
    const ps = [...this.players.values()], trials = [], t = this.mainType, won = this.mainDown;
    if (main || shin) {
      if (shin && p.shinDowns != null && p.shinDowns === (p.downs || 0) && !p.down) trials.push('onigami'); // 鬼神・真との戦いで自分が一度も倒れなかった
      if (won && t === 'gokuou' && this.bossKillT != null && this.bossKillT <= 240) trials.push('zeus');
      if (won && t === 'hyakki' && ps.length === 1) trials.push('odin');
      if (p.yokai === 'nurarihyon' || p.yokai === 'melusine') trials.push('ra');
      if (p.revives >= 3) trials.push('joka'); // 倒れた仲間を3回起こした
      if (won && t === 'gokuou' && !p.judgeHits) trials.push('shiva');
    }
    // 追加の10柱（相手は鬼神のあとの8体）
    if (won && t === 'nue' && !this.anyDownAtKill) trials.push('tsukuyomi');
    if (won && t === 'amanojaku' && !p.downs) trials.push('loki'); // 天邪鬼の戦いで一度も倒れなかった
    if (won && t === 'kage' && p.ownShade > 0) trials.push('hades');
    if (won && t === 'yakubyo' && this.curseCleared >= 5) trials.push('seioubo');
    if (won && t === 'kyubi' && p.decoyHits <= 5) trials.push('horus'); // 偽者を5体までしか攻撃せずに
    if (won && t === 'toki' && !this.rewound) trials.push('kronos');
    if (won && t === 'gasha' && this.mainBoss && p.weakDmg >= this.mainBoss.maxHp * 0.1) trials.push('poseidon');
    if (p.escaped && ps.reduce((a, q) => a + q.dama, 0) >= 700) trials.push('ganesha');
    const tf = this.twinFin || {};
    if (won && t === 'twin' && tf.twin === p.id && tf.twin2 && tf.twin2 !== p.id) trials.push('izanagi');
    if (won && t === 'twin' && tf.twin2 === p.id && tf.twin && tf.twin !== p.id) trials.push('izanami');
    if (!frag && !trials.length) return undefined;
    return { frag, trials };
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
        skCd: +(p.skillT / A.SKILL[S.YOKAI_BY_ID[p.yokai].role].cd).toFixed(2), au: p.atkUpT > 0, su: p.spdUpT > 0, ult: p.legend ? Math.floor(p.ult) : -1, jd: p.judge ? { k: p.judge.k, t: Math.ceil(p.judge.t), w: p.judge.warn > 0 || undefined } : undefined, nyoi: p.nyoiA != null ? +p.nyoiA.toFixed(2) : undefined, nk: p.nyoi && p.nyoi.sweep ? 1 : undefined, jump: p.fly ? 0.5 : +(p.jump || 0).toFixed(2), fly: p.fly || undefined, rev: p.revT > 0 || undefined, charm: p.charmT > 0 || undefined, curse: p.curseT > 0 || undefined, crit: p.critT > 0 || undefined, dodge: !!p.dodge, sl: p.slowT > 0 || undefined, fz: p.frozenT > 0 || undefined, dk: p.darkT > 0 || undefined,
      })),
      patrols: this.patrols.filter(e => e.hp > 0).map(e => ({ id: e.id, x: Math.round(e.x), y: Math.round(e.y), face: +e.face.toFixed(2), alert: e.state === 'alert', target: e.target, hp: Math.round(e.hp), maxHp: e.maxHp, flash: e.hitFlash > 0 })),
      boss: b && b.hp > 0 ? this.bossSnap(b) : null,
      boss2: this.boss2 && this.boss2.hp > 0 ? this.bossSnap(this.boss2) : undefined,
      ex: this.oni3 ? this.otherBosses().map(o => this.bossSnap(o)) : undefined, // 三鬼合戦のほかの鬼
      hz: this.hazards.length ? this.hazards.map(h => ({ k: h.k, x: Math.round(h.x), y: Math.round(h.y), r: Math.round(h.r), t: +h.t.toFixed(1) })) : undefined,
      reveal: this.revealT > 0 || undefined, tstop: this.timeStopT > 0 || undefined, falcon: this.hasPassive('falcon') || undefined, orbMap: this.luckTeam || undefined,
      shades: this.shades.length ? this.shades.filter(e => e.hp > 0).map(e => ({ id: e.id, x: Math.round(e.x), y: Math.round(e.y), yokai: e.yokai, of: e.of, hp: Math.round(e.hp), maxHp: e.maxHp, flash: e.hitFlash > 0 || undefined })) : undefined,
      decoys: this.decoys.length ? this.decoys.map(e => ({ id: e.id, x: Math.round(e.x), y: Math.round(e.y), face: +e.face.toFixed(2) })) : undefined,
      ring: this.ring ? { x: Math.round(this.ring.x), y: Math.round(this.ring.y), r: Math.round(this.ring.r) } : null,
      items: this.items.map(it => ({ id: it.id, x: Math.round(it.x), y: Math.round(it.y), type: it.type })),
      traps: this.traps.map(t => ({ id: t.id, x: Math.round(t.x), y: Math.round(t.y) })),
      bombs: this.bombs.map(bm => ({ id: bm.id, x: Math.round(bm.x), y: Math.round(bm.y), t: +bm.t.toFixed(1) })),
      proj: this.projectiles.map(pr => ({ id: pr.id, x: Math.round(pr.x), y: Math.round(pr.y), r: pr.r, c: pr.c, punch: pr.punch, spin: pr.spin, lob: pr.lob, bomb: pr.bomb, a: +Math.atan2(pr.vy, pr.vx).toFixed(2) })),
      turrets: this.turrets.map(t => ({ id: t.id, x: Math.round(t.x), y: Math.round(t.y), c: t.c, clone: t.clone, mn: t.minion ? 1 : undefined })),
      tele: this.telegraphs.map(tg => ({ id: tg.id, shape: tg.shape, x: Math.round(tg.x), y: Math.round(tg.y), r: tg.r, a: tg.a, len: tg.len, w: tg.w, c: tg.c, p: +(1 - tg.t / tg.max).toFixed(2) })),
      zones: this.zones.map(z => ({ id: z.id, x: Math.round(z.x), y: Math.round(z.y), r: z.r, kind: z.kind || 'heal', c: z.c, shape: z.shape, life: +z.life.toFixed(1) })),
      ev: this.events,
    };
    this.events = [];
    return snap;
  }
}

// ---------- WebSocket ----------
// バトル中の様子（1秒に15回）は圧縮して送る（通信量が約1/4になる）
const wss = new WebSocketServer({ server, perMessageDeflate: process.env.NO_DEFLATE ? false : { zlibDeflateOptions: { level: 3, memLevel: 7 }, threshold: 256, concurrencyLimit: 4 } });

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

// 圧縮が使えているかの確認用（/wsstats）: 起動してからつながった数
const wsStats = { deflate: 0, plain: 0 };
const clientErrs = [];
wss.on('connection', ws => {
  if (/permessage-deflate/.test(ws.extensions || '')) wsStats.deflate++; else wsStats.plain++;
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
    if (msg && msg.zip) ws.zip = true; // この人はゲーム側の圧縮（deflate-raw）を読める

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
        p.ws = ws; p.away = null; p.invulT = Math.max(p.invulT || 0, 2); // つなぎ直した直後は2秒無敵
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
        me = room.addPlayer(ws, msg.name, msg.yokai, pid, msg.totsu, msg.title, msg.lv, msg.ch, msg.cs);
        send({ t: 'welcome', id: me.id });
        room.broadcast(room.lobbyInfo());
        break;
      }
      case 'yokai':
        if (room && me && room.state === 'lobby' && usableYokai(msg.id)) { me.yokai = msg.id; me.totsu = cleanTotsu(msg.totsu); me.lv = cleanLv(msg.lv); me.charm = cleanCharm(msg.ch); me.charmList = cleanCharmList(msg.cs); me.title = cleanTitle(msg.title); room.broadcast(room.lobbyInfo()); }
        break;
      case 'boss':
        if (room && me && me.host && room.state === 'lobby' && S.BOSSES[msg.type] && !S.BOSSES[msg.type].secret) { room.bossSel = msg.type; room.challengeOn = false; room.broadcast(room.lobbyInfo()); }
        break;
      case 'challenge':
        if (room && me && me.host && room.state === 'lobby') { room.challengeOn = !!msg.on && S.themeOf(S.weekIndex()).key === 'challenge'; room.broadcast(room.lobbyInfo()); }
        break;
      case 'start':
        if (room && me && me.host && room.state === 'lobby' && !draining) {
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
      case 'viewed': // ガチャ（経験値・お守り）を選び終わって結果を見た
        if (room && me && room.state === 'result' && !me.viewed) { me.viewed = true; room.broadcast(room.lobbyInfo()); }
        break;
      case 'toLobby': // みんながガチャを引き終わるまでロビーにはもどれない（通信が切れている人は待たない）
        if (room && me && me.host && room.state === 'result' && ![...room.players.values()].some(p => !p.viewed && !p.away)) { room.state = 'lobby'; room.broadcast(room.lobbyInfo()); }
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
// プロフィール: f=持っている妖怪の数（1けた×176）、s=[遊んだ回数, 脱出, 最高鬼玉, 集めた鬼玉]、c=倒したボス、tc=称号の数、wt=限定称号
function cleanProfile(p) {
  if (!p || typeof p !== 'object') return null;
  const n = v => Math.max(0, Math.min(1e7, Math.floor(+v || 0)));
  return {
    f: typeof p.f === 'string' && /^[0-9]{0,400}$/.test(p.f) ? p.f : '',
    s: Array.isArray(p.s) ? p.s.slice(0, 4).map(n) : [],
    c: n(p.c) & 131071, tc: n(p.tc), lv: typeof p.lv === 'string' && /^[0-9a-z]{0,400}$/.test(p.lv) ? p.lv : '', fv: S.YOKAI_BY_ID[p.fv] ? p.fv : null, wt: Array.isArray(p.wt) ? p.wt.filter(t => S.weeklyTitle(t)).slice(0, 50) : [],
  };
}
const cleanTotsu = v => Math.max(0, Math.min(S.TOTSU_MAX, v | 0));
const cleanLv = v => Math.max(1, Math.min(S.LV_MAX, v | 0));
// ルームの仲間に見せるお守り（[レア度, スキル, 強さ, スキル, 強さ]、2つまで）
function cleanCharmList(cs) {
  if (!Array.isArray(cs)) return [];
  return cs.slice(0, 2).map(a => Array.isArray(a) ? [Math.max(0, Math.min(4, a[0] | 0)), ...[[a[1], a[2]], [a[3], a[4]]].filter(([k]) => S.CHARM_SKILLS[k]).flatMap(([k, lv]) => [k, Math.max(1, Math.min(5, lv | 0))])] : null).filter(a => a && a.length > 1);
}
// お守りの効果（スマホで計算したもの）は、上限をこえないようにして使う
function cleanCharm(ch) {
  const out = { drain: 0, regen: 0, guard: 0, hp: 0, atk: 0, haste: 0, ult: 0, guts: 0, orb: 0 };
  if (ch && typeof ch === 'object') for (const k of Object.keys(out)) { const n = +ch[k]; if (n > 0) out[k] = Math.min(S.CHARM_SKILLS[k].max * 2, n); } // 神は2つつけられるので上限の2倍まで
  return out;
}
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
// フレンド一覧は3秒ごとに確かめるが、変わったときだけ送る（変わらなくても1分に1回は送って「◯分前」を新しくする）
function sendFriends(ws, list = friendList(), force = true) {
  const me = presence.get(ws);
  if (ws.readyState !== 1) return;
  const mine = list.filter(f => f.pid !== me), key = JSON.stringify(mine), now = Date.now();
  if (!force && key === ws.lastFriends && now - (ws.lastFriendsT || 0) < 60000) return;
  ws.lastFriends = key; ws.lastFriendsT = now;
  ws.send(JSON.stringify({ t: 'friends', list: mine, now }));
}
setInterval(() => {
  if (!presence.size) return;
  const list = friendList();
  for (const ws of presence.keys()) sendFriends(ws, list, false);
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
