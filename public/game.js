// バスターズ クライアント
(() => {
  'use strict';
  const S = window.Shared;

  const $ = id => document.getElementById(id);
  const screens = ['title', 'lobby', 'game', 'gacha', 'result'];
  function show(id, keepGame) {
    for (const s of screens) $(s).classList.toggle('active', s === id || (!!keepGame && s === 'game'));
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- お友達（端末に保存） ----------
  function loadFriends() {
    let f = {};
    try { f = JSON.parse(localStorage.getItem('friends') || '{}') || {}; } catch { f = {}; }
    for (const y of S.YOKAI) if (y.starter && !f[y.id]) f[y.id] = 1;
    return f;
  }
  function saveFriends() { try { localStorage.setItem('friends', JSON.stringify(friends)); } catch {} }
  let friends = loadFriends();
  let selYokai = localStorage.getItem('yokai');
  if (!friends[selYokai]) selYokai = 'nekomata';

  // ---------- 状態 ----------
  let ws = null;
  let myId = null;
  let lobby = null;
  let map = null;           // 街（シードから生成）
  let fusuma = null;
  let dama = new Map();     // 鬼玉 id -> {x,y}
  let snap = null;
  let timeLimit = 180;
  let result = null;
  const ents = new Map();
  const floats = [];
  const fx = [];
  const bubbles = new Map(); // 見回り鬼の笛表示 id -> 残り時間
  let shake = 0;
  let banner = null;
  let myPred = null;

  $('name').value = localStorage.getItem('name') || '';
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom) $('code').value = urlRoom.toUpperCase();
  function updateFriendCount() {
    $('friendCount').textContent = `お友達 ${Object.keys(friends).length} / ${S.YOKAI.length}`;
  }
  updateFriendCount();

  // ---------- サウンド（簡易） ----------
  let actx = null;
  function beep(freq, dur, type = 'sine', vol = 0.08, slide = 0) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = freq;
      if (slide) o.frequency.linearRampToValueAtTime(freq + slide, actx.currentTime + dur);
      g.gain.value = vol; g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
    } catch {}
  }

  // ---------- 通信 ----------
  function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

  function connect(first) {
    const name = $('name').value.trim() || 'プレイヤー';
    localStorage.setItem('name', name);
    $('err').textContent = '';
    goFullscreen();
    beep(1, 0.01, 'sine', 0.0001); // iOSで音を有効にする
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = () => send({ ...first, name, yokai: selYokai });
    ws.onmessage = e => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      ws = null; myId = null; snap = null;
      show('title');
      $('err').textContent = '接続が切れました';
    };
  }

  function onMessage(m) {
    switch (m.t) {
      case 'error':
        $('err').textContent = m.msg;
        ws.onclose = null; ws.close(); ws = null;
        break;
      case 'welcome': myId = m.id; break;
      case 'lobby':
        lobby = m;
        if (m.state === 'lobby') { renderLobby(); show('lobby'); }
        else if (m.state === 'battle') show('game');
        break;
      case 'start':
        map = S.generateCity(m.seed);
        fusuma = m.fusuma;
        timeLimit = m.timeLimit;
        dama = new Map(m.dama.map(d => [d.id, d]));
        snap = null; myPred = null; result = null;
        ents.clear(); floats.length = 0; fx.length = 0; bubbles.clear();
        banner = { text: '鬼の世界に入った！鬼玉を集めよう', t: 2.2 };
        break;
      case 'state':
        snap = m;
        for (const ev of m.ev) handleEvent(ev);
        break;
      case 'result':
        result = m;
        startGacha();
        break;
    }
  }

  $('btnCreate').onclick = () => connect({ t: 'create' });
  $('btnJoin').onclick = () => {
    const code = $('code').value.trim().toUpperCase();
    if (code.length !== 4) { $('err').textContent = '4文字のコードを入力してね'; return; }
    connect({ t: 'join', code });
  };
  $('btnStart').onclick = () => send({ t: 'start' });
  $('btnAgain').onclick = () => send({ t: 'toLobby' });
  $('btnShare').onclick = () => {
    const url = `${location.origin}${location.pathname}?room=${lobby.code}`;
    if (navigator.share) navigator.share({ title: 'バスターズ', text: '一緒に鬼の世界へ行こう！', url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => { $('btnShare').textContent = 'コピーしました'; });
  };

  // ---------- ロビー ----------
  function renderLobby() {
    $('roomCode').textContent = lobby.code;
    const ul = $('plist');
    ul.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const p = lobby.players[i];
      const li = document.createElement('li');
      if (p) {
        const y = S.YOKAI_BY_ID[p.yokai];
        li.innerHTML = `<div class="dot" style="background:${y.color}"></div><b>${esc(p.name)}${p.host ? ' 👑' : ''}</b><span style="color:${S.RANKS[y.rank].color}">${y.rank} ${y.name}</span>`;
      } else { li.className = 'empty'; li.textContent = 'あき'; }
      ul.appendChild(li);
    }
    renderFriends();
    const me = lobby.players.find(p => p.id === myId);
    const isHost = me && me.host;
    $('btnStart').style.display = isHost ? '' : 'none';
    $('waitMsg').style.display = isHost ? 'none' : '';
  }

  function renderFriends() {
    const el = $('friends');
    el.innerHTML = '';
    for (const y of S.YOKAI) {
      const owned = friends[y.id];
      const d = document.createElement('div');
      d.className = 'yk' + (y.id === selYokai ? ' sel' : '') + (owned ? '' : ' locked');
      d.innerHTML = owned
        ? `<span class="rk" style="color:${S.RANKS[y.rank].color}">${y.rank}</span>${owned > 1 ? `<span class="cnt">×${owned}</span>` : ''}<div class="face" style="background:${y.color}"></div>${y.name}<br><small>${S.ROLES[y.role].name}</small>`
        : `<span class="rk" style="color:${S.RANKS[y.rank].color}">${y.rank}</span><div class="face" style="background:#333"></div>？？？<br><small>&nbsp;</small>`;
      if (owned) d.onclick = () => {
        selYokai = y.id; localStorage.setItem('yokai', y.id);
        send({ t: 'yokai', id: y.id });
        renderFriends();
      };
      el.appendChild(d);
    }
  }

  // ---------- 鬼ガチャ ----------
  let gachaStep = 0;
  function startGacha() {
    const mine = result.players.find(p => p.id === myId);
    $('reveal').classList.remove('show');
    $('ball').className = 'ball';
    $('machine').classList.remove('turn');
    $('machine').style.display = '';
    $('btnToResult').style.display = 'none';
    $('gachaHint').style.display = '';
    if (mine && mine.gacha) {
      const ball = S.BALLS.find(b => b.key === mine.gacha.ball);
      $('gachaTitle').textContent = '脱出成功！ 鬼ガチャ';
      $('gachaSub').textContent = `集めた鬼玉 ${mine.dama}個 → ${ball.name}のガチャ玉`;
      $('ball').style.background = ball.color;
      $('ball').style.color = ball.color;
      gachaStep = 1;
    } else {
      $('gachaTitle').textContent = mine && !mine.escaped ? '脱出失敗…' : '鬼ガチャ';
      $('gachaSub').textContent = '襖から脱出できなかったので、ガチャは引けません';
      $('machine').style.display = 'none';
      $('gachaHint').style.display = 'none';
      $('btnToResult').style.display = '';
      gachaStep = 0;
    }
    show('gacha', true);
  }

  $('gacha').addEventListener('click', e => {
    if (e.target.id === 'btnToResult') return;
    const mine = result && result.players.find(p => p.id === myId);
    if (!mine || !mine.gacha) return;
    if (gachaStep === 1) {
      gachaStep = 2;
      $('machine').classList.add('turn');
      beep(300, 0.5, 'square', 0.05, 200);
      setTimeout(() => { $('ball').classList.add('drop'); beep(600, 0.15, 'triangle'); }, 600);
      setTimeout(() => { $('ball').className = 'ball shake'; $('gachaHint').textContent = 'タップしてあける！'; gachaStep = 3; }, 1700);
      $('gachaHint').textContent = '…';
    } else if (gachaStep === 3) {
      gachaStep = 4;
      const y = S.YOKAI_BY_ID[mine.gacha.yokai];
      const isNew = !friends[y.id];
      friends[y.id] = (friends[y.id] || 0) + 1;
      saveFriends(); updateFriendCount();
      $('machine').style.display = 'none';
      $('revealIcon').style.background = y.color;
      $('revealRank').textContent = `${y.rank}ランク`;
      $('revealRank').style.color = S.RANKS[y.rank].color;
      $('revealName').textContent = y.name;
      $('revealMsg').textContent = isNew ? `${S.ROLES[y.role].name}の${y.name}がお友達になった！` : `${y.name}とさらに仲良くなった！（×${friends[y.id]}）`;
      $('reveal').classList.add('show');
      $('gachaHint').style.display = 'none';
      $('btnToResult').style.display = '';
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.25, 'triangle', 0.08), i * 110));
    }
  });

  $('btnToResult').onclick = () => {
    renderResult();
    show('result', true);
  };

  function renderResult() {
    const anyEsc = result.players.some(p => p.escaped);
    $('resTitle').textContent = anyEsc ? '鬼の世界から脱出！' : '全員脱出できなかった…';
    $('resTable').innerHTML = '<tr><th>なまえ</th><th>お友達</th><th>脱出</th><th>鬼玉</th><th>ガチャ</th></tr>' +
      result.players.map(p => {
        const y = S.YOKAI_BY_ID[p.yokai];
        const g = p.gacha ? S.YOKAI_BY_ID[p.gacha.yokai] : null;
        return `<tr><td>${esc(p.name)}</td><td>${y.name}</td><td>${p.escaped ? '⭕' : '❌'}</td><td>${p.dama}</td><td>${g ? `<span style="color:${S.RANKS[g.rank].color}">${g.rank}</span> ${g.name}` : '-'}</td></tr>`;
      }).join('');
    const me = lobby && lobby.players.find(p => p.id === myId);
    $('btnAgain').disabled = !(me && me.host);
    $('btnAgain').textContent = me && me.host ? 'ロビーへもどる' : 'ホストを待っています…';
  }

  function goFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
    }
  }

  // ---------- 演出イベント ----------
  function nameOf(id) { const p = snap && snap.players.find(q => q.id === id); return p ? p.name : ''; }
  function handleEvent(ev) {
    const near = (x, y) => myPred && Math.hypot(x - myPred.x, y - myPred.y) < 700;
    switch (ev.k) {
      case 'dmg': floats.push({ x: ev.x, y: ev.y, text: ev.v, c: '#fff', t: 0.8 }); break;
      case 'hurt':
        floats.push({ x: ev.x, y: ev.y, text: ev.v, c: '#ff5050', t: 0.8 });
        if (ev.id === myId) { shake = 0.25; navigator.vibrate?.(40); }
        break;
      case 'heal': floats.push({ x: ev.x, y: ev.y, text: '+' + ev.v, c: '#7dff9a', t: 0.8 }); break;
      case 'slash': fx.push({ k: 'slash', x: ev.x, y: ev.y, a: ev.a, t: 0.15, max: 0.15 }); break;
      case 'ring': fx.push({ k: 'ring', x: ev.x, y: ev.y, r: ev.r, c: ev.c, t: 0.4, max: 0.4 }); break;
      case 'boom':
        fx.push({ k: 'boom', x: ev.x, y: ev.y, r: ev.r || 80, t: ev.big ? 0.5 : 0.35, max: ev.big ? 0.5 : 0.35 });
        if (near(ev.x, ev.y)) { shake = Math.max(shake, ev.big ? 0.4 : 0.15); beep(90, 0.3, 'sawtooth', 0.06, -40); }
        break;
      case 'whistle':
        bubbles.set(ev.id, 1.0);
        if (ev.target === myId) {
          beep(2400, 0.25, 'sine', ev.quiet ? 0.03 : 0.07, 300);
          if (!ev.quiet) { banner = { text: '見回り鬼に見つかった！', t: 1.8, c: '#ff5050' }; navigator.vibrate?.([60, 40, 60]); }
        }
        break;
      case 'dg':
        dama.delete(ev.id);
        if (ev.by === myId) beep(1200, 0.08, 'triangle', 0.05, 400);
        break;
      case 'da': dama.set(ev.id, { id: ev.id, x: ev.x, y: ev.y }); break;
      case 'pick':
        if (ev.id === myId) { banner = { text: `${S.ITEMS[ev.item].icon} ${S.ITEMS[ev.item].name}をひろった`, t: 1.2, c: '#ffe36b' }; beep(880, 0.12, 'square', 0.04); }
        break;
      case 'use': if (ev.id === myId) beep(660, 0.1, 'square', 0.05); break;
      case 'stun': fx.push({ k: 'ring', x: ev.x, y: ev.y, r: 120, c: '#ffe14a', t: 0.6, max: 0.6 }); banner = { text: 'ボス鬼がしびれた！', t: 1.4, c: '#ffe14a' }; break;
      case 'oniDown': fx.push({ k: 'ring', x: ev.x, y: ev.y, r: 90, c: '#ffffff', t: 0.5, max: 0.5 }); if (near(ev.x, ev.y)) banner = { text: '見回り鬼をたおした！', t: 1.2 }; break;
      case 'bossDown': banner = { text: 'ボス鬼をたおした！', t: 2.5, c: '#ffd84a' }; shake = 0.6; break;
      case 'down': if (ev.id === myId) banner = { text: 'たおれた… 仲間を待とう', t: 2, c: '#ff8080' }; break;
      case 'revive': if (ev.id === myId) banner = { text: '復活！', t: 1.2, c: '#7dff9a' }; break;
      case 'escape':
        banner = ev.id === myId ? { text: '脱出成功！', t: 2.5, c: '#ffd84a' } : { text: `${nameOf(ev.id)}が脱出した！`, t: 1.6 };
        break;
    }
  }

  // ---------- 入力 ----------
  const cv = $('cv');
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * DPR; cv.height = H * DPR;
  }
  window.addEventListener('resize', resize);
  resize();

  const input = { mx: 0, my: 0, atk: false, strong: false, item: false, dash: false };
  const stick = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const btnHold = { atk: null, strong: null, item: null, dash: null };
  const keys = new Set();

  // 右側のボタン配置
  function buttons() {
    const s = Math.min(W, H);
    const big = s * 0.13, mid = s * 0.088;
    const bx = W - big - 26, by = H - big - 22;
    return {
      atk:    { x: bx, y: by, r: big },
      strong: { x: bx - big * 0.25, y: by - big * 1.85, r: mid },
      item:   { x: bx - big * 1.95, y: by + big * 0.25, r: mid },
      dash:   { x: bx - big * 1.75, y: by - big * 1.35, r: mid },
    };
  }

  const playing = () => $('game').classList.contains('active') && !$('gacha').classList.contains('active') && !$('result').classList.contains('active');
  function pointerDown(e) {
    if (!playing()) return;
    for (const [k, b] of Object.entries(buttons())) {
      if (Math.hypot(e.clientX - b.x, e.clientY - b.y) < b.r * 1.2) {
        btnHold[k] = e.pointerId;
        if (k !== 'atk') navigator.vibrate?.(12);
        e.preventDefault();
        return;
      }
    }
    if (e.clientX < W * 0.5 && !stick.active) Object.assign(stick, { active: true, id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY });
    e.preventDefault();
  }
  function pointerMove(e) { if (stick.active && e.pointerId === stick.id) { stick.x = e.clientX; stick.y = e.clientY; } }
  function pointerUp(e) {
    if (stick.active && e.pointerId === stick.id) stick.active = false;
    for (const k in btnHold) if (btnHold[k] === e.pointerId) btnHold[k] = null;
  }
  cv.addEventListener('pointerdown', pointerDown);
  window.addEventListener('pointermove', pointerMove);
  window.addEventListener('pointerup', pointerUp);
  window.addEventListener('pointercancel', pointerUp);
  window.addEventListener('keydown', e => keys.add(e.code));
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  const STICK_R = 60;
  function readInput() {
    let mx = 0, my = 0;
    if (stick.active) {
      let dx = stick.x - stick.ox, dy = stick.y - stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > STICK_R) { stick.ox = stick.x - (dx / d) * STICK_R; stick.oy = stick.y - (dy / d) * STICK_R; dx = stick.x - stick.ox; dy = stick.y - stick.oy; }
      mx = dx / STICK_R; my = dy / STICK_R;
    }
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) my -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) my += 1;
    input.mx = +mx.toFixed(2); input.my = +my.toFixed(2);
    input.atk = btnHold.atk !== null || keys.has('KeyJ') || keys.has('Space');
    input.strong = btnHold.strong !== null || keys.has('KeyK');
    input.item = btnHold.item !== null || keys.has('KeyL');
    input.dash = btnHold.dash !== null || keys.has('ShiftLeft') || keys.has('ShiftRight');
  }

  let lastSent = '', sendT = 0;
  function sendInput(dt) {
    sendT -= dt;
    const s = JSON.stringify(input);
    if (s !== lastSent || sendT <= 0) { send({ t: 'input', ...input }); lastSent = s; sendT = 0.25; }
  }

  // ---------- 描画 ----------
  function lerpEnt(key, tx, ty, k) {
    let e = ents.get(key);
    if (!e) { e = { x: tx, y: ty }; ents.set(key, e); }
    e.x += (tx - e.x) * k; e.y += (ty - e.y) * k;
    return e;
  }
  function bar(x, y, w, h, v, c) {
    ctx.fillStyle = '#000a'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = c; ctx.fillRect(x, y, w * Math.max(0, Math.min(1, v)), h);
  }

  const ROOF = ['#5a3a5a', '#4a3a60', '#603a3a', '#3a4a5a'];
  function drawCity(cam) {
    ctx.fillStyle = '#2e2236';
    ctx.fillRect(0, 0, map.w, map.h);
    // 石畳っぽい模様
    ctx.strokeStyle = '#ffffff08'; ctx.lineWidth = 2;
    const g = 75;
    const x0 = Math.max(0, Math.floor((cam.x - cam.vw / 2) / g) * g), x1 = Math.min(map.w, cam.x + cam.vw / 2 + g);
    const y0 = Math.max(0, Math.floor((cam.y - cam.vh / 2) / g) * g), y1 = Math.min(map.h, cam.y + cam.vh / 2 + g);
    ctx.beginPath();
    for (let x = x0; x <= x1; x += g) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = y0; y <= y1; y += g) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
    ctx.strokeStyle = '#ff4a3a'; ctx.lineWidth = 10; ctx.strokeRect(0, 0, map.w, map.h);
  }
  function drawBuildings(cam) {
    const l = cam.x - cam.vw / 2 - 50, r = cam.x + cam.vw / 2 + 50, t = cam.y - cam.vh / 2 - 50, bt = cam.y + cam.vh / 2 + 50;
    for (const b of map.buildings) {
      if (b.x > r || b.x + b.w < l || b.y > bt || b.y + b.h < t) continue;
      ctx.fillStyle = '#140c18'; ctx.fillRect(b.x, b.y + 14, b.w, b.h);       // 影/壁
      ctx.fillStyle = ROOF[b.hue]; ctx.fillRect(b.x, b.y, b.w, b.h - 6);      // 屋根
      ctx.strokeStyle = '#00000055'; ctx.lineWidth = 3;
      ctx.beginPath();
      for (let yy = b.y + 22; yy < b.y + b.h - 10; yy += 22) { ctx.moveTo(b.x + 6, yy); ctx.lineTo(b.x + b.w - 6, yy); }
      ctx.stroke();
      // ちょうちん
      ctx.fillStyle = '#ff6a3d'; ctx.shadowColor = '#ff6a3d'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(b.x + 14, b.y + b.h + 2, 6, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawFusuma(now) {
    const { x, y } = fusuma;
    ctx.save(); ctx.translate(x, y);
    ctx.shadowColor = '#ffd84a'; ctx.shadowBlur = 25 + Math.sin(now * 4) * 10;
    ctx.fillStyle = '#f4ead0'; ctx.fillRect(-34, -44, 68, 80);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#6a3a1a'; ctx.lineWidth = 4; ctx.strokeRect(-34, -44, 68, 80);
    ctx.beginPath(); ctx.moveTo(0, -44); ctx.lineTo(0, 36); ctx.stroke();
    ctx.fillStyle = '#6a3a1a'; ctx.fillRect(-10, -6, 5, 12); ctx.fillRect(5, -6, 5, 12);
    ctx.fillStyle = '#ffd84a'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('出口', 0, -52);
    ctx.restore();
  }

  function drawOni(x, y, r, body, face, flash, horns) {
    ctx.fillStyle = '#0006'; ctx.beginPath(); ctx.ellipse(x, y + r * 0.85, r, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = flash ? '#fff' : body;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f3e3b0';
    for (const s of horns) { ctx.beginPath(); ctx.moveTo(x + s * r * 0.3, y - r * 0.75); ctx.lineTo(x + s * r * 0.55, y - r * 1.4); ctx.lineTo(x + s * r * 0.72, y - r * 0.55); ctx.closePath(); ctx.fill(); }
    const ex = Math.cos(face) * r * 0.15, ey = Math.sin(face) * r * 0.1;
    ctx.fillStyle = '#ffeb3b';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(x + s * r * 0.34 + ex, y - r * 0.15 + ey, r * 0.18, r * 0.13, s * 0.3, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#000';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(x + s * r * 0.34 + ex * 1.3, y - r * 0.15 + ey, r * 0.07, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#3a0a0a'; ctx.beginPath(); ctx.ellipse(x + ex, y + r * 0.38 + ey, r * 0.42, r * 0.15, 0, 0, Math.PI * 2); ctx.fill();
  }

  function drawPatrol(e, pos, now) {
    // 視界
    const range = 300, half = 0.65;
    ctx.fillStyle = e.alert ? 'rgba(255,60,60,0.16)' : 'rgba(255,240,120,0.12)';
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y); ctx.arc(pos.x, pos.y, range, e.face - half, e.face + half); ctx.closePath(); ctx.fill();
    drawOni(pos.x, pos.y, 22, '#3a6ad8', e.face, e.flash, [0]);
    bar(pos.x - 20, pos.y - 40, 40, 4, e.hp / e.maxHp, '#ff5050');
    if (e.alert) {
      ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#ff5050'; ctx.fillText(bubbles.has(e.id) ? 'ピーッ！♪' : '！', pos.x, pos.y - 48 - Math.abs(Math.sin(now * 8)) * 4);
    }
  }

  function drawBoss(b, pos, now) {
    const wob = Math.sin(now * 5) * 3;
    if (b.st !== 'wander' && !b.stun) { ctx.shadowColor = '#ff2020'; ctx.shadowBlur = 30; }
    drawOni(pos.x, pos.y + wob, 46, '#b8242a', b.face, b.flash, [-1, 1]);
    ctx.shadowBlur = 0;
    if (b.stun) {
      ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = 3;
      for (let k = 0; k < 5; k++) {
        const a = now * 6 + k * 1.26;
        ctx.beginPath(); ctx.moveTo(pos.x + Math.cos(a) * 30, pos.y - 60 + Math.sin(a) * 10); ctx.lineTo(pos.x + Math.cos(a) * 44, pos.y - 70 + Math.sin(a) * 10); ctx.stroke();
      }
      ctx.fillStyle = '#ffe14a'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('ビリビリ…', pos.x, pos.y - 80);
    }
    bar(pos.x - 50, pos.y - 72, 100, 6, b.hp / b.maxHp, '#ff8a3d');
  }

  function drawPlayer(p, pos, me) {
    const y = S.YOKAI_BY_ID[p.yokai];
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.globalAlpha = p.down ? 0.5 : p.invis ? (me ? 0.35 : 0.15) : 1;
    ctx.fillStyle = '#0005'; ctx.beginPath(); ctx.ellipse(0, 16, 18, 6, 0, 0, Math.PI * 2); ctx.fill();
    if (me) { ctx.strokeStyle = '#ffe36b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 27, 0, Math.PI * 2); ctx.stroke(); }
    if (p.sh) { ctx.fillStyle = 'rgba(100,160,255,0.3)'; ctx.beginPath(); ctx.arc(0, 0, 31, 0, Math.PI * 2); ctx.fill(); }
    if (p.run || p.dash) {
      ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 3;
      for (let k = -1; k <= 1; k++) { const a = p.face + Math.PI + k * 0.4; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 22, Math.sin(a) * 22); ctx.lineTo(Math.cos(a) * 36, Math.sin(a) * 36); ctx.stroke(); }
    }
    ctx.fillStyle = y.color;
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = S.RANKS[y.rank].color; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(Math.cos(p.face) * 6 - 5, Math.sin(p.face) * 4 - 3, 3, 0, Math.PI * 2); ctx.arc(Math.cos(p.face) * 6 + 5, Math.sin(p.face) * 4 - 3, 3, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#fff'; ctx.fillText(p.name, 0, -34);
    bar(-22, -29, 44, 5, p.hp / p.maxHp, '#5be07a');
    if (p.down) {
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.fillText('たすけて！', 0, 40);
      ctx.strokeStyle = '#7dff9a'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(0, 0, 36, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.rv); ctx.stroke();
    }
    ctx.restore();
  }

  function drawTelegraph(t) {
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.fillStyle = 'rgba(255,40,40,0.22)';
    ctx.strokeStyle = 'rgba(255,60,60,0.9)'; ctx.lineWidth = 3;
    if (t.shape === 'rect') {
      ctx.rotate(t.a);
      ctx.fillRect(0, -t.w / 2, t.len, t.w); ctx.strokeRect(0, -t.w / 2, t.len, t.w);
      ctx.fillStyle = 'rgba(255,40,40,0.45)'; ctx.fillRect(0, -t.w / 2, t.len * t.p, t.w);
    } else {
      ctx.beginPath(); ctx.arc(0, 0, t.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,40,40,0.45)'; ctx.beginPath(); ctx.arc(0, 0, t.r * t.p, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // ---------- HUD ----------
  function drawMinimap(me, now) {
    const mw = Math.min(W * 0.21, 200), mh = mw * map.h / map.w;
    const ox = 10, oy = 10;
    const sx = mw / map.w;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#1a1020cc'; ctx.fillRect(ox, oy, mw, mh);
    ctx.fillStyle = '#5a4a66';
    for (const b of map.buildings) ctx.fillRect(ox + b.x * sx, oy + b.y * sx, b.w * sx, b.h * sx);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#fff6'; ctx.lineWidth = 1; ctx.strokeRect(ox, oy, mw, mh);
    const dot = (x, y, r, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(ox + x * sx, oy + y * sx, r, 0, Math.PI * 2); ctx.fill(); };
    // 襖
    ctx.fillStyle = '#ffd84a'; ctx.fillRect(ox + fusuma.x * sx - 5, oy + fusuma.y * sx - 6, 10, 12);
    ctx.strokeStyle = '#6a3a1a'; ctx.strokeRect(ox + fusuma.x * sx - 5, oy + fusuma.y * sx - 6, 10, 12);
    // アイテム（近くだけ種類がわかる）
    ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const it of snap.items) {
      const known = me && Math.hypot(it.x - me.x, it.y - me.y) < S.ITEM_REVEAL_DIST;
      if (known) { ctx.font = '10px sans-serif'; ctx.fillText(S.ITEMS[it.type].icon, ox + it.x * sx, oy + it.y * sx); }
      else { dot(it.x, it.y, 4, '#d0c0ff'); ctx.fillStyle = '#301050'; ctx.font = 'bold 7px sans-serif'; ctx.fillText('?', ox + it.x * sx, oy + it.y * sx + 0.5); }
    }
    ctx.textBaseline = 'alphabetic';
    for (const e of snap.patrols) dot(e.x, e.y, 3.5, e.alert ? (Math.sin(now * 12) > 0 ? '#ff4040' : '#ffffff') : '#5c8cff');
    if (snap.boss) {
      dot(snap.boss.x, snap.boss.y, 6, '#ff2020');
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(ox + snap.boss.x * sx, oy + snap.boss.y * sx, 6, 0, Math.PI * 2); ctx.stroke();
    }
    for (const p of snap.players) {
      if (p.esc) continue;
      const pos = p.id === myId && myPred ? myPred : p;
      dot(pos.x, pos.y, p.id === myId ? 4.5 : 3.5, p.id === myId ? '#ffe36b' : S.YOKAI_BY_ID[p.yokai].color);
    }
    ctx.restore();
    return mh + oy;
  }

  function drawHUD(me, now) {
    drawMinimap(me, now);

    // タイマー
    const tl = Math.max(0, snap.timeLeft);
    const mm = Math.floor(tl / 60), ss = Math.floor(tl % 60);
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(Math.min(W, H) * 0.075)}px sans-serif`;
    ctx.lineWidth = 5; ctx.strokeStyle = '#000';
    const tcol = tl < 30 ? (Math.sin(now * 8) > 0 ? '#ff4040' : '#fff') : '#fff';
    ctx.strokeText(`${mm}:${String(ss).padStart(2, '0')}`, W / 2, 42); ctx.fillStyle = tcol; ctx.fillText(`${mm}:${String(ss).padStart(2, '0')}`, W / 2, 42);

    // 鬼玉の数
    if (me) {
      const team = snap.players.reduce((a, p) => a + p.dama, 0);
      const ball = S.ballFor(me.dama);
      ctx.textAlign = 'right';
      ctx.fillStyle = ball.color; ctx.beginPath(); ctx.arc(W - 120, 30, 12, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.font = 'bold 22px sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = '#000';
      ctx.strokeText(`× ${me.dama}`, W - 20, 38); ctx.fillStyle = '#ffd0f0'; ctx.fillText(`× ${me.dama}`, W - 20, 38);
      ctx.font = '11px sans-serif'; ctx.fillStyle = '#fffc';
      ctx.fillText(`チーム ${team}個 / ガチャ玉: ${ball.name}`, W - 20, 56);
      const next = S.BALLS.find(b => b.min > me.dama);
      if (next) ctx.fillText(`あと${next.min - me.dama}個で${next.name}`, W - 20, 70);
    }

    // 仲間
    let y = 88;
    ctx.textAlign = 'right';
    for (const p of snap.players) {
      if (p.id === myId) continue;
      ctx.fillStyle = p.esc ? '#ffd84a' : p.down ? '#ff8080' : '#fff'; ctx.font = '11px sans-serif';
      ctx.fillText(p.name + (p.esc ? '（脱出）' : p.down ? '（たおれた）' : ''), W - 20, y);
      if (!p.esc) bar(W - 100, y + 3, 80, 4, p.hp / p.maxHp, '#5be07a');
      y += 20;
    }

    if (me && !me.esc) {
      // 自分のHP
      bar(W / 2 - 90, H - 22, 180, 10, me.hp / me.maxHp, '#5be07a');
      ctx.textAlign = 'center'; ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#fff';
      ctx.fillText(`${S.YOKAI_BY_ID[me.yokai].name}  ${me.hp}/${me.maxHp}`, W / 2, H - 28);

      const bs = buttons();
      const st = S.ROLES[S.YOKAI_BY_ID[me.yokai].role];
      drawButton(bs.atk, btnHold.atk !== null || input.atk, me.atkCd, '#e2531f', '攻撃');
      drawButton(bs.strong, input.strong, me.stCd, '#7a3fbf', '強攻撃', st.strong);
      const it = me.item ? S.ITEMS[me.item] : null;
      drawButton(bs.item, input.item, 0, it ? '#2f8a5a' : '#333', it ? it.icon : 'アイテム', it ? it.name : 'なし', !!it);
      drawButton(bs.dash, input.dash, 0, me.exh ? '#552222' : '#2f62d9', 'ダッシュ', me.inf ? '∞' : null);
      // スタミナ
      const db = bs.dash;
      ctx.strokeStyle = me.inf ? `hsl(${(now * 300) % 360},100%,65%)` : me.exh ? '#ff5050' : '#5be0ff'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(db.x, db.y, db.r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (me.inf ? 1 : me.stam / 100)); ctx.stroke();

      // 警告
      const b = snap.boss;
      if (b && b.target === myId) {
        ctx.textAlign = 'center'; ctx.font = 'bold 16px sans-serif';
        const msg = b.hunt ? '⚠ ボス鬼に居場所がバレている！見回り鬼をたおせ！' : '⚠ ボス鬼が追ってくる！';
        ctx.fillStyle = Math.sin(now * 10) > 0 ? '#ff4040' : '#ffaaaa';
        ctx.fillText(msg, W / 2, 70);
      }
      if (me.invis) { ctx.textAlign = 'center'; ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = '#b08cff'; ctx.fillText('👻 ジミーフィールド中', W / 2, 92); }
    }

    // スティック
    if (stick.active) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#fff3'; ctx.beginPath(); ctx.arc(stick.ox, stick.oy, STICK_R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fffa'; ctx.beginPath(); ctx.arc(stick.x, stick.y, 26, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (timeLimit - snap.timeLeft < 8) {
      ctx.fillStyle = '#ffffff66'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('左側をドラッグで移動', W * 0.22, H - 40);
    }

    if (me && me.esc) {
      ctx.textAlign = 'center'; ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = '#ffd84a';
      ctx.fillText('脱出済み！ 仲間の脱出を待っています…', W / 2, H - 30);
    }

    if (banner) {
      ctx.globalAlpha = Math.min(1, banner.t * 2);
      ctx.font = `bold ${Math.round(Math.min(W, H) * 0.065)}px sans-serif`; ctx.textAlign = 'center';
      ctx.lineWidth = 6; ctx.strokeStyle = '#000'; ctx.strokeText(banner.text, W / 2, H * 0.34);
      ctx.fillStyle = banner.c || '#ffe36b'; ctx.fillText(banner.text, W / 2, H * 0.34);
      ctx.globalAlpha = 1;
    }
  }

  function drawButton(b, pressed, cd, color, label, sub, glow) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    if (glow) { ctx.shadowColor = '#7dff9a'; ctx.shadowBlur = 16; }
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(b.x, b.y + (pressed ? 2 : 0), b.r * (pressed ? 0.93 : 1), 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
    if (cd > 0) {
      ctx.fillStyle = '#000a';
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cd); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(b.r * (label.length <= 2 ? 0.5 : 0.3))}px sans-serif`;
    ctx.fillText(label, b.x, b.y - (sub ? b.r * 0.15 : 0));
    if (sub) { ctx.font = `${Math.round(b.r * 0.2)}px sans-serif`; ctx.fillText(sub, b.x, b.y + b.r * 0.35); }
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  // ---------- メインループ ----------
  let last = performance.now();
  function frame(nowMs) {
    const dt = Math.min(0.05, (nowMs - last) / 1000);
    last = nowMs;
    const now = nowMs / 1000;
    requestAnimationFrame(frame);

    if (!$('game').classList.contains('active') || !snap || !map) return;
    readInput();
    if (playing()) sendInput(dt);

    const me = snap.players.find(p => p.id === myId);

    // 自キャラは入力で先に動かし、サーバー位置へ寄せる
    if (me) {
      if (!myPred) myPred = { x: me.x, y: me.y };
      if (!me.down && !me.dash && !me.esc && playing()) {
        const st = S.yokaiStats(me.yokai);
        let mx = input.mx, my = input.my; const m = Math.hypot(mx, my);
        if (m > 1) { mx /= m; my /= m; }
        const run = input.dash && m > 0.15 && (me.inf || (!me.exh && me.stam > 0));
        const spd = st.speed * (run ? 1.65 : 1);
        myPred.x += mx * spd * dt; myPred.y += my * spd * dt;
        S.collide(map, myPred, 18);
      }
      const k = me.dash ? 0.5 : 0.12;
      myPred.x += (me.x - myPred.x) * k; myPred.y += (me.y - myPred.y) * k;
    }

    const scale = H / 640;
    const cam = { vw: W / scale, vh: H / scale, x: myPred ? myPred.x : map.w / 2, y: myPred ? myPred.y : map.h / 2 };
    cam.x = Math.max(cam.vw / 2 - 80, Math.min(map.w - cam.vw / 2 + 80, cam.x));
    cam.y = Math.max(cam.vh / 2 - 80, Math.min(map.h - cam.vh / 2 + 80, cam.y));
    if (me && me.esc) { const other = snap.players.find(p => !p.esc); if (other) { const pos = ents.get('p' + other.id) || other; cam.x = pos.x; cam.y = pos.y; } }

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#120a1a'; ctx.fillRect(0, 0, W, H);

    shake = Math.max(0, shake - dt);
    const sx = shake > 0 ? (Math.random() - 0.5) * 60 * shake : 0;
    const sy = shake > 0 ? (Math.random() - 0.5) * 60 * shake : 0;
    ctx.save();
    ctx.translate(W / 2 + sx, H / 2 + sy);
    ctx.scale(scale, scale);
    ctx.translate(-cam.x, -cam.y);

    drawCity(cam);
    drawBuildings(cam);
    const k = 1 - Math.pow(0.001, dt);

    for (const z of snap.zones) {
      ctx.fillStyle = 'rgba(91,224,122,0.18)'; ctx.strokeStyle = 'rgba(125,255,154,0.8)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r * (0.95 + Math.sin(now * 5) * 0.05), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    for (const t of snap.traps) {
      ctx.fillStyle = '#ffe14a33'; ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(t.x, t.y, 26, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.font = '20px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⚡', t.x, t.y); ctx.textBaseline = 'alphabetic';
    }
    for (const bm of snap.bombs) {
      ctx.fillStyle = `rgba(255,80,40,${0.1 + 0.1 * Math.sin(now * 12)})`; ctx.strokeStyle = '#ff6a3d'; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.arc(bm.x, bm.y, 170, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = '30px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('💣', bm.x, bm.y); ctx.textBaseline = 'alphabetic';
      ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(Math.ceil(bm.t), bm.x, bm.y - 26);
    }
    for (const t of snap.tele) drawTelegraph(t);

    // 鬼玉
    for (const d of dama.values()) {
      if (Math.abs(d.x - cam.x) > cam.vw / 2 + 30 || Math.abs(d.y - cam.y) > cam.vh / 2 + 30) continue;
      const bob = Math.sin(now * 4 + d.id) * 3;
      ctx.fillStyle = '#ff3da8'; ctx.shadowColor = '#ff3da8'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(d.x, d.y + bob, 9, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffd0f0'; ctx.beginPath(); ctx.arc(d.x - 3, d.y + bob - 3, 3, 0, Math.PI * 2); ctx.fill();
    }
    // アイテム
    for (const it of snap.items) {
      const known = myPred && Math.hypot(it.x - myPred.x, it.y - myPred.y) < S.ITEM_REVEAL_DIST;
      const bob = Math.sin(now * 3 + it.id) * 3;
      ctx.fillStyle = known ? '#2f8a5a' : '#5a3a8a'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(it.x - 16, it.y - 16 + bob, 32, 32, 8) : ctx.rect(it.x - 16, it.y - 16 + bob, 32, 32); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (known) { ctx.font = '20px sans-serif'; ctx.fillText(S.ITEMS[it.type].icon, it.x, it.y + bob); ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(S.ITEMS[it.type].name, it.x, it.y - 26 + bob); }
      else { ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('?', it.x, it.y + bob); }
      ctx.textBaseline = 'alphabetic';
    }
    drawFusuma(now);

    // y座標順に描画
    const list = [];
    for (const e of snap.patrols) { const pos = lerpEnt('e' + e.id, e.x, e.y, k); list.push({ y: pos.y, f: () => drawPatrol(e, pos, now) }); }
    if (snap.boss) { const pos = lerpEnt('boss', snap.boss.x, snap.boss.y, snap.boss.st === 'charging' ? 0.6 : k); list.push({ y: pos.y, f: () => drawBoss(snap.boss, pos, now) }); }
    for (const p of snap.players) {
      if (p.esc) continue;
      const pos = p.id === myId && myPred ? myPred : lerpEnt('p' + p.id, p.x, p.y, k);
      list.push({ y: pos.y, f: () => drawPlayer(p, pos, p.id === myId) });
    }
    list.sort((a, b) => a.y - b.y).forEach(d => d.f());

    for (const pr of snap.proj) {
      const pos = lerpEnt('j' + pr.id, pr.x, pr.y, 0.5);
      if (pr.punch) { ctx.font = '40px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('👊', pos.x, pos.y); ctx.textBaseline = 'alphabetic'; continue; }
      ctx.fillStyle = pr.c; ctx.shadowColor = pr.c; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, pr.r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }

    for (let i = fx.length - 1; i >= 0; i--) {
      const e = fx[i]; e.t -= dt;
      if (e.t <= 0) { fx.splice(i, 1); continue; }
      const a = e.t / e.max;
      ctx.globalAlpha = a;
      if (e.k === 'slash') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(e.x, e.y, 40, e.a - 1.1, e.a + 1.1); ctx.stroke(); }
      else if (e.k === 'boom') { ctx.fillStyle = '#ff6a3d'; ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1.1 - a * 0.3), 0, Math.PI * 2); ctx.fill(); }
      else if (e.k === 'ring') { ctx.strokeStyle = e.c; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1 - a), 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }

    ctx.textAlign = 'center';
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i]; f.t -= dt; f.y -= 50 * dt;
      if (f.t <= 0) { floats.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(1, f.t * 3);
      ctx.font = 'bold 22px sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = '#000';
      ctx.strokeText(f.text, f.x, f.y); ctx.fillStyle = f.c; ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    for (const [id, t] of bubbles) { if (t - dt <= 0) bubbles.delete(id); else bubbles.set(id, t - dt); }
    if (Math.random() < 0.05) {
      const live = new Set(['boss', ...snap.players.map(p => 'p' + p.id), ...snap.patrols.map(e => 'e' + e.id), ...snap.proj.map(p => 'j' + p.id)]);
      for (const key of ents.keys()) if (!live.has(key)) ents.delete(key);
    }
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    drawHUD(me, now);
  }
  requestAnimationFrame(frame);
})();
