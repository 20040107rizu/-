#!/usr/bin/env node
// 生成AI（Gemini の画像生成 = Nano Banana）でゲームの絵を作り、public/art/ に保存する
//
// 使い方:
//   GEMINI_API_KEY=... npm run art               まだ無い絵だけ作る
//   npm run art -- --force                       全部作り直す
//   npm run art -- --only=yokai/nekomata         指定したものだけ（前方一致、カンマ区切り可）
//   npm run art -- --list                        作る絵の一覧と指示文を表示
//   npm run art -- --process-only                tools/raw/ の元画像から加工だけやり直す（APIは使わない）
//
// 環境変数: GEMINI_API_KEY（必須）、GEMINI_IMAGE_MODEL（省略時 gemini-2.5-flash-image）
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { list } = require('./art-prompts');

const ROOT = path.join(__dirname, '..');
const RAW_DIR = path.join(__dirname, 'raw');
const ART_DIR = path.join(ROOT, 'public', 'art');
const ICON_DIR = path.join(ROOT, 'public', 'icons');
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const only = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);

// ---------- Gemini API ----------
async function generate(item, refImage) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY が設定されていません');
  const parts = [{ text: item.prompt }];
  if (refImage) {
    parts.unshift({ inlineData: { mimeType: 'image/png', data: refImage.toString('base64') } });
    parts[1].text = 'Use the attached image only as a reference for the art style (line thickness, shading, color saturation). Draw a different character. ' + item.prompt;
  }
  const body = {
    contents: [{ parts }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: item.aspect || '1:1' } },
  };
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = await res.json();
      const img = (json.candidates?.[0]?.content?.parts || []).find(p => p.inlineData);
      if (img) return Buffer.from(img.inlineData.data, 'base64');
      const why = json.candidates?.[0]?.finishReason || json.promptFeedback?.blockReason || 'no image';
      if (attempt >= 3) throw new Error(`画像が返ってきませんでした (${why})`);
    } else {
      const text = await res.text();
      if (res.status === 400 || res.status === 401 || res.status === 403) throw new Error(`API エラー ${res.status}: ${text.slice(0, 300)}`);
      if (attempt >= 4) throw new Error(`API エラー ${res.status}: ${text.slice(0, 300)}`);
    }
    await new Promise(r => setTimeout(r, 2000 * 2 ** attempt));
  }
}

// ---------- 加工 ----------
// 緑背景を透明にして、キャラの大きさに切り詰め、正方形に収める
async function keySprite(buf, size) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4, r = data[o], g = data[o + 1], b = data[o + 2];
    const spill = g - Math.max(r, b);
    if (spill > 90 && g > 110) data[o + 3] = 0;
    else if (spill > 25) {
      data[o + 3] = Math.round(255 * (1 - (spill - 25) / 65)); // ふちを少しなめらかに
      data[o + 1] = Math.max(r, b); // 緑のにじみを消す
    }
    if (data[o + 3] > 20) {
      const x = i % w, y = (i / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('キャラが見つかりませんでした（背景が緑でない可能性）');
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  return sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: minX, top: minY, width: cw, height: ch })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toBuffer();
}

async function processItem(item, raw) {
  const out = path.join(ART_DIR, `${item.key}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  let buf;
  if (item.kind === 'sprite') buf = await keySprite(raw, item.size);
  else if (item.kind === 'tile') buf = await sharp(raw).resize(item.size, item.size, { fit: 'cover' }).png({ compressionLevel: 9 }).toBuffer();
  else buf = await sharp(raw).resize({ width: item.width }).jpeg({ quality: 82 }).toBuffer();
  const file = item.kind === 'image' ? out.replace(/\.png$/, '.jpg') : out;
  fs.writeFileSync(file, buf);
  if (item.key === 'icon/app') await writeAppIcons(raw);
  return path.relative(ROOT, file);
}

// アプリアイコン一式（ホーム画面・Android の丸切り抜き用・ファビコン）
async function writeAppIcons(raw) {
  const base = sharp(raw).resize(512, 512, { fit: 'cover' });
  const png = await base.png().toBuffer();
  for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180], ['favicon-64.png', 64]]) {
    fs.writeFileSync(path.join(ICON_DIR, name), await sharp(png).resize(size, size).png().toBuffer());
  }
  // maskable: 周りを背景色で広げて、丸く切られても絵が欠けないように
  const inner = await sharp(png).resize(400, 400).png().toBuffer();
  const { dominant } = await sharp(png).stats();
  fs.writeFileSync(path.join(ICON_DIR, 'maskable-512.png'),
    await sharp({ create: { width: 512, height: 512, channels: 4, background: { ...dominant, alpha: 1 } } }).composite([{ input: inner, gravity: 'center' }]).png().toBuffer());
}

function writeManifest() {
  const files = [];
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(png|jpg)$/.test(f)) files.push(path.relative(ART_DIR, p).split(path.sep).join('/'));
    }
  };
  walk(ART_DIR);
  const manifest = Object.fromEntries(files.map(f => [f.replace(/\.(png|jpg)$/, ''), f]));
  fs.writeFileSync(path.join(ART_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return files.length;
}

// ---------- メイン ----------
(async () => {
  let items = list();
  if (only.length) items = items.filter(it => only.some(o => it.key.startsWith(o)));
  if (flag('list')) {
    for (const it of items) console.log(`■ ${it.key} (${it.kind})\n  ${it.prompt}\n`);
    return;
  }
  fs.mkdirSync(RAW_DIR, { recursive: true });
  // 最初に作った妖怪を絵柄の見本にして、全体の絵柄をそろえる
  const refPath = path.join(RAW_DIR, 'yokai', 'nekomata.png');
  let failed = 0;
  for (const it of items) {
    const rawPath = path.join(RAW_DIR, `${it.key}.png`);
    try {
      let raw;
      if (flag('process-only')) {
        if (!fs.existsSync(rawPath)) continue;
        raw = fs.readFileSync(rawPath);
      } else {
        const outExists = fs.existsSync(path.join(ART_DIR, `${it.key}.png`)) || fs.existsSync(path.join(ART_DIR, `${it.key}.jpg`));
        if (outExists && !flag('force')) { console.log(`- ${it.key}: あるのでスキップ`); continue; }
        const ref = it.kind === 'sprite' && it.key !== 'yokai/nekomata' && fs.existsSync(refPath) ? fs.readFileSync(refPath) : null;
        process.stdout.write(`… ${it.key} を生成中${ref ? '（絵柄見本つき）' : ''}\n`);
        raw = await generate(it, ref);
        fs.mkdirSync(path.dirname(rawPath), { recursive: true });
        fs.writeFileSync(rawPath, raw);
      }
      console.log(`✓ ${it.key} → ${await processItem(it, raw)}`);
    } catch (e) {
      failed++;
      console.error(`✗ ${it.key}: ${e.message}`);
      if (/GEMINI_API_KEY|API エラー 40[013]/.test(e.message)) break;
    }
  }
  console.log(`manifest: ${writeManifest()} 枚 / 失敗 ${failed}`);
  if (failed) process.exitCode = 1;
})();
