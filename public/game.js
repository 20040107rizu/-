// 鬼バスターズ クライアント
(() => {
  'use strict';
  const S = window.Shared;

  const $ = id => document.getElementById(id);
  const screens = ['title', 'lobby', 'game', 'gacha', 'result', 'installHelp', 'saveScreen', 'whatsNew'];
  function show(id, keepGame) {
    for (const s of screens) $(s).classList.toggle('active', s === id || (!!keepGame && s === 'game'));
    refreshUpdateBar();
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- セーブデータ（端末に自動保存＋引き継ぎコード） ----------
  function loadJSON(key, def) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') || def; } catch { return def; }
  }
  function loadFriends(f) {
    f = f || loadJSON('friends', {});
    for (const id of Object.keys(f)) if (!S.YOKAI_BY_ID[id] || !(f[id] > 0)) delete f[id];
    for (const y of S.YOKAI) if (y.starter && !f[y.id]) f[y.id] = 1;
    return f;
  }
  let friends = loadFriends();
  let stats = loadJSON('stats', { plays: 0, escapes: 0, dama: 0, best: 0 });
  let selYokai = localStorage.getItem('yokai');
  if (!friends[selYokai]) selYokai = 'nekomata';
  function saveAll() {
    try {
      localStorage.setItem('friends', JSON.stringify(friends));
      localStorage.setItem('stats', JSON.stringify(stats));
      localStorage.setItem('yokai', selYokai);
    } catch {}
  }
  // ブラウザに勝手に消されにくくする
  navigator.storage?.persist?.().catch(() => {});

  // 引き継ぎコード: ONI1-<データ>-<チェック用4文字>
  const b64 = {
    enc: str => btoa(String.fromCharCode(...new TextEncoder().encode(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    dec: str => new TextDecoder().decode(Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))),
  };
  function checksum(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36).slice(-4).toUpperCase().padStart(4, '0');
  }
  function makeSaveCode() {
    const data = { v: 1, n: localStorage.getItem('name') || '', y: selYokai, f: S.YOKAI.map(y => friends[y.id] || 0), s: [stats.plays, stats.escapes, stats.dama, stats.best] };
    const body = b64.enc(JSON.stringify(data));
    return `ONI1-${body}-${checksum(body)}`;
  }
  function readSaveCode(code) {
    const m = String(code).replace(/\s+/g, '').match(/^ONI1-([A-Za-z0-9_-]+)-([0-9A-Z]{4})$/);
    if (!m || checksum(m[1]) !== m[2]) throw new Error('コードが正しくありません（途中が欠けていないか確認してね）');
    const d = JSON.parse(b64.dec(m[1]));
    if (d.v !== 1 || !Array.isArray(d.f)) throw new Error('このコードは読み込めません');
    const f = {};
    S.YOKAI.forEach((y, i) => { const c = Math.floor(+d.f[i] || 0); if (c > 0) f[y.id] = Math.min(c, 999); });
    const st = (d.s || []).map(x => Math.max(0, Math.floor(+x || 0)));
    return { name: String(d.n || '').slice(0, 10), yokai: d.y, friends: loadFriends(f), stats: { plays: st[0] || 0, escapes: st[1] || 0, dama: st[2] || 0, best: st[3] || 0 } };
  }

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
  let bossType = 'red';

  $('name').value = localStorage.getItem('name') || '';
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom) $('code').value = urlRoom.toUpperCase();
  function updateFriendCount() {
    $('friendCount').textContent = `お友達 ${Object.keys(friends).length} / ${S.YOKAI.length}`;
  }
  updateFriendCount();

  // ---------- セーブ画面 ----------
  function openSave() {
    $('saveStats').textContent = `お友達 ${Object.keys(friends).length}/${S.YOKAI.length}　遊んだ回数 ${stats.plays}　脱出 ${stats.escapes}回　集めた鬼玉 ${stats.dama}個（最高 ${stats.best}個）`;
    $('saveCode').value = makeSaveCode();
    $('loadCode').value = '';
    $('saveMsg').textContent = '';
    $('btnCopyCode').textContent = 'コピー';
    show('saveScreen');
  }
  $('btnSave').onclick = openSave;
  $('btnSaveClose').onclick = () => show('title');
  $('btnCopyCode').onclick = () => {
    const code = $('saveCode').value;
    const done = () => { $('btnCopyCode').textContent = 'コピーしました'; };
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(done, () => { $('saveCode').select(); document.execCommand('copy'); done(); });
    else { $('saveCode').select(); document.execCommand('copy'); done(); }
  };
  $('saveCode').onclick = () => $('saveCode').select();
  $('btnLoadCode').onclick = () => {
    let data;
    try { data = readSaveCode($('loadCode').value); }
    catch (e) { $('saveMsg').style.color = '#ff8080'; $('saveMsg').textContent = e.message; return; }
    const n = Object.keys(data.friends).length;
    if (!confirm(`お友達${n}体のデータを読み込みます。\nこの端末の今のデータは上書きされます。よろしいですか？`)) return;
    friends = data.friends; stats = data.stats;
    selYokai = friends[data.yokai] ? data.yokai : 'nekomata';
    if (data.name) { $('name').value = data.name; try { localStorage.setItem('name', data.name); } catch {} }
    saveAll(); updateFriendCount();
    openSave();
    $('saveMsg').style.color = '#7dff9a';
    $('saveMsg').textContent = `読み込みました！ お友達 ${n}体`;
  };

  // ---------- 生成AIの絵（public/art/、無ければ図形で描く） ----------
  const ART = {};
  const ART_LOADING = {};
  const PATTERNS = {};
  let MANIFEST = {};
  fetch('art/manifest.json').then(r => (r.ok ? r.json() : {})).then(m => {
    MANIFEST = m;
    if (lobby && $('lobby').classList.contains('active')) renderLobby();
  }).catch(() => {});
  const artUrl = key => (MANIFEST[key] ? 'art/' + MANIFEST[key] : null);
  // 読み込み済みならその絵、まだなら読み込みを始めて null（その間は図形で描く）
  function art(key) {
    if (ART[key]) return ART[key];
    if (MANIFEST[key] && !ART_LOADING[key]) {
      ART_LOADING[key] = true;
      const img = new Image();
      img.onload = () => { ART[key] = img; };
      img.src = artUrl(key);
    }
    return null;
  }
  function pattern(key) {
    const img = art(key);
    if (!img) return null;
    return PATTERNS[key] || (PATTERNS[key] = ctx.createPattern(img, 'repeat'));
  }
  const BOSS_UI = { red: '#ff5050', blue: '#5a9aff', black: '#d0a8ff' };
  let view = { l: 0, r: 0, t: 0, b: 0 }; // 今画面に見えている範囲（ワールド座標）
  const inView = (x, y, m = 0) => x > view.l - m && x < view.r + m && y > view.t - m && y < view.b + m;
  let spectateId = null;
  // キャラ画像を足元基準で描く（左向きなら反転）
  function drawSprite(img, x, y, size, flip, flash) {
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.scale(-1, 1);
    if (flash) ctx.filter = 'brightness(2.5)';
    ctx.drawImage(img, -size / 2, -size * 0.92, size, size); // 絵の足元（下から8%）を y に合わせる
    ctx.restore();
  }
  const faceStyle = y => (artUrl('yokai/' + y.id) ? `background:${y.color}55 url(${artUrl('yokai/' + y.id)}) center/contain no-repeat` : `background:${y.color}`);

  // ---------- ホーム画面に追加（PWA） ----------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPrompt = e;
    $('btnInstall').style.display = 'inline-block';
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; $('btnInstall').style.display = 'none'; });
  if (isIOS && !standalone) $('btnInstall').style.display = 'inline-block';
  $('btnInstall').onclick = () => {
    if (installPrompt) {
      installPrompt.prompt();
      installPrompt.userChoice.finally(() => { installPrompt = null; $('btnInstall').style.display = 'none'; });
    } else show('installHelp');
  };
  $('btnInstallClose').onclick = () => show('title');

  // ---------- 更新のお知らせ ----------
  // サーバーのバージョンが変わったら「今すぐ更新」を出す（プレイ中は出さない）
  var loadedVersion = null; // show() から先に呼ばれても大丈夫なように var
  var updateReady = false;
  function refreshUpdateBar() {
    const bar = document.getElementById('updateBar');
    if (!bar) return;
    const busy = ['game', 'gacha', 'whatsNew'].some(id => document.getElementById(id).classList.contains('active')) && !document.getElementById('result').classList.contains('active');
    bar.classList.toggle('show', updateReady && !busy);
  }
  function checkVersion() {
    fetch('version', { cache: 'no-store' }).then(r => r.json()).then(info => {
      if (!loadedVersion) {
        loadedVersion = info.v;
        let seen = null;
        try { seen = localStorage.getItem('seenVersion'); localStorage.setItem('seenVersion', info.v); } catch {}
        // 更新したあとに開いたら、変わったところを見せる
        if (seen && seen !== info.v && Array.isArray(info.notes) && info.notes.length && $('title').classList.contains('active')) {
          $('whatsNewList').innerHTML = info.notes.map(n => `<li>${esc(n)}</li>`).join('');
          show('whatsNew');
        }
      } else if (info.v !== loadedVersion) {
        updateReady = true;
        refreshUpdateBar();
      }
    }).catch(() => {});
  }
  checkVersion();
  setInterval(checkVersion, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVersion(); });
  $('btnUpdate').onclick = () => {
    $('btnUpdate').textContent = '更新中…';
    const reg = navigator.serviceWorker ? navigator.serviceWorker.getRegistration() : Promise.resolve(null);
    reg.then(r => r && r.update()).catch(() => {}).finally(() => location.reload());
  };
  $('btnWhatsNewClose').onclick = () => show('title');

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
        bossType = m.boss;
        spectateId = null;
        banner = { text: `${S.BOSSES[m.boss].name}が現れた！`, sub: '鬼玉を集めて、襖から脱出しよう', t: 3.2, c: BOSS_UI[m.boss] };
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
    if (navigator.share) navigator.share({ title: '鬼バスターズ', text: '一緒に鬼の世界へ行こう！', url }).catch(() => {});
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
        li.innerHTML = `<div class="dot" style="${faceStyle(y)}"></div><b>${esc(p.name)}${p.host ? ' 👑' : ''}</b><span style="color:${S.RANKS[y.rank].color}">${y.rank} ${y.name}</span>`;
      } else { li.className = 'empty'; li.textContent = 'あき'; }
      ul.appendChild(li);
    }
    renderFriends();
    const me = lobby.players.find(p => p.id === myId);
    const isHost = me && me.host;
    $('btnStart').style.display = isHost ? '' : 'none';
    $('waitMsg').style.display = isHost ? 'none' : '';
  }

  let friendTab = 'own';
  function renderFriendTabs() {
    const tabs = [['own', 'お友達'], ['C', 'C'], ['B', 'B'], ['A', 'A'], ['S', 'S']];
    $('friendTabs').innerHTML = tabs.map(([k, label]) => {
      const list = k === 'own' ? S.YOKAI.filter(y => friends[y.id]) : S.YOKAI.filter(y => y.rank === k);
      const got = list.filter(y => friends[y.id]).length;
      return `<button class="tab${friendTab === k ? ' on' : ''}" data-k="${k}">${label} <small>${k === 'own' ? got : `${got}/${list.length}`}</small></button>`;
    }).join('');
    for (const b of $('friendTabs').querySelectorAll('button')) b.onclick = () => { friendTab = b.dataset.k; renderFriends(); };
  }
  const faceImg = (y, locked) => artUrl('yokai/' + y.id)
    ? `<img class="face${locked ? ' sil' : ''}" loading="lazy" src="${artUrl('yokai/' + y.id)}" alt="">`
    : `<div class="face" style="background:${locked ? '#333' : y.color}"></div>`;
  function renderFriends() {
    renderFriendTabs();
    const el = $('friends');
    el.innerHTML = '';
    const list = friendTab === 'own' ? S.YOKAI.filter(y => friends[y.id]) : S.YOKAI.filter(y => y.rank === friendTab);
    for (const y of list) {
      const owned = friends[y.id];
      const d = document.createElement('div');
      d.className = 'yk' + (y.id === selYokai ? ' sel' : '') + (owned ? '' : ' locked');
      d.innerHTML = owned
        ? `<span class="rk" style="color:${S.RANKS[y.rank].color}">${y.rank}</span>${owned > 1 ? `<span class="cnt">×${owned}</span>` : ''}${faceImg(y)}${y.name}<br><small>${S.ROLES[y.role].name}・${y.origin}</small>`
        : `<span class="rk" style="color:${S.RANKS[y.rank].color}">${y.rank}</span>${faceImg(y, true)}？？？<br><small>${y.origin}</small>`;
      if (owned) d.onclick = () => {
        selYokai = y.id; saveAll();
        send({ t: 'yokai', id: y.id });
        renderFriends();
      };
      el.appendChild(d);
    }
  }

  // ---------- 鬼ガチャ ----------
  let gachaStep = 0;
  let gachaIsNew = false;
  function startGacha() {
    const mine = result.players.find(p => p.id === myId);
    // ガチャ結果はこの時点で保存する（玉を開ける前にアプリを閉じても消えない）
    if (mine) {
      stats.plays++;
      stats.dama += mine.dama;
      stats.best = Math.max(stats.best, mine.dama);
      if (mine.gacha) {
        stats.escapes++;
        gachaIsNew = !friends[mine.gacha.yokai];
        friends[mine.gacha.yokai] = (friends[mine.gacha.yokai] || 0) + 1;
      }
      saveAll(); updateFriendCount();
    }
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
      const isNew = gachaIsNew;
      $('machine').style.display = 'none';
      $('revealIcon').style.cssText = faceStyle(y);
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
    if (!standalone && !document.fullscreenElement && el.requestFullscreen) {
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
        if (ev.by === myId) {
          beep(1200, 0.08, 'triangle', 0.05, 400);
          if (ev.v > 1) { banner = { text: `どデカい鬼玉ゲット！ +${ev.v}`, t: 2.4, c: '#ff8ad8' }; [523, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.2, 'triangle', 0.08), i * 90)); }
        } else if (ev.v > 1) banner = { text: `${nameOf(ev.by)}がどデカい鬼玉をゲット！`, t: 1.8, c: '#ff8ad8' };
        break;
      case 'da':
        dama.set(ev.id, { id: ev.id, x: ev.x, y: ev.y, v: ev.v || 1 });
        if (ev.v > 1) banner = { text: `どデカい鬼玉（${ev.v}個分）が落ちた！`, t: 2.4, c: '#ff8ad8' };
        break;
      case 'pick':
        if (ev.id === myId) { banner = { text: `${S.ITEMS[ev.item].icon} ${S.ITEMS[ev.item].name}をひろった`, t: 1.2, c: '#ffe36b' }; beep(880, 0.12, 'square', 0.04); }
        break;
      case 'use': if (ev.id === myId) beep(660, 0.1, 'square', 0.05); break;
      case 'stun': fx.push({ k: 'ring', x: ev.x, y: ev.y, r: 120, c: '#ffe14a', t: 0.6, max: 0.6 }); banner = { text: 'ボス鬼がしびれた！', t: 1.4, c: '#ffe14a' }; break;
      case 'oniDown': fx.push({ k: 'ring', x: ev.x, y: ev.y, r: 90, c: '#ffffff', t: 0.5, max: 0.5 }); if (near(ev.x, ev.y)) banner = { text: '見回り鬼をたおした！', t: 1.2 }; break;
      case 'bossDown': banner = { text: `${S.BOSSES[bossType].name}をたおした！`, t: 2.5, c: '#ffd84a' }; shake = 0.6; break;
      case 'down': if (ev.id === myId) banner = { text: 'たおれた… 仲間を待とう', t: 2, c: '#ff8080' }; break;
      case 'revive': if (ev.id === myId) banner = { text: '復活！', t: 1.2, c: '#7dff9a' }; break;
      case 'escape':
        banner = ev.id === myId ? { text: '脱出成功！', sub: 'タップで観戦する仲間を切り替え', t: 2.5, c: '#ffd84a' } : { text: `${nameOf(ev.id)}が脱出した！`, t: 1.6 };
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
    const me = snap && snap.players.find(p => p.id === myId);
    if (me && me.esc) {
      const others = snap.players.filter(p => !p.esc);
      if (others.length) {
        const i = others.findIndex(p => p.id === spectateId);
        spectateId = others[(i + 1) % others.length].id;
      }
      e.preventDefault();
      return;
    }
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
    ctx.fillStyle = pattern('scene/ground') || '#2e2236';
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
      const roof = pattern('scene/roof');
      ctx.fillStyle = roof || ROOF[b.hue]; ctx.fillRect(b.x, b.y, b.w, b.h - 6);      // 屋根
      if (roof) { ctx.fillStyle = ['#0000', '#4060ff18', '#ff404018', '#40ff8012'][b.hue]; ctx.fillRect(b.x, b.y, b.w, b.h - 6); }
      else {
        ctx.strokeStyle = '#00000055'; ctx.lineWidth = 3;
        ctx.beginPath();
        for (let yy = b.y + 22; yy < b.y + b.h - 10; yy += 22) { ctx.moveTo(b.x + 6, yy); ctx.lineTo(b.x + b.w - 6, yy); }
        ctx.stroke();
      }
      // ちょうちん
      ctx.fillStyle = '#ff6a3d'; ctx.shadowColor = '#ff6a3d'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(b.x + 14, b.y + b.h + 2, 6, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawFusuma(now, me) {
    const { x, y } = fusuma;
    if (me && !me.esc && myPred && Math.hypot(myPred.x - x, myPred.y - y) < 90) {
      ctx.save();
      ctx.strokeStyle = '#00000088'; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.arc(x, y - 4, 62, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(x, y - 4, 62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * me.ep); ctx.stroke();
      ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#000';
      ctx.strokeText('攻撃ボタン長押しで脱出！', x, y + 66); ctx.fillStyle = '#ffd84a'; ctx.fillText('攻撃ボタン長押しで脱出！', x, y + 66);
      ctx.restore();
    }
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
    const img = art('oni/patrol');
    if (img) { ctx.fillStyle = '#0006'; ctx.beginPath(); ctx.ellipse(pos.x, pos.y + 18, 22, 7, 0, 0, Math.PI * 2); ctx.fill(); drawSprite(img, pos.x, pos.y + 18, 86, Math.cos(e.face) < 0, e.flash); }
    else drawOni(pos.x, pos.y, 22, '#7a4ab0', e.face, e.flash, [0]);
    bar(pos.x - 20, pos.y - (img ? 66 : 40), 40, 4, e.hp / e.maxHp, '#ff5050');
    if (e.alert) {
      ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#ff5050'; ctx.fillText(bubbles.has(e.id) ? 'ピーッ！♪' : '！', pos.x, pos.y - (img ? 74 : 48) - Math.abs(Math.sin(now * 8)) * 4);
    }
  }

  function drawBoss(b, pos, now) {
    const wob = Math.sin(now * 5) * 3;
    if (b.st !== 'wander' && !b.stun) { ctx.shadowColor = '#ff2020'; ctx.shadowBlur = 30; }
    const img = art('oni/boss-' + (b.type || 'red'));
    if (img) { ctx.shadowBlur = 0; ctx.fillStyle = '#0007'; ctx.beginPath(); ctx.ellipse(pos.x, pos.y + 40, 50, 15, 0, 0, Math.PI * 2); ctx.fill(); drawSprite(img, pos.x, pos.y + 40 + wob, 180, Math.cos(b.face) < 0, b.flash); }
    else drawOni(pos.x, pos.y + wob, 46, S.BOSSES[b.type || 'red'].color, b.face, b.flash, [-1, 1]);
    ctx.shadowBlur = 0;
    if (b.stun) {
      ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = 3;
      for (let k = 0; k < 5; k++) {
        const a = now * 6 + k * 1.26;
        ctx.beginPath(); ctx.moveTo(pos.x + Math.cos(a) * 30, pos.y - 60 + Math.sin(a) * 10); ctx.lineTo(pos.x + Math.cos(a) * 44, pos.y - 70 + Math.sin(a) * 10); ctx.stroke();
      }
      ctx.fillStyle = '#ffe14a'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('ビリビリ…', pos.x, pos.y - 80);
    }
    bar(pos.x - 50, pos.y - (img ? 132 : 72), 100, 6, b.hp / b.maxHp, '#ff8a3d');
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
    const img = art('yokai/' + y.id);
    if (img) {
      ctx.strokeStyle = S.RANKS[y.rank].color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(0, 16, 20, 7, 0, 0, Math.PI * 2); ctx.stroke();
      drawSprite(img, 0, 16, 80, Math.cos(p.face) < 0);
    } else {
      ctx.fillStyle = y.color;
      ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = S.RANKS[y.rank].color; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.arc(Math.cos(p.face) * 6 - 5, Math.sin(p.face) * 4 - 3, 3, 0, Math.PI * 2); ctx.arc(Math.cos(p.face) * 6 + 5, Math.sin(p.face) * 4 - 3, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const top = img ? -62 : -29;
    ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#fff'; ctx.fillText(p.name, 0, top - 5);
    bar(-22, top, 44, 5, p.hp / p.maxHp, '#5be07a');
    // ダッシュのスタミナ（減っているときだけ）
    if (!p.down && !p.inf && (p.stam < 100 || p.exh)) {
      bar(-18, top - 24, 36, 4, p.stam / 100, p.exh ? '#ff5050' : '#5be0ff');
      if (p.exh) {
        ctx.font = 'bold 13px sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = '#000';
        const wob = Math.sin(performance.now() / 120) * 2;
        ctx.strokeText('ぜぇぜぇ…', 0, top - 30 + wob); ctx.fillStyle = '#ffb0b0'; ctx.fillText('ぜぇぜぇ…', 0, top - 30 + wob);
      }
    }
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
    // どデカい鬼玉
    for (const d of dama.values()) if (d.v > 1) dot(d.x, d.y, 3 + Math.abs(Math.sin(now * 5)) * 2.5, '#ff5ac8');
    // アイテム（画面に見えているものだけ種類がわかる）
    ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const it of snap.items) {
      const known = inView(it.x, it.y);
      if (known) { ctx.font = '10px sans-serif'; ctx.fillText(S.ITEMS[it.type].icon, ox + it.x * sx, oy + it.y * sx); }
      else { dot(it.x, it.y, 4, '#d0c0ff'); ctx.fillStyle = '#301050'; ctx.font = 'bold 7px sans-serif'; ctx.fillText('?', ox + it.x * sx, oy + it.y * sx + 0.5); }
    }
    ctx.textBaseline = 'alphabetic';
    for (const e of snap.patrols) dot(e.x, e.y, 3, e.alert ? (Math.sin(now * 12) > 0 ? '#ff4040' : '#ffffff') : '#b08cff');
    if (snap.boss) {
      dot(snap.boss.x, snap.boss.y, 6, BOSS_UI[snap.boss.type] || '#ff2020');
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(ox + snap.boss.x * sx, oy + snap.boss.y * sx, 6, 0, Math.PI * 2); ctx.stroke();
    }
    for (const p of snap.players) {
      if (p.esc) continue;
      const pos = p.id === myId && myPred ? myPred : p;
      dot(pos.x, pos.y, p.id === myId ? 4.5 : 3.5, p.id === myId ? '#ffe36b' : S.YOKAI_BY_ID[p.yokai].color);
    }
    ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 1;
    ctx.strokeRect(ox + Math.max(0, view.l) * sx, oy + Math.max(0, view.t) * sx, (Math.min(map.w, view.r) - Math.max(0, view.l)) * sx, (Math.min(map.h, view.b) - Math.max(0, view.t)) * sx);
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
      ctx.textAlign = 'right';
      ctx.font = 'bold 24px sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = '#000';
      const label = `× ${me.dama}`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = '#ff3da8'; ctx.shadowColor = '#ff3da8'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(W - 34 - tw, 30, 12, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffd0f0'; ctx.beginPath(); ctx.arc(W - 38 - tw, 26, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeText(label, W - 20, 39); ctx.fillStyle = '#ffd0f0'; ctx.fillText(label, W - 20, 39);
    }

    // 仲間
    let y = 66;
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
      const atFusuma = myPred && Math.hypot(myPred.x - fusuma.x, myPred.y - fusuma.y) < 80;
      drawButton(bs.atk, btnHold.atk !== null || input.atk, atFusuma ? 1 - me.ep : me.atkCd, atFusuma ? '#c8a020' : '#e2531f', atFusuma ? '脱出' : '攻撃', atFusuma ? '長押し' : null);
      drawButton(bs.strong, input.strong, me.stCd, '#7a3fbf', '強攻撃', st.strong);
      const it = me.item ? S.ITEMS[me.item] : null;
      const itImg = me.item ? art('item/' + me.item) : null;
      drawButton(bs.item, input.item, 0, it ? '#2f8a5a' : '#333', it ? (itImg ? '' : it.icon) : 'アイテム', it ? it.name : 'なし', !!it);
      if (itImg) ctx.drawImage(itImg, bs.item.x - bs.item.r * 0.5, bs.item.y - bs.item.r * 0.75, bs.item.r, bs.item.r);
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
    } else if (timeLimit - snap.timeLeft < 8 && !(me && me.esc)) {
      ctx.fillStyle = '#ffffff66'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('左側をドラッグで移動', W * 0.22, H - 40);
    }

    if (me && me.esc) {
      const watching = snap.players.find(p => p.id === spectateId && !p.esc);
      ctx.textAlign = 'center'; ctx.font = 'bold 18px sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = '#000';
      const msg = watching ? `👀 観戦中：${watching.name}（タップで切り替え）` : '脱出済み！ みんなを待っています…';
      ctx.strokeText(msg, W / 2, H - 30); ctx.fillStyle = '#ffd84a'; ctx.fillText(msg, W / 2, H - 30);
    }

    if (banner) {
      ctx.globalAlpha = Math.min(1, banner.t * 2);
      ctx.font = `bold ${Math.round(Math.min(W, H) * 0.065)}px sans-serif`; ctx.textAlign = 'center';
      ctx.lineWidth = 6; ctx.strokeStyle = '#000'; ctx.strokeText(banner.text, W / 2, H * 0.34);
      ctx.fillStyle = banner.c || '#ffe36b'; ctx.fillText(banner.text, W / 2, H * 0.34);
      if (banner.sub) {
        ctx.font = `bold ${Math.round(Math.min(W, H) * 0.04)}px sans-serif`; ctx.lineWidth = 4;
        ctx.strokeText(banner.sub, W / 2, H * 0.34 + 34); ctx.fillStyle = '#fff'; ctx.fillText(banner.sub, W / 2, H * 0.34 + 34);
      }
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
    if (label) ctx.fillText(label, b.x, b.y - (sub ? b.r * 0.15 : 0));
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
        const spd = st.speed * (run ? 1.4 : 1);
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
    if (me && me.esc) {
      // 脱出したら、まだ鬼の世界にいる仲間を観戦する
      let other = snap.players.find(p => p.id === spectateId && !p.esc);
      if (!other) { other = snap.players.find(p => !p.esc); spectateId = other ? other.id : null; }
      if (other) { const pos = ents.get('p' + other.id) || other; cam.x = pos.x; cam.y = pos.y; }
    }
    view = { l: cam.x - cam.vw / 2, r: cam.x + cam.vw / 2, t: cam.y - cam.vh / 2, b: cam.y + cam.vh / 2 };

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
      const r = d.v > 1 ? 30 + Math.sin(now * 6) * 2 : 9;
      ctx.fillStyle = '#ff3da8'; ctx.shadowColor = d.v > 1 ? '#ffe14a' : '#ff3da8'; ctx.shadowBlur = d.v > 1 ? 40 : 12;
      ctx.beginPath(); ctx.arc(d.x, d.y + bob, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffd0f0'; ctx.beginPath(); ctx.arc(d.x - r / 3, d.y + bob - r / 3, r / 3, 0, Math.PI * 2); ctx.fill();
      if (d.v > 1) {
        ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(d.x, d.y + bob, r + 4, 0, Math.PI * 2); ctx.stroke();
        ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#000';
        ctx.strokeText(`×${d.v}`, d.x, d.y + bob - r - 10); ctx.fillStyle = '#ffe14a'; ctx.fillText(`×${d.v}`, d.x, d.y + bob - r - 10);
      }
    }
    // アイテム
    for (const it of snap.items) {
      if (!inView(it.x, it.y, 40)) continue;
      const known = inView(it.x, it.y);
      const bob = Math.sin(now * 3 + it.id) * 3;
      ctx.fillStyle = known ? '#2f8a5a' : '#5a3a8a'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(it.x - 16, it.y - 16 + bob, 32, 32, 8) : ctx.rect(it.x - 16, it.y - 16 + bob, 32, 32); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (known) { const ii = art('item/' + it.type); if (ii) ctx.drawImage(ii, it.x - 18, it.y - 18 + bob, 36, 36); else { ctx.font = '20px sans-serif'; ctx.fillText(S.ITEMS[it.type].icon, it.x, it.y + bob); } ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(S.ITEMS[it.type].name, it.x, it.y - 26 + bob); }
      else { ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('?', it.x, it.y + bob); }
      ctx.textBaseline = 'alphabetic';
    }
    drawFusuma(now, me);

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
