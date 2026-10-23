// 生成AI（Gemini）で作る絵の一覧と指示文
// key: 保存先（public/art/<key>.png）、kind: sprite=背景を抜いて切り抜く / image=そのまま / tile=繰り返し模様
const S = require('../public/shared.js');

// 全部の絵で共通の絵柄
const STYLE = 'Cute Japanese anime game art in the style of a colorful mobile game, chibi proportions, thick clean dark outlines, cel shading, vivid saturated colors, playful and spooky-cute yokai theme. Original character design, not based on any existing franchise.';
const SPRITE_BG = 'Full body, single character, centered, facing the viewer at a slight three-quarter angle, on a perfectly flat solid pure green (#00FF00) background with no gradient, no ground shadow, no text, no border.';

const RANK_FLAIR = {
  C: 'simple design, small and humble',
  B: 'a bit cooler design with one accessory',
  A: 'impressive design with glowing effects and armor or ornaments',
  S: 'legendary, majestic design with a golden glowing aura, elaborate ornaments, very powerful looking',
};

// 妖怪ごとの見た目
const YOKAI_LOOK = {
  nekomata:   'a mischievous orange cat yokai with two tails, standing on hind legs, raising tiny clawed fists ready to fight',
  kasabou:    'a one-eyed paper umbrella yokai (kasa-obake) with one leg and a long tongue, sturdy and brave, holding up its umbrella like a shield',
  chochin:    'a cheerful paper lantern yokai (chochin-obake) glowing warm orange, with a big smile and tiny arms, gentle healer',
  hitodama:   'a pale blue will-o-wisp ghost flame yokai with big round eyes, floating, shooting little blue fireballs',
  kappado:    'a green kappa yokai warrior with a water dish on its head and a turtle shell, holding a cucumber-shaped short sword',
  nurikabe:   'a big friendly wall yokai (nurikabe) made of grey plaster and stone bricks, with stubby arms and a determined face',
  yukinko:    'a small snow girl yokai (yuki-onna child) in a white and light blue kimono with snowflakes swirling around her, healing',
  tenguri:    'a young red-faced tengu yokai with a long nose, small black wings and a feather fan, aiming a fan gust',
  raijin:     'a young thunder god oni boy with yellow hair, drum ring on his back, crackling lightning on his fists',
  gashadoku:  'a giant skeleton yokai (gashadokuro) in samurai armor, glowing blue eyes, holding a huge bone shield',
  hakutaku:   'a gentle white mythical beast princess yokai (hakutaku) with many eyes on her robes, horns and healing light',
  kitsunebi:  'a nine-tailed fox yokai with orange fur and floating fox-fire flames around her tails, holding a bow made of fire',
  susanoo:    'a legendary storm god warrior yokai with flowing blue hair, a magnificent sword and swirling wind and waves',
  daidara:    'a colossal mountain giant yokai (daidarabotchi) with a body of earth and trees, enormous fists, ancient and calm',
  amaterasu:  'a radiant sun goddess yokai with a golden halo, mirror and flowing white and red robes, holy healing light',
  yatagarasu: 'a mythical three-legged black crow yokai with a divine golden sun emblem, majestic wings spread, shooting light feathers',
};

function list() {
  const out = [];
  for (const y of S.YOKAI) {
    out.push({
      key: `yokai/${y.id}`, kind: 'sprite', size: 256,
      prompt: `${STYLE} ${SPRITE_BG} The character: ${YOKAI_LOOK[y.id]}. Rank ${y.rank}: ${RANK_FLAIR[y.rank]}. Main color ${y.color}.`,
    });
  }
  out.push({ key: 'oni/patrol', kind: 'sprite', size: 256, prompt: `${STYLE} ${SPRITE_BG} The character: a blue-skinned patrol oni guard with one horn, wearing a happi coat and holding a whistle in its mouth and a lantern, looking around suspiciously.` });
  out.push({ key: 'oni/boss', kind: 'sprite', size: 384, prompt: `${STYLE} ${SPRITE_BG} The character: a huge intimidating red boss oni with two big horns, tiger-skin loincloth, a giant spiked iron club (kanabo), angry glowing yellow eyes, fangs, scary but still cute game boss.` });

  const ITEM_LOOK = {
    trap: 'an electric trap device: a round metal pad with yellow lightning sparks',
    bomb: 'a classic round black bomb with a lit fuse and a little skull mark',
    punch: 'a big silver robot fist punching forward with motion lines',
    stamina: 'an energy drink bottle glowing cyan with a lightning bolt label (no letters)',
    onigiri: 'a fluffy rice ball onigiri wrapped with nori seaweed, with a happy face',
    jimmy: 'a purple translucent invisibility bubble field with sparkles',
  };
  for (const [id, look] of Object.entries(ITEM_LOOK)) {
    out.push({ key: `item/${id}`, kind: 'sprite', size: 128, prompt: `${STYLE} A single game item icon, centered, on a perfectly flat solid pure green (#00FF00) background, no text, no border. The item: ${look}.` });
  }

  out.push({ key: 'scene/title-bg', kind: 'image', aspect: '16:9', width: 1600, prompt: `${STYLE} Wide landscape background illustration for a game title screen: a spooky-cute Japanese yokai town at night, a big red full moon, a five-story pagoda, traditional houses with curved tiled roofs, glowing red paper lanterns on strings, purple fog, floating glowing pink orbs. A giant red oni with glowing yellow eyes peeking from behind the town on the left side. Leave the upper center and the bottom center calm and simple for a logo and buttons. No text, no letters, no logo.` });
  out.push({ key: 'scene/roof', kind: 'tile', size: 256, prompt: `${STYLE} Seamless tileable top-down texture of a dark purple traditional Japanese tiled roof (kawara), viewed straight from above, evenly lit, no perspective, no text.` });
  out.push({ key: 'scene/ground', kind: 'tile', size: 256, prompt: `${STYLE} Seamless tileable top-down texture of dark purple-grey cobblestone street pavement at night, viewed straight from above, evenly lit, subtle, low contrast, no perspective, no text.` });
  out.push({ key: 'icon/app', kind: 'image', aspect: '1:1', width: 1024, prompt: `${STYLE} A mobile game app icon: a cute but fierce red oni face mascot with two cream horns, glowing yellow eyes and small fangs, a glowing pink orb beside it, on a deep purple night sky background with a red moon. Bold, readable at small sizes, centered, no text, no letters, no border.` });
  return out;
}

module.exports = { list };
