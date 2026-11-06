#!/usr/bin/env node
// 生成AIで作った絵（incoming-art/ … art-upload ブランチ）を、ゲーム用の大きさにそろえて public/art/ に入れる
//   node tools/import-art.js <incoming-art のフォルダ> [--only=yokai/,oni/]
// ・キャラ: まわりの透明な所を切りとって、足もとを下から8%の線に合わせ、正方形にする（drawSprite の決まり）
// ・アイコン・エフェクト: まん中にそろえる
// ・タイル（屋根・地面）: そのまま縮小（つなぎ目が合うように）
// 入れた絵の名前は public/art/ai.json に記録する（npm run draw でSVGの絵に上書きされないように）
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) { console.error('使い方: node tools/import-art.js <incoming-art のフォルダ>'); process.exit(1); }
const only = ((process.argv.find(a => a.startsWith('--only=')) || '').slice(7)).split(',').filter(Boolean);
const ART = path.join(__dirname, '..', 'public', 'art');

// フォルダごとの決まり: [出力フォルダ, 大きさ, やり方]
//  feet: 足もとを合わせる / center: まん中 / tile: そのまま縮小 / cover: 横長の背景
const RULES = {
  yokai: ['yokai', 256, 'feet'],
  oni: ['oni', 384, 'feet'],
  item: ['item', 128, 'center'],
  ult: ['ult', 320, 'feet'],
  fx: ['fx', 256, 'center'],
  oni_fx: ['oni_fx', 256, 'center'],
  icon: ['icon', 128, 'center'],
  'scene/tile': ['scene', 256, 'tile'],
  'scene/landmark': ['scene', 512, 'center'],
  title: ['title', 0, 'keep'],
  gacha: ['gacha', 0, 'keep'],
  ui: ['ui', 0, 'keep'],
  bg: ['bg', 1280, 'cover'],
};
const SKIP = new Set(['icon/orb.png']); // 鬼玉の絵は今のまま（プログラムで描く）
const SIZE_OF = { 'oni/patrol': 256, 'title/logo': 800, 'title/bg': 1600, 'title/oni_peek': 512, 'gacha/bg': 1280, 'gacha/machine': 640 };

async function trim(buf) {
  // 透明な所を切りとる（ほとんど透明なふちも切る）
  const img = sharp(buf).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return { buf, w: info.width, h: info.height };
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  return { buf: await sharp(buf).extract({ left: x0, top: y0, width: w, height: h }).png().toBuffer(), w, h };
}

async function place(buf, size, mode) {
  const t = await trim(buf);
  // feet: 高さは 88%（頭の上に少し余白）・幅は 96% まで。足もとは下から 8%
  const maxW = size * (mode === 'feet' ? 0.96 : 0.92), maxH = size * (mode === 'feet' ? 0.88 : 0.92);
  const k = Math.min(maxW / t.w, maxH / t.h);
  const w = Math.max(1, Math.round(t.w * k)), h = Math.max(1, Math.round(t.h * k));
  const inner = await sharp(t.buf).resize(w, h, { kernel: 'lanczos3' }).png().toBuffer();
  const left = Math.round((size - w) / 2);
  const top = mode === 'feet' ? Math.round(size * 0.92 - h) : Math.round((size - h) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: inner, left, top }]).png({ compressionLevel: 9, palette: true, quality: 92, effort: 8 }).toBuffer();
}

(async () => {
  const files = [];
  const walk = dir => { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.png$/i.test(f)) files.push(path.relative(SRC, p).split(path.sep).join('/')); } };
  walk(SRC);
  const aiPath = path.join(ART, 'ai.json');
  const ai = new Set(fs.existsSync(aiPath) ? JSON.parse(fs.readFileSync(aiPath, 'utf8')) : []);
  let n = 0;
  for (const rel of files.sort()) {
    if (SKIP.has(rel) || rel.startsWith('extra/')) continue;
    if (only.length && !only.some(o => rel.startsWith(o))) continue;
    const parts = rel.split('/');
    let ruleKey = parts[0], outRel = rel;
    if (parts[0] === 'scene') { ruleKey = /landmark/.test(parts[2]) ? 'scene/landmark' : 'scene/tile'; }
    const rule = RULES[ruleKey];
    if (!rule) { console.log('? しらないフォルダ', rel); continue; }
    const [, defSize, mode] = rule;
    const key = outRel.replace(/\.png$/i, '');
    const size = SIZE_OF[key] || defSize;
    const src = fs.readFileSync(path.join(SRC, rel));
    let out;
    if (mode === 'feet' || mode === 'center') out = await place(src, size, mode);
    else if (mode === 'tile') out = await sharp(src).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9, palette: true, quality: 92 }).toBuffer();
    else if (mode === 'cover') out = await sharp(src).resize(size, Math.round(size / 2), { fit: 'cover' }).jpeg({ quality: 82 }).toBuffer();
    else { // keep: 大きいものだけ縮める
      const m = await sharp(src).metadata();
      const target = size || Math.min(m.width, 768);
      out = await sharp(src).resize({ width: Math.min(m.width, target), withoutEnlargement: true }).png({ compressionLevel: 9, palette: true, quality: 92 }).toBuffer();
    }
    const ext = mode === 'cover' ? '.jpg' : '.png';
    const dest = path.join(ART, key + ext);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // 同じ名前の .png/.jpg がもう一方にあれば消す（manifest が2つにならないように）
    const other = path.join(ART, key + (ext === '.png' ? '.jpg' : '.png'));
    if (fs.existsSync(other)) fs.unlinkSync(other);
    fs.writeFileSync(dest, out);
    ai.add(key);
    n++;
    if (n % 25 === 0) console.log(n, '枚…');
  }
  fs.writeFileSync(aiPath, JSON.stringify([...ai].sort(), null, 1) + '\n');
  console.log(`取りこみ: ${n}枚`);
})();
