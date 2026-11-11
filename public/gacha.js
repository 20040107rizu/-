// 鬼ガチャの演出。GachaShow.run(root, opts) で root の中に演出を作り、終わったら resolve する。
// opts: { team, ticket: チケットの名前（チケットガチャのとき）, failed: {from} | null（脱出失敗で半分になったとき）, ball: {key, name, color}, yokai: {name, rank, rankColor, role, img}, isNew, dupCount, totsu, totsuMax, totsuStep }
(function () {
  'use strict';
  const TIER = { green: 0, blue: 1, red: 2, gold: 3, black: 4, matsuri: 4 };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // ---------- 効果音（Web Audio） ----------
  let ac = null;
  function sfx(fn) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      fn(ac, ac.currentTime);
    } catch {}
  }
  function osc(a, t, type, f0, f1, dur, vol) {
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(a, t, dur, vol, freq = 1200) {
    const b = a.createBuffer(1, a.sampleRate * dur, a.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = b; f.type = 'bandpass'; f.frequency.value = freq; g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(a.destination); s.start(t);
  }
  const SFX = {
    pop: () => sfx((a, t) => osc(a, t, 'triangle', 900, 1600, 0.07, 0.05)),
    click: () => sfx((a, t) => { noise(a, t, 0.04, 0.25, 3000); osc(a, t, 'square', 220, 160, 0.05, 0.04); }),
    rumble: () => sfx((a, t) => { osc(a, t, 'sawtooth', 60, 40, 0.8, 0.08); noise(a, t, 0.8, 0.15, 300); }),
    drop: () => sfx((a, t) => { osc(a, t, 'sine', 500, 120, 0.25, 0.12); osc(a, t + 0.28, 'sine', 300, 150, 0.12, 0.06); }),
    thunder: () => sfx((a, t) => { noise(a, t, 1.4, 0.6, 180); osc(a, t, 'sawtooth', 50, 30, 1.2, 0.1); }),
    shimmer: () => sfx((a, t) => [1046, 1318, 1568, 2093].forEach((f, i) => osc(a, t + i * 0.06, 'sine', f, 0, 0.5, 0.04))),
    burn: () => sfx((a, t) => noise(a, t, 0.7, 0.3, 2400)),
    shake: () => sfx((a, t) => osc(a, t, 'square', 180, 260, 0.08, 0.05)),
    burst: () => sfx((a, t) => { noise(a, t, 0.5, 0.5, 900); osc(a, t, 'triangle', 300, 1200, 0.3, 0.08); }),
    stamp: () => sfx((a, t) => { osc(a, t, 'sine', 120, 50, 0.3, 0.3); noise(a, t, 0.12, 0.3, 500); }),
    fanfare: tier => sfx((a, t) => {
      const notes = tier >= 3 ? [523, 659, 784, 1046, 1318, 1568] : tier >= 2 ? [523, 659, 784, 1046] : [523, 659, 784];
      notes.forEach((f, i) => { osc(a, t + i * 0.11, 'triangle', f, 0, 0.6, 0.07); osc(a, t + i * 0.11, 'square', f / 2, 0, 0.3, 0.02); });
    }),
  };

  // ---------- 部品 ----------
  const MACHINE = `
  <svg class="gs-mc" viewBox="0 0 300 380" aria-hidden="true">
    <defs>
      <radialGradient id="gsDome" cx="0.35" cy="0.3"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#b8a8d8" stop-opacity=".18"/><stop offset="1" stop-color="#3a2a5a" stop-opacity=".35"/></radialGradient>
      <linearGradient id="gsBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4a3a"/><stop offset="1" stop-color="#a8141e"/></linearGradient>
      <clipPath id="gsDomeClip"><circle cx="150" cy="118" r="98"/></clipPath>
    </defs>
    <ellipse cx="150" cy="372" rx="120" ry="8" fill="#000" opacity=".4"/>
    <g clip-path="url(#gsDomeClip)"><g class="gs-balls">
      ${[['#4fd16a', 98, 160], ['#3f7cff', 150, 178], ['#ff3b3b', 202, 160], ['#ffcc33', 122, 122], ['#1a1a1a', 180, 120], ['#4fd16a', 160, 140], ['#3f7cff', 110, 190], ['#ff3b3b', 196, 196], ['#ffcc33', 76, 190], ['#3f7cff', 224, 186], ['#4fd16a', 140, 92]]
        .map(([c, x, y]) => `<circle cx="${x}" cy="${y}" r="21" fill="${c}" stroke="#fff" stroke-width="3"/><circle cx="${x - 7}" cy="${y - 7}" r="5" fill="#fff" opacity=".6"/>`).join('')}
    </g></g>
    <circle cx="150" cy="118" r="98" fill="url(#gsDome)" stroke="#2a1020" stroke-width="7"/>
    <path d="M86 70 Q110 40 146 34" stroke="#fff" stroke-width="9" fill="none" opacity=".55" stroke-linecap="round"/>
    <rect x="58" y="196" width="184" height="18" rx="6" fill="#ffcc33" stroke="#2a1020" stroke-width="6"/>
    <rect x="44" y="210" width="212" height="150" rx="22" fill="url(#gsBody)" stroke="#2a1020" stroke-width="7"/>
    <g class="gs-plate">
      <path d="M96 236 L108 214 L118 236Z M204 236 L192 214 L182 236Z" fill="#f6e6b0" stroke="#2a1020" stroke-width="4"/>
      <rect x="92" y="228" width="116" height="54" rx="14" fill="#2a1020"/>
      <ellipse class="gs-eye" cx="126" cy="252" rx="13" ry="8" fill="#ffe14a"/>
      <ellipse class="gs-eye" cx="174" cy="252" rx="13" ry="8" fill="#ffe14a"/>
      <circle cx="126" cy="252" r="3.5" fill="#2a1020"/><circle cx="174" cy="252" r="3.5" fill="#2a1020"/>
      <path d="M118 270 L126 262 L134 270 L142 262 L150 270 L158 262 L166 270 L174 262 L182 270" stroke="#fff" stroke-width="3" fill="none"/>
    </g>
    <rect class="gs-slot" x="226" y="232" width="12" height="40" rx="5" fill="#2a1020"/>
    <g class="gs-crank"><circle cx="110" cy="320" r="24" fill="#ffcc33" stroke="#2a1020" stroke-width="6"/><rect x="104" y="296" width="12" height="48" rx="6" fill="#c88a10" stroke="#2a1020" stroke-width="4"/></g>
    <rect x="160" y="296" width="62" height="48" rx="12" fill="#2a1020"/>
    <rect x="166" y="302" width="50" height="36" rx="9" fill="#120610"/>
    <text x="150" y="208" text-anchor="middle" font-size="14" font-weight="900" fill="#2a1020" font-family="sans-serif">鬼ガチャ</text>
  </svg>`;

  function confetti(layer, colors, n) {
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.className = 'gs-cf';
      p.style.left = 50 + (Math.random() - 0.5) * 20 + '%';
      p.style.background = colors[i % colors.length];
      p.style.setProperty('--dx', (Math.random() - 0.5) * 140 + 'vmin');
      p.style.setProperty('--dy', -(40 + Math.random() * 60) + 'vmin');
      p.style.setProperty('--r', Math.random() * 720 - 360 + 'deg');
      p.style.animationDelay = Math.random() * 0.25 + 's';
      layer.appendChild(p);
      setTimeout(() => p.remove(), 2600);
    }
  }

  async function run(root, o) {
    const tier = TIER[o.ball.key] ?? 0;
    root.innerHTML = `
      <div class="gs gs-t${tier}">
        <div class="gs-bg"></div>
        <div class="gs-flash"></div>
        <div class="gs-bolts"></div>
        <div class="gs-info">${o.ticket ? `🎫 ${o.ticket}を使った！<b class="gs-count" hidden>0</b>` : o.failed
          ? `<span class="gs-failed">脱出失敗… 鬼玉が半分に！</span> みんなの鬼玉 <s>${o.failed.from}</s> → <b class="gs-count">0</b>個`
          : 'みんなで集めた鬼玉 <b class="gs-count">0</b>個'}</div>
        <div class="gs-stage">
          <div class="gs-machine">${MACHINE}</div>
          <div class="gs-orbs"></div>
          <div class="gs-ball" hidden>
            <div class="gs-ballcore"></div>
            <div class="gs-cracks"></div>
            <div class="gs-ofuda"><span>封</span></div>
          </div>
          <div class="gs-reveal" hidden>
            <div class="gs-rays"></div>
            <div class="gs-charabox"><img class="gs-chara" alt=""></div>
            <div class="gs-stamp"></div>
            <div class="gs-name"></div>
            <div class="gs-msg"></div>
          </div>
        </div>
        <div class="gs-balltext" hidden></div>
        <div class="gs-hint">タップで鬼玉を入れる</div>
        <div class="gs-cfl"></div>
      </div>`;
    const $ = s => root.querySelector(s);
    const g = $('.gs'), hint = $('.gs-hint');
    const au = window.artUrl || (() => null);
    if (au('gacha/machine')) $('.gs-machine').innerHTML = `<img class="gs-mimg" src="${au('gacha/machine')}" alt="">`; // 生成AIのガチャの機械
    const tap = text => new Promise(res => {
      hint.textContent = text; hint.hidden = false;
      const h = e => { e.preventDefault(); g.removeEventListener('pointerdown', h); hint.hidden = true; res(); };
      g.addEventListener('pointerdown', h);
    });
    const flash = (color, ms = 500) => { const f = $('.gs-flash'); f.style.background = color; f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); setTimeout(() => f.classList.remove('on'), ms); };
    const shakeScreen = cls => { g.classList.remove(cls); void g.offsetWidth; g.classList.add(cls); };

    // 1) 鬼玉を入れる
    await tap('タップで鬼玉を入れる');
    const orbs = $('.gs-orbs'), countEl = $('.gs-count');
    const flyN = Math.min(18, Math.max(6, Math.round(o.team / 10)));
    for (let i = 0; i < flyN; i++) {
      const d = document.createElement('i');
      d.className = 'gs-orb';
      d.style.setProperty('--sx', (Math.random() * 60 + 20) + '%');
      d.style.animationDelay = i * 0.07 + 's';
      orbs.appendChild(d);
      setTimeout(() => { SFX.pop(); countEl.textContent = Math.round(o.team * (i + 1) / flyN); }, 450 + i * 70);
    }
    await wait(500 + flyN * 70);
    countEl.textContent = o.team;
    g.classList.add('gs-fed');
    SFX.rumble();
    shakeScreen('gs-quake');
    await wait(700);

    // 2) ハンドルを回す
    await tap('タップでハンドルを回す！');
    g.classList.add('gs-turning');
    for (let i = 0; i < 6; i++) { setTimeout(SFX.click, i * 180); }
    await wait(1150);

    // 3) 予兆（ランクが高いほど派手）
    if (tier >= 2) { g.classList.add('gs-eyes'); SFX.shimmer(); await wait(700); }
    if (tier >= 3) {
      g.classList.add('gs-gold'); SFX.thunder(); flash('#fff8c0', 400); shakeScreen('gs-quake');
      $('.gs-bolts').classList.add('on');
      await wait(900);
    }
    if (tier >= 4) {
      g.classList.add('gs-dark'); await wait(500);
      SFX.thunder(); flash('#d0a0ff', 600); shakeScreen('gs-quake-big');
      await wait(1100);
    }
    g.classList.remove('gs-turning');

    // 4) 玉が出てくる（お札でくるまれていて色はまだわからない）
    const ball = $('.gs-ball');
    ball.style.setProperty('--ball', o.ball.color);
    if (au('gacha/ball_' + o.ball.key)) ball.style.setProperty('--ballimg', `url("${au('gacha/ball_' + o.ball.key)}")`);
    ball.hidden = false;
    $('.gs-machine').classList.add('back');
    ball.classList.add('drop');
    SFX.drop();
    await wait(1100);
    // スペシャルガチャの前ぶれ: 黒玉がガタガタふるえて、虹色の火花（レジェンド・神なら必ず、Sでもたまに）
    // 生成AIの絵（虹の玉・神の玉・ふるえる黒玉・光・後光・メダル）をCSSで使えるようにする
    for (const k of ['ball_rainbow', 'ball_divine', 'ball_tease', 'burst_divine', 'rays_rainbow', 'halo', 'mark_legend', 'mark_god']) if (au('gacha/' + k)) g.style.setProperty('--sp-' + k.replace('_', '-'), `url("${au('gacha/' + k)}")`);
    if (o.tease) { ball.classList.add('tease'); SFX.shimmer(); shakeScreen('gs-quake'); await wait(900); }

    // 5) お札がはがれて色がわかる
    await tap('タップでお札をはがす');
    ball.classList.add('burn'); SFX.burn();
    await wait(650);
    const bt = $('.gs-balltext');
    if (o.special) { // 確定演出: お札の下は虹の玉（レジェンド）・金と白に光る玉（神）
      ball.classList.remove('tease');
      ball.classList.add(o.special === 'god' ? 'divine' : 'rainbow');
      g.classList.add(o.special === 'god' ? 'gs-divine' : 'gs-rainbow');
      ball.style.setProperty('--ball', o.special === 'god' ? '#fff6c0' : '#ff9ae8');
      SFX.thunder(); shakeScreen('gs-quake-big');
      flash(o.special === 'god' ? '#ffffff' : '#ff9ae8', o.special === 'god' ? 1400 : 800);
      if (o.special === 'god') { await wait(500); SFX.thunder(); flash('#fff6c0', 1200); }
      bt.textContent = o.special === 'god' ? '✨ 神々しく光る玉…！？' : '🌈 虹のガチャ玉！？';
      bt.style.color = o.special === 'god' ? '#fff6c0' : '#ff9ae8'; bt.hidden = false;
      ball.classList.add('glow');
      await wait(o.special === 'god' ? 1600 : 1200);
    } else {
      ball.classList.remove('tease');
      flash(o.ball.color, 500);
      bt.textContent = `${o.ball.name}のガチャ玉！`; bt.style.color = o.ball.key === 'black' ? '#d0a8ff' : o.ball.color; bt.hidden = false;
      ball.classList.add('glow');
      await wait(900);
    }

    // 6) 割って妖怪を出す
    await tap('タップであける！');
    bt.hidden = true;
    for (let i = 0; i < 3; i++) {
      ball.classList.remove('wob'); void ball.offsetWidth; ball.classList.add('wob'); SFX.shake();
      ball.querySelector('.gs-cracks').style.opacity = (i + 1) / 3;
      await wait(tier >= 3 ? 520 : 420);
    }
    SFX.burst(); flash('#ffffff', 700); shakeScreen('gs-quake');
    ball.hidden = true;
    $('.gs-machine').classList.add('away');
    const rv = $('.gs-reveal'), ch = $('.gs-chara');
    rv.style.setProperty('--rank', o.yokai.rankColor);
    rv.style.setProperty('--ball', o.ball.color);
    ch.src = o.yokai.img;
    try { await Promise.race([ch.decode(), wait(1500)]); } catch {} // 絵の読み込みを待ってから出す
    // シルエットは使わず、最初からカラーの妖怪が飛び出す（iPhone で色が戻らないことがあったため）
    rv.hidden = false;
    rv.classList.add('show');
    await wait(tier >= 3 ? 1100 : 800);
    const stamp = $('.gs-stamp');
    stamp.textContent = o.yokai.rank === 'G' ? '神' : o.yokai.rank; stamp.classList.add('on'); SFX.stamp(); shakeScreen(o.special ? 'gs-quake-big' : 'gs-quake');
    await wait(350);
    $('.gs-name').textContent = o.yokai.name; $('.gs-name').classList.add('on');
    $('.gs-msg').textContent = o.isNew ? `${o.yokai.role}の${o.yokai.name}がお友達になった！` : o.overExp ? `${o.yokai.name}は凸MAX！ あふれた分が 📈 経験値 +${o.overExp.toLocaleString('ja-JP')} に変わった` : o.totsu != null ? (o.dupCount - 1 > o.totsuMax ? `${o.yokai.name}は凸MAX！ これ以上は強くならないけど仲良し（×${o.dupCount}）` : `${o.yokai.name}が凸${o.totsu}になった！ HP・攻撃 +${Math.round(o.totsu * o.totsuStep * 100)}%`) : `${o.yokai.name}とさらに仲良くなった！（×${o.dupCount}）`;
    $('.gs-msg').classList.add('on');
    SFX.fanfare(o.special ? 4 : tier);
    if (o.special) { // レジェンド・神: いちばん長いファンファーレと、虹・金の紙吹雪
      const cols = o.special === 'god' ? ['#ffffff', '#fff6c0', '#ffd23a', '#ffe680'] : ['#ff4a4a', '#ffd23a', '#4ae07a', '#3ac8ff', '#c85aff'];
      confetti($('.gs-cfl'), cols, 120); setTimeout(() => confetti($('.gs-cfl'), cols, 100), 600); setTimeout(() => confetti($('.gs-cfl'), cols, 80), 1300);
      setTimeout(() => SFX.fanfare(4), 900);
    }
    confetti($('.gs-cfl'), tier >= 3 ? ['#ffe14a', '#fff6c0', '#ffb000', '#ffffff'] : [o.yokai.rankColor, '#ffffff', '#ff8ad8', '#7ad8ff'], tier >= 3 ? 90 : 50);
    if (tier >= 3) setTimeout(() => confetti($('.gs-cfl'), ['#ffe14a', '#fff6c0', '#ffffff'], 60), 700);
    await wait(900);
  }

  // ---------- 10連 ----------
  // GachaShow.run10(root, { ticket, ball: {key, name, color}, items: [{ name, rank, rankColor, img, isNew, note, special: 'legend'|'god'|null, tease }] })
  // ハンドルを回す → ガチャ玉が10個ころがり出る → 順番にあける（レジェンド・神の玉は最後に1個ずつ大きく）
  async function run10(root, o) {
    const tier = TIER[o.ball.key] ?? 0, items = o.items, rares = items.filter(it => it.special);
    const god = rares.some(it => it.special === 'god');
    root.innerHTML = `
      <div class="gs gs-t${tier} g10s">
        <div class="gs-bg"></div>
        <div class="gs-flash"></div>
        <div class="gs-bolts"></div>
        <div class="gs-info">🎫 ${o.ticket}</div>
        <div class="gs-stage"><div class="gs-machine">${MACHINE}</div></div>
        <div class="g10s-grid">${items.map((it, i) => `<div class="g10s-slot" data-i="${i}"><div class="g10s-ball"></div><div class="g10s-card" style="--rc:${it.rankColor}"></div></div>`).join('')}</div>
        <div class="g10s-big" hidden><div class="g10s-rays"></div><img alt=""><div class="g10s-stamp"></div><div class="g10s-name"></div><div class="g10s-msg"></div></div>
        <div class="gs-balltext" hidden></div>
        <div class="gs-hint">タップでハンドルを回す！</div>
        <button class="g10s-skip">スキップ ▶▶</button>
        <div class="gs-cfl"></div>
      </div>`;
    const $ = sel => root.querySelector(sel), $$ = sel => [...root.querySelectorAll(sel)];
    const g = $('.gs'), hint = $('.gs-hint');
    const au = window.artUrl || (() => null);
    if (au('gacha/machine')) $('.gs-machine').innerHTML = `<img class="gs-mimg" src="${au('gacha/machine')}" alt="">`;
    for (const k of ['ball_rainbow', 'ball_divine', 'ball_tease', 'burst_divine', 'rays_rainbow', 'halo', 'mark_legend', 'mark_god']) if (au('gacha/' + k)) g.style.setProperty('--sp-' + k.replace('_', '-'), `url("${au('gacha/' + k)}")`);
    const bimg = au('gacha/ball_' + o.ball.key);
    g.style.setProperty('--ball', o.ball.color);
    if (bimg) g.style.setProperty('--ballimg', `url("${bimg}")`);
    let skip = false;
    const W = ms => (skip ? Promise.resolve() : wait(ms));
    const tap = text => (skip ? Promise.resolve() : new Promise(res => {
      hint.textContent = text; hint.hidden = false;
      const h = e => { if (e.target.closest('.g10s-skip')) return; e.preventDefault(); g.removeEventListener('pointerdown', h); hint.hidden = true; g._skipRes = null; res(); };
      g.addEventListener('pointerdown', h);
      g._skipRes = () => { g.removeEventListener('pointerdown', h); hint.hidden = true; res(); };
    }));
    $('.g10s-skip').addEventListener('pointerdown', e => { e.stopPropagation(); skip = true; if (g._skipRes) g._skipRes(); });
    const flash = (color, ms = 500) => { if (skip) return; const f = $('.gs-flash'); f.style.background = color; f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); setTimeout(() => f.classList.remove('on'), ms); };
    const quake = cls => { if (skip) return; g.classList.remove(cls); void g.offsetWidth; g.classList.add(cls); };
    const snd = f => { if (!skip) f(); };
    const slots = $$('.g10s-slot');
    const cardHtml = it => `<span class="g10s-rk">${it.rank === 'G' ? '神' : it.rank}</span>${it.img ? `<img src="${it.img}" alt="">` : ''}<b>${it.name}</b><small>${it.isNew ? '<i class="g10-new">NEW</i>' : it.note || ''}</small>`;
    const open = (i, big) => {
      const it = items[i], sl = slots[i];
      sl.querySelector('.g10s-card').innerHTML = cardHtml(it);
      sl.classList.remove('tease', 'focus', 'rainbow', 'divine');
      sl.classList.add('open'); if (it.special) sl.classList.add('rare', it.special);
      if (!big) { snd(SFX.pop); if (it.rank === 'S') flash(it.rankColor + '55', 250); }
    };

    // 1) ハンドルを回す（10回ぶん）
    await tap('タップでハンドルを回す！');
    g.classList.add('gs-turning');
    for (let i = 0; i < 10; i++) setTimeout(() => snd(SFX.click), i * 110);
    snd(SFX.rumble); quake('gs-quake');
    await W(1200);
    // 前ぶれ: レジェンド・神が入っていると、目が光って雷（神ならさらに真っ白）
    if (rares.length || tier >= 3) { g.classList.add('gs-eyes'); snd(SFX.shimmer); await W(600); }
    if (rares.length) {
      g.classList.add('gs-gold'); snd(SFX.thunder); flash('#fff8c0', 400); quake('gs-quake'); $('.gs-bolts').classList.add('on');
      const bt = $('.gs-balltext'); bt.textContent = god ? '✨ なにか神々しい気配が…！？' : '⚡ なにかすごいのが混じってる…！？'; bt.style.color = god ? '#fff6c0' : '#ff9ae8'; bt.hidden = skip;
      await W(1100);
      if (god) { snd(SFX.thunder); flash('#ffffff', 900); quake('gs-quake-big'); await W(900); }
      bt.hidden = true;
    }
    g.classList.remove('gs-turning');

    // 2) ガチャ玉が10個ころがり出る
    const mc = $('.gs-stage').getBoundingClientRect();
    $('.gs-machine').classList.add('back');
    g.classList.add('g10s-pour');
    for (let i = 0; i < 10; i++) {
      const sl = slots[i], r = sl.getBoundingClientRect();
      sl.style.setProperty('--fx', `${mc.left + mc.width / 2 - (r.left + r.width / 2)}px`);
      sl.style.setProperty('--fy', `${mc.top + mc.height * 0.7 - (r.top + r.height / 2)}px`);
      sl.classList.add('in'); if (items[i].tease || items[i].special) sl.classList.add('tease');
      snd(SFX.drop);
      await W(170);
    }
    await W(700);
    $('.gs-machine').classList.add('away');

    // キャラを大きく見せて、タップを待つ（レジェンド・神・初ゲットのキャラ）
    const bigShow = async (it, kind) => {
      if (skip) return;
      const bg = $('.g10s-big');
      bg.className = 'g10s-big ' + kind; bg.hidden = false;
      bg.style.setProperty('--rc', it.rankColor);
      bg.querySelector('img').src = it.img || '';
      bg.querySelector('.g10s-stamp').textContent = it.rank === 'G' ? '神' : it.rank;
      bg.querySelector('.g10s-name').innerHTML = (it.isNew ? '<i class="g10s-newb">NEW!</i>' : '') + it.name.replace(/</g, '&lt;');
      bg.querySelector('.g10s-msg').textContent = it.isNew ? `${it.name}がお友達になった！` : (it.note || `${it.name}とさらに仲良くなった！`);
      void bg.offsetWidth; bg.classList.add('show');
      const rare = kind === 'legend' || kind === 'god';
      snd(SFX.stamp); snd(() => SFX.fanfare(rare ? 4 : Math.min(3, tier + 1))); if (rare) setTimeout(() => snd(() => SFX.fanfare(4)), 900);
      const cols = kind === 'god' ? ['#ffffff', '#fff6c0', '#ffd23a', '#ffe680'] : kind === 'legend' ? ['#ff4a4a', '#ffd23a', '#4ae07a', '#3ac8ff', '#c85aff'] : [it.rankColor, '#ffffff', '#ff8ad8', '#7ad8ff'];
      confetti($('.gs-cfl'), cols, rare ? 120 : 60); if (rare) setTimeout(() => { if (!skip) confetti($('.gs-cfl'), cols, 90); }, 600);
      await W(rare ? 1400 : 900);
      await tap('タップで次へ');
      bg.hidden = true; bg.classList.remove('show');
    };

    // 3) ふつうの玉を順番にあける（初ゲットのキャラが出たら止まって大きく見せる）
    await tap('タップでぜんぶあける！');
    for (let i = 0; i < 10; i++) {
      if (items[i].special) continue;
      slots[i].classList.add('pop'); await W(120);
      if (items[i].isNew && !skip) { snd(SFX.burst); flash('#ffffff', 450); quake('gs-quake'); open(i, true); await W(250); await bigShow(items[i], 'new'); continue; }
      open(i); await W(items[i].rank === 'S' ? 260 : 170);
    }
    // 4) レジェンド・神の玉は最後に1個ずつ
    for (const it of rares) {
      const i = items.indexOf(it), sl = slots[i];
      if (skip) { open(i, true); continue; }
      sl.classList.remove('tease'); sl.classList.add('focus', it.special === 'god' ? 'divine' : 'rainbow');
      g.classList.add(it.special === 'god' ? 'gs-divine' : 'gs-rainbow');
      snd(SFX.thunder); quake('gs-quake-big'); flash(it.special === 'god' ? '#ffffff' : '#ff9ae8', it.special === 'god' ? 1200 : 700);
      const bt = $('.gs-balltext'); bt.textContent = it.special === 'god' ? '✨ 神々しく光る玉…！？' : '🌈 虹のガチャ玉！？'; bt.style.color = it.special === 'god' ? '#fff6c0' : '#ff9ae8'; bt.hidden = false;
      await W(1000);
      await tap('タップであける！');
      bt.hidden = true;
      for (let k = 0; k < 3; k++) { sl.classList.remove('wob'); void sl.offsetWidth; sl.classList.add('wob'); snd(SFX.shake); await W(380); }
      snd(SFX.burst); flash('#ffffff', 800); quake('gs-quake-big');
      open(i, true);
      await bigShow(it, it.special);
      g.classList.remove('gs-divine', 'gs-rainbow');
    }
    for (let i = 0; i < 10; i++) if (!slots[i].classList.contains('open')) open(i, true);
    // 5) まとめ
    g.classList.add('g10s-done'); $('.g10s-skip').hidden = true; hint.hidden = true;
    $('.gs-info').textContent = '🎫 ' + o.ticket.replace(/！$/, '') + 'の結果';
    if (!skip) { SFX.fanfare(rares.length ? 4 : tier); confetti($('.gs-cfl'), ['#ffe14a', '#fff6c0', '#ff8ad8', '#7ad8ff', '#ffffff'], 70); }
    await wait(300);
  }

  window.GachaShow = { run, run10 };
})();
