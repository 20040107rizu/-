// ステージごとの街の描き方（地面・建物の屋根・広場の名所）
// 当たり判定は全ステージ共通で、見た目だけが変わる
(function (root) {
  const TAU = Math.PI * 2;
  const STREET = 150, BLOCK = 330, PITCH = STREET + BLOCK;

  // 決まった値から毎回同じ乱数を出す（建物ごとの飾りの位置）
  function hashRand(n) {
    let s = (n * 2654435761) >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function rect(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
  function circle(ctx, x, y, r, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  function glow(ctx, x, y, r, c, blur) { ctx.shadowColor = c; ctx.shadowBlur = blur; circle(ctx, x, y, r, c); ctx.shadowBlur = 0; }

  // ---------- 色 ----------
  const THEME = {
    oni:    { road: '#2e2236', walk: '#2e2236', line: null, wall: '#140c18', border: '#ff4a3a', mini: '#5a4a66', miniBg: '#1a1020cc', tint: null },
    japan:  { road: '#3a3c44', walk: '#7a766e', line: '#e8e4d8', wall: '#2a2420', border: '#e8a03a', mini: '#6a6e7a', miniBg: '#202228cc', tint: '#ff8a3a14' },
    france: { road: '#6a5e52', walk: '#b8a88e', line: null, wall: '#8a7a62', border: '#3a5ad8', mini: '#7a8aa0', miniBg: '#2a2a32cc', tint: '#5a6aff12' },
    brazil: { road: '#3e3e3a', walk: '#e8e0cc', line: '#ffd23a', wall: '#6a4a3a', border: '#2ab84a', mini: '#c08a5a', miniBg: '#1e3020cc', tint: null },
    china:  { road: '#4a4440', walk: '#8a8278', line: null, wall: '#5a1a14', border: '#e8c03a', mini: '#a04a3a', miniBg: '#2a1a18cc', tint: '#ff303010' },
    usa:    { road: '#34363a', walk: '#9a9894', line: '#f0c020', wall: '#3a2a26', border: '#d83a3a', mini: '#7a7c84', miniBg: '#1c1e24cc', tint: null },
  };
  function theme(stage) { return THEME[stage] || THEME.oni; }

  // ---------- 地面 ----------
  // view: {l, r, t, b} 画面に見えている範囲
  function drawGround(ctx, map, view, stage, pattern) {
    const th = theme(stage);
    if (stage === 'oni' || !THEME[stage]) {
      ctx.fillStyle = pattern('scene/ground') || th.road;
      ctx.fillRect(0, 0, map.w, map.h);
      ctx.strokeStyle = '#ffffff08'; ctx.lineWidth = 2;
      grid(ctx, view, map, 75);
      ctx.strokeStyle = th.border; ctx.lineWidth = 10; ctx.strokeRect(0, 0, map.w, map.h);
      return;
    }
    // 道路
    rect(ctx, 0, 0, map.w, map.h, th.road);
    // 歩道（ブロックの部分）
    const i0 = Math.max(0, Math.floor((view.l - STREET) / PITCH)), i1 = Math.floor((view.r - STREET) / PITCH);
    const j0 = Math.max(0, Math.floor((view.t - STREET) / PITCH)), j1 = Math.floor((view.b - STREET) / PITCH);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const x = STREET + i * PITCH, y = STREET + j * PITCH;
      if (x + BLOCK > map.w || y + BLOCK > map.h) continue;
      drawWalk(ctx, stage, x, y, th);
    }
    // 道路の模様
    drawRoadMarks(ctx, map, view, stage, th);
    ctx.strokeStyle = th.border; ctx.lineWidth = 10; ctx.strokeRect(0, 0, map.w, map.h);
  }

  function grid(ctx, view, map, g) {
    const x0 = Math.max(0, Math.floor(view.l / g) * g), x1 = Math.min(map.w, view.r + g);
    const y0 = Math.max(0, Math.floor(view.t / g) * g), y1 = Math.min(map.h, view.b + g);
    ctx.beginPath();
    for (let x = x0; x <= x1; x += g) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = y0; y <= y1; y += g) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
  }

  function drawWalk(ctx, stage, x, y, th) {
    const m = 14; // 縁石
    rect(ctx, x - m, y - m, BLOCK + m * 2, BLOCK + m * 2, '#00000030');
    rect(ctx, x - m + 3, y - m + 3, BLOCK + m * 2 - 6, BLOCK + m * 2 - 6, th.walk);
    ctx.save();
    ctx.beginPath(); ctx.rect(x - m + 3, y - m + 3, BLOCK + m * 2 - 6, BLOCK + m * 2 - 6); ctx.clip();
    if (stage === 'brazil') {
      // コパカバーナの波もよう
      ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 9;
      for (let yy = y - m; yy < y + BLOCK + m + 30; yy += 30) {
        ctx.beginPath();
        for (let xx = x - m; xx <= x + BLOCK + m; xx += 10) {
          const w = Math.sin((xx - x) / 26) * 9;
          if (xx === x - m) ctx.moveTo(xx, yy + w); else ctx.lineTo(xx, yy + w);
        }
        ctx.stroke();
      }
    } else if (stage === 'france') {
      ctx.strokeStyle = '#00000018'; ctx.lineWidth = 2;
      for (let yy = y - m; yy < y + BLOCK + m; yy += 18) {
        ctx.beginPath(); ctx.moveTo(x - m, yy); ctx.lineTo(x + BLOCK + m, yy); ctx.stroke();
        const off = ((yy - y) / 18) % 2 ? 0 : 14;
        ctx.beginPath();
        for (let xx = x - m + off; xx < x + BLOCK + m; xx += 28) { ctx.moveTo(xx, yy); ctx.lineTo(xx, yy + 18); }
        ctx.stroke();
      }
    } else if (stage === 'china') {
      ctx.strokeStyle = '#00000022'; ctx.lineWidth = 2;
      for (let yy = y - m; yy < y + BLOCK + m; yy += 40) {
        ctx.beginPath(); ctx.moveTo(x - m, yy); ctx.lineTo(x + BLOCK + m, yy); ctx.stroke();
        const off = ((yy - y) / 40) % 2 ? 0 : 30;
        ctx.beginPath();
        for (let xx = x - m + off; xx < x + BLOCK + m; xx += 60) { ctx.moveTo(xx, yy); ctx.lineTo(xx, yy + 40); }
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = '#00000018'; ctx.lineWidth = 2;
      for (let xx = x - m; xx < x + BLOCK + m; xx += 36) { ctx.beginPath(); ctx.moveTo(xx, y - m); ctx.lineTo(xx, y + BLOCK + m); ctx.stroke(); }
      for (let yy = y - m; yy < y + BLOCK + m; yy += 36) { ctx.beginPath(); ctx.moveTo(x - m, yy); ctx.lineTo(x + BLOCK + m, yy); ctx.stroke(); }
    }
    ctx.restore();
  }

  function drawRoadMarks(ctx, map, view, stage, th) {
    if (stage === 'france' || stage === 'china') {
      // 石畳
      ctx.strokeStyle = stage === 'france' ? '#00000026' : '#ffffff10'; ctx.lineWidth = 2;
      grid(ctx, view, map, stage === 'france' ? 25 : 50);
      return;
    }
    // 中央線
    ctx.strokeStyle = th.line; ctx.lineWidth = 5;
    ctx.setLineDash(stage === 'usa' ? [] : [36, 30]);
    ctx.beginPath();
    for (let k = 0; k * PITCH <= map.w; k++) {
      const x = k * PITCH + STREET / 2;
      if (x < view.l - 20 || x > view.r + 20) continue;
      if (stage === 'usa') { ctx.moveTo(x - 4, Math.max(0, view.t)); ctx.lineTo(x - 4, Math.min(map.h, view.b)); ctx.moveTo(x + 4, Math.max(0, view.t)); ctx.lineTo(x + 4, Math.min(map.h, view.b)); }
      else { ctx.moveTo(x, Math.max(0, view.t)); ctx.lineTo(x, Math.min(map.h, view.b)); }
    }
    for (let k = 0; k * PITCH <= map.h; k++) {
      const y = k * PITCH + STREET / 2;
      if (y < view.t - 20 || y > view.b + 20) continue;
      if (stage === 'usa') { ctx.moveTo(Math.max(0, view.l), y - 4); ctx.lineTo(Math.min(map.w, view.r), y - 4); ctx.moveTo(Math.max(0, view.l), y + 4); ctx.lineTo(Math.min(map.w, view.r), y + 4); }
      else { ctx.moveTo(Math.max(0, view.l), y); ctx.lineTo(Math.min(map.w, view.r), y); }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // 交差点の横断歩道（日本・アメリカ）
    if (stage === 'japan' || stage === 'usa') {
      ctx.fillStyle = '#e8e4d8cc';
      for (let i = 0; i * PITCH <= map.w; i++) for (let j = 0; j * PITCH <= map.h; j++) {
        const cx = i * PITCH, cy = j * PITCH;
        if (cx < view.l - 200 || cx > view.r + 50 || cy < view.t - 200 || cy > view.b + 50) continue;
        for (let s = 14; s < STREET - 10; s += 22) {
          ctx.fillRect(cx + s, cy + STREET + 2, 12, 26); // 下側
          ctx.fillRect(cx + STREET + 2, cy + s, 26, 12); // 右側
        }
      }
    }
  }

  // ---------- 建物 ----------
  // layer: 'static' = 動かない部分だけ（一度描いて使い回す）、'anim' = 動く部分だけ（毎コマ）、なし = 全部
  function drawBuilding(ctx, b, stage, now, pattern, layer) {
    const th = theme(stage);
    const R = hashRand(b.x * 7 + b.y * 13 + b.w);
    if (layer === 'anim') { // 動くのは中国のちょうちんと、アメリカのヘリポートの灯りだけ
      if (stage === 'china') chinaLanterns(ctx, b, now);
      else if (stage === 'usa') usaBlink(ctx, b, R, now);
      return;
    }
    rect(ctx, b.x, b.y + 14, b.w, b.h, th.wall); // 壁（手前に見える面）
    switch (stage) {
      case 'japan': return japanRoof(ctx, b, R, now);
      case 'france': return franceRoof(ctx, b, R, now);
      case 'brazil': return brazilRoof(ctx, b, R, now);
      case 'china': chinaRoof(ctx, b, R, now); if (layer !== 'static') chinaLanterns(ctx, b, now); return;
      case 'usa': usaRoof(ctx, b, R, now); if (layer !== 'static') usaBlink(ctx, b, hashRand(b.x * 7 + b.y * 13 + b.w), now); return;
      default: return oniRoof(ctx, b, now, pattern);
    }
  }
  const STAGE_HAS_ANIM = { china: true, usa: true };

  const ONI_ROOF = ['#5a3a5a', '#4a3a60', '#603a3a', '#3a4a5a'];
  function oniRoof(ctx, b, now, pattern) {
    const roof = pattern('scene/roof');
    ctx.fillStyle = roof || ONI_ROOF[b.hue]; ctx.fillRect(b.x, b.y, b.w, b.h - 6);
    if (roof) { ctx.fillStyle = ['#0000', '#4060ff18', '#ff404018', '#40ff8012'][b.hue]; ctx.fillRect(b.x, b.y, b.w, b.h - 6); }
    else {
      ctx.strokeStyle = '#00000055'; ctx.lineWidth = 3;
      ctx.beginPath();
      for (let yy = b.y + 22; yy < b.y + b.h - 10; yy += 22) { ctx.moveTo(b.x + 6, yy); ctx.lineTo(b.x + b.w - 6, yy); }
      ctx.stroke();
    }
    glow(ctx, b.x + 14, b.y + b.h + 2, 6, '#ff6a3d', 14);
  }

  // 日本: 瓦屋根の家と、屋上にエアコンのあるビル
  function japanRoof(ctx, b, R, now) {
    const H = b.h - 6;
    if (b.hue < 2) {
      const base = ['#3e4652', '#5a4a40'][b.hue];
      rect(ctx, b.x, b.y, b.w, H, base);
      ctx.strokeStyle = '#00000040'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let yy = b.y + 10; yy < b.y + H; yy += 12) { ctx.moveTo(b.x, yy); ctx.lineTo(b.x + b.w, yy); }
      ctx.stroke();
      ctx.strokeStyle = '#ffffff14'; ctx.beginPath();
      for (let xx = b.x + 8; xx < b.x + b.w; xx += 16) { ctx.moveTo(xx, b.y); ctx.lineTo(xx, b.y + H); }
      ctx.stroke();
      // 棟（屋根のてっぺん）
      rect(ctx, b.x, b.y + H / 2 - 6, b.w, 12, '#22262e');
      rect(ctx, b.x, b.y + H / 2 - 6, b.w, 4, '#ffffff22');
      circle(ctx, b.x + 6, b.y + H / 2, 9, '#22262e'); circle(ctx, b.x + b.w - 6, b.y + H / 2, 9, '#22262e');
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 4; ctx.strokeRect(b.x + 2, b.y + 2, b.w - 4, H - 4);
    } else {
      rect(ctx, b.x, b.y, b.w, H, b.hue === 2 ? '#9a9890' : '#86888c');
      rect(ctx, b.x + 8, b.y + 8, b.w - 16, H - 16, b.hue === 2 ? '#aaa8a0' : '#96989c');
      for (let k = 0; k < 2 + Math.floor(R() * 3); k++) {
        const x = b.x + 20 + R() * (b.w - 70), y = b.y + 20 + R() * (H - 60);
        rect(ctx, x, y, 34, 26, '#d8d8d0'); circle(ctx, x + 17, y + 13, 9, '#6a6c70');
      }
      if (b.w > 150 && H > 150) { // 給水タンク
        const x = b.x + b.w - 60, y = b.y + 30;
        circle(ctx, x, y + 6, 22, '#00000030'); circle(ctx, x, y, 22, '#5a8ac8'); circle(ctx, x, y, 14, '#4a78b0');
      }
    }
    // 自動販売機（光る）
    const vx = b.x + 10 + R() * (b.w - 40);
    ctx.shadowColor = '#bfe8ff'; ctx.shadowBlur = 12;
    rect(ctx, vx, b.y + b.h - 2, 24, 14, R() < 0.5 ? '#e83a3a' : '#f0f0f0');
    ctx.shadowBlur = 0;
    rect(ctx, vx + 3, b.y + b.h + 1, 18, 5, '#bfe8ff');
    // ちょうちん or 街灯
    glow(ctx, b.x + b.w - 14, b.y + b.h + 4, 5, '#ffd88a', 12);
  }

  // フランス: 灰色の亜鉛屋根（マンサード）とえんとつ
  function franceRoof(ctx, b, R, now) {
    const H = b.h - 6;
    rect(ctx, b.x, b.y, b.w, H, '#6a7a8e');
    rect(ctx, b.x + 14, b.y + 14, b.w - 28, H - 28, '#8494a8');
    ctx.strokeStyle = '#00000022'; ctx.lineWidth = 2; ctx.beginPath();
    for (let xx = b.x + 14; xx < b.x + b.w - 14; xx += 14) { ctx.moveTo(xx, b.y + 14); ctx.lineTo(xx, b.y + H - 14); }
    ctx.stroke();
    ctx.strokeStyle = '#d8ccb0'; ctx.lineWidth = 5; ctx.strokeRect(b.x + 3, b.y + 3, b.w - 6, H - 6); // 石のふち
    // 屋根窓
    ctx.fillStyle = '#f0e4c0';
    for (let xx = b.x + 26; xx < b.x + b.w - 30; xx += 46) { ctx.fillRect(xx, b.y + 4, 16, 9); ctx.fillRect(xx, b.y + H - 13, 16, 9); }
    // えんとつ（テラコッタの煙突）
    const n = 2 + Math.floor(R() * 3);
    for (let k = 0; k < n; k++) {
      const x = b.x + 24 + R() * (b.w - 70), y = b.y + 24 + R() * (H - 70);
      rect(ctx, x + 4, y + 6, 36, 16, '#00000030');
      rect(ctx, x, y, 36, 16, '#c87a5a');
      for (let c = 0; c < 4; c++) circle(ctx, x + 5 + c * 9, y + 6, 3.5, '#8a4a32');
    }
    // 街灯
    glow(ctx, b.x + 16, b.y + b.h + 4, 5, '#ffe9a8', 14);
    glow(ctx, b.x + b.w - 16, b.y + b.h + 4, 5, '#ffe9a8', 14);
    // カフェのひさし（赤白）
    if (b.w > 120) {
      const ax = b.x + b.w / 2 - 40;
      for (let s = 0; s < 8; s++) rect(ctx, ax + s * 10, b.y + b.h - 4, 10, 12, s % 2 ? '#fff' : '#c8242a');
    }
  }

  // ブラジル: カラフルな平らな屋根と水タンク
  const BR = ['#ff7aa8', '#ffd23a', '#3ad0c8', '#7ad84a', '#ff9a3a', '#8a7aff'];
  function brazilRoof(ctx, b, R, now) {
    const H = b.h - 6;
    // ひとつの建物を何軒かに分ける
    const cols = Math.max(1, Math.round(b.w / 110)), rows = Math.max(1, Math.round(H / 110));
    const cw = b.w / cols, rh = H / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = b.x + i * cw, y = b.y + j * rh, c = BR[Math.floor(R() * BR.length)];
      rect(ctx, x, y, cw, rh, c);
      rect(ctx, x + 5, y + 5, cw - 10, rh - 10, '#ffffff26');
      ctx.strokeStyle = '#00000040'; ctx.lineWidth = 3; ctx.strokeRect(x + 1.5, y + 1.5, cw - 3, rh - 3);
      if (R() < 0.6) { // 青い水タンク
        const tx = x + 18 + R() * (cw - 36), ty = y + 18 + R() * (rh - 36);
        circle(ctx, tx + 3, ty + 4, 13, '#00000030'); circle(ctx, tx, ty, 13, '#2a6ad8'); circle(ctx, tx, ty, 7, '#4a8af0');
      }
    }
    // 洗濯物のロープ
    ctx.strokeStyle = '#ffffff99'; ctx.lineWidth = 1.5;
    const ly = b.y + 20 + R() * (H - 40);
    ctx.beginPath(); ctx.moveTo(b.x + 10, ly); ctx.lineTo(b.x + b.w - 10, ly); ctx.stroke();
    for (let xx = b.x + 18; xx < b.x + b.w - 20; xx += 22) rect(ctx, xx, ly, 10, 12, BR[(xx / 22 | 0) % BR.length]);
  }

  // 中国: 反り返った瑠璃瓦の屋根と赤いちょうちん
  function chinaRoof(ctx, b, R, now) {
    const H = b.h - 6;
    const tile = b.hue % 2 ? '#2a8a6a' : '#d8a02a', dark = b.hue % 2 ? '#1a5a44' : '#a06a14';
    // 反り返った角
    ctx.fillStyle = dark;
    for (const [cx, cy, sx, sy] of [[b.x, b.y, -1, -1], [b.x + b.w, b.y, 1, -1], [b.x, b.y + H, -1, 1], [b.x + b.w, b.y + H, 1, 1]]) {
      ctx.beginPath(); ctx.moveTo(cx - sx * 30, cy); ctx.quadraticCurveTo(cx, cy, cx + sx * 12, cy + sy * 12); ctx.lineTo(cx, cy - sy * 30); ctx.closePath(); ctx.fill();
    }
    rect(ctx, b.x, b.y, b.w, H, tile);
    ctx.strokeStyle = dark; ctx.lineWidth = 3; ctx.beginPath();
    for (let xx = b.x + 9; xx < b.x + b.w; xx += 12) { ctx.moveTo(xx, b.y); ctx.lineTo(xx, b.y + H); }
    ctx.stroke();
    ctx.fillStyle = '#ffffff20'; ctx.fillRect(b.x, b.y, b.w, 8);
    // 棟と飾り
    rect(ctx, b.x + 10, b.y + H / 2 - 7, b.w - 20, 14, '#8a1a14');
    rect(ctx, b.x + 10, b.y + H / 2 - 7, b.w - 20, 4, '#e8c03a');
    for (const x of [b.x + 14, b.x + b.w - 14]) { circle(ctx, x, b.y + H / 2, 10, '#e8c03a'); circle(ctx, x, b.y + H / 2, 5, '#8a1a14'); }
    ctx.strokeStyle = '#8a1a14'; ctx.lineWidth = 5; ctx.strokeRect(b.x + 2.5, b.y + 2.5, b.w - 5, H - 5);
  }
  // 赤ちょうちんの列（ゆれるので毎コマ描く。光るちょうちんは一度描いた絵を使い回す）
  let lanternImg = null;
  function lanternSprite() {
    if (lanternImg || typeof document === 'undefined') return lanternImg;
    const k = 3, c = document.createElement('canvas'); c.width = c.height = 48 * k;
    const g = c.getContext('2d'); g.scale(k, k); g.translate(24, 24);
    g.shadowColor = '#ff3a2a'; g.shadowBlur = 14 * k;
    g.fillStyle = '#e8241a'; g.beginPath(); g.ellipse(0, 0, 7, 9, 0, 0, TAU); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = '#e8c03a'; g.fillRect(-4, -10, 8, 3);
    return (lanternImg = c);
  }
  function chinaLanterns(ctx, b, now) {
    const sway = Math.sin(now * 2 + b.x) * 2, img = lanternSprite();
    for (let xx = b.x + 18; xx < b.x + b.w - 10; xx += 40) {
      if (img) { ctx.drawImage(img, xx + sway - 24, b.y + b.h + 6 - 24, 48, 48); continue; }
      ctx.shadowColor = '#ff3a2a'; ctx.shadowBlur = 14;
      ctx.fillStyle = '#e8241a'; ctx.beginPath(); ctx.ellipse(xx + sway, b.y + b.h + 6, 7, 9, 0, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      rect(ctx, xx + sway - 4, b.y + b.h - 4, 8, 3, '#e8c03a');
    }
  }

  // アメリカ: 高層ビルの屋上（エアコン・給水塔・ヘリポート）
  function usaRoof(ctx, b, R, now) {
    const H = b.h - 6;
    const base = ['#5a5c64', '#6a5a50', '#4a5462', '#7a7468'][b.hue];
    rect(ctx, b.x, b.y, b.w, H, base);
    rect(ctx, b.x + 10, b.y + 10, b.w - 20, H - 20, '#ffffff12');
    ctx.strokeStyle = '#00000050'; ctx.lineWidth = 6; ctx.strokeRect(b.x + 3, b.y + 3, b.w - 6, H - 6);
    if (b.w > 200 && H > 200 && R() < 0.5) {
      // ヘリポート
      const cx = b.x + b.w / 2, cy = b.y + H / 2;
      circle(ctx, cx, cy, 62, '#3a3c40');
      ctx.strokeStyle = '#f0c020'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(cx, cy, 52, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 54px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('H', cx, cy + 2); ctx.textBaseline = 'alphabetic';
    } else {
      for (let k = 0; k < 3 + Math.floor(R() * 3); k++) {
        const x = b.x + 18 + R() * (b.w - 64), y = b.y + 18 + R() * (H - 60);
        rect(ctx, x + 4, y + 5, 40, 30, '#00000030');
        rect(ctx, x, y, 40, 30, '#b8bcc4');
        ctx.strokeStyle = '#7a7e86'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x + 20, y + 15, 10, 0, TAU); ctx.stroke();
      }
      if (R() < 0.6) { // 木の給水塔
        const x = b.x + 30 + R() * (b.w - 60), y = b.y + 30 + R() * (H - 60);
        circle(ctx, x + 6, y + 8, 24, '#00000035'); circle(ctx, x, y, 24, '#8a5a32');
        ctx.strokeStyle = '#5a3a1e'; ctx.lineWidth = 2;
        for (let r = 8; r < 24; r += 7) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); }
      }
    }
    // ネオンの看板
    const c = ['#ff3a8a', '#3ae8ff', '#ffe03a'][Math.floor(R() * 3)];
    ctx.shadowColor = c; ctx.shadowBlur = 12;
    rect(ctx, b.x + b.w / 2 - 26, b.y + b.h + 2, 52, 8, c);
    ctx.shadowBlur = 0;
  }

  // ---------- 広場の名所 ----------
  function drawPlaza(ctx, pl, stage, now) {
    const cx = pl.x + pl.w / 2, cy = pl.y + pl.h / 2, v = pl.v || 0;
    switch (stage) {
      case 'japan': return v % 2 ? shrine(ctx, cx, cy, now) : sakuraPark(ctx, pl, now);
      case 'france': return v % 2 ? eiffel(ctx, cx, cy, now) : fountain(ctx, cx, cy, now);
      case 'brazil': return v % 2 ? soccer(ctx, pl) : redeemer(ctx, cx, cy, now);
      case 'china': return v % 2 ? pagoda(ctx, cx, cy, now) : moonGarden(ctx, cx, cy, now);
      case 'usa': return v % 2 ? liberty(ctx, cx, cy, now) : court(ctx, pl);
      default: return oniShrine(ctx, cx, cy, now);
    }
  }
  function shadow(ctx, x, y, rx, ry) { ctx.fillStyle = '#00000038'; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill(); }

  function torii(ctx, x, y, s, c) {
    rect(ctx, x - 60 * s, y - 110 * s, 14 * s, 110 * s, c); rect(ctx, x + 46 * s, y - 110 * s, 14 * s, 110 * s, c);
    rect(ctx, x - 80 * s, y - 126 * s, 160 * s, 16 * s, '#1a1a1a');
    rect(ctx, x - 70 * s, y - 112 * s, 140 * s, 10 * s, c);
    rect(ctx, x - 70 * s, y - 92 * s, 140 * s, 10 * s, c);
  }
  function oniShrine(ctx, x, y, now) {
    shadow(ctx, x, y + 40, 110, 22);
    torii(ctx, x, y + 40, 1, '#8a1a2a');
    for (const dx of [-90, 90]) {
      rect(ctx, x + dx - 10, y + 10, 20, 34, '#4a4050'); rect(ctx, x + dx - 16, y, 32, 12, '#5a5060');
      glow(ctx, x + dx, y + 22, 5, '#ff6a3d', 16);
    }
  }
  function shrine(ctx, x, y, now) {
    rect(ctx, x - 90, y - 50, 180, 150, '#c8b8a0'); // 参道の砂利
    shadow(ctx, x, y + 92, 100, 18);
    torii(ctx, x, y + 92, 0.9, '#e0401e');
    // 本殿
    rect(ctx, x - 60, y - 80, 120, 50, '#7a4a2a');
    ctx.fillStyle = '#3e4652'; ctx.beginPath(); ctx.moveTo(x - 80, y - 74); ctx.lineTo(x, y - 120); ctx.lineTo(x + 80, y - 74); ctx.closePath(); ctx.fill();
    rect(ctx, x - 12, y - 60, 24, 30, '#f4ead0');
    sakura(ctx, x - 120, y - 90, now); sakura(ctx, x + 120, y - 90, now);
  }
  function sakura(ctx, x, y, now) {
    shadow(ctx, x, y + 46, 40, 12);
    rect(ctx, x - 6, y, 12, 46, '#5a3a2a');
    for (const [dx, dy, r] of [[0, -14, 34], [-26, 4, 26], [26, 4, 26], [0, 12, 24]]) circle(ctx, x + dx, y + dy, r, '#ffb8d0');
    for (const [dx, dy] of [[-10, -20], [12, -8], [-20, 8], [18, 14]]) circle(ctx, x + dx, y + dy, 6, '#ffd8e4');
    // 散る花びら
    const t = (now * 0.4 + x * 0.01) % 1;
    circle(ctx, x - 30 + t * 50, y + t * 70, 3, '#ffd0e0');
  }
  function sakuraPark(ctx, pl, now) {
    rect(ctx, pl.x + 20, pl.y + 20, pl.w - 40, pl.h - 40, '#5a8a4a');
    ctx.fillStyle = '#4a8ac8'; ctx.beginPath(); ctx.ellipse(pl.x + pl.w / 2, pl.y + pl.h / 2 + 20, 70, 44, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#c8241a'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(pl.x + pl.w / 2, pl.y + pl.h / 2 + 50, 50, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); // 太鼓橋
    for (const [dx, dy] of [[60, 60], [pl.w - 60, 70], [70, pl.h - 90], [pl.w - 70, pl.h - 80]]) sakura(ctx, pl.x + dx, pl.y + dy, now);
  }
  function eiffel(ctx, x, y, now) {
    rect(ctx, x - 140, y - 140, 280, 280, '#7a9a5a');
    shadow(ctx, x, y + 70, 110, 22);
    ctx.strokeStyle = '#5a4a3a'; ctx.fillStyle = '#6a5a48'; ctx.lineWidth = 6;
    // 足
    ctx.beginPath(); ctx.moveTo(x - 100, y + 70); ctx.quadraticCurveTo(x - 30, y - 20, x - 16, y - 200); ctx.lineTo(x + 16, y - 200); ctx.quadraticCurveTo(x + 30, y - 20, x + 100, y + 70);
    ctx.lineTo(x + 60, y + 70); ctx.quadraticCurveTo(x, y + 10, x - 60, y + 70); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#3a2e22';
    for (let k = 0; k < 10; k++) { const yy = y + 60 - k * 26, w = 90 - k * 8; ctx.beginPath(); ctx.moveTo(x - w, yy); ctx.lineTo(x + w, yy - 26); ctx.moveTo(x + w, yy); ctx.lineTo(x - w, yy - 26); ctx.stroke(); }
    rect(ctx, x - 64, y - 4, 128, 10, '#4a3a2a'); rect(ctx, x - 40, y - 100, 80, 8, '#4a3a2a');
    ctx.fillStyle = '#6a5a48'; ctx.beginPath(); ctx.moveTo(x - 14, y - 200); ctx.lineTo(x, y - 290); ctx.lineTo(x + 14, y - 200); ctx.fill();
    if (Math.sin(now * 5) > 0.3) glow(ctx, x, y - 290, 4, '#fff6c0', 16); // きらめき
  }
  function fountain(ctx, x, y, now) {
    circle(ctx, x, y, 110, '#d8ccb0'); circle(ctx, x, y, 92, '#4a8ad8'); circle(ctx, x, y, 92 - 6, '#5a9ae8');
    circle(ctx, x, y, 22, '#d8ccb0');
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU + now; circle(ctx, x + Math.cos(a) * (30 + (now * 40 % 40)), y + Math.sin(a) * (30 + (now * 40 % 40)), 3, '#ffffffaa'); }
    // カフェのテーブル
    for (const [dx, dy] of [[-130, -120], [130, -120], [-130, 120], [130, 120]]) {
      circle(ctx, x + dx, y + dy, 14, '#2a2a2a'); circle(ctx, x + dx, y + dy, 10, '#f0f0f0');
      circle(ctx, x + dx - 18, y + dy, 6, '#8a4a2a'); circle(ctx, x + dx + 18, y + dy, 6, '#8a4a2a');
    }
  }
  function soccer(ctx, pl) {
    const x = pl.x + 15, y = pl.y + 45, w = pl.w - 30, h = pl.h - 90;
    for (let k = 0; k < 6; k++) rect(ctx, x + k * w / 6, y, w / 6, h, k % 2 ? '#3a9a3a' : '#44a844');
    ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = 4;
    ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
    ctx.beginPath(); ctx.moveTo(x + w / 2, y + 6); ctx.lineTo(x + w / 2, y + h - 6); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, 40, 0, TAU); ctx.stroke();
    ctx.strokeRect(x + 6, y + h / 2 - 50, 46, 100); ctx.strokeRect(x + w - 52, y + h / 2 - 50, 46, 100);
    rect(ctx, x - 4, y + h / 2 - 24, 10, 48, '#fff'); rect(ctx, x + w - 6, y + h / 2 - 24, 10, 48, '#fff');
    circle(ctx, x + w / 2 + 20, y + h / 2 - 8, 6, '#fff');
  }
  function palm(ctx, x, y, now) {
    shadow(ctx, x, y + 40, 30, 10);
    ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(x, y + 40); ctx.quadraticCurveTo(x + 10, y, x + 4, y - 30); ctx.stroke();
    const s = Math.sin(now * 1.5 + x) * 0.08;
    ctx.fillStyle = '#2a9a4a';
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * TAU + s;
      ctx.beginPath(); ctx.ellipse(x + 4 + Math.cos(a) * 26, y - 30 + Math.sin(a) * 16, 28, 8, a, 0, TAU); ctx.fill();
    }
    circle(ctx, x + 4, y - 30, 7, '#6a4a2a');
  }
  function redeemer(ctx, x, y, now) {
    circle(ctx, x, y + 20, 130, '#6aa84a');
    rect(ctx, x - 40, y - 10, 80, 70, '#9a9690'); rect(ctx, x - 50, y + 50, 100, 18, '#7a7670');
    shadow(ctx, x, y + 60, 120, 16);
    // 両手を広げた像
    ctx.fillStyle = '#e8e4dc';
    ctx.beginPath(); ctx.moveTo(x - 22, y - 10); ctx.lineTo(x - 14, y - 150); ctx.lineTo(x + 14, y - 150); ctx.lineTo(x + 22, y - 10); ctx.closePath(); ctx.fill();
    rect(ctx, x - 110, y - 150, 220, 18, '#e8e4dc');
    circle(ctx, x, y - 168, 16, '#e8e4dc');
    ctx.fillStyle = '#00000018'; ctx.fillRect(x, y - 150, 14, 140);
    for (const [dx, dy] of [[-110, 40], [110, 40], [-90, -60], [90, -60]]) palm(ctx, x + dx, y + dy, now);
  }
  function pagoda(ctx, x, y, now) {
    rect(ctx, x - 120, y - 120, 240, 240, '#a89a88');
    shadow(ctx, x, y + 80, 100, 18);
    for (let k = 0; k < 5; k++) {
      const yy = y + 70 - k * 48, w = 80 - k * 12;
      rect(ctx, x - w * 0.6, yy - 40, w * 1.2, 40, '#c8241a');
      ctx.fillStyle = k % 2 ? '#2a8a6a' : '#1a5a44';
      ctx.beginPath(); ctx.moveTo(x - w - 18, yy - 30); ctx.quadraticCurveTo(x - w, yy - 44, x, yy - 56); ctx.quadraticCurveTo(x + w, yy - 44, x + w + 18, yy - 30); ctx.lineTo(x + w, yy - 40); ctx.lineTo(x - w, yy - 40); ctx.closePath(); ctx.fill();
      glow(ctx, x - w - 14, yy - 28, 4, '#ff3a2a', 10); glow(ctx, x + w + 14, yy - 28, 4, '#ff3a2a', 10);
    }
    rect(ctx, x - 3, y - 230, 6, 30, '#e8c03a'); circle(ctx, x, y - 232, 7, '#e8c03a');
  }
  function moonGarden(ctx, x, y, now) {
    rect(ctx, x - 140, y - 140, 280, 280, '#5a7a4a');
    ctx.fillStyle = '#3a7ab0'; ctx.beginPath(); ctx.ellipse(x + 30, y + 40, 80, 50, 0.3, 0, TAU); ctx.fill();
    for (let k = 0; k < 4; k++) circle(ctx, x + 10 + k * 20, y + 40 + Math.sin(now + k) * 4, 5, '#ff8a2a'); // 金魚
    // 月の門（丸い門）
    rect(ctx, x - 130, y - 110, 260, 40, '#e8e0d0');
    ctx.fillStyle = '#3a3a3a'; ctx.beginPath(); ctx.arc(x - 40, y - 90, 30, 0, TAU); ctx.fill();
    rect(ctx, x - 140, y - 120, 280, 10, '#2a8a6a');
    // 龍の像
    ctx.strokeStyle = '#e8c03a'; ctx.lineWidth = 10; ctx.beginPath();
    for (let k = 0; k <= 20; k++) { const t = k / 20; const px = x - 100 + t * 80, py = y + 70 + Math.sin(t * 9 + now * 2) * 14; if (!k) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
    ctx.stroke(); circle(ctx, x - 16, y + 70 + Math.sin(9 + now * 2) * 14, 12, '#e8c03a'); circle(ctx, x - 12, y + 66 + Math.sin(9 + now * 2) * 14, 3, '#c8241a');
  }
  function liberty(ctx, x, y, now) {
    circle(ctx, x, y + 20, 130, '#6a8a5a');
    ctx.fillStyle = '#9a9488'; ctx.beginPath();
    for (let k = 0; k < 11; k++) { const a = k / 11 * TAU; ctx.lineTo(x + Math.cos(a) * 70, y + 30 + Math.sin(a) * 50); } ctx.fill(); // 星形の台座
    rect(ctx, x - 34, y - 30, 68, 70, '#b8b0a0');
    shadow(ctx, x, y + 40, 70, 14);
    const g = '#5aa894', d = '#3a8a76';
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - 26, y - 30); ctx.lineTo(x - 16, y - 150); ctx.lineTo(x + 16, y - 150); ctx.lineTo(x + 28, y - 30); ctx.closePath(); ctx.fill();
    ctx.fillStyle = d; ctx.fillRect(x - 4, y - 150, 6, 120);
    circle(ctx, x, y - 164, 14, g);
    for (let k = 0; k < 7; k++) { const a = -Math.PI / 2 + (k - 3) * 0.32; ctx.strokeStyle = g; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, y - 168); ctx.lineTo(x + Math.cos(a) * 28, y - 168 + Math.sin(a) * 28); ctx.stroke(); }
    ctx.strokeStyle = g; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(x + 14, y - 140); ctx.lineTo(x + 26, y - 210); ctx.stroke(); // たいまつを持つ腕
    ctx.shadowColor = '#ffb83a'; ctx.shadowBlur = 20;
    ctx.fillStyle = '#ffc83a'; ctx.beginPath(); ctx.ellipse(x + 27, y - 222 + Math.sin(now * 8) * 2, 7, 12, 0, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    rect(ctx, x - 30, y - 118, 14, 26, d); // 本
  }
  function court(ctx, pl) {
    const x = pl.x + 30, y = pl.y + 50, w = pl.w - 60, h = pl.h - 100;
    rect(ctx, pl.x + 10, pl.y + 10, pl.w - 20, pl.h - 20, '#2a5a8a');
    rect(ctx, x, y, w, h, '#c8743a');
    ctx.strokeStyle = '#ffffffdd'; ctx.lineWidth = 4;
    ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
    ctx.beginPath(); ctx.moveTo(x + w / 2, y + 6); ctx.lineTo(x + w / 2, y + h - 6); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, 32, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + 6, y + h / 2, 90, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + w - 6, y + h / 2, 90, Math.PI / 2, Math.PI * 1.5); ctx.stroke();
    for (const gx of [x + 20, x + w - 20]) { circle(ctx, gx, y + h / 2, 10, '#ff5a1a'); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
    // ホットドッグの屋台
    rect(ctx, pl.x + pl.w - 90, pl.y + 14, 70, 30, '#e8e8e8'); for (let s = 0; s < 7; s++) rect(ctx, pl.x + pl.w - 90 + s * 10, pl.y + 10, 10, 10, s % 2 ? '#fff' : '#e8241a');
  }

  // ヘリポートの赤い灯り（点滅）。usaRoof と同じ乱数の1回目でヘリポートかどうかが決まる
  function usaBlink(ctx, b, R, now) {
    const H = b.h - 6;
    if (!(b.w > 200 && H > 200 && R() < 0.5)) return;
    const cx = b.x + b.w / 2, cy = b.y + H / 2;
    if (Math.sin(now * 3 + b.x) > 0) glow(ctx, cx + 60, cy - 60, 4, '#ff3a3a', 10);
  }

  // 画面全体の色味
  function drawTint(ctx, W, H, stage) {
    const t = theme(stage).tint;
    if (!t) return;
    ctx.fillStyle = t; ctx.fillRect(0, 0, W, H);
  }

  const api = { THEME, theme, drawGround, drawBuilding, drawPlaza, drawTint, STAGE_HAS_ANIM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Stages = api;
})(typeof self !== 'undefined' ? self : this);
