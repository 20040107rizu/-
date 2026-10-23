// BGM（Web Audio でその場で鳴らす和風の曲）
// mode: 'intro' ボス鬼登場 / 'normal' ふだん / 'chase' ボス鬼に追われている
(function () {
  'use strict';
  let ctx = null, master = null, noise = null;
  let mode = null, playing = false, step = 0, nextTime = 0, timer = null;
  let enabled = true;
  try { enabled = localStorage.getItem('bgm') !== 'off'; } catch {}

  const midi = n => 440 * Math.pow(2, (n - 69) / 12);

  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  // ---------- 楽器 ----------
  function tone(t, note, dur, vol, type = 'triangle', attack = 0.005, cutoff = 0) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = midi(note);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = o;
    if (cutoff) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; o.connect(f); out = f; }
    out.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  const koto = (t, n, v = 0.12) => { tone(t, n, 0.9, v, 'triangle'); tone(t, n + 12, 0.25, v * 0.3, 'sine'); };
  const fue = (t, n, d, v = 0.06) => tone(t, n, d, v, 'square', 0.03, 2400);
  const bass = (t, n, d, v = 0.16, type = 'sine') => tone(t, n, d, v, type, 0.01, type === 'sawtooth' ? 700 : 0);
  function taiko(t, v = 0.5, f = 70) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f * 2.2, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.55);
    hit(t, v * 0.35, 900, 0.06);
  }
  function hit(t, v, freq, dur) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.02);
  }
  const kane = (t, v = 0.05) => { tone(t, 93, 1.6, v, 'sine'); tone(t, 100, 1.2, v * 0.5, 'sine'); };

  // 都節の音階（D, Eb, G, A, Bb）
  const SC = [50, 51, 55, 57, 58, 62, 63, 67, 69, 70, 74, 75, 79];

  // ---------- 曲（16分音符ごとに呼ばれる） ----------
  // 三味線っぽい音（短くはじく）
  const shami = (t, n, v = 0.07) => tone(t, n, 0.28, v, 'sawtooth', 0.002, 1800);
  const suzu = (t, v = 0.035) => { hit(t, v, 7000, 0.12); tone(t, 98, 0.3, v * 0.6, 'sine'); };

  const SONGS = {
    // タイトル・ロビー: お祭りっぽくて少し怪しい曲
    title: {
      bpm: 112, len: 64,
      play(i, t, s16) {
        const b = i % 16, bar = Math.floor(i / 16);
        // 祭り太鼓（ドン・ドドン）
        if (b === 0 || b === 6 || b === 8) taiko(t, b === 0 ? 0.32 : 0.2, 62);
        if (b === 12 || b === 14) hit(t, 0.08, 1800, 0.05);
        if (b === 4 || b === 12) suzu(t);
        // 三味線の伴奏
        const roots = [50, 50, 55, 51];
        if (b % 4 === 2) shami(t, roots[bar] + (b === 10 ? 7 : 0));
        if (b === 0) bass(t, roots[bar] - 12, s16 * 7, 0.12);
        // 琴のメロディ
        const mel = [
          [0, 5], [2, 7], [4, 8], [6, 7], [8, 10], [11, 9], [12, 8],
          [16, 7], [18, 8], [20, 10], [22, 11], [24, 12], [27, 11], [28, 10],
          [32, 10], [34, 9], [36, 8], [38, 7], [40, 8], [43, 7], [44, 6],
          [48, 5], [50, 6], [52, 7], [54, 6], [56, 5], [60, 3], [62, 5],
        ];
        for (const [st, n] of mel) if (st === i) koto(t, SC[n], 0.1);
        if (i === 31 || i === 63) kane(t, 0.04);
      },
    },
    normal: {
      bpm: 86, len: 64,
      play(i, t, s16) {
        const bar = Math.floor(i / 16), b = i % 16;
        if (b === 0) { bass(t, 38, s16 * 14, 0.14); taiko(t, 0.28, 60); }
        if (b === 8) taiko(t, 0.14, 70);
        if (b === 12 && bar % 2) hit(t, 0.05, 3000, 0.05);
        const mel = [
          [0, 7], [3, 8], [6, 9], [8, 8], [12, 6],
          [16, 5], [19, 6], [22, 7], [24, 5], [28, 3],
          [32, 7], [35, 9], [38, 10], [40, 9], [44, 8],
          [48, 7], [51, 6], [54, 5], [56, 3], [60, 5],
        ];
        for (const [s, n] of mel) if (s === i) koto(t, SC[n]);
        if (i === 30 || i === 62) kane(t);
      },
    },
    chase: {
      bpm: 158, len: 64,
      play(i, t, s16) {
        const b = i % 16, bar = Math.floor(i / 16);
        const bl = [38, 38, 50, 38, 39, 38, 50, 46];
        if (i % 2 === 0) bass(t, bl[(i / 2) % 8] + (bar === 3 ? 3 : 0), s16 * 1.8, 0.14, 'sawtooth');
        if (b % 4 === 0) taiko(t, 0.5, 60);
        if (b === 6 || b === 14) taiko(t, 0.3, 80);
        if (b % 2 === 1) hit(t, 0.05, 6000, 0.03);
        const lead = [[0, 10], [2, 9], [4, 7], [6, 9], [8, 10], [12, 12], [16, 11], [18, 10], [20, 9], [24, 7], [28, 8], [32, 10], [34, 12], [36, 11], [40, 10], [44, 9], [48, 7], [52, 8], [56, 9], [60, 10]];
        for (const [s, n] of lead) if (s === i) fue(t, SC[n], s16 * 1.8);
      },
    },
    intro: {
      bpm: 100, len: 32,
      play(i, t, s16) {
        if (i === 0) { bass(t, 26, s16 * 30, 0.2, 'sawtooth'); kane(t, 0.06); }
        if ([0, 6, 8, 14, 16, 20, 22, 24, 26, 28, 29, 30, 31].includes(i)) taiko(t, 0.25 + i / 60, 55);
        if (i === 16) fue(t, 63, s16 * 14, 0.05);
      },
    },
  };

  function tick() {
    if (!playing || !ctx) return;
    const song = SONGS[mode];
    const s16 = 60 / song.bpm / 4;
    while (nextTime < ctx.currentTime + 0.15) {
      song.play(step % song.len, nextTime, s16);
      step++;
      nextTime += s16;
    }
  }

  function fadeTo(v, sec) {
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(v, t + sec);
  }

  window.Music = {
    get enabled() { return enabled; },
    // ボタンを押したときに呼ぶ（スマホは操作のあとでないと音が出せない）
    unlock() { if (init() && ctx.state === 'suspended') ctx.resume(); },
    setEnabled(on) {
      enabled = on;
      try { localStorage.setItem('bgm', on ? 'on' : 'off'); } catch {}
      if (!on) this.stop();
    },
    play(m) {
      if (!enabled || !init()) return;
      if (ctx.state === 'suspended') ctx.resume();
      if (playing && mode === m) return;
      const switching = playing;
      mode = m; step = 0;
      nextTime = ctx.currentTime + (switching ? 0.25 : 0.05);
      if (!playing) { playing = true; timer = setInterval(tick, 25); }
      if (switching) {
        // 曲の切り替え: いったん小さくしてから新しい曲へ
        fadeTo(0, 0.2);
        setTimeout(() => { if (playing) fadeTo(0.5, 0.4); }, 230);
        if (m === 'chase') taiko(nextTime, 0.7, 50);
      } else fadeTo(0.5, 0.6);
    },
    stop() {
      if (!ctx || !playing) return;
      fadeTo(0, 0.5);
      const t = timer;
      setTimeout(() => { clearInterval(t); }, 550);
      playing = false; mode = null;
    },
    get mode() { return playing ? mode : null; },
  };
})();
