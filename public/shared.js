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

  // ---------- 妖怪（お友達） ----------
  const YOKAI = [
    // Cランク（はじめから全員がお友達）
    { id: 'nekomata',  name: 'ネコマタロウ', rank: 'C', role: 'fighter', color: '#ff8a5c', starter: true },
    { id: 'kasabou',   name: 'カサボウ',     rank: 'C', role: 'tank',    color: '#8aa0ff', starter: true },
    { id: 'chochin',   name: 'チョウチンコ', rank: 'C', role: 'healer',  color: '#ffb35c', starter: true },
    { id: 'hitodama',  name: 'ヒトダマン',   rank: 'C', role: 'ranger',  color: '#9ef0ff', starter: true },
    // Bランク
    { id: 'kappado',   name: 'カッパード',   rank: 'B', role: 'fighter', color: '#3fcf8e' },
    { id: 'nurikabe',  name: 'ヌリカベエ',   rank: 'B', role: 'tank',    color: '#b0a080' },
    { id: 'yukinko',   name: 'ユキンコ',     rank: 'B', role: 'healer',  color: '#d8f4ff' },
    { id: 'tenguri',   name: 'テングリ',     rank: 'B', role: 'ranger',  color: '#e05050' },
    // Aランク
    { id: 'raijin',    name: 'ライジン坊',   rank: 'A', role: 'fighter', color: '#ffe14a' },
    { id: 'gashadoku', name: 'ガシャドクロウ', rank: 'A', role: 'tank',  color: '#e8e8e8' },
    { id: 'hakutaku',  name: 'ハクタク姫',   rank: 'A', role: 'healer',  color: '#ffc8ec' },
    { id: 'kitsunebi', name: 'キツネビ',     rank: 'A', role: 'ranger',  color: '#ff9a2e' },
    // Sランク
    { id: 'susanoo',   name: 'スサノオ丸',   rank: 'S', role: 'fighter', color: '#5c7cff' },
    { id: 'daidara',   name: 'ダイダラ王',   rank: 'S', role: 'tank',    color: '#7a5c3a' },
    { id: 'amaterasu', name: 'アマテラ',     rank: 'S', role: 'healer',  color: '#fff27a' },
    { id: 'yatagarasu', name: 'ヤタガラス',  rank: 'S', role: 'ranger',  color: '#3a2a5c' },
  ];
  const YOKAI_BY_ID = Object.fromEntries(YOKAI.map(y => [y.id, y]));

  // 妖怪の実ステータス（ロール基本値 × ランク倍率）
  function yokaiStats(id) {
    const y = YOKAI_BY_ID[id] || YOKAI[0];
    const r = ROLES[y.role];
    const m = RANKS[y.rank].mul;
    return { ...r, hp: Math.round(r.hp * m), atkDmg: r.atkDmg * m, strongMul: m, speed: r.speed + (m - 1) * 20 };
  }

  // ---------- ガチャ玉 ----------
  // 集めた鬼玉の数で色が決まる
  const BALLS = [
    { key: 'green', name: '緑', color: '#4fd16a', min: 0,  ranks: [['C', 1]] },
    { key: 'blue',  name: '青', color: '#3f7cff', min: 8,  ranks: [['B', 1]] },
    { key: 'red',   name: '赤', color: '#ff3b3b', min: 15, ranks: [['A', 1]] },
    { key: 'gold',  name: '金', color: '#ffcc33', min: 23, ranks: [['A', 0.6], ['S', 0.4]] },
    { key: 'black', name: '黒', color: '#1a1a1a', min: 32, ranks: [['S', 1]] },
  ];
  function ballFor(count) {
    let b = BALLS[0];
    for (const x of BALLS) if (count >= x.min) b = x;
    return b;
  }

  // ---------- アイテム ----------
  const ITEMS = {
    trap:    { name: '電気トラップ',     icon: '⚡', color: '#ffe14a' },
    bomb:    { name: '爆弾',             icon: '💣', color: '#ff6a3d' },
    punch:   { name: 'ロボットパンチ',   icon: '🤖', color: '#9ab0c8' },
    stamina: { name: 'スタミナム',       icon: '🥤', color: '#5be0ff' },
    onigiri: { name: 'おにぎり',         icon: '🍙', color: '#ffffff' },
    jimmy:   { name: 'ジミーフィールド', icon: '👻', color: '#b08cff' },
  };
  const ITEM_REVEAL_DIST = 170; // これより近づくと種類がわかる

  // ---------- 街マップ ----------
  const MAP_W = 3000, MAP_H = 2000;
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
    const buildings = [];
    for (let bx = STREET; bx + BLOCK <= MAP_W - STREET / 2; bx += BLOCK + STREET) {
      for (let by = STREET; by + BLOCK <= MAP_H - STREET / 2; by += BLOCK + STREET) {
        const roll = rand();
        if (roll < 0.15) continue; // 広場
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
    return { w: MAP_W, h: MAP_H, buildings, seed };
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

  return { RANKS, ROLES, YOKAI, YOKAI_BY_ID, yokaiStats, BALLS, ballFor, ITEMS, ITEM_REVEAL_DIST, MAP_W, MAP_H, CELL, generateCity, collide, lineOfSight, isFree, rng };
});
