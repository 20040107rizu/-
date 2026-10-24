// サーバーとクライアントで共有するデータとマップ処理
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- ランク ----------
  const RANKS = {
    C: { mul: 1.0,  color: '#5be07a' },
    B: { mul: 1.25, color: '#4a8bff' },
    A: { mul: 1.55, color: '#ff4a4a' },
    S: { mul: 2.0,  color: '#ffd84a' },
    L: { mul: 2.4,  color: '#ff7ae8' }, // レジェンド
  };

  // ---------- ロール（タイプ） ----------
  // atk: 通常攻撃、strong: 強攻撃（クールダウンつき）
  const ROLES = {
    fighter: { name: 'ファイター', hp: 120, speed: 220, atkDmg: 14, atkRange: 80,  atkCd: 0.35, strongCd: 5, strong: 'ダッシュ斬り' },
    tank:    { name: 'タンク',     hp: 200, speed: 200, atkDmg: 9,  atkRange: 75,  atkCd: 0.5,  strongCd: 7, strong: 'じしん' },
    healer:  { name: 'ヒーラー',   hp: 100, speed: 215, atkDmg: 7,  atkRange: 420, atkCd: 0.5,  strongCd: 8, strong: '回復エリア' },
    ranger:  { name: 'レンジャー', hp: 90,  speed: 225, atkDmg: 10, atkRange: 520, atkCd: 0.3,  strongCd: 5, strong: '3連ショット' },
  };

  // ---------- 妖怪（お友達）: public/yokai.js ----------
  const YOKAI = typeof module === 'object' && module.exports ? require('./yokai.js') : self.YokaiList;
  const LEGENDS = YOKAI.LEGENDS || [];
  // 名前や強さを引くときはレジェンドも含める（一覧・ガチャ・図鑑の数は YOKAI だけ）
  const YOKAI_BY_ID = Object.fromEntries(YOKAI.concat(LEGENDS).map(y => [y.id, y]));

  // 妖怪の実ステータス（ロール基本値 × ランク倍率）
  // 凸: 同じ妖怪がガチャでかぶるたびに1つ上がり、HPと攻撃が少しだけ上がる
  const TOTSU_MAX = 5, TOTSU_STEP = 0.03;
  const totsuOf = count => Math.max(0, Math.min(TOTSU_MAX, (count | 0) - 1));
  function yokaiStats(id, totsu = 0) {
    const y = YOKAI_BY_ID[id] || YOKAI[0];
    const r = ROLES[y.role];
    const m = RANKS[y.rank].mul;
    const k = 1 + TOTSU_STEP * Math.max(0, Math.min(TOTSU_MAX, totsu | 0));
    return { ...r, hp: Math.round(r.hp * m * k), atkDmg: r.atkDmg * m * k, strongMul: m * k, speed: r.speed + (m - 1) * 20 };
  }

  // ---------- 称号（図鑑のコンプリート報酬） ----------
  const REGION = {
    japan: ['日本', '沖縄'],
    asia: ['中国', '韓国', 'インド', 'フィリピン', 'ヒマラヤ'],
    europe: ['イギリス', 'ヨーロッパ', 'スコットランド', 'アイルランド', 'ドイツ', 'スペイン', 'ルーマニア', 'ギリシャ', 'ノルウェー', '北欧', 'フランス', '中欧', 'ロシア'],
  };
  const regionOf = y => Object.keys(REGION).find(k => REGION[k].includes(y.origin)) || 'world';
  // need(list) → その妖怪たちを全部集めたら。count → 種類数
  const TITLES = [
    { id: 'n10',    name: '妖怪となかよし',     color: '#9ae0ff', count: 10,  desc: 'お友達を10体集める' },
    { id: 'n30',    name: '妖怪ハンター',       color: '#7be07b', count: 30,  desc: 'お友達を30体集める' },
    { id: 'n50',    name: '妖怪博士',           color: '#5aa7ff', count: 50,  desc: 'お友達を50体集める' },
    { id: 'n100',   name: '妖怪大将',           color: '#ff8a5a', count: 100, desc: 'お友達を100体集める' },
    { id: 'rC',     name: 'Cランク制覇',        color: '#7be07b', of: y => y.rank === 'C', desc: 'Cランクを全部集める' },
    { id: 'rB',     name: 'Bランク制覇',        color: '#5aa7ff', of: y => y.rank === 'B', desc: 'Bランクを全部集める' },
    { id: 'rA',     name: 'Aランク制覇',        color: '#ff6a6a', of: y => y.rank === 'A', desc: 'Aランクを全部集める' },
    { id: 'rS',     name: 'Sランク制覇',        color: '#ffd23a', of: y => y.rank === 'S', desc: 'Sランクを全部集める' },
    { id: 's10',    name: '伝説を従えし者',     color: '#ffd23a', of: y => y.rank === 'S', count: 10, desc: 'Sランクを10体集める' },
    { id: 'fighter', name: '百戦錬磨',          color: '#ff8a5a', of: y => y.role === 'fighter', desc: 'ファイターを全部集める' },
    { id: 'tank',   name: '鉄壁の守り手',       color: '#9ab0c8', of: y => y.role === 'tank', desc: 'タンクを全部集める' },
    { id: 'healer', name: '癒しの使い手',       color: '#7af0b0', of: y => y.role === 'healer', desc: 'ヒーラーを全部集める' },
    { id: 'ranger', name: '百発百中',           color: '#c8a0ff', of: y => y.role === 'ranger', desc: 'レンジャーを全部集める' },
    { id: 'japan',  name: '日本妖怪コンプ',     color: '#ff6a8a', of: y => regionOf(y) === 'japan', desc: '日本（沖縄も）の妖怪を全部集める' },
    { id: 'asia',   name: 'アジア妖怪コンプ',   color: '#ffb84a', of: y => regionOf(y) === 'asia', desc: '中国・韓国・インドなどの妖怪を全部集める' },
    { id: 'europe', name: 'ヨーロッパ妖怪コンプ', color: '#8ab8ff', of: y => regionOf(y) === 'europe', desc: 'ヨーロッパの妖怪を全部集める' },
    { id: 'world',  name: '世界の妖怪コンプ',   color: '#5ad8c8', of: y => regionOf(y) === 'world', desc: 'アフリカ・アメリカ・中東などの妖怪を全部集める' },
    { id: 'totsu',  name: '限界突破',           color: '#ff5ad8', totsu: true, desc: 'どれか1体を凸5（凸MAX）にする' },
    { id: 'all',    name: '妖怪マスター',       color: 'gold', count: 'all', desc: '170体ぜんぶ集める（名前が金色になる）' },
  ];
  const TITLE_BY_ID = Object.fromEntries(TITLES.map(t => [t.id, t]));
  // friends: { id: 持っている数 } → [{ title, got, need, done }]
  function titleProgress(friends) {
    return TITLES.map(t => {
      if (t.totsu) { const best = Math.max(0, ...YOKAI.map(y => totsuOf(friends[y.id] || 0))); return { title: t, got: best, need: TOTSU_MAX, done: best >= TOTSU_MAX }; }
      const pool = t.of ? YOKAI.filter(t.of) : YOKAI;
      const got = pool.filter(y => friends[y.id]).length;
      const need = t.count === 'all' ? YOKAI.length : t.count || pool.length;
      return { title: t, got: Math.min(got, need), need, done: got >= need };
    });
  }


  // ---------- ガチャ玉 ----------
  // 集めた鬼玉が多いほど良い色が出やすくなる（必ず出るわけではない）
  const BALLS = [
    { key: 'green', name: '緑', color: '#4fd16a', ranks: [['C', 1]] },
    { key: 'blue',  name: '青', color: '#3f7cff', ranks: [['B', 1]] },
    { key: 'red',   name: '赤', color: '#ff3b3b', ranks: [['A', 1]] },
    { key: 'gold',  name: '金', color: '#ffcc33', ranks: [['A', 0.6], ['S', 0.4]] },
    { key: 'black', name: '黒', color: '#1a1a1a', ranks: [['S', 1]] },
  ];
  // [この数以上, 緑, 青, 赤, 金, 黒 の出やすさ]
  const BALL_ODDS = [
    [0,   80, 17,  3,  0,  0],
    [50,  30, 55, 12,  3,  0],
    [100, 12, 45, 33,  9,  1],
    [150,  4, 22, 50, 19,  5],
    [200,  0, 15, 30, 33, 22],
  ];
  function ballOdds(count) {
    let row = BALL_ODDS[0];
    for (const r of BALL_ODDS) if (count >= r[0]) row = r;
    return row.slice(1);
  }
  function rollBall(count, rnd = Math.random) {
    const w = ballOdds(count);
    let x = rnd() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < w.length; i++) { if (x < w[i]) return BALLS[i]; x -= w[i]; }
    return BALLS[0];
  }

  // ---------- レジェンドの封印 ----------
  // 全部そろうと図鑑で「封印をとく」が押せる
  const SEAL = { totsuNeed: 3, totsuCount: 3, fragments: 5 };
  // friends: { id: 数 }、seals: { legendId: { frag: 欠片の数, black: 封印の地で黒鬼を倒したか } }
  function sealProgress(legend, friends, seals) {
    const st = (seals && seals[legend.id]) || {};
    const got = legend.seal.filter(id => friends[id]).length;
    const totsu = legend.seal.filter(id => totsuOf(friends[id] || 0) >= SEAL.totsuNeed).length;
    const frag = Math.min(SEAL.fragments, st.frag || 0);
    const conds = [
      { label: '決められた妖怪8体をお友達にする', got, need: legend.seal.length },
      { label: `そのうち${SEAL.totsuCount}体を凸${SEAL.totsuNeed}以上にする`, got: Math.min(totsu, SEAL.totsuCount), need: SEAL.totsuCount },
      { label: `「${STAGES_N[legend.stage]}」ステージで黒鬼を倒す`, got: st.black ? 1 : 0, need: 1 },
      { label: `封印の欠片を${SEAL.fragments}個集める（「${STAGES_N[legend.stage]}」で黒鬼：必ず1個／青鬼：3回に1個）`, got: frag, need: SEAL.fragments },
    ];
    return { conds, ready: conds.every(c => c.got >= c.need) };
  }
  // バトルの結果から、もらえる欠片を決める（サーバーで使う）
  function sealDrop(stage, boss, bossDown, rnd = Math.random) {
    if (!bossDown) return null;
    const l = LEGENDS.find(x => x.stage === stage);
    if (!l) return null;
    if (boss === 'black') return { legend: l.id, frag: 1, black: true };
    if (boss === 'blue' && rnd() < 1 / 3) return { legend: l.id, frag: 1 };
    return null;
  }

  // ---------- 週替わりランキング ----------
  // 毎週月曜0時（日本時間）に1種類ずつ入れ替わる。第1回 = 2026年10月19日（月）からの週
  const WEEK_MS = 7 * 24 * 3600 * 1000;
  const WEEK_BASE = Date.UTC(2026, 9, 18, 15, 0, 0); // 2026-10-19 00:00 JST
  const weekIndex = (now = Date.now()) => Math.floor((now - WEEK_BASE) / WEEK_MS);
  const weekStart = idx => WEEK_BASE + idx * WEEK_MS;
  const THEME_ORDER = ['dama', 'bossTime', 'challenge', 'rescue', 'stealth', 'patrol', 'bossDmg', 'meister'];
  const STARTERS = ['nekomata', 'kasabou', 'chochin', 'hitodama'];
  function themeOf(idx) {
    const key = THEME_ORDER[((idx % THEME_ORDER.length) + THEME_ORDER.length) % THEME_ORDER.length];
    const round = Math.floor(idx / THEME_ORDER.length); // 何周目か（ボスやお題が毎回ちがう）
    const t = { key, idx, no: idx + 1 };
    switch (key) {
      case 'dama': return { ...t, icon: '🟣', name: '鬼玉ランキング', desc: '1週間に集めた鬼玉の合計で勝負！', unit: '個', crown: '鬼玉王' };
      case 'bossTime': {
        const boss = ['red', 'blue', 'red', 'black'][round % 4];
        return { ...t, icon: '⏱️', boss, name: `${BOSSES_N[boss]}討伐タイム`, desc: `${BOSSES_N[boss]}を倒すまでの最速タイムで勝負！（何回挑戦してもOK・一番いい記録が残ります）`, lower: true, crown: `${BOSSES_N[boss]}討伐王` };
      }
      case 'challenge': {
        const stage = ['france', 'usa', 'china', 'brazil', 'japan', 'oni'][round % 6];
        const boss = ['red', 'blue', 'red', 'black', 'blue', 'red'][round % 6];
        const rule = ['noHealer', 'short'][round % 2];
        const ruleName = rule === 'noHealer' ? 'ヒーラー禁止' : '制限時間3分';
        return { ...t, icon: '🎯', stage, boss, rule, ruleName, name: `チャレンジ「${STAGES_N[stage]}×${BOSSES_N[boss]}」`, desc: `しばり：${ruleName}　1回のバトルで集めた鬼玉の最高記録で勝負！（ロビーで「今週のチャレンジ」を選んで出撃）`, unit: '個', crown: `${STAGES_N[stage]}の覇者` };
      }
      case 'rescue': return { ...t, icon: '🤝', name: '救助ランキング', desc: '倒れた仲間を起こした回数で勝負！', unit: '回', crown: '救助王' };
      case 'stealth': return { ...t, icon: '👻', name: '隠密ランキング', desc: '見回り鬼にもボス鬼にも見つからずに脱出した回数で勝負！', unit: '回', crown: '忍びの王' };
      case 'patrol': return { ...t, icon: '⚔️', name: '見回り鬼ハンター', desc: '倒した見回り鬼の数で勝負！', unit: '体', crown: '見回り鬼ハンター王' };
      case 'bossDmg': return { ...t, icon: '💥', name: 'ボスダメージ', desc: 'ボス鬼に与えたダメージの合計で勝負！', unit: '', crown: '破壊王' };
      default: {
        const yokai = STARTERS[round % STARTERS.length];
        const yn = (YOKAI_BY_ID[yokai] || {}).name;
        return { ...t, icon: '🦊', yokai, name: `妖怪マイスター「${yn}」`, desc: `${yn}をつれて出撃して集めた鬼玉の合計で勝負！`, unit: '個', crown: `${yn}マイスター` };
      }
    }
  }
  const fmtScore = (theme, v) => theme.lower ? `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}` : `${Math.round(v).toLocaleString('ja-JP')}${theme.unit}`;
  // 順位ごとの報酬（チケットは、ホームの「チケットガチャ」でその色の玉が必ず出る）
  function weeklyReward(rank) {
    if (rank === 1) return { ticket: 'gold', title: true };
    if (rank <= 3) return { ticket: 'red' };
    if (rank <= 10) return { ticket: 'blue' };
    return { ticket: 'green' }; // 参加賞
  }
  // その週の1位の称号（id は w + 週の番号）
  function weeklyTitle(id) {
    const m = /^w(\d{1,5})$/.exec(id || '');
    if (!m) return null;
    const th = themeOf(+m[1]);
    return { id, name: `第${th.no}回 ${th.crown}`, color: '#ffd23a', weekly: true, desc: `第${th.no}回 ${th.name} 1位` };
  }

  // ---------- ボス鬼 ----------
  // 赤鬼 → 青鬼 → 黒鬼 の順に、前の鬼を倒すと次の鬼に挑戦できる
  const BOSSES = {
    red:   { name: '赤鬼', color: '#c8242a', hp: 1.15, dmg: 1.2, atkGap: 0.85, warn: 1.0,  drop: 50,  need: null },
    blue:  { name: '青鬼', color: '#2a5ad8', hp: 1.75, dmg: 1.55, atkGap: 0.7, warn: 0.95, drop: 100, need: 'red' },
    black: { name: '黒鬼', color: '#2a2030', hp: 2.6, dmg: 1.95, atkGap: 0.56, warn: 0.85, drop: 150, need: 'blue' },
  };
  const BOSS_ORDER = ['red', 'blue', 'black'];
  const BOSSES_N = Object.fromEntries(Object.entries(BOSSES).map(([k, b]) => [k, b.name]));
  // cleared: { red: true, ... } 倒したことのある鬼
  function bossUnlocked(type, cleared) {
    const b = BOSSES[type];
    return !!b && (!b.need || !!(cleared && cleared[b.need]));
  }

  // ---------- ステージ（毎回ランダム） ----------
  const STAGES = {
    oni:    { name: '鬼の世界' },
    japan:  { name: '日本の街' },
    france: { name: 'フランスの街' },
    brazil: { name: 'ブラジルの街' },
    china:  { name: '中国の街' },
    usa:    { name: 'アメリカの街' },
  };
  const STAGE_KEYS = Object.keys(STAGES);
  const STAGES_N = { oni: '鬼の世界', japan: '日本', france: 'フランス', brazil: 'ブラジル', china: '中国', usa: 'アメリカ' };
  function pickStage(rnd = Math.random) { return STAGE_KEYS[Math.floor(rnd() * STAGE_KEYS.length)]; }

  // ---------- アイテム ----------
  const ITEMS = {
    trap:    { name: '電気トラップ',     icon: '⚡', color: '#ffe14a' },
    bomb:    { name: '爆弾',             icon: '💣', color: '#ff6a3d' },
    punch:   { name: 'ロボットパンチ',   icon: '🤖', color: '#9ab0c8' },
    stamina: { name: 'スタミナム',       icon: '🥤', color: '#5be0ff' },
    onigiri: { name: 'おにぎり',         icon: '🍙', color: '#ffffff' },
    jimmy:   { name: 'ジミーフィールド', icon: '👻', color: '#b08cff' },
  };

  // ---------- 街マップ ----------
  const MAP_W = 4950, MAP_H = 3510; // 横10×縦7ブロック
  const STREET = 150;           // 道幅
  const BLOCK = 330;            // 1ブロックの大きさ
  const CELL = 50;              // 経路探索グリッド

  // シード付き乱数（全員で同じ街を生成するため）
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function generateCity(seed) {
    const rand = rng(seed);
    const buildings = [], plazas = [];
    for (let bx = STREET; bx + BLOCK <= MAP_W - STREET / 2; bx += BLOCK + STREET) {
      for (let by = STREET; by + BLOCK <= MAP_H - STREET / 2; by += BLOCK + STREET) {
        const roll = rand();
        if (roll < 0.15) { plazas.push({ x: bx, y: by, w: BLOCK, h: BLOCK }); continue; } // 広場（名所を置く）
        if (roll < 0.55) {
          buildings.push({ x: bx, y: by, w: BLOCK, h: BLOCK });
        } else if (roll < 0.8) {
          // 縦に2つ（間に細い路地）
          const h1 = BLOCK * (0.35 + rand() * 0.2);
          buildings.push({ x: bx, y: by, w: BLOCK, h: h1 });
          buildings.push({ x: bx, y: by + h1 + 70, w: BLOCK, h: BLOCK - h1 - 70 });
        } else {
          const w1 = BLOCK * (0.35 + rand() * 0.2);
          buildings.push({ x: bx, y: by, w: w1, h: BLOCK });
          buildings.push({ x: bx + w1 + 70, y: by, w: BLOCK - w1 - 70, h: BLOCK });
        }
      }
    }
    for (const b of buildings) { b.x = Math.round(b.x); b.y = Math.round(b.y); b.w = Math.round(b.w); b.h = Math.round(b.h); b.hue = Math.floor(rand() * 4); }
    for (const pl of plazas) pl.v = Math.floor(rand() * 1000);
    return { w: MAP_W, h: MAP_H, buildings, plazas, seed };
  }

  // ---- 建物の場所の索引（近くの建物だけを調べて速くする。結果は全部調べたときと同じ） ----
  const BCELL = 300;
  function bIndex(map) {
    if (map._bi) return map._bi;
    const cols = Math.ceil(map.w / BCELL) + 1, rows = Math.ceil(map.h / BCELL) + 1;
    const cells = Array.from({ length: cols * rows }, () => []);
    map.buildings.forEach((b, i) => {
      for (let cy = Math.max(0, Math.floor(b.y / BCELL)); cy <= Math.min(rows - 1, Math.floor((b.y + b.h) / BCELL)); cy++)
        for (let cx = Math.max(0, Math.floor(b.x / BCELL)); cx <= Math.min(cols - 1, Math.floor((b.x + b.w) / BCELL)); cx++) cells[cy * cols + cx].push(i);
    });
    return (map._bi = { cols, rows, cells, mark: new Uint32Array(map.buildings.length), stamp: 0, out: [] });
  }
  // 四角 (x0,y0)-(x1,y1) にかかるかもしれない建物の番号（小さい順）
  function nearIdx(map, x0, y0, x1, y1) {
    const ix = bIndex(map), out = ix.out;
    out.length = 0;
    if (++ix.stamp === 0xffffffff) { ix.mark.fill(0); ix.stamp = 1; }
    const c0 = Math.max(0, Math.floor(Math.min(x0, x1) / BCELL)), c1 = Math.min(ix.cols - 1, Math.floor(Math.max(x0, x1) / BCELL));
    const r0 = Math.max(0, Math.floor(Math.min(y0, y1) / BCELL)), r1 = Math.min(ix.rows - 1, Math.floor(Math.max(y0, y1) / BCELL));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) for (const i of ix.cells[r * ix.cols + c]) if (ix.mark[i] !== ix.stamp) { ix.mark[i] = ix.stamp; out.push(i); }
    return out;
  }

  // 円をマップ外と建物から押し出す（建物は90くらいなので、全部見るほうが速い）
  function collide(map, e, r) {
    e.x = Math.max(r, Math.min(map.w - r, e.x));
    e.y = Math.max(r, Math.min(map.h - r, e.y));
    for (const b of map.buildings) {
      const cx = Math.max(b.x, Math.min(b.x + b.w, e.x));
      const cy = Math.max(b.y, Math.min(b.y + b.h, e.y));
      const dx = e.x - cx, dy = e.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        e.x = cx + (dx / d) * r; e.y = cy + (dy / d) * r;
      } else {
        // 中心が建物の中: いちばん近い辺から外へ
        const l = e.x - b.x, rr = b.x + b.w - e.x, t = e.y - b.y, bt = b.y + b.h - e.y;
        const m = Math.min(l, rr, t, bt);
        if (m === l) e.x = b.x - r; else if (m === rr) e.x = b.x + b.w + r;
        else if (m === t) e.y = b.y - r; else e.y = b.y + b.h + r;
      }
    }
  }

  // 線分 a-b が建物にさえぎられていないか
  // 索引のマスを、線が通る行ごとに通る範囲だけ見る（長い線でも斜めの四角全体は見ない。結果は全部調べたときと同じ）
  function lineOfSight(map, a, b) {
    const ix = bIndex(map), bs = map.buildings, mark = ix.mark;
    if (++ix.stamp === 0xffffffff) { mark.fill(0); ix.stamp = 1; }
    const st = ix.stamp, dx = b.x - a.x, dy = b.y - a.y;
    const ymin = Math.min(a.y, b.y), ymax = Math.max(a.y, b.y);
    const r0 = Math.max(0, Math.floor(ymin / BCELL)), r1 = Math.min(ix.rows - 1, Math.floor(ymax / BCELL));
    for (let r = r0; r <= r1; r++) {
      let xa = a.x, xb = b.x;
      if (dy !== 0) {
        const ya = Math.max(ymin, r * BCELL), yb = Math.min(ymax, (r + 1) * BCELL);
        xa = a.x + dx * (ya - a.y) / dy; xb = a.x + dx * (yb - a.y) / dy;
      }
      // 計算の誤差でマスの境目を取りこぼさないよう、左右に1ずつ広めに見る
      const c0 = Math.max(0, Math.floor((Math.min(xa, xb) - 1) / BCELL)), c1 = Math.min(ix.cols - 1, Math.floor((Math.max(xa, xb) + 1) / BCELL));
      for (let c = c0; c <= c1; c++) for (const i of ix.cells[r * ix.cols + c]) {
        if (mark[i] === st) continue;
        mark[i] = st;
        if (segRect(a.x, a.y, b.x, b.y, bs[i])) return false;
      }
    }
    return true;
  }
  function segRect(x0, y0, x1, y1, r) {
    let t0 = 0, t1 = 1;
    const dx = x1 - x0, dy = y1 - y0;
    // 4つの辺について順に（配列を作らずに）
    for (let i = 0; i < 4; i++) {
      const p = i === 0 ? -dx : i === 1 ? dx : i === 2 ? -dy : dy;
      const q = i === 0 ? x0 - r.x : i === 1 ? r.x + r.w - x0 : i === 2 ? y0 - r.y : r.y + r.h - y0;
      if (p === 0) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  }

  function isFree(map, x, y, r) {
    if (x < r || y < r || x > map.w - r || y > map.h - r) return false;
    const bs = map.buildings;
    for (const i of nearIdx(map, x - r, y - r, x + r, y + r)) {
      const b = bs[i];
      if (x > b.x - r && x < b.x + b.w + r && y > b.y - r && y < b.y + b.h + r) return false;
    }
    return true;
  }

  return { RANKS, ROLES, YOKAI, LEGENDS, SEAL, sealProgress, sealDrop, YOKAI_BY_ID, yokaiStats, BALLS, ballOdds, rollBall, TOTSU_MAX, TOTSU_STEP, totsuOf, TITLES, TITLE_BY_ID, titleProgress, weekIndex, weekStart, WEEK_MS, themeOf, fmtScore, weeklyReward, weeklyTitle, BOSSES, BOSS_ORDER, bossUnlocked, STAGES, STAGE_KEYS, pickStage, ITEMS, MAP_W, MAP_H, CELL, generateCity, collide, lineOfSight, isFree, rng };
});
