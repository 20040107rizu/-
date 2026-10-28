// 攻撃の種類と、妖怪ごとの攻撃の割り当て（サーバーとクライアントで共有）
// 通常攻撃 NORMAL × 強攻撃 STRONG × 属性 ELEMENT の組み合わせを、できるだけ全員違うように割り当てる。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./yokai.js'));
  else root.Attacks = factory(root.YokaiList);
})(typeof self !== 'undefined' ? self : this, function (YOKAI) {
  'use strict';

  // 通常攻撃: range は自動で狙う距離、cd は間隔（秒）、dmg はタイプの攻撃力に掛ける倍率
  const NORMAL = {
    slash:      { label: '斬撃',       range: 85,  cd: 0.35, dmg: 1.0 },
    thrust:     { label: '突き',       range: 130, cd: 0.45, dmg: 1.25 },
    combo:      { label: '三連撃',     range: 80,  cd: 0.26, dmg: 0.5 },  // 3回目が2倍
    spin:       { label: '回転斬り',   range: 95,  cd: 0.5,  dmg: 1.2 },
    wave:       { label: '衝撃波',     range: 160, cd: 0.7,  dmg: 1.1 },
    drainHit:   { label: '吸血斬り',   range: 85,  cd: 0.4,  dmg: 0.9 },  // 与えたダメージの15%回復
    slam:       { label: '叩きつけ',   range: 110, cd: 0.6,  dmg: 1.45 },
    bolt:       { label: '弾',         range: 520, cd: 0.3,  dmg: 1.0 },
    spread:     { label: '散弾',       range: 300, cd: 0.55, dmg: 0.7 },
    orb:        { label: '貫通弾',     range: 450, cd: 0.7,  dmg: 1.4 },
    boomerang:  { label: 'ブーメラン', range: 380, cd: 0.6,  dmg: 1.0 },
    homing:     { label: '追尾弾',     range: 520, cd: 0.45, dmg: 0.9 },
    beam:       { label: '光線',       range: 420, cd: 0.65, dmg: 1.2 },
    lob:        { label: '投てき',     range: 380, cd: 0.7,  dmg: 1.5 },
    chain:      { label: '連鎖弾',     range: 420, cd: 0.6,  dmg: 1.0 },  // 近くの敵に1回はねる
    needle:     { label: '連射',       range: 460, cd: 0.15, dmg: 0.45 },
    bounce:     { label: '反射弾',     range: 460, cd: 0.45, dmg: 1.0 },  // 壁で2回はねる
    healShot:   { label: '癒やし弾',   range: 420, cd: 0.5,  dmg: 0.8 },  // 仲間に当たると回復
    healBeam:   { label: '癒やしの光線', range: 400, cd: 0.7, dmg: 1.0 },
    healLob:    { label: '癒やしの雫', range: 360, cd: 0.8,  dmg: 1.2 },
    healHoming: { label: '癒やしの蛍', range: 460, cd: 0.5,  dmg: 0.8 },
    healOrb:    { label: '癒やしの玉', range: 420, cd: 0.75, dmg: 1.2 },
  };

  // 強攻撃: cd は間隔（秒）、range は狙う距離
  const STRONG = {
    dashSlash:   { label: '突進斬り',     cd: 5,  range: 260 },
    drain:       { label: '吸収斬り',     cd: 6,  range: 120 },  // 与えたダメージの40%回復
    leap:        { label: '大ジャンプ',   cd: 7,  range: 320 },
    blink:       { label: '瞬間移動斬り', cd: 6,  range: 280 },
    tornado:     { label: '竜巻',         cd: 8,  range: 400 },
    flurry:      { label: '乱れ斬り',     cd: 6,  range: 120 },
    quake:       { label: '地割れ',       cd: 7,  range: 170 },
    charge:      { label: '体当たり',     cd: 6,  range: 300 },
    shieldBash:  { label: '盾の一撃',     cd: 6,  range: 130 },  // 見回り鬼をしびれさせる
    vortex:      { label: '吸い込み',     cd: 8,  range: 260 },
    freeze:      { label: '鈍化の波動',   cd: 9,  range: 220 },  // 敵を遅くする
    meteor:      { label: '隕石',         cd: 9,  range: 420 },
    healZone:    { label: '回復エリア',   cd: 8,  range: 0 },
    lifeLink:    { label: '命の絆',       cd: 12, range: 0 },    // 仲間全員を回復
    regenAura:   { label: '癒やしのオーラ', cd: 10, range: 0 },  // 自分と一緒に動く回復の輪
    drainBeam:   { label: '吸収光線',     cd: 7,  range: 450 },
    triple:      { label: '三連射',       cd: 5,  range: 520 },
    laser:       { label: '極太レーザー', cd: 8,  range: 600 },
    barrage:     { label: '全方位弾',     cd: 7,  range: 300 },
    multiHoming: { label: '追尾ミサイル', cd: 8,  range: 600 },
    thunder:     { label: '落雷',         cd: 8,  range: 520 },
    poison:      { label: '霧',           cd: 9,  range: 380 },  // その場に残ってダメージ
    turret:      { label: '砲台設置',     cd: 11, range: 500 },
  };

  // 属性: 当たったときの追加効果
  const ELEMENT = {
    fire:    { name: '炎', adj: '紅蓮',   color: '#ff6a2a', effect: '燃えて少しずつダメージ' },
    ice:     { name: '氷', adj: '氷結',   color: '#8ad8ff', effect: '敵が遅くなる' },
    thunder: { name: '雷', adj: '迅雷',   color: '#ffe14a', effect: '鬼が一瞬しびれる（ボス鬼は2秒に1回まで）' },
    wind:    { name: '風', adj: '疾風',   color: '#7af0b0', effect: '鬼を吹き飛ばす（ボス鬼は少しだけ）' },
    water:   { name: '水', adj: '激流',   color: '#4a9aff', effect: '敵が少し遅くなる' },
    dark:    { name: '闇', adj: '常闇',   color: '#b06aff', effect: 'ダメージの一部を吸収' },
    light:   { name: '光', adj: '閃光',   color: '#fff6a0', effect: 'ボス鬼に大ダメージ' },
    earth:   { name: '土', adj: '岩砕',   color: '#c8a060', effect: '鬼に追加ダメージ' },
    flower:  { name: '花', adj: '花吹雪', color: '#ff9ad8', effect: '近くの仲間を少し回復' },
    poison:  { name: '毒', adj: '猛毒',   color: '#9ad04a', effect: '毒で少しずつダメージ' },
  };

  const ROLE_NORMAL = {
    fighter: ['slash', 'thrust', 'combo', 'spin', 'wave', 'drainHit', 'slam'],
    tank:    ['slam', 'spin', 'wave', 'slash', 'thrust', 'drainHit'],
    healer:  ['healShot', 'healBeam', 'healLob', 'healHoming', 'healOrb'],
    ranger:  ['bolt', 'spread', 'orb', 'boomerang', 'homing', 'beam', 'lob', 'chain', 'needle', 'bounce'],
  };
  const ROLE_STRONG = {
    fighter: ['dashSlash', 'drain', 'leap', 'blink', 'tornado', 'flurry', 'shieldBash'],
    tank:    ['quake', 'charge', 'shieldBash', 'vortex', 'freeze', 'meteor', 'leap'],
    healer:  ['healZone', 'lifeLink', 'regenAura', 'drainBeam', 'freeze', 'barrage'],
    ranger:  ['triple', 'laser', 'barrage', 'multiHoming', 'meteor', 'thunder', 'poison', 'turret', 'tornado'],
  };

  // スキルボタン（タイプごと）
  const SKILL = {
    fighter: { key: 'dodge',  label: '回避',   cd: 2.5, desc: '素早くステップ。その間は攻撃を受けない' },
    healer:  { key: 'buff',   label: '強化',   cd: 16,  desc: '近くの仲間の攻撃力と速さを8秒アップ（重ねがけなし）' },
    tank:    { key: 'shield', label: 'シールド', cd: 10, desc: '4秒間、受けるダメージを大きく減らす（重ねがけなし）' },
    ranger:  { key: 'bomb',   label: '爆弾',   cd: 7,   desc: '狙った方向に爆弾を投げる（仲間は巻き込まない）' },
  };

  // 最初の16体は見た目に合わせて手で決める
  const HAND = {
    nekomata:   ['combo', 'flurry', 'fire'],
    kasabou:    ['spin', 'shieldBash', 'water'],
    chochin:    ['healLob', 'healZone', 'fire'],
    hitodama:   ['homing', 'triple', 'ice'],
    kappado:    ['thrust', 'dashSlash', 'water'],
    nurikabe:   ['slam', 'quake', 'earth'],
    yukinko:    ['healShot', 'freeze', 'ice'],
    tenguri:    ['boomerang', 'tornado', 'wind'],
    raijin:     ['combo', 'leap', 'thunder'],
    gashadoku:  ['slash', 'vortex', 'dark'],
    hakutaku:   ['healBeam', 'lifeLink', 'light'],
    kitsunebi:  ['chain', 'meteor', 'fire'],
    susanoo:    ['wave', 'tornado', 'wind'],
    daidara:    ['slam', 'meteor', 'earth'],
    amaterasu:  ['healOrb', 'regenAura', 'light'],
    yatagarasu: ['needle', 'multiHoming', 'light'],
  };

  // 伝承に合わせて決める属性
  const EL_FIX = {
    vampire: 'dark', werewolf: 'dark', banshee: 'dark', bogey: 'dark', ghoul: 'dark', llorona: 'water', mummy: 'earth',
    kraken: 'water', kraken2: 'water', leviathan: 'water', umibozu: 'water', amabie: 'water', mermaid: 'water', mamiwata: 'water', selkie: 'water', kelpie: 'water', bunyip: 'water', namazu: 'water', kawauso: 'water',
    phoenix: 'fire', houou: 'fire', ifrit: 'fire', kasha: 'fire', cerberus: 'fire', wisp: 'fire', enma: 'fire', shuten: 'fire',
    fenrir: 'ice', yeti: 'ice', yukijo: 'ice', sleipnir: 'wind', garuda: 'wind', griffin: 'wind', harpy: 'wind', kamikaze: 'wind', ootengu: 'wind',
    jormungand: 'poison', medusa: 'poison', basilisk: 'poison', hydra: 'poison', orochi: 'poison', nidhogg: 'dark', jorogumo: 'poison', anansi: 'poison', chupacabra: 'poison',
    raiden: 'thunder', raiju: 'thunder', thunderbird: 'thunder', impundulu: 'thunder', nue: 'thunder',
    unicorn: 'light', kirin: 'light', valkyrie: 'light', bastet: 'light', sphinx: 'earth', anubis: 'dark',
    golem: 'earth', titan: 'earth', troll: 'earth', gargoyle: 'earth', dwarf: 'earth', minotaur: 'earth', behemoth: 'earth', bigfoot: 'earth', mapinguari: 'earth', genbu: 'water', seiryu: 'wind', byakko: 'wind',
    oberon: 'flower', pixie: 'flower', elf: 'flower', kodama: 'flower', kodamaB: 'flower', zashiko: 'flower', duende: 'flower', kinoko: 'poison', pumpkin: 'fire',
  };
  // 体の形ごとの属性
  const EL_TYPE = { golem: 'earth', fish: 'water', ghost: 'dark', skull: 'dark', bug: 'poison', bird: 'wind', blob: 'water', plant: 'flower' };

  // 伝承・体の形・色から属性を決める
  function elementOf(y) {
    if (EL_FIX[y.id]) return EL_FIX[y.id];
    const fx = (/fx=(\w+)/.exec(y.look || '') || [])[1];
    if (fx === 'fire') return 'fire';
    if (fx === 'ice') return 'ice';
    if (fx === 'spark') return 'thunder';
    if (fx === 'leaf') return 'wind';
    if (fx === 'star') return 'light';
    const t = (/t=(\w+)/.exec(y.look || '') || [])[1];
    if (EL_TYPE[t]) return EL_TYPE[t];
    const n = parseInt(y.color.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 510;
    if (l > 0.85) return 'light';
    if (l < 0.22) return 'dark';
    if (max - min < 40) return l > 0.5 ? 'wind' : 'earth';
    const h = max === r ? ((g - b) / (max - min) + 6) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
    if (h < 0.4 || h >= 5.6) return 'fire';
    if (h < 0.9) return r > 160 && g > 100 && b < 90 ? 'earth' : 'fire';
    if (h < 1.4) return 'thunder';
    if (h < 2.4) return 'poison';
    if (h < 3.3) return 'wind';
    if (h < 3.8) return 'ice';
    if (h < 4.4) return 'water';
    if (h < 5.0) return 'dark';
    return 'flower';
  }

  function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  // 割り当て: 同じタイプの中で、使われた回数が少ない組み合わせから選ぶ
  const BY_ID = {};
  const used = {};
  for (const y of YOKAI) {
    let n, s, el;
    if (HAND[y.id]) [n, s, el] = HAND[y.id];
    else {
      el = elementOf(y);
      let best = null, bestScore = Infinity;
      const ns = ROLE_NORMAL[y.role], ss = ROLE_STRONG[y.role];
      const h = hash(y.id);
      for (let i = 0; i < ns.length; i++) for (let j = 0; j < ss.length; j++) {
        const a = ns[(i + h) % ns.length], b = ss[(j + (h >>> 8)) % ss.length];
        const score = (used[a + '|' + b] || 0) * 100 + (used[a + '|' + b + '|' + el] || 0) * 1000 + (used['n|' + a] || 0) + (used['s|' + b] || 0);
        if (score < bestScore) { bestScore = score; best = [a, b]; }
      }
      [n, s] = best;
    }
    for (const k of [n + '|' + s, n + '|' + s + '|' + el, 'n|' + n, 's|' + s]) used[k] = (used[k] || 0) + 1;
    const E = ELEMENT[el];
    BY_ID[y.id] = {
      normal: n, strong: s, el,
      normalName: `${E.name}の${NORMAL[n].label}`,
      strongName: `${E.adj}の${STRONG[s].label}`,
    };
  }

  // レジェンドは決まった攻撃
  for (const l of (YOKAI.LEGENDS || []).concat(YOKAI.GODS || [])) {
    const E = ELEMENT[l.el];
    BY_ID[l.id] = { normal: l.normal, strong: l.strong, el: l.el, normalName: `${E.name}の${NORMAL[l.normal].label}`, strongName: `${E.adj}の${STRONG[l.strong].label}`, ult: l.ult, ultName: l.ultName };
  }
  function of(id) { return BY_ID[id] || BY_ID[YOKAI[0].id]; }

  return { NORMAL, STRONG, ELEMENT, SKILL, of };
});
