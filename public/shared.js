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
  const YOKAI_BY_ID = Object.fromEntries(YOKAI.map(y => [y.id, y]));

  // 妖怪の実ステータス（ロール基本値 × ランク倍率）
  function yokaiStats(id) {
    const y = YOKAI_BY_ID[id] || YOKAI[0];
    const r = ROLES[y.role];
    const m = RANKS[y.rank].mul;
    return { ...r, hp: Math.round(r.hp * m), atkDmg: r.atkDmg * m, strongMul: m, speed: r.speed + (m - 1) * 20 };
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

  // ---------- ボス鬼 ----------
  // 赤鬼 → 青鬼 → 黒鬼 の順に、前の鬼を倒すと次の鬼に挑戦できる
  const BOSSES = {
    red:   { name: '赤鬼', color: '#c8242a', hp: 1.15, dmg: 1.2, atkGap: 0.85, warn: 1.0,  drop: 50,  need: null },
    blue:  { name: '青鬼', color: '#2a5ad8', hp: 1.75, dmg: 1.55, atkGap: 0.7, warn: 0.95, drop: 100, need: 'red' },
    black: { name: '黒鬼', color: '#2a2030', hp: 2.6, dmg: 1.95, atkGap: 0.56, warn: 0.85, drop: 150, need: 'blue' },
  };
  const BOSS_ORDER = ['red', 'blue', 'black'];
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

  // 円をマップ外と建物から押し出す
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
  function lineOfSight(map, a, b) {
    for (const r of map.buildings) {
      if (segRect(a.x, a.y, b.x, b.y, r)) return false;
    }
    return true;
  }
  function segRect(x0, y0, x1, y1, r) {
    let t0 = 0, t1 = 1;
    const dx = x1 - x0, dy = y1 - y0;
    const p = [-dx, dx, -dy, dy];
    const q = [x0 - r.x, r.x + r.w - x0, y0 - r.y, r.y + r.h - y0];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return false; continue; }
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  }

  function isFree(map, x, y, r) {
    if (x < r || y < r || x > map.w - r || y > map.h - r) return false;
    for (const b of map.buildings) {
      if (x > b.x - r && x < b.x + b.w + r && y > b.y - r && y < b.y + b.h + r) return false;
    }
    return true;
  }

  return { RANKS, ROLES, YOKAI, YOKAI_BY_ID, yokaiStats, BALLS, ballOdds, rollBall, BOSSES, BOSS_ORDER, bossUnlocked, STAGES, STAGE_KEYS, pickStage, ITEMS, MAP_W, MAP_H, CELL, generateCity, collide, lineOfSight, isFree, rng };
});
