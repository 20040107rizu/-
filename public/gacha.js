// 鬼ガチャの演出。GachaShow.run(root, opts) で root の中に演出を作り、終わったら resolve する。
// opts: { team, failed: {from} | null（脱出失敗で半分になったとき）, ball: {key, name, color}, yokai: {name, rank, rankColor, role, img}, isNew, dupCount }
(function () {
  'use strict';
  const TIER = { green: 0, blue: 1, red: 2, gold: 3, black: 4 };
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
        <div class="gs-info">${o.failed
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
    ball.hidden = false;
    $('.gs-machine').classList.add('back');
    ball.classList.add('drop');
    SFX.drop();
    await wait(1100);

    // 5) お札がはがれて色がわかる
    await tap('タップでお札をはがす');
    ball.classList.add('burn'); SFX.burn();
    await wait(650);
    flash(o.ball.color, 500);
    const bt = $('.gs-balltext');
    bt.textContent = `${o.ball.name}のガチャ玉！`; bt.style.color = o.ball.key === 'black' ? '#d0a8ff' : o.ball.color; bt.hidden = false;
    ball.classList.add('glow');
    await wait(900);

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
    stamp.textContent = o.yokai.rank; stamp.classList.add('on'); SFX.stamp(); shakeScreen('gs-quake');
    await wait(350);
    $('.gs-name').textContent = o.yokai.name; $('.gs-name').classList.add('on');
    $('.gs-msg').textContent = o.isNew ? `${o.yokai.role}の${o.yokai.name}がお友達になった！` : `${o.yokai.name}とさらに仲良くなった！（×${o.dupCount}）`;
    $('.gs-msg').classList.add('on');
    SFX.fanfare(tier);
    confetti($('.gs-cfl'), tier >= 3 ? ['#ffe14a', '#fff6c0', '#ffb000', '#ffffff'] : [o.yokai.rankColor, '#ffffff', '#ff8ad8', '#7ad8ff'], tier >= 3 ? 90 : 50);
    if (tier >= 3) setTimeout(() => confetti($('.gs-cfl'), ['#ffe14a', '#fff6c0', '#ffffff'], 60), 700);
    await wait(900);
  }

  window.GachaShow = { run };
})();
