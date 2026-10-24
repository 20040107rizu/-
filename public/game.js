// 鬼バスターズ クライアント
(() => {
  'use strict';
  const S = window.Shared;

  const $ = id => document.getElementById(id);
  const screens = ['title', 'lobby', 'game', 'gacha', 'result', 'installHelp', 'saveScreen', 'whatsNew', 'buddyScreen', 'zukan', 'rankScreen', 'rewardScreen', 'profileScreen'];
  function show(id, keepGame) {
    for (const s of screens) $(s).classList.toggle('active', s === id || (!!keepGame && s === 'game'));
    if (MENU_SCREENS.includes(id) && !keepGame) menuMusic();
    refreshUpdateBar();
    try { showBuildInfo(); } catch {}
  }
  // タイトル・ロビー・結果などではタイトルの曲を流す
  const MENU_SCREENS = ['title', 'lobby', 'saveScreen', 'installHelp', 'whatsNew', 'buddyScreen', 'zukan', 'rankScreen', 'rewardScreen', 'profileScreen'];
  function menuMusic() { if (window.Music && Music.enabled) Music.play('title'); }
  const onMenu = () => MENU_SCREENS.some(id => document.getElementById(id).classList.contains('active')) || document.getElementById('result').classList.contains('active');
  // スマホは画面に触れるまで音を出せないので、最初に触れたときに鳴らし始める
  document.addEventListener('pointerdown', () => { Music.unlock(); if (onMenu()) menuMusic(); }, true);
  document.addEventListener('keydown', () => { Music.unlock(); if (onMenu()) menuMusic(); }, true);
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
  stats.cleared = stats.cleared || {}; // 倒したことのあるボス鬼 { red: true, ... }
  stats.seals = stats.seals || {};     // レジェンドの封印 { legendId: { frag: 欠片, black: 封印の地で黒鬼を倒した } }
  // 称号（図鑑のコンプリート報酬）。付けている称号は引き継ぎコードにも入る
  let myTitle = localStorage.getItem('title') || null;
  let weeklyTitles = loadJSON('wtitles', []).filter(id => S.weeklyTitle(id)); // ランキング1位でもらった称号
  const titlesDone = () => S.titleProgress(friends).filter(t => t.done).map(t => t.title.id).concat(weeklyTitles);
  const titleInfo = id => S.TITLE_BY_ID[id] || S.weeklyTitle(id);
  function checkMyTitle() { if (myTitle && !titlesDone().includes(myTitle)) myTitle = null; }
  checkMyTitle();
  const myTotsu = () => S.totsuOf(friends[selYokai] || 0);
  const titleTag = id => { const t = titleInfo(id); return t ? `<span class="ttl${t.color === 'gold' ? ' gold' : ''}" style="${t.color === 'gold' ? '' : `color:${t.color}`}">《${t.name}》</span>` : ''; };
  const nameTag = (name, title) => `<span class="${title === 'all' ? 'gold' : ''}">${esc(name)}</span>`;
  const totsuTag = n => (n > 0 ? `<span class="totsu">${n >= S.TOTSU_MAX ? '凸MAX' : `凸${n}`}</span>` : '');

  // フレンド機能用の、この人のID（引き継ぎコードにも入る）
  const newPid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'[b & 63]).join('');
  let pid = localStorage.getItem('pid');
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(pid || '')) { pid = newPid(); try { localStorage.setItem('pid', pid); } catch {} }
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
    const data = { v: 1, p: pid, t: myTitle, n: localStorage.getItem('name') || '', y: selYokai, f: S.YOKAI.map(y => friends[y.id] || 0), l: S.LEGENDS.map(l => friends[l.id] || 0), g: S.LEGENDS.map(l => [stats.seals[l.id]?.frag || 0, stats.seals[l.id]?.black ? 1 : 0]), s: [stats.plays, stats.escapes, stats.dama, stats.best, S.BOSS_ORDER.reduce((m, k, i) => m | (stats.cleared[k] ? 1 << i : 0), 0)] };
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
    S.LEGENDS.forEach((l, i) => { if ((d.l || [])[i] > 0) f[l.id] = 1; });
    const seals = {};
    S.LEGENDS.forEach((l, i) => { const g = (d.g || [])[i]; if (Array.isArray(g) && (g[0] || g[1])) seals[l.id] = { frag: Math.min(99, Math.floor(+g[0] || 0)), black: !!g[1] }; });
    const st = (d.s || []).map(x => Math.max(0, Math.floor(+x || 0)));
    return { pid: /^[A-Za-z0-9_-]{8,40}$/.test(d.p || '') ? d.p : null, title: S.TITLE_BY_ID[d.t] || S.weeklyTitle(d.t) ? d.t : null, seals, name: String(d.n || '').slice(0, 10), yokai: d.y, friends: loadFriends(f), stats: { plays: st[0] || 0, escapes: st[1] || 0, dama: st[2] || 0, best: st[3] || 0, cleared: Object.fromEntries(S.BOSS_ORDER.filter((k, i) => (st[4] || 0) & (1 << i)).map(k => [k, true])) } };
  }

  // ---------- フレンド（このゲームで遊んだ人はみんなフレンド） ----------
  // ホーム画面にいる間はサーバーとつないで、みんなが今どうしているかを受け取る
  let pws = null, pwsWait = 2000, buddyLive = [];
  let buddies = loadJSON('buddies', {}); // 一度会った人（サーバーが再起動しても一覧に残す） pid → { name, yokai, seen }
  function presenceConnect() {
    if (pws && pws.readyState <= 1) return;
    pws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    pws.onopen = () => { pwsWait = 2000; helloAgain(); };
    pws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.t === 'profile') return gotProfile(m);
      if (m.t !== 'friends') return;
      buddyLive = m.list;
      for (const f of m.list) buddies[f.pid] = { name: f.name, yokai: f.yokai, seen: Math.max(f.seen, buddies[f.pid]?.seen || 0) };
      const keep = Object.entries(buddies).sort((a, b) => b[1].seen - a[1].seen).slice(0, 200);
      buddies = Object.fromEntries(keep);
      try { localStorage.setItem('buddies', JSON.stringify(buddies)); } catch {}
      renderBuddies();
    };
    pws.onclose = () => {
      pws = null; buddyLive = [];
      renderBuddies();
      setTimeout(presenceConnect, pwsWait);
      pwsWait = Math.min(pwsWait * 2, 30000);
    };
  }
  // フレンドに見せる自分の情報（持っている妖怪の数・記録・称号）
  const PROF_YOKAI = S.YOKAI.concat(S.LEGENDS);
  function myProfile() {
    return {
      f: PROF_YOKAI.map(y => Math.min(9, friends[y.id] || 0)).join(''),
      s: [stats.plays, stats.escapes, stats.best, stats.dama],
      c: S.BOSS_ORDER.reduce((m, k, i) => m | (stats.cleared[k] ? 1 << i : 0), 0),
      tc: titlesDone().length, wt: weeklyTitles,
    };
  }
  function helloAgain() {
    if (pws && pws.readyState === 1) pws.send(JSON.stringify({ t: 'hello', pid, name: $('name').value.trim() || 'プレイヤー', yokai: selYokai, title: myTitle, prof: myProfile() }));
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) presenceConnect(); });
  const STATUS = { home: 'ホームにいる', lobby: '募集中', battle: '出撃中', result: '結果を見ている', off: 'オフライン' };
  const ago = t => { const m = Math.floor((Date.now() - t) / 60000); return m < 60 ? `${Math.max(1, m)}分前` : m < 1440 ? `${Math.floor(m / 60)}時間前` : `${Math.floor(m / 1440)}日前`; };
  function renderBuddies() {
    const live = new Map(buddyLive.map(f => [f.pid, f]));
    const list = Object.entries(buddies).filter(([id]) => id !== pid).map(([id, b]) => live.get(id) || { pid: id, ...b, status: 'off' });
    const order = { lobby: 0, battle: 1, result: 2, home: 3, off: 4 };
    list.sort((a, b) => order[a.status] - order[b.status] || b.seen - a.seen);
    const online = list.filter(f => f.status !== 'off').length;
    const open = list.filter(f => f.room && f.status === 'lobby').length;
    $('buddyBadge').hidden = !online;
    $('buddyBadge').textContent = open ? `募集中 ${open}` : `${online}人`;
    if (!$('buddyScreen').classList.contains('active')) return;
    const ul = $('buddyList');
    if (!list.length) { ul.innerHTML = `<li class="buddy-empty">${pws ? 'まだフレンドがいません。だれかがこのゲームを遊ぶと、ここに出てきます' : 'サーバーにつないでいます…'}</li>`; return; }
    ul.innerHTML = list.map(f => {
      const y = S.YOKAI_BY_ID[f.yokai] || S.YOKAI[0], url = artUrl('yokai/' + y.id);
      const st = f.status === 'off' ? `オフライン（${ago(f.seen)}）` : f.status === 'lobby' ? `募集中（${f.n}/4人）` : STATUS[f.status];
      const btn = f.room && f.status === 'lobby' ? `<button class="join" data-code="${f.room}">参加</button>`
        : f.room && f.status === 'battle' ? `<button class="watch" data-code="${f.room}">観戦</button>` : '';
      return `<li class="${f.status}" data-pid="${f.pid}">${url ? `<img src="${url}" alt="">` : '<span class="noimg"></span>'}<div class="who"><b>${nameTag(f.name, f.title)} ${f.title ? titleTag(f.title) : ''}</b><span class="st ${f.status}">${st}</span></div>${btn}</li>`;
    }).join('');
    for (const li of ul.querySelectorAll('li[data-pid]')) li.onclick = e => { if (!e.target.closest('button')) openProfile(li.dataset.pid); };
    for (const b of ul.querySelectorAll('button.join')) b.onclick = () => { $('buddyMsg').textContent = ''; connect({ t: 'join', code: b.dataset.code }); };
    for (const b of ul.querySelectorAll('button.watch')) b.onclick = () => { $('buddyMsg').textContent = ''; connect({ t: 'watch', code: b.dataset.code }); };
  }
  // ---------- フレンドのプロフィール ----------
  let profPid = null, profTab = 'all';
  function openProfile(id) {
    profPid = id; profTab = 'all';
    show('profileScreen');
    renderProfile();
    if (pws && pws.readyState === 1) pws.send(JSON.stringify({ t: 'profile', pid: id }));
  }
  function gotProfile(m) {
    if (m.ok && buddies[m.pid]) { buddies[m.pid].prof = m.prof; try { localStorage.setItem('buddies', JSON.stringify(buddies)); } catch {} } // オフラインでも見られるように覚えておく
    if (m.pid === profPid) renderProfile(m.ok ? null : 'none');
  }
  function renderProfile(state) {
    const b = buddies[profPid] || {}, live = buddyLive.find(f => f.pid === profPid) || { status: 'off', seen: b.seen };
    const pr = b.prof;
    const y = S.YOKAI_BY_ID[live.yokai || b.yokai] || S.YOKAI[0], url = artUrl('yokai/' + y.id);
    const counts = pr ? Object.fromEntries(PROF_YOKAI.map((q, i) => [q.id, +(pr.f[i] || 0)])) : {};
    const own = S.YOKAI.filter(q => counts[q.id]).length, legends = S.LEGENDS.filter(q => counts[q.id]);
    const st = live.status === 'off' ? `オフライン（${ago(live.seen || Date.now())}）` : live.status === 'lobby' ? `募集中（${live.n}/4人）` : STATUS[live.status];
    const bosses = S.BOSS_ORDER.map((k, i) => `<span class="pboss ${k}${pr && pr.c & (1 << i) ? ' on' : ''}">${S.BOSSES[k].name}${pr && pr.c & (1 << i) ? '✔' : ''}</span>`).join('');
    $('profInfo').innerHTML = `${url ? `<img class="big-face" src="${url}" alt="">` : ''}
      <div class="pv"><b>${nameTag(b.name || live.name || '？', live.title || b.title)}</b> ${(live.title || b.title) ? titleTag(live.title || b.title) : ''}
      <div><span class="st ${live.status}">${st}</span></div>
      <div>いまのお友達：<span style="color:${S.RANKS[y.rank].color}">${y.rank} ${esc(y.name)}</span></div>
      ${pr ? `<dl><dt>お友達</dt><dd>${own} / ${S.YOKAI.length}体${legends.length ? `　🌈 レジェンド ${legends.length}体` : ''}</dd>
        <dt>遊んだ</dt><dd>${pr.s[0] || 0}回（脱出 ${pr.s[1] || 0}回）</dd>
        <dt>鬼玉</dt><dd>最高 ${pr.s[2] || 0}個・合計 ${(pr.s[3] || 0).toLocaleString('ja-JP')}個</dd>
        <dt>称号</dt><dd>${pr.tc || 0}個${(pr.wt || []).length ? `（限定 ${pr.wt.map(titleTag).join(' ')}）` : ''}</dd>
        <dt>ボス鬼</dt><dd>${bosses}</dd></dl>`
        : `<small>${state === 'none' ? 'まだくわしい情報がありません（この人が新しいバージョンで遊ぶと見られるようになります）' : '読み込み中…'}</small>`}</div>`;
    const btn = live.room && live.status === 'lobby' ? `<button class="big" id="profJoin">参加</button>` : live.room && live.status === 'battle' ? `<button class="big alt" id="profWatch">観戦</button>` : '';
    $('profAction').innerHTML = btn;
    if ($('profJoin')) $('profJoin').onclick = () => connect({ t: 'join', code: live.room });
    if ($('profWatch')) $('profWatch').onclick = () => connect({ t: 'watch', code: live.room });
    // 持っている妖怪
    const tabs = [['all', 'ぜんぶ'], ['L', '🌈'], ['S', 'S'], ['A', 'A'], ['B', 'B'], ['C', 'C']];
    $('profTabs').innerHTML = pr ? tabs.map(([k, l]) => {
      const pool = k === 'all' ? S.YOKAI : k === 'L' ? S.LEGENDS : S.YOKAI.filter(q => q.rank === k);
      return `<button class="tab${profTab === k ? ' on' : ''}" data-k="${k}">${l} <small>${pool.filter(q => counts[q.id]).length}/${pool.length}</small></button>`;
    }).join('') : '';
    for (const t of $('profTabs').querySelectorAll('button')) t.onclick = () => { profTab = t.dataset.k; $('profGrid').scrollTop = 0; renderProfile(state); };
    const pool = profTab === 'all' ? S.LEGENDS.concat(S.YOKAI) : profTab === 'L' ? S.LEGENDS : S.YOKAI.filter(q => q.rank === profTab);
    const list = pool.filter(q => counts[q.id]);
    $('profGrid').innerHTML = !pr ? '' : list.length ? list.map(q => {
      const n = counts[q.id], tt = S.totsuOf(n);
      return `<div class="yk${q.legend ? ' legend' : ''}"><span class="rk" style="color:${S.RANKS[q.rank].color}">${q.rank}</span>${tt ? `<span class="cnt">${tt >= S.TOTSU_MAX ? '凸MAX' : `凸${tt}`}</span>` : ''}${faceImg(q)}<span class="nm">${q.name}</span><small class="nm">${S.ROLES[q.role].name}・${q.origin}</small></div>`;
    }).join('') : '<p class="sub">このランクのお友達はまだいません</p>';
  }
  $('btnProfClose').onclick = () => { show('buddyScreen'); renderBuddies(); };

  $('btnBuddies').onclick = () => { $('buddyMsg').textContent = ''; show('buddyScreen'); renderBuddies(); presenceConnect(); };
  $('btnBuddyClose').onclick = () => show('title');
  $('name').addEventListener('change', helloAgain);

  // ---------- 妖怪図鑑 ----------
  let zukanRank = 'all', zukanRole = 'all', zukanSel = null;
  function renderTitles() {
    const prog = S.titleProgress(friends);
    $('zukanGrid').innerHTML = '';
    $('zukanTitles').innerHTML = prog.map(({ title: t, got, need, done }) => `<div class="title-row${done ? ' done' : ''}${myTitle === t.id ? ' on' : ''}">
        <div class="tinfo">${done ? titleTag(t.id) : `<span class="ttl locked">《${t.name}》</span>`}<small>${t.desc}</small>
        <div class="tbar"><i style="width:${Math.round((got / need) * 100)}%"></i></div></div>
        <span class="tnum">${got}/${need}</span>
        ${done ? `<button class="small" data-id="${t.id}">${myTitle === t.id ? 'はずす' : 'つける'}</button>` : '<span class="tlock">🔒</span>'}</div>`).join('')
      + weeklyTitles.map(id => { const t = S.weeklyTitle(id); return `<div class="title-row done${myTitle === id ? ' on' : ''}"><div class="tinfo">${titleTag(id)}<small>🏆 ${t.desc}（限定）</small></div>
        <button class="small" data-id="${id}">${myTitle === id ? 'はずす' : 'つける'}</button></div>`; }).join('');
    for (const b of $('zukanTitles').querySelectorAll('button')) b.onclick = () => {
      myTitle = myTitle === b.dataset.id ? null : b.dataset.id;
      try { localStorage.setItem('title', myTitle || ''); } catch {}
      helloAgain(); renderTitles(); renderMyTitle();
    };
    renderMyTitle();
  }
  function renderMyTitle() {
    const done = titlesDone().length;
    $('zukanInfo').innerHTML = `<div class="pv"><b>🏅 称号</b><div>${done} / ${S.TITLES.length} 個ゲット</div>
      <div style="margin:6px 0">いまの称号：${myTitle ? titleTag(myTitle) : 'なし'}</div>
      <small>図鑑をコンプリートすると称号がもらえます。つけた称号は、ロビーやフレンド一覧で名前といっしょに表示されます。「妖怪マスター」をつけると名前が金色に！</small></div>`;
  }
  function renderZukan() {
    $('zukanTitles').hidden = zukanRank !== 'title';
    $('zukanGrid').hidden = zukanRank === 'title';
    $('zukanRoles').hidden = zukanRank === 'title' || zukanRank === 'legend';
    const got = S.YOKAI.filter(y => friends[y.id]).length;
    $('zukanCount').textContent = `${got} / ${S.YOKAI.length} 体`;
    $('zukanTabs').innerHTML = [['all', 'ぜんぶ'], ['C', 'C'], ['B', 'B'], ['A', 'A'], ['S', 'S']].map(([k, label]) => {
      const l = k === 'all' ? S.YOKAI : S.YOKAI.filter(y => y.rank === k);
      return `<button class="tab${zukanRank === k ? ' on' : ''}" data-k="${k}">${label} <small>${l.filter(y => friends[y.id]).length}/${l.length}</small></button>`;
    }).join('') + `<button class="tab legend-tab${zukanRank === 'legend' ? ' on' : ''}" data-k="legend">🌈 レジェンド <small>${S.LEGENDS.filter(l => friends[l.id]).length}/${S.LEGENDS.length}</small></button>`
      + `<button class="tab title-tab${zukanRank === 'title' ? ' on' : ''}" data-k="title">🏅 称号 <small>${titlesDone().length}/${S.TITLES.length}</small></button>`;
    $('zukanRoles').innerHTML = [['all', 'ぜんぶ'], ...Object.entries(S.ROLES).map(([k, r]) => [k, r.name])].map(([k, label]) =>
      `<button class="tab${zukanRole === k ? ' on' : ''}" data-k="${k}">${label}</button>`).join('');
    for (const b of $('zukanTabs').querySelectorAll('button')) b.onclick = () => { zukanRank = b.dataset.k; $('zukanGrid').scrollTop = 0; renderZukan(); };
    for (const b of $('zukanRoles').querySelectorAll('button')) b.onclick = () => { zukanRole = b.dataset.k; $('zukanGrid').scrollTop = 0; renderZukan(); };
    if (zukanRank === 'title') { renderTitles(); return; }
    if (zukanRank === 'legend') { renderLegends(); return; }
    const list = S.YOKAI.filter(y => (zukanRank === 'all' || y.rank === zukanRank) && (zukanRole === 'all' || y.role === zukanRole));
    const grid = $('zukanGrid'), keep = grid.scrollTop;
    grid.innerHTML = '';
    for (const y of list) {
      const owned = friends[y.id];
      const d = document.createElement('div');
      d.className = 'yk' + (y.id === zukanSel ? ' sel' : '') + (owned ? '' : ' locked');
      d.innerHTML = `<span class="rk" style="color:${S.RANKS[y.rank].color}">${y.rank}</span>${owned > 1 ? `<span class="cnt">${S.totsuOf(owned) >= S.TOTSU_MAX ? '凸MAX' : `凸${S.totsuOf(owned)}`}</span>` : ''}${faceImg(y, !owned)}`
        + (owned ? `<span class="nm">${y.name}</span>` : `<span class="unk nm">${'？'.repeat([...y.name].length)}</span>`) + `<small class="nm">${y.origin}</small>`;
      d.onclick = () => { zukanSel = y.id; renderZukan(); };
      grid.appendChild(d);
    }
    grid.scrollTop = keep;
    renderZukanInfo();
  }
  function renderZukanInfo() {
    const y = S.YOKAI_BY_ID[zukanSel];
    if (!y) { $('zukanInfo').innerHTML = '<div class="pv">妖怪をタップすると、くわしく見られるよ<br><small>まだお友達になっていない妖怪はシルエットで表示されます</small></div>'; return; }
    const owned = friends[y.id], url = artUrl('yokai/' + y.id);
    const img = url ? `<img class="big-face${owned ? '' : ' sil'}" src="${url}" alt="">` : `<div class="big-face" style="background:${owned ? y.color : '#333'}"></div>`;
    if (!owned) {
      $('zukanInfo').innerHTML = `${img}<div class="pv"><b style="color:${S.RANKS[y.rank].color}">${y.rank} ${'？'.repeat([...y.name].length)}</b><div>出身：${y.origin}</div><small>まだお友達になっていません。鬼ガチャで出会えるかも</small></div>`;
      return;
    }
    const at = Attacks.of(y.id), sk = Attacks.SKILL[y.role], el = Attacks.ELEMENT[at.el];
    $('zukanInfo').innerHTML = `${img}<div class="pv"><b style="color:${S.RANKS[y.rank].color}">${y.rank} ${esc(y.name)}</b>
      <div>${S.ROLES[y.role].name}・<span style="color:${el.color}">${el.name}属性</span>・${y.origin}</div>
      <dl><dt>通常</dt><dd>${esc(at.normalName)}</dd><dt>強攻撃</dt><dd>${esc(at.strongName)}</dd><dt>スキル</dt><dd>${sk.label}</dd><dt>仲間</dt><dd>${owned}体${owned > 1 ? `（${S.totsuOf(owned) >= S.TOTSU_MAX ? '凸MAX' : `凸${S.totsuOf(owned)}`}・HP/攻撃 +${Math.round(S.totsuOf(owned) * S.TOTSU_STEP * 100)}%）` : ''}</dd></dl></div>`;
  }
  // ---------- レジェンド（封印をとく） ----------
  function renderLegends() {
    if (!S.YOKAI_BY_ID[zukanSel]?.legend) zukanSel = S.LEGENDS[0].id;
    const grid = $('zukanGrid');
    grid.innerHTML = '';
    for (const l of S.LEGENDS) {
      const owned = friends[l.id], ready = !owned && S.sealProgress(l, friends, stats.seals).ready;
      const d = document.createElement('div');
      d.className = 'yk legend' + (l.id === zukanSel ? ' sel' : '') + (owned ? '' : ' locked');
      d.innerHTML = `<span class="rk" style="color:${S.RANKS.L.color}">L</span>${ready ? '<span class="cnt">🔓</span>' : ''}${faceImg(l, !owned)}<span class="nm">${l.name}</span><small class="nm">${S.STAGES[l.stage].name}</small>`;
      d.onclick = () => { zukanSel = l.id; renderZukan(); };
      grid.appendChild(d);
    }
    const l = S.YOKAI_BY_ID[zukanSel], owned = friends[l.id];
    const prog = S.sealProgress(l, friends, stats.seals);
    const box = document.createElement('div');
    box.className = 'seal-box';
    box.innerHTML = owned
      ? `<b>🌈 封印はとけています</b><br><small>ロビーで連れていけます（チームで1体まで）</small>`
      : `<b>🔒 封印をとく条件（ぜんぶ必要）</b>
        ${prog.conds.map(c => `<div class="cond${c.got >= c.need ? ' ok' : ''}"><span class="ck">${c.got >= c.need ? '✓' : ''}</span><span class="cl">${esc(c.label)}</span><span class="pg">${c.got}/${c.need}</span></div><div class="tbar"><i style="width:${Math.round((c.got / c.need) * 100)}%"></i></div>`).join('')}
        <div class="mem">${l.seal.map(id => { const y = S.YOKAI_BY_ID[id], n = friends[id]; return `<span class="${n ? 'got' : ''}">${n ? `${y.name}${S.totsuOf(n) ? ` 凸${S.totsuOf(n)}` : ''}` : '？'.repeat([...y.name].length)}</span>`; }).join('')}</div>
        <button id="btnUnseal" class="big"${prog.ready ? '' : ' disabled'}>${prog.ready ? '🔓 封印をとく！' : '🔒 封印をとく（条件がそろうと押せる）'}</button>`;
    grid.appendChild(box);
    if ($('btnUnseal')) $('btnUnseal').onclick = () => unseal(l);
    renderLegendInfo(l);
  }
  function renderLegendInfo(l) {
    const owned = friends[l.id], url = artUrl('yokai/' + l.id);
    const at = Attacks.of(l.id), el = Attacks.ELEMENT[at.el];
    $('zukanInfo').innerHTML = `${url ? `<img class="big-face legend-face${owned ? '' : ' sil'}" src="${url}" alt="">` : ''}
      <div class="pv"><b class="legend-name">L ${esc(l.name)}</b>
      <div>${S.ROLES[l.role].name}・<span style="color:${el.color}">${el.name}属性</span>・封印の地：${S.STAGES[l.stage].name}</div>
      <dl><dt>必殺技</dt><dd>${esc(l.ultName)}：${esc(l.ultDesc)}</dd><dt>特性</dt><dd>${esc(l.passiveDesc)}</dd></dl>
      <small>${esc(l.story)}</small></div>`;
  }
  function unseal(l) {
    if (friends[l.id] || !S.sealProgress(l, friends, stats.seals).ready) return;
    friends[l.id] = 1;
    saveAll(); updateFriendCount(); helloAgain();
    beep(523, 0.2, 'triangle', 0.08); setTimeout(() => beep(784, 0.2, 'triangle', 0.08), 150); setTimeout(() => beep(1046, 0.5, 'triangle', 0.09), 300);
    $('rewardWeek').textContent = '🌈 レジェンド';
    $('rewardTitle').textContent = `${l.name}の封印がとけた！`;
    $('rewardSub').textContent = `${l.name}がお友達になった！ ロビーで連れていけます（チームで1体まで）`;
    $('rewardPrizes').innerHTML = `<img class="unseal-img" src="${artUrl('yokai/' + l.id) || ''}" alt="">`;
    $('btnRewardOk').onclick = () => { show('zukan'); renderZukan(); };
    show('rewardScreen');
  }

  $('btnZukan').onclick = () => { zukanSel = null; show('zukan'); renderZukan(); };
  $('btnZukanClose').onclick = () => show('title');

  // ---------- 週替わりランキング ----------
  let rankData = null;
  async function loadRanking(week) {
    const r = await fetch(`ranking?pid=${encodeURIComponent(pid)}${week ? `&week=${week}` : ''}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }
  function rankButton() {
    const th = rankData ? rankData.theme : S.themeOf(S.weekIndex());
    const me = rankData && rankData.me;
    $('btnRank').innerHTML = `${th.icon} ランキング${me && me.rank ? ` <span class="badge gold-bg">${me.rank}位</span>` : ''}`;
    $('btnRank').title = th.name;
  }
  async function refreshRanking() {
    try { rankData = await loadRanking(); } catch { return; }
    rankButton();
    if ($('rankScreen').classList.contains('active')) renderRanking();
  }
  const left = end => { const ms = Math.max(0, end - Date.now()), d = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000) % 24, m = Math.floor(ms / 60000) % 60; return d ? `${d}日${h}時間` : h ? `${h}時間${m}分` : `${m}分`; };
  function rewardText(r) {
    return { gold: '金玉チケット', red: '赤玉チケット', blue: '青玉チケット', green: '緑玉チケット' }[r.ticket] + (r.title ? '＋限定称号' : '');
  }
  function renderRanking() {
    const now = rankData ? rankData.idx : S.weekIndex();
    $('rankSched').innerHTML = [-1, 0, 1, 2, 3].map(k => {
      const t = S.themeOf(now + k);
      if (now + k < 0) return '';
      return `<div class="sched${k === 0 ? ' on' : k < 0 ? ' past' : ''}"><span class="ic">${t.icon}</span><div><small>第${t.no}回${k === 0 ? '（開催中）' : k < 0 ? '（終了）' : k === 1 ? '（来週）' : ''}</small><br>${esc(t.name)}</div>${k === 0 ? '<span class="now">いま</span>' : ''}</div>`;
    }).join('');
    if (!rankData) { $('rankList').innerHTML = '<p class="sub">読み込み中…</p>'; return; }
    const d = rankData, th = d.theme;
    $('rankBanner').innerHTML = `<span class="ic">${th.icon}</span><div class="txt"><b>第${th.no}回：${esc(th.name)}</b><br>${esc(th.desc)}</div><div class="left">のこり<br><b>${left(d.end)}</b></div>`;
    $('rankCount').textContent = `参加 ${d.total}人` + (d.dbError ? '（⚠️ 記録の保存に失敗しています）' : d.saved ? '（記録は保存されています）' : '（試験運転中：サーバーが更新されると記録が消えます）');
    const rows = d.rows.map((r, i) => ({ ...r, rank: i + 1 }));
    const medal = n => (n <= 3 ? ['🥇', '🥈', '🥉'][n - 1] : n);
    $('rankList').innerHTML = rows.length ? rows.map(r => {
      const y = S.YOKAI_BY_ID[r.yokai] || S.YOKAI[0], url = artUrl('yokai/' + y.id);
      return `<div class="rrow${r.pid === pid ? ' me' : ''}"><span class="rk r${r.rank}">${medal(r.rank)}</span>${url ? `<img src="${url}" alt="">` : ''}
        <div class="nm"><b>${nameTag(r.name, r.title)} ${r.title ? titleTag(r.title) : ''}</b><small>${esc(r.detail || '')}</small></div><span class="val">${esc(S.fmtScore(th, r.score))}</span></div>`;
    }).join('') : `<p class="sub empty">まだ記録がありません。一番乗りをめざそう！</p>`;
    const me = d.me;
    $('rankReward').innerHTML = `🎁 報酬　🥇 限定称号《第${th.no}回 ${esc(th.crown)}》＋金玉チケット　🥈🥉 赤玉チケット　〜10位 青玉チケット　参加賞 緑玉チケット`
      + `<br>あなた：${me.rank ? `<b>${me.rank}位</b>（${esc(S.fmtScore(th, me.score))}）→ ${rewardText(S.weeklyReward(me.rank))}` : me.joined ? '参加済み（まだ記録なし）→ 緑玉チケット' : 'まだ参加していません'}`;
  }
  $('btnRank').onclick = () => { show('rankScreen'); renderRanking(); refreshRanking(); };
  $('btnRankClose').onclick = () => show('title');
  setInterval(() => { if ($('title').classList.contains('active') || $('rankScreen').classList.contains('active')) refreshRanking(); }, 60000);

  // 先週の結果と報酬（まだ受け取っていなければ）
  let tickets = loadJSON('tickets', {});
  function renderTicketButton() {
    const n = Object.values(tickets).reduce((a, b) => a + b, 0);
    $('btnTicket').hidden = !n;
    $('btnTicket').innerHTML = `🎫 チケットガチャ <span class="badge">${n}</span>`;
  }
  async function checkReward() {
    const prev = (rankData ? rankData.idx : S.weekIndex()) - 1;
    if (prev < 0 || +(localStorage.getItem('rewardWeek') ?? -1) >= prev) return;
    let d;
    try { d = await loadRanking('prev'); } catch { return; }
    if (!d.me.joined) { try { localStorage.setItem('rewardWeek', prev); } catch {} return; }
    const r = S.weeklyReward(d.me.rank || 999), th = d.theme;
    $('rewardWeek').textContent = `第${th.no}回 ${th.name} の結果`;
    $('rewardTitle').textContent = d.me.rank ? `${d.me.rank <= 3 ? ['🥇', '🥈', '🥉'][d.me.rank - 1] : '🏅'} ${d.me.rank}位！` : '🎉 参加ありがとう！';
    $('rewardSub').textContent = d.me.rank ? `記録 ${S.fmtScore(th, d.me.score)}（参加 ${d.total}人）` : `参加 ${d.total}人`;
    const ball = S.BALLS.find(b => b.key === r.ticket);
    $('rewardPrizes').innerHTML = (r.title ? `<div class="prize"><div class="i">🏅</div>限定称号<br>${titleTag('w' + prev)}</div>` : '')
      + `<div class="prize"><div class="i" style="color:${ball.color}">●</div>${ball.name}玉チケット<br>×1</div>`;
    $('btnRewardOk').onclick = () => {
      tickets[r.ticket] = (tickets[r.ticket] || 0) + 1;
      if (r.title && !weeklyTitles.includes('w' + prev)) weeklyTitles.push('w' + prev);
      try { localStorage.setItem('tickets', JSON.stringify(tickets)); localStorage.setItem('wtitles', JSON.stringify(weeklyTitles)); localStorage.setItem('rewardWeek', prev); } catch {}
      renderTicketButton();
      show('title');
    };
    // 「アップデートしました」のお知らせなどが出ている間は待って、ホーム画面に戻ったら出す
    const open = () => { if ($('title').classList.contains('active')) show('rewardScreen'); else setTimeout(open, 800); };
    open();
  }

  // チケットガチャ: その色のガチャ玉が必ず出る
  let ticketMode = false;
  $('btnTicket').onclick = () => {
    const key = ['gold', 'red', 'blue', 'green'].find(k => tickets[k] > 0);
    if (!key) return;
    tickets[key]--;
    if (!tickets[key]) delete tickets[key];
    const ball = S.BALLS.find(b => b.key === key);
    let x = Math.random(), rank = ball.ranks[0][0];
    for (const [rk, w] of ball.ranks) { if (x < w) { rank = rk; break; } x -= w; }
    const pool = S.YOKAI.filter(y => y.rank === rank), y = pool[Math.floor(Math.random() * pool.length)];
    const isNew = !friends[y.id];
    friends[y.id] = (friends[y.id] || 0) + 1;
    try { localStorage.setItem('tickets', JSON.stringify(tickets)); } catch {}
    saveAll(); updateFriendCount(); renderTicketButton(); helloAgain();
    ticketMode = true;
    const id = ++gachaRun;
    $('btnToResult').hidden = true; $('btnToResult').textContent = 'ホームへ';
    $('gachaFail').hidden = true;
    GachaShow.run($('gachaStage'), {
      team: 0, ticket: `${ball.name}玉チケット`,
      ball: { key: ball.key, name: ball.name, color: ball.color },
      yokai: { name: y.name, rank: y.rank, rankColor: S.RANKS[y.rank].color, role: S.ROLES[y.role].name, img: artUrl('yokai/' + y.id) || '' },
      isNew, dupCount: friends[y.id], totsu: S.totsuOf(friends[y.id]), totsuMax: S.TOTSU_MAX, totsuStep: S.TOTSU_STEP,
    }).then(() => { if (id === gachaRun) $('btnToResult').hidden = false; });
    show('gacha');
  };

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
  let stage = 'oni';
  let offline = false;        // 試合のあとで接続が切れた（結果はそのまま見られる）
  let watcher = false;        // フレンドのバトルを観戦している
  let serverUpdating = false; // サーバーの更新で切れた
  // 開始時の演出: introMovie 秒の映像 → introCount 秒のカウントダウン（サーバーの intro が残り時間）
  let introMovie = 0, introCount = 0, landed = false, lastCount = 0, started = true, chaseHold = 0;

  $('name').value = localStorage.getItem('name') || '';
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom) $('code').value = urlRoom.toUpperCase();
  function updateFriendCount() {
    $('friendCount').textContent = `お友達 ${S.YOKAI.filter(y => friends[y.id]).length} / ${S.YOKAI.length}` + (S.LEGENDS.some(l => friends[l.id]) ? `　🌈 ${S.LEGENDS.filter(l => friends[l.id]).length}` : '');
  }
  updateFriendCount();

  // ---------- セーブ画面 ----------
  function openSave() {
    $('saveStats').textContent = `お友達 ${S.YOKAI.filter(y => friends[y.id]).length}/${S.YOKAI.length}　遊んだ回数 ${stats.plays}　脱出 ${stats.escapes}回　集めた鬼玉 ${stats.dama}個（最高 ${stats.best}個）`;
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
    friends = data.friends; stats = data.stats; stats.seals = data.seals;
    selYokai = friends[data.yokai] ? data.yokai : 'nekomata';
    if (data.name) { $('name').value = data.name; try { localStorage.setItem('name', data.name); } catch {} }
    myTitle = data.title; checkMyTitle(); try { localStorage.setItem('title', myTitle || ''); } catch {}
    if (data.pid) { pid = data.pid; try { localStorage.setItem('pid', pid); } catch {} helloAgain(); }
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
  const BUILD = document.documentElement.dataset.build || '';
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
        // 古い版が残っていたら、タイトル画面にいるうちに自動で新しい版にする（1回だけ）
        // このときは「見た」記録を付けない（読み込み直したあとにお知らせを出すため）
        if (BUILD && BUILD !== '__BUILD__' && BUILD !== info.v) {
          let tried = null;
          try { tried = sessionStorage.getItem('autoUpdate'); sessionStorage.setItem('autoUpdate', info.v); } catch {}
          if (tried !== info.v && $('title').classList.contains('active') && !ws) { location.reload(); return; }
          updateReady = true; refreshUpdateBar();
          return;
        }
        let seen = null;
        try { seen = localStorage.getItem('seenVersion'); localStorage.setItem('seenVersion', info.v); } catch {}
        // 更新したあとに開いたら、変わったところを見せる
        if (seen && seen !== info.v && Array.isArray(info.notes) && info.notes.length && $('title').classList.contains('active')) {
          $('whatsNewList').innerHTML = info.notes.map(n => `<li>${esc(n)}</li>`).join('');
          show('whatsNew');
        }
      } else if (info.v !== loadedVersion) {
        updateReady = true;
        if (serverUpdating && !ws && $('title').classList.contains('active')) { location.reload(); return; }
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
    Music.unlock();
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    watcher = first.t === 'watch';
    ws.onopen = () => send({ ...first, name, yokai: selYokai, pid, totsu: myTotsu(), title: myTitle });
    ws.onmessage = e => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      ws = null;
      // 試合が終わったあと（ガチャ・結果画面）なら、そのまま見られるようにする
      if (result && ($('gacha').classList.contains('active') || $('result').classList.contains('active'))) {
        offline = true;
        renderResult();
        return;
      }
      myId = null; snap = null; watcher = false;
      Music.stop();
      show('title');
      $('err').textContent = serverUpdating ? 'サーバーが更新されました。もう一度ルームを作ってね' : '接続が切れました';
      if (serverUpdating) checkVersion();
    };
  }

  function onMessage(m) {
    switch (m.t) {
      case 'error':
        $('err').textContent = m.msg;
        ws.onclose = null; ws.close(); ws = null;
        if (watcher || $('buddyScreen').classList.contains('active')) { $('buddyMsg').textContent = m.msg; if (watcher) { watcher = false; snap = null; show('buddyScreen'); } }
        break;
      case 'welcome': myId = m.id; offline = false; serverUpdating = false; break;
      case 'serverUpdate': serverUpdating = true; break;
      case 'lobbyMsg': $('lobbyMsg').hidden = false; $('lobbyMsg').textContent = '⚠️ ' + m.msg; break;
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
        stage = S.STAGES[m.stage] ? m.stage : 'oni';
        spectateId = null;
        introMovie = m.movie || 0; introCount = m.countdown || 0;
        landed = false; lastCount = 0; started = !(introMovie + introCount > 0); chaseHold = 0;
        banner = started ? { text: `${S.BOSSES[m.boss].name}が現れた！`, sub: '鬼玉を集めて、襖から脱出しよう', t: 3.2, c: BOSS_UI[m.boss] } : null;
        Music.play(introMovie > 0 ? 'intro' : 'normal');
        if (m.watch) { banner = { text: '👀 観戦中', sub: `${S.BOSSES[m.boss].name}・${S.STAGES[stage].name}`, t: 2.5, c: '#5aa7ff' }; show('game'); }
        break;
      case 'state':
        snap = m;
        for (const ev of m.ev) handleEvent(ev);
        break;
      case 'result':
        Music.stop();
        result = m;
        if (watcher) { renderResult(); show('result', true); menuMusic(); break; } // 観戦していた人はガチャなしで結果だけ
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
  // ルームを抜けてタイトルへ
  function leaveRoom() {
    if (ws) { ws.onclose = null; ws.close(); }
    ws = null; myId = null; lobby = null; snap = null; watcher = false; result = null;
    Music.stop();
    $('err').textContent = '';
    show('title');
  }
  $('btnLeave').onclick = leaveRoom;
  function renderBgmButton() { $('btnBgm').textContent = Music.enabled ? '🔊 BGM ON' : '🔇 BGM OFF'; }
  $('btnBgm').onclick = () => { Music.unlock(); Music.setEnabled(!Music.enabled); renderBgmButton(); menuMusic(); };
  renderBgmButton();
  $('btnAgain').onclick = () => {
    if (watcher) { leaveRoom(); return; }
    if (offline) { offline = false; myId = null; snap = null; result = null; show('title'); if (serverUpdating) checkVersion(); return; }
    send({ t: 'toLobby' });
  };
  $('btnShare').onclick = () => {
    const url = `${location.origin}${location.pathname}?room=${lobby.code}`;
    if (navigator.share) navigator.share({ title: '鬼バスターズ', text: '一緒に鬼の世界へ行こう！', url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => { $('btnShare').textContent = 'コピー済'; });
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
        // みんなが連れていく妖怪が絵でわかるように
        const y = S.YOKAI_BY_ID[p.yokai];
        if (p.id === myId) li.className = 'me';
        li.innerHTML = `${faceImg(y)}${totsuTag(p.totsu)}<div class="pinfo"><b>${nameTag(p.name, p.title)}${p.host ? '👑' : ''}</b>${p.title ? titleTag(p.title) : ''}<span style="color:${S.RANKS[y.rank].color}">${y.rank} ${y.name}</span></div>`;
      } else { li.className = 'empty'; li.textContent = 'あき'; }
      ul.appendChild(li);
    }
    renderFriends();
    const me = lobby.players.find(p => p.id === myId);
    const isHost = me && me.host;
    // ホストが挑戦できない鬼が選ばれていたら、挑戦できるいちばん強い鬼に戻す
    if (isHost && !S.bossUnlocked(lobby.boss, stats.cleared)) {
      const ok = S.BOSS_ORDER.filter(k => S.bossUnlocked(k, stats.cleared));
      send({ t: 'boss', type: ok[ok.length - 1] });
    }
    renderBossPick(isHost);
    $('btnStart').style.display = isHost ? '' : 'none';
    $('waitMsg').style.display = isHost ? 'none' : '';
  }

  function renderBossPick(isHost) {
    $('bossPick').innerHTML = S.BOSS_ORDER.map(k => {
      const b = S.BOSSES[k], open = S.bossUnlocked(k, stats.cleared), sel = lobby.boss === k;
      const lock = isHost && !open;
      const sub = lock ? `🔒 ${S.BOSSES[b.need].name}を倒すと解放` : stats.cleared[k] ? '✔ たおした' : `大鬼玉 ${b.drop}個`;
      return `<button class="boss-card ${k}${sel ? ' on' : ''}${lock ? ' lock' : ''}" data-k="${k}" ${isHost && open ? '' : 'disabled'}>
        <span class="bname">${lock ? '？？' : b.name}</span><small>${sub}</small></button>`;
    }).join('');
    const th = S.themeOf(lobby.week ?? S.weekIndex());
    if (th.key === 'challenge') {
      $('bossPick').innerHTML += `<button class="boss-card challenge${lobby.challenge ? ' on' : ''}" data-ch="1" ${isHost ? '' : 'disabled'}><span class="bname">🎯</span><small>今週のチャレンジ</small></button>`;
      if (lobby.challenge) for (const el of $('bossPick').querySelectorAll('.boss-card:not(.challenge)')) el.classList.remove('on');
    }
    for (const el of $('bossPick').querySelectorAll('button')) el.onclick = () => (el.dataset.ch ? send({ t: 'challenge', on: !lobby.challenge }) : send({ t: 'boss', type: el.dataset.k }));
    $('lobbyMsg').hidden = !lobby.challenge;
    if (lobby.challenge) $('lobbyMsg').textContent = `🎯 ${th.name}　しばり：${th.ruleName}（記録はランキングに入ります）`;
  }

  let friendTab = 'own';
  function renderFriendTabs() {
    const tabs = [['own', 'お友達'], ['C', 'C'], ['B', 'B'], ['A', 'A'], ['S', 'S']];
    $('friendTabs').innerHTML = tabs.map(([k, label]) => {
      const list = k === 'own' ? S.YOKAI.filter(y => friends[y.id]) : S.YOKAI.filter(y => y.rank === k);
      const got = list.filter(y => friends[y.id]).length;
      return `<button class="tab${friendTab === k ? ' on' : ''}" data-k="${k}">${label} <small>${k === 'own' ? got : `${got}/${list.length}`}</small></button>`;
    }).join('');
    for (const b of $('friendTabs').querySelectorAll('button')) b.onclick = () => { friendTab = b.dataset.k; $('friends').scrollTop = 0; renderFriends(); };
  }
  const faceImg = (y, locked) => artUrl('yokai/' + y.id)
    ? `<img class="face${locked ? ' sil' : ''}" loading="lazy" src="${artUrl('yokai/' + y.id)}" alt="">`
    : `<div class="face" style="background:${locked ? '#333' : y.color}"></div>`;
  function renderYokaiInfo() {
    const y = S.YOKAI_BY_ID[selYokai], at = Attacks.of(y.id), sk = Attacks.SKILL[y.role], el = Attacks.ELEMENT[at.el];
    const url = artUrl('yokai/' + y.id);
    $('yokaiInfo').innerHTML = `${url ? `<img class="big-face" src="${url}" alt="">` : `<div class="big-face" style="background:${y.color}"></div>`}
      <div class="pv"><b style="color:${S.RANKS[y.rank].color}">${y.rank} ${esc(y.name)}</b> ${totsuTag(myTotsu())}
      <div>${S.ROLES[y.role].name}・<span style="color:${el.color}">${el.name}属性</span>${myTotsu() ? `・<span class="totsu-up">HP・攻撃 +${Math.round(myTotsu() * S.TOTSU_STEP * 100)}%</span>` : ''}</div>
      <dl><dt>通常</dt><dd>${esc(at.normalName)}</dd><dt>強攻撃</dt><dd>${esc(at.strongName)}</dd><dt>スキル</dt><dd>${sk.label}</dd></dl>
      <small>${el.name}属性：${el.effect}</small></div>`;
  }
  function renderFriends() {
    renderFriendTabs();
    renderYokaiInfo();
    const el = $('friends');
    const keep = el.scrollTop; // 選び直してもスクロール位置はそのまま
    el.innerHTML = '';
    const list = friendTab === 'own' ? S.LEGENDS.filter(y => friends[y.id]).concat(S.YOKAI.filter(y => friends[y.id])) : S.YOKAI.filter(y => y.rank === friendTab);
    const legendTaken = lobby && lobby.players.some(p => p.id !== myId && S.YOKAI_BY_ID[p.yokai]?.legend);
    for (const y of list) {
      const owned = friends[y.id];
      const blocked = y.legend && legendTaken; // レジェンドはチームで1体まで
      const d = document.createElement('div');
      d.className = 'yk' + (y.id === selYokai ? ' sel' : '') + (owned ? '' : ' locked') + (y.legend ? ' legend' : '') + (blocked ? ' blocked' : '');
      d.innerHTML = owned
        ? `<span class="rk" style="color:${S.RANKS[y.rank].color}">${y.rank}</span>${owned > 1 ? `<span class="cnt">${S.totsuOf(owned) >= S.TOTSU_MAX ? '凸MAX' : `凸${S.totsuOf(owned)}`}</span>` : ''}${faceImg(y)}<span class="nm">${y.name}</span><small class="nm">${S.ROLES[y.role].name}・${y.origin}</small>`
        : `<span class="rk" style="color:${S.RANKS[y.rank].color}">${y.rank}</span>${faceImg(y, true)}<span class="unk nm">${'？'.repeat([...y.name].length)}</span><small class="nm">${y.origin}</small>`; // 名前は文字数ぶんの？
      if (blocked) d.innerHTML += '<span class="block-tag">チームに1体まで</span>';
      if (owned) d.onclick = () => {
        if (blocked) { $('lobbyMsg').hidden = false; $('lobbyMsg').textContent = '⚠️ レジェンドはチームで1体まで。ほかの人がもう連れています'; return; }
        selYokai = y.id; saveAll();
        send({ t: 'yokai', id: y.id, totsu: myTotsu(), title: myTitle });
        helloAgain();
        renderFriends();
      };
      el.appendChild(d);
    }
    el.scrollTop = keep;
  }

  // ---------- 鬼ガチャ ----------
  let gachaRun = 0;
  function startGacha() {
    const mine = result.players.find(p => p.id === myId);
    let isNew = false;
    const titlesBefore = titlesDone();
    // ガチャ結果はこの時点で保存する（玉を開ける前にアプリを閉じても消えない）
    if (mine) {
      stats.plays++;
      stats.dama += mine.dama;
      stats.best = Math.max(stats.best, mine.dama);
      if (mine.escaped) stats.escapes++;
      if (mine.gacha) {
        isNew = !friends[mine.gacha.yokai];
        friends[mine.gacha.yokai] = (friends[mine.gacha.yokai] || 0) + 1;
      }
    }
    // ボス鬼を倒したら次の鬼が解放される（その回に参加していた全員）
    result.newClear = false;
    if (mine && result.bossDown && !stats.cleared[result.boss]) { stats.cleared[result.boss] = true; result.newClear = true; }
    result.newTitles = mine ? titlesDone().filter(id => !titlesBefore.includes(id)) : [];
    // レジェンドの封印の欠片
    result.sealNote = null;
    if (mine && mine.seal) {
      const sl = (stats.seals[mine.seal.legend] = stats.seals[mine.seal.legend] || { frag: 0, black: false });
      sl.frag += mine.seal.frag;
      if (mine.seal.black) sl.black = true;
      const l = S.YOKAI_BY_ID[mine.seal.legend];
      result.sealNote = `🔮 封印の欠片をゲット！（${l.name}の封印 ${Math.min(sl.frag, S.SEAL.fragments)}/${S.SEAL.fragments}）`;
    }
    if (mine) { saveAll(); updateFriendCount(); helloAgain(); }
    const id = ++gachaRun;
    $('btnToResult').hidden = true;
    $('gachaStage').innerHTML = '';
    if (mine && mine.gacha) {
      $('gachaFail').hidden = true;
      const ball = S.BALLS.find(b => b.key === mine.gacha.ball);
      const y = S.YOKAI_BY_ID[mine.gacha.yokai];
      // 絵が無い妖怪は色の丸で代わりにする
      const img = artUrl('yokai/' + y.id) || 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="${y.color}" stroke="#fff" stroke-width="6"/></svg>`);
      GachaShow.run($('gachaStage'), {
        team: mine.count ?? result.team ?? mine.dama,
        failed: mine.escaped ? null : { from: result.team ?? 0 },
        ball: { key: ball.key, name: ball.name, color: ball.color },
        yokai: { name: y.name, rank: y.rank, rankColor: S.RANKS[y.rank].color, role: S.ROLES[y.role].name, img },
        isNew, dupCount: friends[y.id], totsu: S.totsuOf(friends[y.id]), totsuMax: S.TOTSU_MAX, totsuStep: S.TOTSU_STEP,
      }).then(() => { if (id === gachaRun) $('btnToResult').hidden = false; });
    } else {
      $('gachaTitle').textContent = mine && !mine.escaped ? '脱出失敗…' : '鬼ガチャ';
      $('gachaFail').hidden = false;
      $('btnToResult').hidden = false;
    }
    show('gacha', true);
  }

  $('btnToResult').onclick = () => {
    if (ticketMode) { ticketMode = false; $('btnToResult').textContent = '結果を見る'; show('title'); return; }
    renderResult();
    show('result', true);
    menuMusic();
  };

  function renderResult() {
    const anyEsc = result.players.some(p => p.escaped);
    $('resTitle').textContent = anyEsc ? '鬼の世界から脱出！' : '全員脱出できなかった…';
    $('resTitle').textContent += `（みんなの鬼玉 ${result.team ?? 0}個）`;
    const notes = [];
    if (result.newClear) {
      const next = S.BOSS_ORDER.find(k => S.BOSSES[k].need === result.boss);
      notes.push(esc(next ? `🔓 ${S.BOSSES[result.boss].name}をはじめてたおした！ ${S.BOSSES[next].name}に挑戦できるようになった！`
        : `🏆 ${S.BOSSES[result.boss].name}をはじめてたおした！ すべてのボス鬼を制覇！`));
    }
    if (result.sealNote) notes.push(esc(result.sealNote));
    for (const id of result.newTitles || []) notes.push(`🏅 称号 ${titleTag(id)} をゲット！（図鑑の「称号」でつけられます）`);
    $('resUnlock').hidden = !notes.length;
    $('resUnlock').innerHTML = notes.join('<br>');
    $('resTable').innerHTML = '<tr><th>なまえ</th><th>お友達</th><th>脱出</th><th>集めた鬼玉</th><th>ガチャ</th></tr>' +
      result.players.map(p => {
        const y = S.YOKAI_BY_ID[p.yokai];
        const g = p.gacha ? S.YOKAI_BY_ID[p.gacha.yokai] : null;
        return `<tr><td>${esc(p.name)}</td><td>${y.name}</td><td>${p.escaped ? '⭕' : '❌'}</td><td>${p.dama}</td><td>${g ? `<span style="color:${S.RANKS[g.rank].color}">${g.rank}</span> ${g.name}${p.escaped ? '' : ` <small>（鬼玉${p.count ?? '半分'}個で）</small>`}` : '-'}</td></tr>`;
      }).join('');
    if (watcher) {
      $('btnAgain').disabled = false;
      $('btnAgain').textContent = 'ホームにもどる';
      return;
    }
    const me = lobby && lobby.players.find(p => p.id === myId);
    if (offline) {
      $('btnAgain').disabled = false;
      $('btnAgain').textContent = serverUpdating ? 'サーバー更新のためタイトルへ' : 'タイトルへもどる';
      return;
    }
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
  // キャラの頭の上に文字を出す（強攻撃の名前など）
  function floatOn(id, text, c, big) {
    const p = snap && snap.players.find(q => q.id === id);
    if (!p) return;
    const pos = id === myId && myPred ? myPred : p;
    floats.push({ x: pos.x, y: pos.y - 70, text, c: c || '#fff', t: big ? 1.6 : 1.1, small: !big });
  }
  function handleEvent(ev) {
    const near = (x, y) => myPred && Math.hypot(x - myPred.x, y - myPred.y) < 700;
    switch (ev.k) {
      case 'dmg': floats.push({ x: ev.x, y: ev.y, text: ev.v, c: '#fff', t: 0.8 }); break;
      case 'hurt':
        floats.push({ x: ev.x, y: ev.y, text: ev.v, c: '#ff5050', t: 0.8 });
        if (ev.id === myId) { shake = 0.25; navigator.vibrate?.(40); }
        break;
      case 'heal': floats.push({ x: ev.x, y: ev.y, text: '+' + ev.v, c: '#7dff9a', t: 0.8 }); break;
      case 'slash': fx.push({ k: 'slash', x: ev.x, y: ev.y, a: ev.a, c: ev.c, big: ev.big, t: 0.15, max: 0.15 }); break;
      case 'beam': fx.push({ k: 'beam', x: ev.x, y: ev.y, x2: ev.x2, y2: ev.y2, w: ev.w, c: ev.c, t: 0.22, max: 0.22 }); break;
      case 'cone': fx.push({ k: 'cone', x: ev.x, y: ev.y, a: ev.a, r: ev.r, c: ev.c, t: 0.25, max: 0.25 }); break;
      case 'blink': fx.push({ k: 'beam', x: ev.x, y: ev.y, x2: ev.x2, y2: ev.y2, w: 26, c: ev.c, t: 0.3, max: 0.3 }); fx.push({ k: 'ring', x: ev.x2, y: ev.y2, r: 110, c: ev.c, t: 0.35, max: 0.35 }); break;
      case 'bolt': fx.push({ k: 'bolt', x: ev.x, y: ev.y, c: ev.c, t: 0.3, max: 0.3 }); if (near(ev.x, ev.y)) shake = Math.max(shake, 0.12); break;
      case 'buff': fx.push({ k: 'buff', id: ev.id, t: 0.8, max: 0.8 }); if (ev.id === myId) floatOn(ev.id, '攻撃・速さアップ！', '#ffd84a'); break;
      case 'dodge': fx.push({ k: 'after', id: ev.id, t: 0.3, max: 0.3 }); break;
      case 'strong': floatOn(ev.id, ev.name, ev.c); break;
      case 'ult': {
        // 技の名前をキャラの上に出す（大きなカットインはなし）
        floatOn(ev.id, `必殺！${ev.name}`, ev.c, true);
        fx.push({ k: 'ring', x: ev.x, y: ev.y, r: 120, c: '#fff', t: 0.4, max: 0.4 });
        shake = Math.max(shake, 0.3);
        beep(220, 0.5, 'sawtooth', 0.08, 600); setTimeout(() => beep(660, 0.4, 'triangle', 0.07, 900), 120);
        if (ev.kind === 'roar') for (let k = 0; k < 3; k++) fx.push({ k: 'ring', x: ev.x, y: ev.y, r: 480 * (0.5 + k * 0.25), c: ['#ff4a4a', '#ffb83a', '#fff'][k], t: 0.7 + k * 0.15, max: 0.7 + k * 0.15 });
        if (ev.kind === 'dragon') fx.push({ k: 'dragon', x: ev.x, y: ev.y, a: ev.a, t: 1.0, max: 1.0 });
        break;
      }
      case 'ring': fx.push({ k: 'ring', x: ev.x, y: ev.y, r: ev.r, c: ev.c, t: 0.4, max: 0.4 }); break;
      case 'boom':
        fx.push({ k: 'boom', x: ev.x, y: ev.y, r: ev.r || 80, c: ev.c, t: ev.big ? 0.5 : 0.35, max: ev.big ? 0.5 : 0.35 });
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
      case 'rage': banner = { text: `${S.BOSSES[bossType].name}が怒った！`, sub: '攻撃がはげしくなるぞ', t: 2.2, c: '#ff4a3a' }; shake = 0.5; break;
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
  // 実際に表示されている大きさに合わせる。iPhone のホーム画面アプリでは起動直後や回転直後に
  // window.innerWidth/innerHeight が古い値のことがあり、ずれると絵が引き伸ばされるので毎フレーム確かめる
  function resize() {
    const r = cv.getBoundingClientRect();
    const w = Math.round(r.width) || window.innerWidth, h = Math.round(r.height) || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === W && h === H && dpr === DPR) return;
    W = w; H = h; DPR = dpr;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  }
  function fixViewport() {
    const landscape = matchMedia('(orientation: landscape)').matches || (screen.orientation && /landscape/.test(screen.orientation.type)) || Math.abs(window.orientation || 0) === 90;
    if (landscape && window.innerWidth < window.innerHeight) {
      const m = document.querySelector('meta[name=viewport]');
      const c = m.getAttribute('content');
      m.setAttribute('content', c.replace('initial-scale=1', 'initial-scale=1.0001'));
      setTimeout(() => { m.setAttribute('content', c); resize(); }, 50);
    }
    fillScreen(landscape);
    resize();
    showBuildInfo();
  }
  // iPhone のホーム画面アプリでは、横向きでもステータスバーの分だけ低い高さが伝えられ、
  // 下にすき間が残ることがある。本体の画面サイズを使って画面いっぱいに広げる
  function fillScreen(landscape) {
    const root = document.documentElement.style;
    if (!(isIOS && standalone)) { root.removeProperty('--app-w'); root.removeProperty('--app-h'); return; }
    const land = landscape || window.innerWidth > window.innerHeight;
    const long = Math.max(screen.width, screen.height), short = Math.min(screen.width, screen.height);
    const w = land ? long : short, h = land ? short : long;
    root.setProperty('--app-w', Math.max(w, window.innerWidth) + 'px');
    root.setProperty('--app-h', Math.max(h, window.innerHeight) + 'px');
  }
  window.addEventListener('resize', fixViewport);
  window.addEventListener('orientationchange', () => { fixViewport(); setTimeout(fixViewport, 300); setTimeout(fixViewport, 1000); });
  window.addEventListener('pageshow', fixViewport);
  window.visualViewport?.addEventListener('resize', resize);
  // タイトル画面の右下に、版の番号と画面サイズ（不具合を調べるため）
  function showBuildInfo() {
    const el = document.getElementById('buildInfo');
    if (!el || typeof BUILD === 'undefined') return;
    const vv = window.visualViewport;
    el.textContent = `v${BUILD} ${window.innerWidth}×${window.innerHeight} vv${vv ? Math.round(vv.width) + '×' + Math.round(vv.height) + '@' + vv.scale.toFixed(2) : '-'} 画${screen.width}×${screen.height} ${standalone ? 'app' : 'web'}`;
    el.classList.toggle('show', $('title').classList.contains('active'));
  }
  setTimeout(fixViewport, 0);

  const input = { mx: 0, my: 0, atk: false, strong: false, item: false, dash: false, skill: false };
  const stick = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const btnHold = { atk: null, strong: null, item: null, dash: null, skill: null, ult: null };
  const keys = new Set();

  // 右側のボタン配置
  function buttons() {
    const s = Math.min(W, H);
    const big = s * 0.13, mid = s * 0.088;
    const bx = W - big - 26, by = H - big - 22;
    // アイテムは右上（鬼玉の数の下）、元のアイテムの場所はタイプ別のスキル
    return {
      atk:    { x: bx, y: by, r: big },
      strong: { x: bx - big * 0.25, y: by - big * 1.85, r: mid },
      skill:  { x: bx - big * 1.95, y: by + big * 0.25, r: mid },
      dash:   { x: bx - big * 1.75, y: by - big * 1.35, r: mid },
      item:   { x: W - 20 - s * 0.075, y: 66 + s * 0.075, r: s * 0.072 },
      ult:    { x: bx - big * 1.3, y: by - big * 3.0, r: mid * 1.05 }, // レジェンドの必殺技
    };
  }

  const watchExitBtn = () => ({ x: W - 150, y: 12, w: 138, h: 40 });
  const playing = () => $('game').classList.contains('active') && !$('gacha').classList.contains('active') && !$('result').classList.contains('active');
  // タップ位置を、キャンバスに描いている座標（W×H）に直す
  function toCanvas(e) {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / (r.width || W), y: ((e.clientY - r.top) * H) / (r.height || H) };
  }
  function pointerDown(e) {
    if (!playing()) return;
    const pt = toCanvas(e);
    const me = snap && snap.players.find(p => p.id === myId);
    if (watcher) {
      const b = watchExitBtn();
      if (pt.x > b.x && pt.x < b.x + b.w && pt.y > b.y && pt.y < b.y + b.h) { e.preventDefault(); leaveRoom(); return; }
    }
    if (watcher || (me && me.esc)) {
      const others = snap.players.filter(p => !p.esc);
      if (others.length) {
        const i = others.findIndex(p => p.id === spectateId);
        spectateId = others[(i + 1) % others.length].id;
      }
      e.preventDefault();
      return;
    }
    for (const [k, b] of Object.entries(buttons())) {
      if (Math.hypot(pt.x - b.x, pt.y - b.y) < b.r * 1.2) {
        btnHold[k] = e.pointerId;
        if (k !== 'atk') navigator.vibrate?.(12);
        e.preventDefault();
        return;
      }
    }
    if (pt.x < W * 0.5 && !stick.active) Object.assign(stick, { active: true, id: e.pointerId, ox: pt.x, oy: pt.y, x: pt.x, y: pt.y });
    e.preventDefault();
  }
  function pointerMove(e) { if (stick.active && e.pointerId === stick.id) { const pt = toCanvas(e); stick.x = pt.x; stick.y = pt.y; } }
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
    input.skill = btnHold.skill !== null || keys.has('KeyU') || keys.has('KeyI');
    input.ult = btnHold.ult !== null || keys.has('KeyO');
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

  function drawCity(cam) {
    const v = { l: cam.x - cam.vw / 2 - 50, r: cam.x + cam.vw / 2 + 50, t: cam.y - cam.vh / 2 - 50, b: cam.y + cam.vh / 2 + 50 };
    Stages.drawGround(ctx, map, v, stage, pattern);
    for (const pl of map.plazas || []) {
      if (pl.x > v.r + 150 || pl.x + pl.w < v.l - 150 || pl.y > v.b + 300 || pl.y + pl.h < v.t - 150) continue;
      Stages.drawPlaza(ctx, pl, stage, performance.now() / 1000);
    }
  }
  function drawBuildings(cam) {
    const l = cam.x - cam.vw / 2 - 50, r = cam.x + cam.vw / 2 + 50, t = cam.y - cam.vh / 2 - 50, bt = cam.y + cam.vh / 2 + 50;
    const now = performance.now() / 1000;
    for (const b of map.buildings) {
      if (b.x > r || b.x + b.w < l || b.y > bt || b.y + b.h < t) continue;
      Stages.drawBuilding(ctx, b, stage, now, pattern);
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
    ctx.globalAlpha = p.down ? 0.5 : p.invis ? (me ? 0.35 : 0.15) : p.dodge ? 0.55 : 1;
    ctx.fillStyle = '#0005'; ctx.beginPath(); ctx.ellipse(0, 16, 18 * (1 - (p.jump || 0) * 0.5), 6, 0, 0, Math.PI * 2); ctx.fill();
    if (p.jump) ctx.translate(0, -p.jump * 70); // 大ジャンプ中は浮く
    if (p.au || p.su) { ctx.fillStyle = 'rgba(255,200,60,0.22)'; ctx.beginPath(); ctx.arc(0, -10, 38 + Math.sin(performance.now() / 120) * 3, 0, Math.PI * 2); ctx.fill(); }
    if (me) { ctx.strokeStyle = '#ffe36b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 27, 0, Math.PI * 2); ctx.stroke(); }
    if (y.legend) { // レジェンドは虹色に光る
      ctx.save(); ctx.globalAlpha *= 0.35;
      ctx.fillStyle = `hsl(${(performance.now() / 8) % 360},90%,60%)`;
      ctx.beginPath(); ctx.arc(0, -14, 44 + Math.sin(performance.now() / 150) * 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    if (p.nyoi != null) { // 如意棒のなぎはらい
      ctx.save(); ctx.rotate(p.nyoi); ctx.lineCap = 'round';
      ctx.strokeStyle = '#3a0a0a'; ctx.lineWidth = 26; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(520, -10); ctx.stroke();
      ctx.strokeStyle = '#d8241a'; ctx.lineWidth = 18; ctx.stroke();
      ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = 18; ctx.beginPath(); ctx.moveTo(470, -10); ctx.lineTo(520, -10); ctx.moveTo(0, -10); ctx.lineTo(40, -10); ctx.stroke();
      ctx.restore();
    }
    if (p.sh) { ctx.fillStyle = 'rgba(100,160,255,0.3)'; ctx.beginPath(); ctx.arc(0, 0, 31, 0, Math.PI * 2); ctx.fill(); }
    if (p.run || p.dash) {
      ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 3;
      for (let k = -1; k <= 1; k++) { const a = p.face + Math.PI + k * 0.4; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 22, Math.sin(a) * 22); ctx.lineTo(Math.cos(a) * 36, Math.sin(a) * 36); ctx.stroke(); }
    }
    const img = art('yokai/' + y.id);
    if (img) {
      ctx.strokeStyle = S.RANKS[y.rank].color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(0, 16, 20, 7, 0, 0, Math.PI * 2); ctx.stroke();
      drawSprite(img, 0, 16, y.legend ? 96 : 80, Math.cos(p.face) < 0);
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

  // 回復・ダメージのエリアや隕石の目印
  const PARADE = ['kasabou', 'chochin', 'hitodama', 'gashadoku', 'nekomata', 'kitsunebi', 'tenguri', 'yukinko'];
  function drawZone(z, now) {
    ctx.save();
    if (z.shape === 'parade') { // 百鬼夜行: 妖怪たちがぐるぐる回る
      ctx.fillStyle = 'rgba(120,60,200,0.15)'; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.fill();
      PARADE.forEach((id, i) => {
        const a = now * 2.2 + (i / PARADE.length) * Math.PI * 2, rr = z.r * (0.55 + 0.2 * Math.sin(now * 3 + i));
        const img = art('yokai/' + id);
        ctx.globalAlpha = 0.75;
        if (img) drawSprite(img, z.x + Math.cos(a) * rr, z.y + Math.sin(a) * rr * 0.7 + 20, 64, Math.sin(a) > 0);
      });
      ctx.restore(); return;
    }
    if (z.shape === 'petals') { // 森のまどわし: 花びらと矢が降る
      ctx.fillStyle = 'rgba(60,180,80,0.12)'; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.fill();
      for (let k = 0; k < 28; k++) {
        const ph = (now * 0.8 + k * 0.137) % 1, a = k * 2.4, rr = (k % 7) / 7 * z.r;
        const px = z.x + Math.cos(a) * rr, py = z.y + Math.sin(a) * rr * 0.8 - 200 * (1 - ph);
        ctx.globalAlpha = Math.min(1, ph * 3) * 0.9;
        ctx.fillStyle = k % 3 ? '#ff9ad8' : '#7af07a';
        ctx.beginPath(); ctx.ellipse(px, py, 6, 3, now * 3 + k, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore(); return;
    }
    if (z.shape === 'spring') { // 竜の泉: 回復の泉
      const g = ctx.createRadialGradient(z.x, z.y, 10, z.x, z.y, z.r);
      g.addColorStop(0, 'rgba(180,240,255,0.55)'); g.addColorStop(1, 'rgba(60,140,255,0.1)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r, z.r * 0.75, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(200,250,255,0.8)'; ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) { const rr = ((now * 50 + k * 50) % z.r); ctx.globalAlpha = 1 - rr / z.r; ctx.beginPath(); ctx.ellipse(z.x, z.y, rr, rr * 0.75, 0, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore(); return;
    }
    if (z.kind === 'heal') {
      ctx.fillStyle = 'rgba(91,224,122,0.18)'; ctx.strokeStyle = 'rgba(125,255,154,0.8)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r * (0.95 + Math.sin(now * 5) * 0.05), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (z.kind === 'mark') {
      // 隕石が落ちてくる場所
      ctx.strokeStyle = z.c; ctx.lineWidth = 3; ctx.setLineDash([12, 8]);
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = z.c; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(z.x, z.y, z.r * (1 - z.life / 0.9), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(z.x, z.y - 400 * (z.life / 0.9), 30, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = z.c || '#fff'; ctx.strokeStyle = z.c || '#fff';
      if (z.shape === 'tornado' || z.shape === 'vortex') {
        ctx.lineWidth = 4;
        for (let k = 0; k < 3; k++) {
          ctx.globalAlpha = 0.5 - k * 0.12;
          ctx.beginPath(); ctx.arc(z.x, z.y, z.r * (1 - k * 0.28), now * (z.shape === 'vortex' ? -8 : 10) + k, now * (z.shape === 'vortex' ? -8 : 10) + k + 4.2); ctx.stroke();
        }
      } else {
        ctx.globalAlpha = 0.22 + Math.sin(now * 4) * 0.05;
        for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(z.x + Math.cos(k * 1.3 + now) * z.r * 0.4, z.y + Math.sin(k * 1.7 + now) * z.r * 0.3, z.r * 0.55, 0, Math.PI * 2); ctx.fill(); }
      }
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
    const th = Stages.theme(stage);
    ctx.fillStyle = th.miniBg; ctx.fillRect(ox, oy, mw, mh);
    ctx.fillStyle = th.mini;
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

  // 画面の外から自分を見つけた見回り鬼の方向を、画面のふちに赤い矢印で出す
  function drawSpotterArrows(now) {
    if (!myPred) return;
    const cx = W / 2, cy = H / 2;
    for (const e of snap.patrols) {
      if (!e.alert || e.target !== myId || inView(e.x, e.y, -30)) continue;
      const a = Math.atan2(e.y - myPred.y, e.x - myPred.x);
      const k = Math.min((W / 2 - 46) / Math.abs(Math.cos(a) || 1e-6), (H / 2 - 46) / Math.abs(Math.sin(a) || 1e-6));
      const x = cx + Math.cos(a) * k, y = cy + Math.sin(a) * k;
      const pulse = 1 + Math.sin(now * 10) * 0.12;
      ctx.save(); ctx.translate(x, y);
      ctx.fillStyle = '#ff3a3acc'; ctx.beginPath(); ctx.arc(0, 0, 20 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.rotate(a); ctx.fillStyle = '#ff3a3a'; ctx.beginPath(); ctx.moveTo(34 * pulse, 0); ctx.lineTo(18, -11); ctx.lineTo(18, 11); ctx.closePath(); ctx.fill();
      ctx.rotate(-a); ctx.fillStyle = '#fff'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', 0, 1);
      ctx.restore();
    }
    ctx.textBaseline = 'alphabetic';
  }

  function drawHUD(me, now) {
    Stages.drawTint(ctx, W, H, stage);
    drawMinimap(me, now);
    drawSpotterArrows(now);

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
      const team = snap.players.reduce((a, p) => a + p.dama, 0); // みんなで集めた合計
      const label = `× ${team}`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = '#ff3da8'; ctx.shadowColor = '#ff3da8'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(W - 34 - tw, 30, 12, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffd0f0'; ctx.beginPath(); ctx.arc(W - 38 - tw, 26, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeText(label, W - 20, 39); ctx.fillStyle = '#ffd0f0'; ctx.fillText(label, W - 20, 39);
      if (snap.players.length > 1) { ctx.font = '11px sans-serif'; ctx.fillStyle = '#fffc'; ctx.fillText(`みんなの鬼玉（自分 ${me.dama}）`, W - 20, 54); }
    }

    // 仲間
    let y = buttons().item.y + buttons().item.r + 34;
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
      const at = Attacks.of(me.yokai), sk = Attacks.SKILL[S.YOKAI_BY_ID[me.yokai].role];
      drawButton(bs.strong, input.strong, me.stCd, '#7a3fbf', '強攻撃', at.strongName.replace(/^.+?の/, ''));
      drawButton(bs.skill, input.skill, me.skCd, { fighter: '#2a8a8a', healer: '#c8a020', tank: '#4a6ad8', ranger: '#a8402a' }[S.YOKAI_BY_ID[me.yokai].role], sk.label);
      const it = me.item ? S.ITEMS[me.item] : null;
      const itImg = me.item ? art('item/' + me.item) : null;
      drawButton(bs.item, input.item, 0, it ? '#2f8a5a' : '#333', it ? (itImg ? '' : it.icon) : 'なし', it ? null : null, !!it);
      if (itImg) ctx.drawImage(itImg, bs.item.x - bs.item.r * 0.6, bs.item.y - bs.item.r * 0.6, bs.item.r * 1.2, bs.item.r * 1.2);
      ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fffc'; ctx.fillText(it ? it.name : 'アイテム', bs.item.x, bs.item.y + bs.item.r + 12);
      drawButton(bs.dash, input.dash, 0, me.exh ? '#552222' : '#2f62d9', 'ダッシュ', me.inf ? '∞' : null);
      if (me.ult >= 0) { // レジェンドの必殺技（ゲージは虹色）
        const ub = bs.ult, full = me.ult >= 100;
        drawButton(ub, input.ult, 0, full ? `hsl(${(now * 200) % 360},70%,45%)` : '#3a2a4a', '必殺', at.ultName, full);
        ctx.lineWidth = 6; ctx.strokeStyle = full ? '#fff' : `hsl(${(now * 120) % 360},90%,62%)`;
        ctx.beginPath(); ctx.arc(ub.x, ub.y, ub.r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * me.ult / 100); ctx.stroke();
      }
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
    } else if (timeLimit - snap.timeLeft < 8 && !watcher && !(me && me.esc)) {
      ctx.fillStyle = '#ffffff66'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('左側をドラッグで移動', W * 0.22, H - 64);
    }

    if (watcher || (me && me.esc)) {
      const watching = snap.players.find(p => p.id === spectateId && !p.esc);
      ctx.textAlign = 'center'; ctx.font = 'bold 18px sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = '#000';
      const msg = watching ? `👀 観戦中：${watching.name}（タップで切り替え）` : watcher ? '👀 観戦中' : '脱出済み！ みんなを待っています…';
      ctx.strokeText(msg, W / 2, H - 30); ctx.fillStyle = '#ffd84a'; ctx.fillText(msg, W / 2, H - 30);
    }
    if (watcher) { // 観戦をやめるボタン（右上）
      const b = watchExitBtn();
      ctx.fillStyle = '#000a'; ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 12); ctx.fill();
      ctx.strokeStyle = '#fff8'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('✕ 観戦をやめる', b.x + b.w / 2, b.y + b.h / 2); ctx.textBaseline = 'alphabetic';
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

  // ボス鬼が街に到着する映像（上下に黒い帯＋文字）
  function drawMovie(p, now) {
    const bar = H * 0.12 * Math.min(1, p * 6, (1 - p) * 8);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, bar); ctx.fillRect(0, H - bar, W, bar);
    const kind = S.BOSSES[bossType];
    ctx.textAlign = 'center';
    if (p < 0.4) {
      ctx.globalAlpha = Math.min(1, p * 5);
      ctx.font = `bold ${Math.round(H * 0.05)}px sans-serif`; ctx.fillStyle = '#fff';
      ctx.fillText('…ゴゴゴゴゴ', W / 2 + Math.sin(now * 40) * 2, H * 0.3);
      ctx.font = `bold ${Math.round(H * 0.07)}px sans-serif`; ctx.lineWidth = 6; ctx.strokeStyle = '#000';
      ctx.strokeText(`ステージ：${S.STAGES[stage].name}`, W / 2, H * 0.44); ctx.fillStyle = Stages.theme(stage).border; ctx.fillText(`ステージ：${S.STAGES[stage].name}`, W / 2, H * 0.44);
    } else if (p < 0.95) {
      ctx.globalAlpha = Math.min(1, (p - 0.4) * 6, (0.95 - p) * 8);
      ctx.font = `bold ${Math.round(Math.min(W, H) * 0.1)}px sans-serif`; ctx.lineWidth = 8; ctx.strokeStyle = '#000';
      const arrive = `${kind.name}が${S.STAGES[stage].name}に到着した…！`;
      ctx.strokeText(arrive, W / 2, H * 0.24); ctx.fillStyle = BOSS_UI[bossType]; ctx.fillText(arrive, W / 2, H * 0.24);
      ctx.font = `bold ${Math.round(H * 0.045)}px sans-serif`; ctx.lineWidth = 5;
      ctx.strokeText('見回り鬼に見つかると、ボス鬼に居場所がバレるぞ', W / 2, H * 0.24 + H * 0.09); ctx.fillStyle = '#fff'; ctx.fillText('見回り鬼に見つかると、ボス鬼に居場所がバレるぞ', W / 2, H * 0.24 + H * 0.09);
    }
    ctx.globalAlpha = 1;
  }
  function drawCountdown(intro) {
    const n = Math.ceil(intro), f = intro - Math.floor(intro); // f: 1→0 で数字が縮む
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(Math.min(W, H) * (0.28 + f * 0.12))}px sans-serif`;
    ctx.globalAlpha = Math.min(1, f * 3 + 0.3);
    ctx.lineWidth = 10; ctx.strokeStyle = '#000'; ctx.strokeText(n, W / 2, H * 0.45);
    ctx.fillStyle = n <= 3 ? '#ff5050' : '#ffe36b'; ctx.fillText(n, W / 2, H * 0.45);
    ctx.font = `bold ${Math.round(H * 0.045)}px sans-serif`; ctx.lineWidth = 5; ctx.globalAlpha = 1;
    ctx.strokeText('鬼玉を集めて、襖から脱出しよう', W / 2, H * 0.68); ctx.fillStyle = '#fff'; ctx.fillText('鬼玉を集めて、襖から脱出しよう', W / 2, H * 0.68);
    ctx.restore();
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
    if ($('game').classList.contains('active')) resize();

    if (!$('game').classList.contains('active') || !snap || !map) return;
    readInput();
    if (playing()) sendInput(dt);

    const me = snap.players.find(p => p.id === myId);
    const intro = snap.intro || 0;
    const movieLeft = intro - introCount;             // > 0 なら映像中
    const movieP = movieLeft > 0 && introMovie > 0 ? 1 - movieLeft / introMovie : 1; // 映像の進み具合 0→1
    if (intro <= 0 && !started) {
      started = true;
      banner = { text: 'スタート！', sub: '鬼玉を集めて、襖から脱出しよう', t: 1.6, c: '#ffe36b' };
      beep(1320, 0.35, 'square', 0.07);
      Music.play('normal');
    }
    if (movieLeft <= 0 && intro > 0) {
      const n = Math.ceil(intro);
      if (n !== lastCount) { lastCount = n; beep(660, 0.15, 'square', 0.06); if (n === introCount) Music.play('normal'); }
    }
    // ボス鬼に追われている間は BGM を変える（見失って2.5秒たったら元に戻す）
    if (started && me && !me.esc && playing()) {
      const chased = snap.boss && snap.boss.target === myId;
      chaseHold = chased ? 2.5 : Math.max(0, chaseHold - dt);
      Music.play(chaseHold > 0 ? 'chase' : 'normal');
    }

    // 自キャラは入力で先に動かし、サーバー位置へ寄せる
    if (me) {
      if (!myPred) myPred = { x: me.x, y: me.y };
      if (!me.down && !me.dash && !me.esc && playing() && intro <= 0) {
        const st = S.yokaiStats(me.yokai);
        let mx = input.mx, my = input.my; const m = Math.hypot(mx, my);
        if (m > 1) { mx /= m; my /= m; }
        const run = input.dash && m > 0.15 && (me.inf || (!me.exh && me.stam > 0));
        const spd = st.speed * (run ? 1.4 : 1) * (me.su ? 1.15 : 1);
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
    if (watcher || (me && me.esc)) {
      // 脱出したら、まだ鬼の世界にいる仲間を観戦する
      let other = snap.players.find(p => p.id === spectateId && !p.esc);
      if (!other) { other = snap.players.find(p => !p.esc); spectateId = other ? other.id : null; }
      if (other) { const pos = ents.get('p' + other.id) || other; cam.x = pos.x; cam.y = pos.y; }
    }
    // 映像中はボス鬼を映し、最後に自分のところへカメラを戻す
    let bossDrop = 0;
    if (movieLeft > 0 && snap.boss) {
      const back = Math.max(0, (movieP - 0.78) / 0.22);
      const e = back * back * (3 - 2 * back);
      cam.x = snap.boss.x + (cam.x - snap.boss.x) * e;
      cam.y = snap.boss.y + (cam.y - snap.boss.y) * e;
      const fall = Math.min(1, Math.max(0, (movieP - 0.12) / 0.26));
      bossDrop = movieP < 0.12 ? -2000 : -900 * (1 - fall * fall);
      if (!landed && fall >= 1) {
        landed = true; shake = 0.8;
        fx.push({ k: 'ring', x: snap.boss.x, y: snap.boss.y, r: 360, c: BOSS_UI[bossType], t: 0.8, max: 0.8 });
        fx.push({ k: 'boom', x: snap.boss.x, y: snap.boss.y + 30, r: 140, t: 0.6, max: 0.6 });
        beep(55, 0.7, 'sawtooth', 0.12, -20); navigator.vibrate?.(200);
      }
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

    for (const z of snap.zones) drawZone(z, now);
    for (const t of snap.turrets || []) {
      const cimg = t.clone && art('yokai/' + t.clone);
      if (cimg) { ctx.globalAlpha = 0.6 + Math.sin(now * 12) * 0.15; drawSprite(cimg, t.x, t.y + 16, 70, false); ctx.globalAlpha = 1; continue; } // ソンゴクウの分身
      ctx.fillStyle = '#3a2a4a'; ctx.strokeStyle = t.c; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(t.x, t.y, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = t.c; ctx.beginPath(); ctx.arc(t.x, t.y - 4, 7 + Math.sin(now * 10) * 2, 0, Math.PI * 2); ctx.fill();
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
    if (snap.boss) {
      const pos = lerpEnt('boss', snap.boss.x, snap.boss.y, snap.boss.st === 'charging' ? 0.6 : k);
      if (bossDrop) {
        // 空から降ってくる途中: 地面に影だけ先に出す
        const sc = 1 + bossDrop / 900;
        ctx.fillStyle = `rgba(0,0,0,${0.15 + 0.35 * Math.max(0, sc)})`;
        ctx.beginPath(); ctx.ellipse(pos.x, pos.y + 40, 60 * Math.max(0.2, sc), 18 * Math.max(0.2, sc), 0, 0, Math.PI * 2); ctx.fill();
        if (bossDrop > -1500) { const dp = { x: pos.x, y: pos.y + bossDrop }; list.push({ y: 1e9, f: () => drawBoss(snap.boss, dp, now) }); }
      } else list.push({ y: pos.y, f: () => drawBoss(snap.boss, pos, now) });
    }
    for (const p of snap.players) {
      if (p.esc) continue;
      const pos = p.id === myId && myPred ? myPred : lerpEnt('p' + p.id, p.x, p.y, k);
      list.push({ y: pos.y, f: () => drawPlayer(p, pos, p.id === myId) });
    }
    list.sort((a, b) => a.y - b.y).forEach(d => d.f());

    for (const pr of snap.proj) {
      const pos = lerpEnt('j' + pr.id, pr.x, pr.y, 0.5);
      if (pr.punch) { ctx.font = '40px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('👊', pos.x, pos.y); ctx.textBaseline = 'alphabetic'; continue; }
      if (pr.bomb) { ctx.font = '28px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('💣', pos.x, pos.y - 16); ctx.textBaseline = 'alphabetic'; continue; }
      ctx.fillStyle = pr.c; ctx.shadowColor = pr.c; ctx.shadowBlur = 12;
      if (pr.spin) {
        // ブーメラン: くるくる回る
        ctx.save(); ctx.translate(pos.x, pos.y); ctx.rotate(now * 18);
        ctx.beginPath(); ctx.moveTo(-pr.r, -pr.r * 0.3); ctx.quadraticCurveTo(0, -pr.r * 1.4, pr.r, -pr.r * 0.3); ctx.lineTo(pr.r * 0.6, 0); ctx.quadraticCurveTo(0, -pr.r * 0.6, -pr.r * 0.6, 0); ctx.closePath(); ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(pos.x, pos.y - (pr.lob ? 18 : 0), pr.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    for (let i = fx.length - 1; i >= 0; i--) {
      const e = fx[i]; e.t -= dt;
      if (e.t <= 0) { fx.splice(i, 1); continue; }
      const a = e.t / e.max;
      ctx.globalAlpha = a;
      if (e.k === 'slash') {
        ctx.strokeStyle = e.c || '#fff'; ctx.lineWidth = e.big ? 14 : 8; ctx.beginPath(); ctx.arc(e.x, e.y, e.big ? 52 : 40, e.a - 1.1, e.a + 1.1); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(e.x, e.y, e.big ? 52 : 40, e.a - 0.9, e.a + 0.9); ctx.stroke();
      }
      else if (e.k === 'dragon') { // 竜の泉: 水の竜がうねりながら進む
        const L = 760 * Math.min(1, (1 - a) * 2.2);
        ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.a);
        ctx.lineCap = 'round';
        for (const [w, c] of [[120, 'rgba(40,120,255,0.55)'], [70, 'rgba(120,210,255,0.8)'], [24, 'rgba(255,255,255,0.9)']]) {
          ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath();
          for (let x = 0; x <= L; x += 20) { const yy = Math.sin(x / 70 - performance.now() / 90) * 26; if (!x) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
          ctx.stroke();
        }
        // 竜の頭
        const hy = Math.sin(L / 70 - performance.now() / 90) * 26;
        ctx.fillStyle = '#2a6ad8'; ctx.beginPath(); ctx.moveTo(L + 70, hy); ctx.lineTo(L - 10, hy - 50); ctx.lineTo(L - 30, hy); ctx.lineTo(L - 10, hy + 50); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(L + 10, hy - 16, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(L + 10, hy - 16, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      else if (e.k === 'boom') { ctx.fillStyle = e.c || '#ff6a3d'; ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1.1 - a * 0.3), 0, Math.PI * 2); ctx.fill(); }
      else if (e.k === 'beam') {
        ctx.lineCap = 'round';
        ctx.strokeStyle = e.c; ctx.lineWidth = e.w * (0.6 + a * 0.6); ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x2, e.y2); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, e.w * 0.3 * a); ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x2, e.y2); ctx.stroke();
        ctx.lineCap = 'butt';
      }
      else if (e.k === 'cone') { ctx.fillStyle = e.c; ctx.globalAlpha = a * 0.45; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.arc(e.x, e.y, e.r * (1.1 - a * 0.3), e.a - 0.65, e.a + 0.65); ctx.closePath(); ctx.fill(); }
      else if (e.k === 'bolt') {
        ctx.strokeStyle = e.c; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(e.x + 20, e.y - 260);
        for (let k = 1; k <= 6; k++) ctx.lineTo(e.x + (k % 2 ? -18 : 18) * (1 - k / 7), e.y - 260 + k * 43);
        ctx.stroke(); ctx.fillStyle = e.c; ctx.beginPath(); ctx.arc(e.x, e.y, 40 * (1.2 - a), 0, Math.PI * 2); ctx.fill();
      }
      else if (e.k === 'buff' || e.k === 'after') {
        const p = snap.players.find(q => q.id === e.id);
        if (p) { const pos = p.id === myId && myPred ? myPred : (ents.get('p' + p.id) || p); ctx.strokeStyle = e.k === 'buff' ? '#ffd84a' : '#ffffff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(pos.x, pos.y - 10, 30 + (1 - a) * 30, 0, Math.PI * 2); ctx.stroke(); }
      }
      else if (e.k === 'ring') { ctx.strokeStyle = e.c; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1 - a), 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }

    ctx.textAlign = 'center';
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i]; f.t -= dt; f.y -= 50 * dt;
      if (f.t <= 0) { floats.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(1, f.t * 3);
      ctx.font = f.small ? 'bold 15px sans-serif' : 'bold 22px sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = '#000';
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
    if (movieLeft > 0) drawMovie(movieP, now);
    else {
      drawHUD(me, now);
      if (intro > 0) drawCountdown(intro);
    }
  }
  requestAnimationFrame(frame);
  rankButton(); renderTicketButton(); refreshRanking().then(checkReward);
  presenceConnect();
})();
