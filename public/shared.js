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
    L: { mul: 2.4,  color: '#ff7ae8' }, // レジェンド
    G: { mul: 3.0,  color: '#fff2b0' }, // 神
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
  const LEGENDS = YOKAI.LEGENDS || [];
  const GODS = YOKAI.GODS || [];
  const GOD_FRAG = 30; // 神の封印をとく・凸するのに使う神の欠片（それぞれ神の試練1回ぶんも使う）
  // 名前や強さを引くときはレジェンド・神も含める（一覧・ガチャ・図鑑の数は YOKAI だけ）
  const YOKAI_BY_ID = Object.fromEntries(YOKAI.concat(LEGENDS, GODS).map(y => [y.id, y]));

  // 妖怪の実ステータス（ロール基本値 × ランク倍率）
  // 凸: 同じ妖怪がガチャでかぶるたびに1つ上がり、HPと攻撃が少しだけ上がる
  const TOTSU_MAX = 5, TOTSU_STEP = 0.03;
  const totsuOf = count => Math.max(0, Math.min(TOTSU_MAX, (count | 0) - 1));
  // 完凸（6体）よりあふれた分は経験値ストックに変わる（ランクごとの量）
  const FULL_COUNT = TOTSU_MAX + 1, OVER_EXP = { C: 100, B: 300, A: 1000, S: 3000, L: 10000 }; // L: 凸MAXのレジェンドがガチャでまた出たとき
  // ---- お友達レベル（経験値ストックを使って上げる。Lv1 が今までの強さ、1レベルごとに HP・攻撃 +0.8%） ----
  const LV_MAX = 99, LV_STEP = 0.008;
  const PICK_ANY = 1500, PICK_COPIES = 1; // 鬼玉がこの数以上なら、Sランクまでの好きな妖怪を1体指名してもらえる
  const SEAL_PICK = 700; // 鬼玉がこの数以上なら、バトルのあと好きなレジェンドの封印ガチャも選べる
  const EXP_MUL = 2.5; // バトルのあと「経験値にする」を選ぶと、鬼玉の数の2.5倍の経験値
  // そのレベルになるのに必要な経験値の合計（はじめはすぐ上がり、あとほど重い。Lv50 で約3万、Lv99 で約15万）
  const expForLv = lv => Math.round(3.6 * Math.pow(Math.max(0, lv - 1), 2.32));
  function lvOf(exp) {
    let lv = 1;
    while (lv < LV_MAX && (exp | 0) >= expForLv(lv + 1)) lv++;
    return lv;
  }
  function yokaiStats(id, totsu = 0, lv = 1) {
    const y = YOKAI_BY_ID[id] || YOKAI[0];
    const r = ROLES[y.role];
    const m = RANKS[y.rank].mul;
    const k = 1 + TOTSU_STEP * Math.max(0, Math.min(TOTSU_MAX, totsu | 0)) + LV_STEP * (Math.max(1, Math.min(LV_MAX, lv | 0)) - 1);
    return { ...r, hp: Math.round(r.hp * m * k), atkDmg: r.atkDmg * m * k, strongMul: m * k, speed: r.speed + (m - 1) * 20 };
  }

  // ---------- お守り（ランダムなスキルがつく装備。ふつうは1体に1つ、神は2つまで） ----------
  const CHARM_SKILLS = {
    drain: { name: '吸血',     per: 0.005, max: 0.05, text: v => `攻撃したダメージの${+(v * 100).toFixed(1)}%回復` },
    regen: { name: '自然回復', per: 0.0006, max: 0.005, text: v => `1秒ごとに最大体力の${(v * 100).toFixed(1)}%回復` },
    guard: { name: '鉄壁',     per: 0.03,  max: 0.3,  text: v => `受けるダメージ -${Math.round(v * 100)}%` },
    hp:    { name: '体力',     per: 0.04,  max: 0.4,  text: v => `最大体力 +${Math.round(v * 100)}%` },
    atk:   { name: '攻撃',     per: 0.03,  max: 0.4,  text: v => `攻撃力 +${Math.round(v * 100)}%` },
    haste: { name: '早業',     per: 0.06,  max: 0.4,  text: v => `スキルの待ち時間 -${Math.round(v * 100)}%` },
    ult:   { name: '必殺',     per: 0.08,  max: 0.6,  text: v => `必殺技ゲージ +${Math.round(v * 100)}%` },
    guts:  { name: '根性',     per: 1,     max: 1,    text: () => '倒れるダメージを1回だけ耐える', once: true },
    orb:   { name: '鬼玉',     per: 0.04,  max: 0.4,  text: v => `拾う鬼玉 +${Math.round(v * 100)}%` },
  };
  const CHARM_WEIGHT = { drain: 10, regen: 6, guard: 12, hp: 12, atk: 12, haste: 10, ult: 8, guts: 4, orb: 8 };
  // レア度: 白・青・赤・金・虹（n: スキルの数、lv: スキルの強さの範囲）
  const CHARM_RARITY = [
    { name: '白', color: '#e8e8f0', n: 1, lv: [1, 2], exp: 50 },
    { name: '青', color: '#4a8bff', n: 1, lv: [2, 3], exp: 150 },
    { name: '赤', color: '#ff4a4a', n: 2, lv: [1, 3], exp: 400 },
    { name: '金', color: '#ffd23a', n: 2, lv: [2, 4], exp: 1000 },
    { name: '虹', color: 'rainbow', n: 2, lv: [4, 5], exp: 3000 },
  ];
  const CHARM_MAX = 100; // 持てる数
  // 鬼玉の数ごとの、お守りガチャのレア度の確率（白・青・赤・金・虹 の%）
  const CHARM_ODDS = [[0, 70, 25, 5, 0, 0], [100, 45, 35, 16, 4, 0], [200, 25, 35, 28, 10, 2], [300, 12, 30, 35, 18, 5], [500, 0, 20, 40, 30, 10], [700, 0, 10, 35, 40, 15]];
  // up: ガネーシャがいると1段上の確率になる
  function charmOdds(count, up = 0) { let i = 0; CHARM_ODDS.forEach((r, k) => { if (count >= r[0]) i = k; }); return CHARM_ODDS[Math.min(CHARM_ODDS.length - 1, i + up)].slice(1); }
  function rollCharm(count, rnd = Math.random, up = 0) {
    const odds = charmOdds(count, up), sum = odds.reduce((a, b) => a + b, 0);
    let x = rnd() * sum, r = 0;
    for (let i = 0; i < odds.length; i++) { if (x < odds[i]) { r = i; break; } x -= odds[i]; }
    const R = CHARM_RARITY[r], s = [], used = new Set();
    for (let k = 0; k < R.n; k++) {
      const pool = Object.keys(CHARM_WEIGHT).filter(id => !used.has(id)), tot = pool.reduce((a, id) => a + CHARM_WEIGHT[id], 0);
      let y = rnd() * tot, id = pool[0];
      for (const q of pool) { if (y < CHARM_WEIGHT[q]) { id = q; break; } y -= CHARM_WEIGHT[q]; }
      used.add(id);
      s.push([id, CHARM_SKILLS[id].once ? 1 : R.lv[0] + Math.floor(rnd() * (R.lv[1] - R.lv[0] + 1))]);
    }
    return { r, s };
  }
  // つけているお守りの効果を合わせる（上限つき）
  function charmEffects(list) {
    const e = {};
    for (const c of list || []) for (const [id, lv] of c.s || []) { const k = CHARM_SKILLS[id]; if (k) e[id] = Math.min(k.max, (e[id] || 0) + k.per * lv); }
    return e;
  }
  const charmName = c => `${CHARM_RARITY[c.r].name}のお守り`;
  const charmText = c => c.s.map(([id, lv]) => `${CHARM_SKILLS[id].name}${CHARM_SKILLS[id].once ? '' : '+' + lv}`).join('・');

  // ---------- 称号（図鑑のコンプリート報酬） ----------
  const REGION = {
    japan: ['日本', '沖縄'],
    asia: ['中国', '韓国', 'インド', 'フィリピン', 'ヒマラヤ'],
    europe: ['イギリス', 'ヨーロッパ', 'スコットランド', 'アイルランド', 'ドイツ', 'スペイン', 'ルーマニア', 'ギリシャ', 'ノルウェー', '北欧', 'フランス', '中欧', 'ロシア'],
  };
  const regionOf = y => Object.keys(REGION).find(k => REGION[k].includes(y.origin)) || 'world';
  // need(list) → その妖怪たちを全部集めたら。count → 種類数
  const TITLES = [
    { id: 'n10',    name: '妖怪となかよし',     color: '#9ae0ff', count: 10,  desc: 'お友達を10体集める' },
    { id: 'n30',    name: '妖怪ハンター',       color: '#7be07b', count: 30,  desc: 'お友達を30体集める' },
    { id: 'n50',    name: '妖怪博士',           color: '#5aa7ff', count: 50,  desc: 'お友達を50体集める' },
    { id: 'n100',   name: '妖怪大将',           color: '#ff8a5a', count: 100, desc: 'お友達を100体集める' },
    { id: 'rC',     name: 'Cランク制覇',        color: '#7be07b', of: y => y.rank === 'C', desc: 'Cランクを全部集める' },
    { id: 'rB',     name: 'Bランク制覇',        color: '#5aa7ff', of: y => y.rank === 'B', desc: 'Bランクを全部集める' },
    { id: 'rA',     name: 'Aランク制覇',        color: '#ff6a6a', of: y => y.rank === 'A', desc: 'Aランクを全部集める' },
    { id: 'rS',     name: 'Sランク制覇',        color: '#ffd23a', of: y => y.rank === 'S', desc: 'Sランクを全部集める' },
    { id: 's10',    name: '伝説を従えし者',     color: '#ffd23a', of: y => y.rank === 'S', count: 10, desc: 'Sランクを10体集める' },
    { id: 'fighter', name: '百戦錬磨',          color: '#ff8a5a', of: y => y.role === 'fighter', desc: 'ファイターを全部集める' },
    { id: 'tank',   name: '鉄壁の守り手',       color: '#9ab0c8', of: y => y.role === 'tank', desc: 'タンクを全部集める' },
    { id: 'healer', name: '癒しの使い手',       color: '#7af0b0', of: y => y.role === 'healer', desc: 'ヒーラーを全部集める' },
    { id: 'ranger', name: '百発百中',           color: '#c8a0ff', of: y => y.role === 'ranger', desc: 'レンジャーを全部集める' },
    { id: 'japan',  name: '日本妖怪コンプ',     color: '#ff6a8a', of: y => regionOf(y) === 'japan', desc: '日本（沖縄も）の妖怪を全部集める' },
    { id: 'asia',   name: 'アジア妖怪コンプ',   color: '#ffb84a', of: y => regionOf(y) === 'asia', desc: '中国・韓国・インドなどの妖怪を全部集める' },
    { id: 'europe', name: 'ヨーロッパ妖怪コンプ', color: '#8ab8ff', of: y => regionOf(y) === 'europe', desc: 'ヨーロッパの妖怪を全部集める' },
    { id: 'world',  name: '世界の妖怪コンプ',   color: '#5ad8c8', of: y => regionOf(y) === 'world', desc: 'アフリカ・アメリカ・中東などの妖怪を全部集める' },
    { id: 'totsu',  name: '限界突破',           color: '#ff5ad8', totsu: true, desc: 'どれか1体を凸5（凸MAX）にする' },
    { id: 'all',    name: '妖怪マスター',       color: 'gold', count: 'all', desc: '170体ぜんぶ集める（名前が金色になる）' },
    // バトルでの手がら（feat）でもらえる称号
    { id: 'kishin', name: '鬼神殺し',           color: '#ff3a6a', feat: 'kishin', desc: '鬼神をたおす' },
    { id: 'sanki',  name: '三鬼殺し',           color: '#ff2a6a', feat: 'sanki', desc: '三鬼合戦で、3体のボス鬼をぜんぶたおす' },
    { id: 'solo',   name: '孤高の鬼殺し',       color: '#ffb0d0', feat: 'solo', desc: '金鬼から先のボス鬼を、ひとりで出撃してたおす' },
    // 隠しボスの称号（hidden: 手に入れるまで称号の一覧に出さない）
    { id: 'gokuou', name: '獄王討伐',           color: '#ff3a1a', feat: 'gokuou', hidden: true, desc: '獄王をたおす' },
    { id: 'hyakki', name: '百鬼の覇者',         color: 'gold', feat: 'hyakki', hidden: true, desc: '百鬼王をたおす' },
    { id: 'shin',   name: '真・鬼神殺し',       color: 'rainbow', feat: 'shin', hidden: true, desc: '目覚めた鬼神・真をたおす' },
    // やりこんだ人だけの称号（fx: 光り方 / plate: 名札の台 / emblem: 紋章）
    { id: 'tower12',  name: '塔の覇者',   color: '#ff8a3a', feat: 'tower12',  fx: 'fire',    plate: 'fire',    emblem: 'tower12',  desc: '鬼の塔で12階に到達する' },
    { id: 'tower15',  name: '天を衝く者', color: '#7ab8ff', feat: 'tower15',  fx: 'bolt',    plate: 'bolt',    emblem: 'tower15',  desc: '鬼の塔で15階に到達する' },
    { id: 'sankiperf', name: '三鬼無双',  color: '#ff5a3a', feat: 'sankiperf', fx: 'fire',   plate: 'fire',    emblem: 'sanki',    desc: '三鬼合戦で、だれも倒れずに3体ぜんぶたおす' },
    { id: 'godsall',  name: '神々の主',   color: '#ffd23a', feat: 'godsall',  fx: 'divine',  plate: 'divine',  emblem: 'gods',     hidden: true, desc: '神16柱をぜんぶ仲間にする' },
    { id: 'legendmax', name: '伝説の継承者', color: '#ff9ae8', feat: 'legendmax', fx: 'rainbow', plate: 'rainbow', emblem: 'legend', desc: 'レジェンド6体をぜんぶ凸MAXにする' },
    { id: 'hyakkimax', name: '百鬼全書', color: '#ff9ae8', feat: 'hyakkimax', fx: 'rainbow', plate: 'rainbow', emblem: 'hyakki',   desc: '妖怪170体をぜんぶ凸MAXにする' },
    { id: 'lv99x10',  name: '極めし者',   color: '#9ad8ff', feat: 'lv99x10',  fx: 'ice',     plate: 'ice',     emblem: 'lv99',     desc: 'Lv99の妖怪を10体そだてる' },
    { id: 'play1000', name: '千戦錬磨',   color: '#c890ff', feat: 'play1000', fx: 'dark',    plate: 'dark',    emblem: '1000',     desc: '1,000回遊ぶ' },
    { id: 'orbking',  name: '鬼玉長者',   color: '#ffd23a', feat: 'orbking',  fx: 'gold',    plate: 'gold',    emblem: 'orb',      desc: '1回のバトルで、みんなの鬼玉を2,000個集める' },
    { id: 'flawless', name: '無傷の英雄', color: '#9ad8ff', feat: 'flawless', fx: 'bolt',    plate: 'bolt',    emblem: 'flawless', desc: '金鬼から先のボス鬼を、1回もダメージを受けずにたおす' },
    { id: 'charm10',  name: 'お守り蒐集家', color: '#ff9ae8', feat: 'charm10', fx: 'rainbow', plate: 'rainbow', emblem: 'legend',  desc: '虹のお守りを10個持つ' },
    // 特別な称号（ふつうには手に入らない）
    { id: 'matsuri1', name: '百鬼祭の主', color: '#ff8a3a', feat: 'matsuri1', fx: 'fire', plate: 'matsuri', emblem: 'matsuri', hidden: true, desc: 'イベント「月夜の百鬼祭」で祭り提灯を10,000個集める（期間限定）' },
    { id: 'matsuri2', name: '百鬼祭の覇王', color: '#ffd23a', feat: 'matsuri2', fx: 'creator', plate: 'gold', emblem: 'matsuri', hidden: true, desc: 'イベント「月夜の百鬼祭」で祭り提灯を100,000個集める（期間限定）' },
    { id: 'creator',  name: '鬼バスターズの創造主', color: '#ffd23a', feat: 'creator', fx: 'creator', plate: 'creator', emblem: 'creator', hidden: true, desc: 'このゲームを作った人' },
  ];
  const TITLE_BY_ID = Object.fromEntries(TITLES.map(t => [t.id, t]));
  // friends: { id: 持っている数 }、feats: { kishin: true, ... } バトルでの手がら → [{ title, got, need, done }]
  function titleProgress(friends, feats = {}) {
    return TITLES.map(t => {
      if (t.feat) { const ok = !!feats[t.feat]; return { title: t, got: ok ? 1 : 0, need: 1, done: ok }; }
      if (t.totsu) { const best = Math.max(0, ...YOKAI.map(y => totsuOf(friends[y.id] || 0))); return { title: t, got: best, need: TOTSU_MAX, done: best >= TOTSU_MAX }; }
      const pool = t.of ? YOKAI.filter(t.of) : YOKAI;
      const got = pool.filter(y => friends[y.id]).length;
      const need = t.count === 'all' ? YOKAI.length : t.count || pool.length;
      return { title: t, got: Math.min(got, need), need, done: got >= need };
    });
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
    [300,  0,  8, 22, 38, 32],
    [400,  0,  3, 12, 45, 40],
    [500,  0,  0,  0, 55, 45], // 500個以上は金か黒が必ず出る
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

  // ---------- レジェンドの封印 ----------
  // 全部そろうと図鑑で「封印をとく」が押せる
  const SEAL = { totsuNeed: 3, totsuCount: 3, fragments: 5, gacha: 10 }; // gacha: 封印ガチャ1回に使う欠片
  // レジェンドの凸 = 封印の8体の中でいちばん低い凸（8体全員が凸1ならレジェンドも凸1、全員凸5なら凸5）
  function legendTotsu(legend, friends) {
    return Math.min(...legend.seal.map(id => totsuOf(friends[id] || 0)));
  }
  // レジェンドの試練: 封印の地のステージで、決められたボス鬼を、決められたやり方で倒す
  const TRIALS = {
    ura:         { boss: 'kishin', desc: '鬼神を倒す' },
    songoku:     { boss: 'fuurai', desc: '風雷鬼を倒す' },
    nurarihyon:  { boss: 'white',  rule: 'unseen',   desc: '白鬼を、自分が一度も見回り鬼に見つからずに倒す' },
    jerseydevil: { boss: 'white',  rule: 'blizKill', desc: '白鬼を倒す（とどめは吹雪の中で）' },
    melusine:    { boss: 'gold',   rule: 'noDown',   desc: '金鬼を、チームのだれも倒れずに倒す' },
    curupira:    { boss: 'gold',   rule: 'dama100',  desc: '金鬼を倒すまでに、自分が鬼玉を100個集める' },
  };
  // r: ボスを倒した瞬間の { stage, boss, bossDown, seen: 自分が見回り鬼に見つかった, anyDown: だれかが倒れた, blizKill: 吹雪の中で倒した, dama: 自分の鬼玉 }
  function trialDone(legend, r) {
    const t = TRIALS[legend.id];
    if (!t || r.stage !== legend.stage || r.boss !== t.boss || !r.bossDown) return false;
    switch (t.rule) {
      case 'unseen': return !r.seen;
      case 'blizKill': return !!r.blizKill;
      case 'noDown': return !r.anyDown;
      case 'dama100': return r.dama >= 100;
      default: return true;
    }
  }
  // friends: { id: 数 }、seals: { legendId: { frag: 欠片の数, trial: レジェンドの試練をクリアしたか } }
  function sealProgress(legend, friends, seals) {
    const st = (seals && seals[legend.id]) || {};
    const got = legend.seal.filter(id => friends[id]).length;
    const totsu = legend.seal.filter(id => totsuOf(friends[id] || 0) >= SEAL.totsuNeed).length;
    const frag = Math.min(SEAL.fragments, st.frag || 0);
    const conds = [
      { label: '決められた妖怪8体をお友達にする', got, need: legend.seal.length },
      { label: `そのうち${SEAL.totsuCount}体を凸${SEAL.totsuNeed}以上にする`, got: Math.min(totsu, SEAL.totsuCount), need: SEAL.totsuCount },
      { label: `試練：「${STAGES_N[legend.stage]}」ステージで${TRIALS[legend.id].desc}`, got: st.trial ? 1 : 0, need: 1 },
      { label: `封印の欠片を${SEAL.fragments}個集める（「${STAGES_N[legend.stage]}」でボス鬼を倒すともらえる。強いボスほど多い）`, got: frag, need: SEAL.fragments },
    ];
    return { conds, ready: conds.every(c => c.got >= c.need) };
  }
  // 封印の欠片: 青鬼は3回に1個、黒鬼は必ず1個、金鬼・白鬼は2個、風雷鬼・鬼神は3個
  const SEAL_FRAG = { blue: 1 / 3, black: 1, gold: 2, white: 2, fuurai: 3, kishin: 3, gokuou: 3, hyakki: 3, yakubyo: 3, kage: 3, nue: 3, twin: 3, kyubi: 3, toki: 3, gasha: 3, amanojaku: 3 };
  // バトルの結果から、もらえる欠片と試練を決める（サーバーで使う）。r は trialDone と同じ
  function sealDrop(r, rnd = Math.random) {
    if (!r.bossDown) return null;
    const l = LEGENDS.find(x => x.stage === r.stage);
    if (!l) return null;
    const f = SEAL_FRAG[r.boss] || 0;
    const frag = f < 1 ? (rnd() < f ? 1 : 0) : f;
    const trial = trialDone(l, r);
    return frag || trial ? { legend: l.id, frag, trial } : null;
  }

  // ---------- 週替わりランキング ----------
  // 毎週月曜0時（日本時間）に1種類ずつ入れ替わる。第1回 = 2026年10月19日（月）からの週
  const WEEK_MS = 7 * 24 * 3600 * 1000;
  const WEEK_BASE = Date.UTC(2026, 9, 18, 15, 0, 0); // 2026-10-19 00:00 JST
  const weekIndex = (now = Date.now()) => Math.floor((now - WEEK_BASE) / WEEK_MS);
  const weekStart = idx => WEEK_BASE + idx * WEEK_MS;
  const THEME_ORDER = ['dama', 'bossTime', 'challenge', 'rescue', 'stealth', 'patrol', 'bossDmg', 'meister'];
  const STARTERS = ['nekomata', 'kasabou', 'chochin', 'hitodama'];
  function themeOf(idx) {
    const key = THEME_ORDER[((idx % THEME_ORDER.length) + THEME_ORDER.length) % THEME_ORDER.length];
    const round = Math.floor(idx / THEME_ORDER.length); // 何周目か（ボスやお題が毎回ちがう）
    const t = { key, idx, no: idx + 1 };
    switch (key) {
      case 'dama': return { ...t, icon: '🟣', name: '鬼玉ランキング', desc: '1週間に集めた鬼玉の合計で勝負！', unit: '個', crown: '鬼玉王' };
      case 'bossTime': {
        const boss = ['red', 'blue', 'red', 'black'][round % 4];
        return { ...t, icon: '⏱️', boss, name: `${BOSSES_N[boss]}討伐タイム`, desc: `${BOSSES_N[boss]}をひとりで倒すまでの最速タイムで勝負！（ひとりで出撃したときだけ記録・何回挑戦してもOK）`, lower: true, crown: `${BOSSES_N[boss]}討伐王` };
      }
      case 'challenge': {
        const stage = ['france', 'usa', 'china', 'brazil', 'japan', 'oni'][round % 6];
        const boss = ['red', 'blue', 'red', 'black', 'blue', 'red'][round % 6];
        const rule = ['noHealer', 'short'][round % 2];
        const ruleName = rule === 'noHealer' ? 'ヒーラー禁止' : '制限時間3分';
        return { ...t, icon: '🎯', stage, boss, rule, ruleName, name: `チャレンジ「${STAGES_N[stage]}×${BOSSES_N[boss]}」`, desc: `しばり：${ruleName}　1回のバトルで集めた鬼玉の最高記録で勝負！（ロビーで「今週のチャレンジ」を選んで出撃）`, unit: '個', crown: `${STAGES_N[stage]}の覇者` };
      }
      case 'rescue': return { ...t, icon: '🤝', name: '救助ランキング', desc: '倒れた仲間を起こした回数で勝負！', unit: '回', crown: '救助王' };
      case 'stealth': return { ...t, icon: '👻', name: '隠密ランキング', desc: '見回り鬼にもボス鬼にも見つからずに脱出した回数で勝負！', unit: '回', crown: '忍びの王' };
      case 'patrol': return { ...t, icon: '⚔️', name: '見回り鬼ハンター', desc: '倒した見回り鬼の数で勝負！', unit: '体', crown: '見回り鬼ハンター王' };
      case 'bossDmg': return { ...t, icon: '💥', name: 'ボスダメージ', desc: 'ボス鬼に与えたダメージの合計で勝負！', unit: '', crown: '破壊王' };
      default: {
        const yokai = STARTERS[round % STARTERS.length];
        const yn = (YOKAI_BY_ID[yokai] || {}).name;
        return { ...t, icon: '🦊', yokai, name: `妖怪マイスター「${yn}」`, desc: `${yn}をつれて出撃して集めた鬼玉の合計で勝負！`, unit: '個', crown: `${yn}マイスター` };
      }
    }
  }
  const fmtScore = (theme, v) => theme.lower ? `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}` : `${Math.round(v).toLocaleString('ja-JP')}${theme.unit}`;
  // 順位ごとの報酬（チケットは、ホームの「チケットガチャ」でその色の玉が必ず出る）
  // 第2回（idx 1）から: 1位 黒玉＋称号、2位 金玉、3位 赤玉、〜10位 青玉、それより下は緑玉（参加賞）
  function weeklyReward(rank, idx = weekIndex()) {
    if (idx >= 1) {
      if (rank === 1) return { ticket: 'black', title: true };
      if (rank === 2) return { ticket: 'gold' };
      if (rank === 3) return { ticket: 'red' };
    } else { // 第1回
      if (rank === 1) return { ticket: 'gold', title: true };
      if (rank <= 3) return { ticket: 'red' };
    }
    if (rank <= 10) return { ticket: 'blue' };
    return { ticket: 'green' }; // 参加賞
  }
  // その週の1位の称号（id は w + 週の番号）
  function weeklyTitle(id) {
    const m = /^w(\d{1,5})$/.exec(id || '');
    if (!m) return null;
    const th = themeOf(+m[1]);
    return { id, name: `第${th.no}回 ${th.crown}`, color: '#ffd23a', weekly: true, desc: `第${th.no}回 ${th.name} 1位` };
  }

  // ---------- ボス鬼 ----------
  // 赤鬼 → 青鬼 → 黒鬼 の順に、前の鬼を倒すと次の鬼に挑戦できる
  const BOSSES = {
    red:   { name: '赤鬼', color: '#c8242a', hp: 1.15, dmg: 1.2, atkGap: 0.85, warn: 1.0,  drop: 50,  need: null },
    blue:  { name: '青鬼', color: '#2a5ad8', hp: 1.75, dmg: 1.55, atkGap: 0.7, warn: 0.95, drop: 100, need: 'red' },
    black: { name: '黒鬼', color: '#2a2030', hp: 2.6, dmg: 1.95, atkGap: 0.56, warn: 0.85, drop: 150, need: 'blue' },
    // ここから先はチームで挑むボス（team: 1人・2人でも体力は3人分）
    gold:   { name: '金鬼',   color: '#e0b030', hp: 3.4, dmg: 2.2, atkGap: 0.52, warn: 0.8,  drop: 200, need: 'black', team: true },
    white:  { name: '白鬼',   color: '#e8f2ff', hp: 4.1, dmg: 2.4, atkGap: 0.5,  warn: 0.8,  drop: 230, need: 'gold',  team: true },
    fuurai: { name: '風雷鬼', color: '#38c8a0', hp: 4.4, dmg: 2.5, atkGap: 0.48, warn: 0.78, drop: 260, need: 'white', team: true },
    kishin: { name: '鬼神',   color: '#a01030', hp: 5.0, dmg: 2.7, atkGap: 0.45, warn: 0.75, drop: 300, need: 'fuurai', team: true },
    // 鬼神のあとの8体（gimmick: それぞれ特別な仕組みを持つ。乱入ボスには出てこない）
    yakubyo:   { name: '疫病鬼',     color: '#7a9a3a', hp: 6.0, dmg: 3.0, atkGap: 0.43, warn: 0.75, drop: 320, need: 'kishin',  team: true, gimmick: true },
    kage:      { name: '影鬼',       color: '#3a1a5a', hp: 6.0, dmg: 3.0, atkGap: 0.43, warn: 0.75, drop: 330, need: 'yakubyo', team: true, gimmick: true },
    nue:       { name: 'ぬえ鬼',     color: '#3a3048', hp: 6.5, dmg: 3.0, atkGap: 0.42, warn: 0.74, drop: 340, need: 'kage',    team: true, gimmick: true },
    twin:      { name: '双子鬼',     color: '#26b48c', hp: 3.3, dmg: 2.8, atkGap: 0.5,  warn: 0.75, drop: 360, need: 'nue',     team: true, gimmick: true, twinName: '風神鬼' }, // 体力は1体ぶん（2体いる）
    twin2:     { name: '雷神鬼',     color: '#e8b828', hp: 3.3, dmg: 2.8, atkGap: 0.5,  warn: 0.75, drop: 0,   team: true, hidden: true, secret: true }, // 双子鬼の片われ（選べない）
    kyubi:     { name: '九尾鬼',     color: '#f0d8a0', hp: 6.4, dmg: 3.0, atkGap: 0.42, warn: 0.73, drop: 370, need: 'twin',    team: true, gimmick: true },
    toki:      { name: '刻鬼',       color: '#3a6a8a', hp: 6.6, dmg: 3.0, atkGap: 0.42, warn: 0.73, drop: 380, need: 'kyubi',   team: true, gimmick: true, time: 360 },
    gasha:     { name: 'がしゃどくろ王', color: '#f2ead2', hp: 7.6, dmg: 3.2, atkGap: 0.48, warn: 0.8, drop: 400, need: 'toki',    team: true, gimmick: true },
    amanojaku: { name: '天邪鬼',     color: '#b03a8a', hp: 6.8, dmg: 3.2, atkGap: 0.4, warn: 0.72, drop: 420, need: 'gasha',   team: true, gimmick: true },
    // 隠しボス（hidden: 前のボスを倒した人にしか、ボス選びに出てこない。time: このボスだけの制限時間）
    gokuou: { name: '獄王',   color: '#8a0a0a', hp: 6.0, dmg: 3.0, atkGap: 0.42, warn: 0.72, drop: 350, need: 'kishin', team: true, hidden: true, time: 360 },
    hyakki: { name: '百鬼王', color: '#5a1a8a', hp: 5.5, dmg: 3.0, atkGap: 0.42, warn: 0.72, drop: 400, need: 'gokuou', team: true, hidden: true, time: 480,
              rush: ['red', 'blue', 'black', 'gold', 'white', 'fuurai', 'kishin'], rushHp: 1 / 3 }, // 7体を体力1/3で倒すと百鬼王が降ってくる
    shin:   { name: '鬼神・真', color: '#2a0014', hp: 5.5, dmg: 3.1, atkGap: 0.4, warn: 0.7, drop: 400, team: true, hidden: true, secret: true }, // 選べない（鬼神から覚醒する）
    matsuri_sp: { name: 'スペシャル祭りの鬼王', color: '#ffd23a', hp: 4.2, dmg: 2.4, atkGap: 0.5, warn: 0.78, drop: 600, team: true, hidden: true, secret: true }, // 祭りの鬼王のかわりに 10% で出る（たおすと提灯 600）
    matsuri: { name: '祭りの鬼王', color: '#ff5a3a', hp: 3.6, dmg: 2.2, atkGap: 0.52, warn: 0.8, drop: 250, need: null, team: true, event: true }, // 期間限定イベント「百鬼祭」のボス（期間中だけ選べる）
    tower:  { name: '鬼の塔', color: '#c8a0ff', hp: 1, dmg: 1, atkGap: 0.42, warn: 0.72, drop: 0, need: 'kishin', team: true, tower: true }, // 1階ずつボスを倒して登る（毎回1階から・終わりなし）
    sanki:  { name: '三鬼合戦', color: '#ff2a6a', hp: 1, dmg: 1, atkGap: 0.42, warn: 0.72, drop: 600, need: 'amanojaku', team: true, sanki: true, time: 420 }, // ボス鬼3体が同時に出る（超高難易度）
  };
  // 全部の鬼を少し強く（体力 +15%・攻撃 +12%）。上の表の数字はそのままにして、ここでまとめてかける
  const ONI_BUFF = { hp: 1.15, dmg: 1.12 };
  for (const k of Object.values(BOSSES)) { k.hp *= ONI_BUFF.hp; k.dmg *= ONI_BUFF.dmg; }
  // ---------- 鬼の塔 ----------
  // 1階＝ボス1体を倒せばクリア。毎回1階から、終わりなし。目安: 神3体で10階前後が限界
  const TOWER_CYCLE = ['red', 'blue', 'black', 'gold', 'white', 'fuurai', 'kishin', 'yakubyo', 'kage']; // 1〜9階（11〜19階…も同じ順で強くなる）
  const TOWER_CYCLE2 = ['nue', 'twin', 'kyubi', 'toki', 'gasha', 'amanojaku', 'gold', 'white', 'fuurai'];
  const TOWER_GATE = ['gokuou', 'hyakki', 'shin', 'sanki']; // 10階ごとの門番（40階は三鬼合戦）
  const TOWER = {
    boss(f) { if (f % 10 === 0) return TOWER_GATE[(f / 10 - 1) % TOWER_GATE.length]; const c = Math.floor(f / 10) % 2 ? TOWER_CYCLE2 : TOWER_CYCLE; return c[(f % 10) - 1]; },
    // 強さ（そのボスのふだんの強さにかける）。ボスごとの強さの差をならすため、もともと強いボスは少しおさえる
    hpMul(f, type) { const base = (BOSSES[type] || BOSSES.red).hp, want = 1.0 * Math.pow(1.13, f - 1) * (f % 10 === 0 ? 1.5 : 1); return want * 4 / Math.max(1.5, base); },
    dmgMul(f) { return 1.0 + 0.06 * (f - 1); }, // 目安: 神3体で10階前後が限界（前の19階の強さが10階くらい）
    time(f) { const t = TOWER.boss(f); return t === 'sanki' ? 300 : f % 10 === 0 ? 240 : f < 10 ? 120 : 150; },
    // しばり: 5階から1つ・15階から2つ・30階から3つ（週ごとに出方が変わる）
    MODS: {
      dark: '真っ暗', heal: '回復半分', fast: '鬼が速い', short: '時間が短い', regen: '鬼の体力が回復する', quick: '予告が短い', ult: '必殺技がたまりにくい', patrol: '見回り鬼2倍',
    },
    mods(f, week = 0) {
      const n = f >= 30 ? 3 : f >= 15 ? 2 : f >= 5 ? 1 : 0, keys = Object.keys(TOWER.MODS), r = rng(week * 1000 + f * 7919 + 13), out = [];
      while (out.length < n) { const k = keys[Math.floor(r() * keys.length)]; if (!out.includes(k)) out.push(k); }
      return out;
    },
    medals(f) { return f * f * 3; }, // その階をクリアしたときのメダル（上ほど一気に増える。10階まで登ると合計1,155枚）
    medalTotal(n) { let s = 0; for (let f = 1; f <= n; f++) s += TOWER.medals(f); return s; },
    // 節目のごほうび（届くたびに毎回）
    milestones(n) {
      const out = [];
      if (n >= 3) out.push({ f: 3, k: 'exp', v: 3000 });
      if (n >= 5) out.push({ f: 5, k: 'charm', v: 3 });
      if (n >= 7) out.push({ f: 7, k: 'ticket', v: 'gold' });
      if (n >= 10) { out.push({ f: 10, k: 'special', v: 1 }); out.push({ f: 10, k: 'charm', v: 4 }); out.push({ f: 10, k: 'frag', v: 3 }); }
      if (n >= 12) out.push({ f: 12, k: 'ticket', v: 'black' });
      for (let f = 15; f <= n; f += 5) out.push({ f, k: 'special', v: 2 });
      return out;
    },
    SHOP: [
      { id: 'exp', name: '経験値 5,000', price: 60 },
      { id: 'charm', name: 'お守りガチャ（金以上確定）', price: 300 },
      { id: 'frag', name: '神の欠片 ×1', price: 120 },
      { id: 'gold', name: '金玉チケット', price: 200 },
      { id: 'black', name: '黒玉チケット', price: 500 },
      { id: 'special', name: 'スペシャルガチャチケット', price: 1200 },
    ],
  };
  // ---------- 期間限定イベント「百鬼祭」 ----------
  // 祭りの鬼王のバトルで「祭り提灯」を集める。特攻妖怪（ランクが低いほど％が高い）とチームの人数で倍率がつく
  const EVENT = {
    id: 'matsuri2611', name: '月夜の百鬼祭', boss: 'matsuri',
    start: Date.UTC(2026, 10, 11, 3, 0), end: Date.UTC(2026, 10, 18, 3, 0), // 11/11 12:00 〜 11/18 12:00（日本時間）
    // 特攻妖怪20体（だれでも +100%。凸1つごとに +20%、凸MAXで +200%）
    boost: Object.fromEntries(['chochin', 'mamedanuki', 'kogitsune', 'sunekosuri', 'hitodama', 'chouchin2', 'taiko', 'kitsunemen', 'nekomusume', 'kijimuna',
      'kitsunebi', 'oni_child', 'hannya', 'kasha', 'tamamo', 'houou', 'shuten', 'amaterasu', 'ura', 'nurarihyon'].map(id => [id, 1.0])),
    boostPer: 0.2,
    boostOf(yokai, totsu = 0) { return EVENT.boost[yokai] ? EVENT.boost[yokai] + EVENT.boostPer * Math.max(0, Math.min(TOTSU_MAX, totsu | 0)) : 0; },
    team: [0, 0, 0.1, 0.2, 0.4], // チームの人数ごと（1人 +0%・2人 +10%・3人 +20%・4人 +40%）
    orb: 1, // 鬼玉 → 祭り提灯（拾った数がそのまま提灯。そのあと特攻・チームの倍率がかかる）
    lanOf(dama) { return Math.floor((dama || 0) * EVENT.orb); },
    get: { bossSp: 600 }, // スペシャル祭りの鬼王をたおすと、おまけで提灯 600（倍率つき）
    spRate: 0.1, // スペシャル祭りの鬼王が出る確率
    // ごほうび（届くたびにもらえる）。k: exp / ticket(gold,black,special,matsuri,legendSure,godSure) / charm(レア度) / frag / title
    rewards: [
      [200, [['exp', 5000]]], [500, [['ticket', 'gold']]], [1000, [['charm', 3]]], [2000, [['ticket', 'special']]], [3000, [['ticket', 'black']]],
      [4500, [['ticket', 'matsuri']]], [6000, [['charm', 4], ['exp', 30000]]], [8000, [['ticket', 'matsuri']]], [10000, [['title', 'matsuri1']]],
      [13000, [['ticket', 'matsuri', 2]]], [16000, [['ticket', 'special', 3]]], [20000, [['ticket', 'matsuri', 3]]], [25000, [['frag', 10]]],
      [30000, [['ticket', 'matsuri', 5]]], [40000, [['ticket', 'legendSure']]], [50000, [['ticket', 'matsuri', 5], ['exp', 100000]]],
      [60000, [['ticket', 'special', 5]]], [70000, [['frag', 20]]], [80000, [['ticket', 'legendSure']]], [90000, [['ticket', 'matsuri', 8]]],
      [100000, [['ticket', 'godSure'], ['title', 'matsuri2']]],
    ],
    every: 5000, // 100,000 から先は 5,000 ごとに祭りガチャ ×1
    active(now = Date.now()) { return now >= EVENT.start && now < EVENT.end; },
    mul(yokai, n, totsu = 0) { return 1 + EVENT.boostOf(yokai, totsu) + (EVENT.team[Math.min(4, n)] || 0); },
  };
  // スペシャルガチャ: S 96.9%・レジェンド 3%・神 0.1%（祭りガチャ: S 90%・レジェンド 9%・神 1%）
  const SPECIAL_ODDS = { god: 0.001, legend: 0.03 };
  const MATSURI_ODDS = { god: 0.01, legend: 0.09 };
  function rollSpecial(rnd = Math.random, odds = SPECIAL_ODDS) {
    if (odds === 'legend') return { kind: 'legend', y: LEGENDS[Math.floor(rnd() * LEGENDS.length)] };
    if (odds === 'god') return { kind: 'god', y: GODS[Math.floor(rnd() * GODS.length)] };
    const x = rnd();
    if (x < odds.god) return { kind: 'god', y: GODS[Math.floor(rnd() * GODS.length)] };
    if (x < odds.god + odds.legend) return { kind: 'legend', y: LEGENDS[Math.floor(rnd() * LEGENDS.length)] };
    const pool = YOKAI.filter(y => y.rank === 'S');
    return { kind: 'S', y: pool[Math.floor(rnd() * pool.length)] };
  }
  // お守りを決まったレア度で作る（交換所・塔のごほうび）
  function makeCharm(r, rnd = Math.random) {
    const R = CHARM_RARITY[r], s = [], used = new Set();
    for (let k = 0; k < R.n; k++) {
      const pool = Object.keys(CHARM_WEIGHT).filter(id => !used.has(id)), tot = pool.reduce((a, id) => a + CHARM_WEIGHT[id], 0);
      let y = rnd() * tot, id = pool[0];
      for (const q of pool) { if (y < CHARM_WEIGHT[q]) { id = q; break; } y -= CHARM_WEIGHT[q]; }
      used.add(id);
      s.push([id, CHARM_SKILLS[id].once ? 1 : R.lv[0] + Math.floor(rnd() * (R.lv[1] - R.lv[0] + 1))]);
    }
    return { r, s };
  }
  // BOSS_ORDER はセーブ（倒したボスのビット）の並び。新しいボスは必ず末尾に足す。ボス選びの並びは BOSS_LIST
  const BOSS_ORDER = ['red', 'blue', 'black', 'gold', 'white', 'fuurai', 'kishin', 'gokuou', 'hyakki', 'yakubyo', 'kage', 'nue', 'twin', 'kyubi', 'toki', 'gasha', 'amanojaku', 'sanki', 'tower', 'matsuri'];
  const BOSS_LIST = ['red', 'blue', 'black', 'gold', 'white', 'fuurai', 'kishin', 'yakubyo', 'kage', 'nue', 'twin', 'kyubi', 'toki', 'gasha', 'amanojaku', 'gokuou', 'hyakki', 'sanki', 'tower', 'matsuri'];
  const BOSSES_N = Object.fromEntries(Object.entries(BOSSES).map(([k, b]) => [k, b.name]));
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
  const STAGES_N = { oni: '鬼の世界', japan: '日本', france: 'フランス', brazil: 'ブラジル', china: '中国', usa: 'アメリカ' };
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

  // ---- 建物の場所の索引（近くの建物だけを調べて速くする。結果は全部調べたときと同じ） ----
  const BCELL = 300;
  function bIndex(map) {
    if (map._bi) return map._bi;
    const cols = Math.ceil(map.w / BCELL) + 1, rows = Math.ceil(map.h / BCELL) + 1;
    const cells = Array.from({ length: cols * rows }, () => []);
    map.buildings.forEach((b, i) => {
      for (let cy = Math.max(0, Math.floor(b.y / BCELL)); cy <= Math.min(rows - 1, Math.floor((b.y + b.h) / BCELL)); cy++)
        for (let cx = Math.max(0, Math.floor(b.x / BCELL)); cx <= Math.min(cols - 1, Math.floor((b.x + b.w) / BCELL)); cx++) cells[cy * cols + cx].push(i);
    });
    return (map._bi = { cols, rows, cells, mark: new Uint32Array(map.buildings.length), stamp: 0, out: [] });
  }
  // 四角 (x0,y0)-(x1,y1) にかかるかもしれない建物の番号（小さい順）
  function nearIdx(map, x0, y0, x1, y1) {
    const ix = bIndex(map), out = ix.out;
    out.length = 0;
    if (++ix.stamp === 0xffffffff) { ix.mark.fill(0); ix.stamp = 1; }
    const c0 = Math.max(0, Math.floor(Math.min(x0, x1) / BCELL)), c1 = Math.min(ix.cols - 1, Math.floor(Math.max(x0, x1) / BCELL));
    const r0 = Math.max(0, Math.floor(Math.min(y0, y1) / BCELL)), r1 = Math.min(ix.rows - 1, Math.floor(Math.max(y0, y1) / BCELL));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) for (const i of ix.cells[r * ix.cols + c]) if (ix.mark[i] !== ix.stamp) { ix.mark[i] = ix.stamp; out.push(i); }
    return out;
  }

  // 円をマップ外と建物から押し出す（建物は90くらいなので、全部見るほうが速い）
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
  // 索引のマスを、線が通る行ごとに通る範囲だけ見る（長い線でも斜めの四角全体は見ない。結果は全部調べたときと同じ）
  function lineOfSight(map, a, b) {
    const ix = bIndex(map), bs = map.buildings, mark = ix.mark;
    if (++ix.stamp === 0xffffffff) { mark.fill(0); ix.stamp = 1; }
    const st = ix.stamp, dx = b.x - a.x, dy = b.y - a.y;
    const ymin = Math.min(a.y, b.y), ymax = Math.max(a.y, b.y);
    const r0 = Math.max(0, Math.floor(ymin / BCELL)), r1 = Math.min(ix.rows - 1, Math.floor(ymax / BCELL));
    for (let r = r0; r <= r1; r++) {
      let xa = a.x, xb = b.x;
      if (dy !== 0) {
        const ya = Math.max(ymin, r * BCELL), yb = Math.min(ymax, (r + 1) * BCELL);
        xa = a.x + dx * (ya - a.y) / dy; xb = a.x + dx * (yb - a.y) / dy;
      }
      // 計算の誤差でマスの境目を取りこぼさないよう、左右に1ずつ広めに見る
      const c0 = Math.max(0, Math.floor((Math.min(xa, xb) - 1) / BCELL)), c1 = Math.min(ix.cols - 1, Math.floor((Math.max(xa, xb) + 1) / BCELL));
      for (let c = c0; c <= c1; c++) for (const i of ix.cells[r * ix.cols + c]) {
        if (mark[i] === st) continue;
        mark[i] = st;
        if (segRect(a.x, a.y, b.x, b.y, bs[i])) return false;
      }
    }
    return true;
  }
  function segRect(x0, y0, x1, y1, r) {
    let t0 = 0, t1 = 1;
    const dx = x1 - x0, dy = y1 - y0;
    // 4つの辺について順に（配列を作らずに）
    for (let i = 0; i < 4; i++) {
      const p = i === 0 ? -dx : i === 1 ? dx : i === 2 ? -dy : dy;
      const q = i === 0 ? x0 - r.x : i === 1 ? r.x + r.w - x0 : i === 2 ? y0 - r.y : r.y + r.h - y0;
      if (p === 0) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  }

  function isFree(map, x, y, r) {
    if (x < r || y < r || x > map.w - r || y > map.h - r) return false;
    const bs = map.buildings;
    for (const i of nearIdx(map, x - r, y - r, x + r, y + r)) {
      const b = bs[i];
      if (x > b.x - r && x < b.x + b.w + r && y > b.y - r && y < b.y + b.h + r) return false;
    }
    return true;
  }

  return { EVENT, MATSURI_ODDS, TOWER, rollSpecial, makeCharm, SPECIAL_ODDS, CHARM_SKILLS, CHARM_RARITY, CHARM_MAX, charmOdds, rollCharm, charmEffects, charmName, charmText, RANKS, ROLES, YOKAI, LEGENDS, GODS, GOD_FRAG, SEAL, legendTotsu, TRIALS, trialDone, sealProgress, sealDrop, YOKAI_BY_ID, yokaiStats, LV_MAX, LV_STEP, EXP_MUL, SEAL_PICK, PICK_ANY, PICK_COPIES, expForLv, lvOf, BALLS, ballOdds, rollBall, TOTSU_MAX, TOTSU_STEP, totsuOf, FULL_COUNT, OVER_EXP, TITLES, TITLE_BY_ID, titleProgress, weekIndex, weekStart, WEEK_MS, themeOf, fmtScore, weeklyReward, weeklyTitle, BOSSES, BOSS_ORDER, BOSS_LIST, bossUnlocked, STAGES, STAGE_KEYS, pickStage, ITEMS, MAP_W, MAP_H, CELL, generateCity, collide, lineOfSight, isFree, rng };
});
