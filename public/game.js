// オニバスターズ クライアント
(() => {
  'use strict';

  const ROLE_INFO = {
    fighter: { name: 'ファイター', desc: '近接アタッカー', color: '#ff6b4a', skill: 'ダッシュ斬り', ult: '鬼斬り旋風' },
    tank:    { name: 'タンク',     desc: '挑発で仲間を守る', color: '#4a8bff', skill: '挑発シールド', ult: '鉄壁の陣' },
    healer:  { name: 'ヒーラー',   desc: '回復で支える',   color: '#5be07a', skill: '回復エリア', ult: '全員復活' },
    ranger:  { name: 'レンジャー', desc: '遠距離から射撃', color: '#f5c542', skill: '3連ショット', ult: '全方位乱射' },
  };

  const $ = id => document.getElementById(id);
  const screens = ['title', 'lobby', 'game', 'result'];
  function show(id, keepGame) {
    for (const s of screens) $(s).classList.toggle('active', s === id || (!!keepGame && s === 'game'));
  }

  // ---------- 状態 ----------
  let ws = null;
  let myId = null;
  let arena = { w: 1600, h: 1000 };
  let ultMax = 100;
  let roleStats = {};
  let selRole = localStorage.getItem('role') || 'fighter';
  let lobby = null;
  let snap = null;            // 最新の状態
  const ents = new Map();     // 表示用に補間した位置
  const floats = [];          // ダメージ数字
  const fx = [];              // エフェクト
  let shake = 0;
  let banner = null;          // 画面中央テキスト

  $('name').value = localStorage.getItem('name') || '';
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom) $('code').value = urlRoom.toUpperCase();

  // ---------- ロール選択UI ----------
  function renderRoles(el) {
    el.innerHTML = '';
    for (const [k, r] of Object.entries(ROLE_INFO)) {
      const d = document.createElement('div');
      d.className = 'role' + (k === selRole ? ' sel' : '');
      d.innerHTML = `<div class="icon" style="background:${r.color}"></div><b>${r.name}</b><span>${r.desc}</span>`;
      d.onclick = () => {
        selRole = k; localStorage.setItem('role', k);
        renderRoles($('roles')); renderRoles($('lobbyRoles'));
        if (ws && ws.readyState === 1) send({ t: 'role', role: k });
      };
      el.appendChild(d);
    }
  }
  renderRoles($('roles'));
  renderRoles($('lobbyRoles'));

  // ---------- 通信 ----------
  function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

  function connect(first) {
    const name = $('name').value.trim() || 'プレイヤー';
    localStorage.setItem('name', name);
    $('err').textContent = '';
    goFullscreen();
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = () => send({ ...first, name, role: selRole });
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
      case 'welcome':
        myId = m.id; arena = m.arena; roleStats = m.roles; ultMax = m.ultMax;
        break;
      case 'lobby':
        lobby = m;
        if (m.state === 'lobby') { renderLobby(); show('lobby'); }
        else if (m.state === 'battle') {
          if (!$('game').classList.contains('active') || $('result').classList.contains('active')) {
            ents.clear(); floats.length = 0; fx.length = 0; myPred = null;
            banner = { text: 'バトル開始！', t: 1.6 };
          }
          show('game');
        }
        break;
      case 'state':
        snap = m;
        for (const ev of m.ev) handleEvent(ev);
        break;
      case 'result':
        renderResult(m);
        show('result', true);
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
    if (navigator.share) navigator.share({ title: 'オニバスターズ', text: '一緒に大鬼をたおそう！', url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => { $('btnShare').textContent = 'コピーしました'; });
  };

  function renderLobby() {
    $('roomCode').textContent = lobby.code;
    const ul = $('plist');
    ul.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const p = lobby.players[i];
      const li = document.createElement('li');
      if (p) {
        const r = ROLE_INFO[p.role];
        li.innerHTML = `<div class="dot" style="background:${r.color}"></div><b>${esc(p.name)}${p.host ? ' 👑' : ''}</b><span>${r.name}</span>`;
      } else { li.className = 'empty'; li.textContent = 'あき'; }
      ul.appendChild(li);
    }
    const me = lobby.players.find(p => p.id === myId);
    const isHost = me && me.host;
    $('btnStart').style.display = isHost ? '' : 'none';
    $('waitMsg').style.display = isHost ? 'none' : '';
    $('btnAgain').disabled = !isHost;
  }

  function renderResult(m) {
    $('resTitle').textContent = m.win ? '🎉 大鬼をたおした！' : '💀 全滅してしまった…';
    $('resTime').textContent = `タイム ${Math.floor(m.time / 60)}:${String(m.time % 60).padStart(2, '0')}`;
    $('resTable').innerHTML = '<tr><th>なまえ</th><th>ロール</th><th>与ダメージ</th><th>回復量</th></tr>' +
      m.players.map(p => `<tr><td>${esc(p.name)}</td><td>${ROLE_INFO[p.role].name}</td><td>${p.dmg}</td><td>${p.heal}</td></tr>`).join('');
    const me = lobby && lobby.players.find(p => p.id === myId);
    $('btnAgain').disabled = !(me && me.host);
    $('btnAgain').textContent = me && me.host ? 'ロビーへもどる' : 'ホストを待っています…';
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function goFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
    }
  }

  // ---------- 演出イベント ----------
  function handleEvent(ev) {
    switch (ev.k) {
      case 'dmg': floats.push({ x: ev.x, y: ev.y, text: ev.v, c: '#fff', t: 0.8 }); break;
      case 'hurt':
        floats.push({ x: ev.x, y: ev.y, text: ev.v, c: '#ff5050', t: 0.8 });
        if (ev.id === myId) { shake = 0.25; navigator.vibrate?.(40); }
        break;
      case 'heal': floats.push({ x: ev.x, y: ev.y, text: '+' + ev.v, c: '#7dff9a', t: 0.8 }); break;
      case 'slash': fx.push({ k: 'slash', x: ev.x, y: ev.y, a: ev.a, c: ev.c, t: 0.15, max: 0.15 }); break;
      case 'boom': fx.push({ k: 'boom', x: ev.x, y: ev.y, r: ev.r || 80, t: 0.35, max: 0.35 }); shake = Math.max(shake, 0.15); break;
      case 'taunt': fx.push({ k: 'ring', x: ev.x, y: ev.y, r: 160, c: '#4a8bff', t: 0.5, max: 0.5 }); break;
      case 'ult': {
        const r = ROLE_INFO[ev.role];
        fx.push({ k: 'ring', x: ev.x, y: ev.y, r: 300, c: r.color, t: 0.7, max: 0.7 });
        const p = snap && snap.players.find(q => q.id === ev.id);
        banner = { text: `${p ? p.name : ''}「${r.ult}」！`, t: 1.4, c: r.color };
        shake = 0.4;
        break;
      }
      case 'enrage': banner = { text: '大鬼が怒り狂った！', t: 2, c: '#ff4040' }; shake = 0.5; break;
      case 'down': if (ev.id === myId) banner = { text: 'たおれた… 仲間を待とう', t: 2, c: '#ff8080' }; break;
      case 'revive': if (ev.id === myId) banner = { text: '復活！', t: 1.2, c: '#7dff9a' }; break;
    }
  }

  // ---------- 入力（タッチ / マウス / キーボード） ----------
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

  const input = { mx: 0, my: 0, atk: false, skill: false, ult: false };
  const stick = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const btnHold = { atk: null, skill: null, ult: null }; // 押している pointerId
  const keys = new Set();

  // ボタン配置（右下）
  function buttons() {
    const s = Math.min(W, H);
    const big = s * 0.13, mid = s * 0.095;
    const bx = W - big - 28, by = H - big - 24;
    return {
      atk:   { x: bx, y: by, r: big, label: '攻撃' },
      skill: { x: bx - big * 1.9, y: by + big * 0.2, r: mid, label: 'スキル' },
      ult:   { x: bx - big * 0.35, y: by - big * 1.85, r: mid, label: '必殺' },
    };
  }

  function pointerDown(e) {
    if (!$('game').classList.contains('active') || $('result').classList.contains('active')) return;
    const bs = buttons();
    for (const [k, b] of Object.entries(bs)) {
      if (Math.hypot(e.clientX - b.x, e.clientY - b.y) < b.r * 1.25) {
        btnHold[k] = e.pointerId;
        if (k !== 'atk') navigator.vibrate?.(15);
        e.preventDefault();
        return;
      }
    }
    if (e.clientX < W * 0.55 && !stick.active) {
      Object.assign(stick, { active: true, id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY });
    }
    e.preventDefault();
  }
  function pointerMove(e) {
    if (stick.active && e.pointerId === stick.id) { stick.x = e.clientX; stick.y = e.clientY; }
  }
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
    input.skill = btnHold.skill !== null || keys.has('KeyK');
    input.ult = btnHold.ult !== null || keys.has('KeyL');
  }

  let lastSent = '', sendT = 0;
  function sendInput(dt) {
    sendT -= dt;
    const s = JSON.stringify(input);
    if (s !== lastSent || sendT <= 0) {
      send({ t: 'input', ...input });
      lastSent = s; sendT = 0.25;
    }
  }

  // ---------- 描画 ----------
  function lerpEnt(key, tx, ty, k) {
    let e = ents.get(key);
    if (!e) { e = { x: tx, y: ty }; ents.set(key, e); }
    e.x += (tx - e.x) * k; e.y += (ty - e.y) * k;
    return e;
  }

  function drawFloor(cam) {
    ctx.fillStyle = '#2b1d3e';
    ctx.fillRect(0, 0, arena.w, arena.h);
    ctx.strokeStyle = '#ffffff10'; ctx.lineWidth = 2;
    const g = 100;
    const x0 = Math.max(0, Math.floor((cam.x - cam.vw / 2) / g) * g), x1 = Math.min(arena.w, cam.x + cam.vw / 2 + g);
    const y0 = Math.max(0, Math.floor((cam.y - cam.vh / 2) / g) * g), y1 = Math.min(arena.h, cam.y + cam.vh / 2 + g);
    ctx.beginPath();
    for (let x = x0; x <= x1; x += g) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = y0; y <= y1; y += g) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
    ctx.strokeStyle = '#ff9b3d'; ctx.lineWidth = 8;
    ctx.strokeRect(0, 0, arena.w, arena.h);
  }

  function drawTelegraph(t) {
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.fillStyle = 'rgba(255,40,40,0.22)';
    ctx.strokeStyle = 'rgba(255,60,60,0.9)'; ctx.lineWidth = 3;
    if (t.shape === 'rect') {
      ctx.rotate(t.a);
      ctx.fillRect(0, -t.w / 2, t.len, t.w); ctx.strokeRect(0, -t.w / 2, t.len, t.w);
      ctx.fillStyle = 'rgba(255,40,40,0.45)';
      ctx.fillRect(0, -t.w / 2, t.len * t.p, t.w);
    } else {
      ctx.beginPath(); ctx.arc(0, 0, t.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,40,40,0.45)';
      ctx.beginPath(); ctx.arc(0, 0, t.r * t.p, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawBoss(b, pos, now) {
    const wob = Math.sin(now * 6) * 3;
    ctx.save();
    ctx.translate(pos.x, pos.y + wob);
    // 影
    ctx.fillStyle = '#0006'; ctx.beginPath(); ctx.ellipse(0, b.r * 0.9 - wob, b.r, b.r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    if (b.enraged) { ctx.shadowColor = '#ff2020'; ctx.shadowBlur = 30; }
    // 体
    ctx.fillStyle = b.flash ? '#fff' : (b.enraged ? '#d22a2a' : '#b8342a');
    ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // 角
    ctx.fillStyle = '#f3e3b0';
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(s * b.r * 0.35, -b.r * 0.75); ctx.lineTo(s * b.r * 0.6, -b.r * 1.45); ctx.lineTo(s * b.r * 0.75, -b.r * 0.55); ctx.closePath(); ctx.fill();
    }
    // 目（向きに合わせて少しずらす）
    const ex = Math.cos(b.face) * 10, ey = Math.sin(b.face) * 6;
    ctx.fillStyle = '#ffeb3b';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * 24 + ex, -12 + ey, 13, 9, s * 0.3, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#000';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * 24 + ex * 1.3, -12 + ey, 5, 0, Math.PI * 2); ctx.fill(); }
    // 口と牙
    ctx.fillStyle = '#3a0a0a'; ctx.beginPath(); ctx.ellipse(ex, 26 + ey, 32, b.st === 'windup' ? 18 : 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 18 + ex, 18 + ey); ctx.lineTo(s * 12 + ex, 32 + ey); ctx.lineTo(s * 24 + ex, 20 + ey); ctx.fill(); }
    if (b.taunt) { ctx.fillStyle = '#4a8bff'; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('💢', 0, -b.r * 1.5); }
    ctx.restore();
  }

  function drawPlayer(p, pos, me) {
    const r = ROLE_INFO[p.role];
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.globalAlpha = p.down ? 0.5 : 1;
    ctx.fillStyle = '#0005'; ctx.beginPath(); ctx.ellipse(0, 18, 20, 7, 0, 0, Math.PI * 2); ctx.fill();
    if (me) { ctx.strokeStyle = '#ffe36b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.stroke(); }
    if (p.sh) { ctx.fillStyle = 'rgba(100,160,255,0.3)'; ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = r.color;
    ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
    // 向き
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(Math.cos(p.face) * 12, Math.sin(p.face) * 12, 5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // 名前とHP
    ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#fff'; ctx.fillText(p.name, 0, -38);
    bar(-24, -32, 48, 6, p.hp / p.maxHp, '#5be07a');
    if (p.down) {
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.fillText('たすけて！', 0, 44);
      ctx.strokeStyle = '#7dff9a'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(0, 0, 40, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.rv); ctx.stroke();
    }
    ctx.restore();
  }

  function bar(x, y, w, h, v, c) {
    ctx.fillStyle = '#000a'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = c; ctx.fillRect(x, y, w * Math.max(0, v), h);
  }

  function drawHUD(me, now) {
    const b = snap.boss;
    // ボスHPバー
    if (b) {
      const bw = Math.min(W * 0.5, 520), bx = (W - bw) / 2, by = 14;
      ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
      ctx.fillText(b.name + (b.enraged ? '（怒り）' : ''), W / 2, by + 12);
      bar(bx, by + 18, bw, 12, b.hp / b.maxHp, b.enraged ? '#ff3030' : '#ff8a3d');
    }
    // 仲間のHP（左上）
    let y = 14;
    ctx.textAlign = 'left';
    for (const p of snap.players) {
      const r = ROLE_INFO[p.role];
      ctx.fillStyle = r.color; ctx.beginPath(); ctx.arc(24, y + 10, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = p.down ? '#ff8080' : '#fff'; ctx.font = '12px sans-serif';
      ctx.fillText(p.name, 38, y + 8);
      bar(38, y + 12, 90, 5, p.hp / p.maxHp, p.id === myId ? '#ffe36b' : '#5be07a');
      y += 26;
    }
    // ボタン
    if (me) {
      const bs = buttons();
      drawButton(bs.atk, btnHold.atk !== null, me.atkCd, ROLE_INFO[me.role].color, '攻撃');
      drawButton(bs.skill, btnHold.skill !== null, me.skCd, '#6b4fa0', ROLE_INFO[me.role].skill);
      const full = me.ult >= ultMax;
      const ub = bs.ult;
      drawButton(ub, btnHold.ult !== null, 0, full ? '#ff3da8' : '#40304f', '必殺');
      // 必殺ゲージ
      ctx.strokeStyle = full ? `hsl(${(now * 300) % 360},100%,65%)` : '#ff7ad1'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(ub.x, ub.y, ub.r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (me.ult / ultMax)); ctx.stroke();
    }
    // スティック
    if (stick.active) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#fff3'; ctx.beginPath(); ctx.arc(stick.ox, stick.oy, STICK_R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fffa'; ctx.beginPath(); ctx.arc(stick.x, stick.y, 26, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (snap.time < 8) {
      ctx.fillStyle = '#ffffff55'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('左側をドラッグで移動', W * 0.22, H - 40);
    }
    // バナー
    if (banner) {
      ctx.globalAlpha = Math.min(1, banner.t * 2);
      ctx.font = `bold ${Math.round(Math.min(W, H) * 0.08)}px sans-serif`; ctx.textAlign = 'center';
      ctx.lineWidth = 6; ctx.strokeStyle = '#000'; ctx.strokeText(banner.text, W / 2, H * 0.35);
      ctx.fillStyle = banner.c || '#ffe36b'; ctx.fillText(banner.text, W / 2, H * 0.35);
      ctx.globalAlpha = 1;
    }
  }

  function drawButton(b, pressed, cd, color, label) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(b.x, b.y + (pressed ? 2 : 0), b.r * (pressed ? 0.93 : 1), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
    if (cd > 0) {
      ctx.fillStyle = '#000a';
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cd); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(b.r * 0.32)}px sans-serif`;
    ctx.fillText(label, b.x, b.y);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  // ---------- メインループ ----------
  let last = performance.now();
  let myPred = null; // 自キャラの予測位置

  function frame(nowMs) {
    const dt = Math.min(0.05, (nowMs - last) / 1000);
    last = nowMs;
    const now = nowMs / 1000;
    requestAnimationFrame(frame);

    if (!$('game').classList.contains('active') || !snap) return;
    readInput();
    if (!$('result').classList.contains('active')) sendInput(dt);

    const me = snap.players.find(p => p.id === myId);

    // 自キャラは入力で先に動かし、サーバー位置へ寄せる
    if (me) {
      if (!myPred) myPred = { x: me.x, y: me.y };
      if (!me.down && !me.dash) {
        const spd = roleStats[me.role] ? roleStats[me.role].speed : 220;
        let mx = input.mx, my = input.my; const m = Math.hypot(mx, my);
        if (m > 1) { mx /= m; my /= m; }
        myPred.x = Math.max(20, Math.min(arena.w - 20, myPred.x + mx * spd * dt));
        myPred.y = Math.max(20, Math.min(arena.h - 20, myPred.y + my * spd * dt));
      }
      const k = me.dash ? 0.5 : 0.12;
      myPred.x += (me.x - myPred.x) * k; myPred.y += (me.y - myPred.y) * k;
    }

    // カメラ: 画面の縦が約700ワールド単位になるよう拡大
    const scale = H / 700;
    const cam = { vw: W / scale, vh: H / scale, x: myPred ? myPred.x : arena.w / 2, y: myPred ? myPred.y : arena.h / 2 };
    cam.x = Math.max(cam.vw / 2 - 100, Math.min(arena.w - cam.vw / 2 + 100, cam.x));
    cam.y = Math.max(cam.vh / 2 - 100, Math.min(arena.h - cam.vh / 2 + 100, cam.y));

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#120a22'; ctx.fillRect(0, 0, W, H);

    shake = Math.max(0, shake - dt);
    const sx = shake > 0 ? (Math.random() - 0.5) * 16 * shake * 4 : 0;
    const sy = shake > 0 ? (Math.random() - 0.5) * 16 * shake * 4 : 0;
    ctx.save();
    ctx.translate(W / 2 + sx, H / 2 + sy);
    ctx.scale(scale, scale);
    ctx.translate(-cam.x, -cam.y);

    drawFloor(cam);
    const k = 1 - Math.pow(0.001, dt); // 補間の強さ（fps非依存）

    for (const z of snap.zones) {
      ctx.fillStyle = 'rgba(91,224,122,0.18)'; ctx.strokeStyle = 'rgba(125,255,154,0.8)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r * (0.95 + Math.sin(now * 5) * 0.05), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    for (const t of snap.tele) drawTelegraph(t);

    for (const m of snap.minions) {
      const pos = lerpEnt('m' + m.id, m.x, m.y, k);
      ctx.fillStyle = '#7b3fbf'; ctx.beginPath(); ctx.arc(pos.x, pos.y, m.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffeb3b'; ctx.beginPath(); ctx.arc(pos.x - 7, pos.y - 4, 4, 0, Math.PI * 2); ctx.arc(pos.x + 7, pos.y - 4, 4, 0, Math.PI * 2); ctx.fill();
      bar(pos.x - 20, pos.y - m.r - 10, 40, 4, m.hp / m.maxHp, '#ff5050');
    }

    // y座標順に描画して奥行きを出す
    const drawList = [];
    if (snap.boss && snap.boss.hp > 0) {
      const pos = lerpEnt('boss', snap.boss.x, snap.boss.y, snap.boss.st === 'charging' ? 0.6 : k);
      drawList.push({ y: pos.y, f: () => drawBoss(snap.boss, pos, now) });
    }
    for (const p of snap.players) {
      const pos = p.id === myId && myPred ? myPred : lerpEnt('p' + p.id, p.x, p.y, k);
      drawList.push({ y: pos.y, f: () => drawPlayer(p, pos, p.id === myId) });
    }
    drawList.sort((a, b) => a.y - b.y).forEach(d => d.f());

    for (const pr of snap.proj) {
      const pos = lerpEnt('j' + pr.id, pr.x, pr.y, 0.5);
      ctx.fillStyle = pr.c; ctx.shadowColor = pr.c; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, pr.r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }

    for (let i = fx.length - 1; i >= 0; i--) {
      const e = fx[i]; e.t -= dt;
      if (e.t <= 0) { fx.splice(i, 1); continue; }
      const a = e.t / e.max;
      ctx.globalAlpha = a;
      if (e.k === 'slash') {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 8;
        ctx.beginPath(); ctx.arc(e.x, e.y, 40, e.a - 1.1, e.a + 1.1); ctx.stroke();
      } else if (e.k === 'boom') {
        ctx.fillStyle = '#ff6a3d'; ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1.1 - a * 0.3), 0, Math.PI * 2); ctx.fill();
      } else if (e.k === 'ring') {
        ctx.strokeStyle = e.c; ctx.lineWidth = 10;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1 - a), 0, Math.PI * 2); ctx.stroke();
      }
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

    // 消えたエンティティの補間データを掃除
    if (Math.random() < 0.05) {
      const live = new Set(['boss', ...snap.players.map(p => 'p' + p.id), ...snap.minions.map(m => 'm' + m.id), ...snap.proj.map(p => 'j' + p.id)]);
      for (const key of ents.keys()) if (!live.has(key)) ents.delete(key);
    }

    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    drawHUD(me, now);
  }
  requestAnimationFrame(frame);
})();
