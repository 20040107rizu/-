#!/usr/bin/env node
// tools/svg-art.js の絵を PNG にして public/art/ に書き出す（API キー不要）
//   npm run draw                     全部書き出す（同じ名前の絵は上書き）
//   npm run draw -- --only=yokai/    指定したものだけ（前方一致、カンマ区切り可）
//   npm run draw -- --sheet=out.png  一覧画像（確認用）も作る
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { all } = require('./svg-art');

const ART_DIR = path.join(__dirname, '..', 'public', 'art');
const args = process.argv.slice(2);
const only = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const sheet = (args.find(a => a.startsWith('--sheet=')) || '').slice(8);

(async () => {
  let items = all();
  if (only.length) items = items.filter(([key]) => only.some(o => key.startsWith(o)));
  const rendered = [];
  for (const [key, svg, size] of items) {
    let buf;
    try { buf = await sharp(Buffer.from(svg), { density: (72 * size) / 256 }).resize(size, size).png({ compressionLevel: 9, palette: true, quality: 95 }).toBuffer(); }
    catch (e) { console.error(`✗ ${key}: ${e.message}`); process.exitCode = 1; continue; }
    const out = path.join(ART_DIR, `${key}.png`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
    rendered.push([key, buf]);
  }

  // manifest.json（public/art/ にある絵の一覧。生成AIの絵と共通）
  const files = [];
  const walk = dir => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(png|jpg)$/.test(f)) files.push(path.relative(ART_DIR, p).split(path.sep).join('/'));
    }
  };
  walk(ART_DIR);
  // 絵を描き直したらすぐ反映されるように、中身のハッシュをURLにつける
  const tag = f => crypto.createHash('sha1').update(fs.readFileSync(path.join(ART_DIR, f))).digest('hex').slice(0, 8);
  fs.writeFileSync(path.join(ART_DIR, 'manifest.json'), JSON.stringify(Object.fromEntries(files.sort().map(f => [f.replace(/\.(png|jpg)$/, ''), `${f}?h=${tag(f)}`])), null, 2) + '\n');
  console.log(`manifest: ${files.length} 枚`);

  if (sheet) {
    const cell = 200, cols = 6, rows = Math.ceil(rendered.length / cols);
    const composites = await Promise.all(rendered.map(async ([, buf], i) => ({
      input: await sharp(buf).resize(cell - 10, cell - 10, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer(),
      left: (i % cols) * cell + 5, top: Math.floor(i / cols) * cell + 5,
    })));
    await sharp({ create: { width: cols * cell, height: rows * cell, channels: 4, background: '#3a2a4a' } }).composite(composites).png().toFile(sheet);
    console.log(`sheet: ${sheet}`);
  }
})();
