// アップデート履歴（public/changelog.json）を、git に残っている public/whatsnew.json の移り変わりから作る
//   node tools/changelog.js
// お知らせ（whatsnew.json の notes）に初めて出た日ごとにまとめる。
// 書き直されたお知らせ（消えた同じコミットで、よく似た文が増えたもの）は、書き直す前の文なので入れない。
// アプリは changelog.json と今の whatsnew.json を合わせて表示するので、ふだんは whatsnew.json だけ書けばよい。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const git = cmd => execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
const commits = git('log --reverse --format=%H%x20%ct -- public/whatsnew.json').trim().split('\n').filter(Boolean).map(l => { const [h, t] = l.split(' '); return { h, t: +t * 1000 }; });

const seen = new Map(); // お知らせ -> { first, gone }
let prev = new Set();
// 似ている文か（同じ文字の2文字のならびが4割以上かさなる）
const bigrams = t => { const o = new Set(); for (let i = 0; i < t.length - 1; i++) o.add(t.slice(i, i + 2)); return o; };
const similar = (a, b) => { const A = bigrams(a), B = bigrams(b); let k = 0; for (const x of A) if (B.has(x)) k++; return k / Math.max(1, Math.min(A.size, B.size)) > 0.4; };
for (const c of commits) {
  let notes = [];
  try { notes = JSON.parse(git(`show ${c.h}:public/whatsnew.json`)).notes || []; } catch { continue; }
  const cur = new Set(notes);
  for (const n of cur) if (!seen.has(n)) seen.set(n, { first: c.t, edited: false });
  const added = [...cur].filter(n => !prev.has(n));
  for (const n of prev) if (!cur.has(n) && added.some(m => similar(n, m))) seen.get(n).edited = true;
  prev = cur;
}
const day = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10); // 日本の日付
const byDay = new Map();
for (const [n, s] of seen) {
  if (s.edited) continue; // 書き直される前の文
  const d = day(s.first);
  if (!byDay.has(d)) byDay.set(d, []);
  byDay.get(d).push(n);
}
const out = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([date, notes]) => ({ date, notes }));
fs.writeFileSync(path.join(ROOT, 'public/changelog.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`changelog: ${out.length}日ぶん、${out.reduce((a, d) => a + d.notes.length, 0)}件`);
