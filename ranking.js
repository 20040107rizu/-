// 週替わりランキングの記録。
// SUPABASE_URL と SUPABASE_SERVICE_KEY があれば Supabase の weekly_scores 表に保存して、サーバーが再起動しても1週間残す。
// 無いときはメモリだけで動く（再起動すると消える）。
const S = require('./public/shared.js');

const BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const enabled = !!(BASE && KEY);

let dbError = null; // 最後に Supabase とのやりとりで起きた問題（画面に出して気づけるように）
const weeks = new Map(); // 週の番号 → { rows: Map(pid → row), loading: Promise }

function headers(extra) {
  const h = { apikey: KEY, 'Content-Type': 'application/json', ...extra };
  if (!KEY.startsWith('sb_')) h.Authorization = `Bearer ${KEY}`; // 古い形式（JWT）のキー
  return h;
}

// その週の記録を用意する（Supabase から一度だけ読み込む）
function week(idx) {
  let w = weeks.get(idx);
  if (!w) {
    w = { rows: new Map(), loading: null };
    weeks.set(idx, w);
    if (enabled) {
      w.loading = fetch(`${BASE}/rest/v1/weekly_scores?week=eq.${idx}&select=pid,name,yokai,title,score,detail&limit=5000`, { headers: headers() })
        .then(r => (r.ok ? r.json() : r.text().then(t => { throw new Error(`${r.status} ${t}`); })))
        .then(list => { dbError = null; for (const row of list) if (!w.rows.has(row.pid)) w.rows.set(row.pid, row); })
        .catch(e => { console.error('ランキングの読み込みに失敗:', e.message); dbError = e.message.slice(0, 200); }); // 読み込めなくても、メモリの記録はそのまま使う
    }
    // 古い週はメモリから外す（今週と先週だけ持っておく）
    for (const k of weeks.keys()) if (k < idx - 1) weeks.delete(k);
  }
  return w;
}

async function save(idx, row) {
  if (!enabled) return;
  try {
    const r = await fetch(`${BASE}/rest/v1/weekly_scores?on_conflict=week,pid`, {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify([{ week: String(idx), ...row, updated_at: new Date().toISOString() }]),
    });
    if (!r.ok) { const t = await r.text(); console.error('ランキングの保存に失敗:', r.status, t); dbError = `${r.status} ${t}`.slice(0, 200); }
    else dbError = null;
  } catch (e) { console.error('ランキングの保存に失敗:', e.message); dbError = e.message.slice(0, 200); }
}

// 1回のバトルの結果を記録する。entries: [{ pid, name, yokai, title, value, detail }]
// value はその回の数字（合計に足す / いちばん良い記録だけ残す はテーマで決まる）。value が null の人は参加だけ記録
async function record(idx, entries) {
  const theme = S.themeOf(idx);
  const best = theme.lower || theme.key === 'challenge';
  const w = week(idx);
  if (w.loading) await w.loading;
  for (const e of entries) {
    if (!e.pid) continue;
    const old = w.rows.get(e.pid);
    let score = old ? old.score : 0, detail = old ? old.detail : null;
    if (e.value != null) {
      if (!best) score += e.value;
      else if (theme.lower ? (score <= 0 || e.value < score) : e.value > score) { score = e.value; detail = e.detail || null; }
    }
    const row = { pid: e.pid, name: e.name, yokai: e.yokai, title: e.title || null, score: Math.round(score * 10) / 10, detail };
    w.rows.set(e.pid, row);
    save(idx, row);
  }
}

// 順位表。score が 0 の人は「参加だけ」（順位には入らない）
async function board(idx, pid) {
  const theme = S.themeOf(idx);
  const w = week(idx);
  if (w.loading) await w.loading;
  const all = [...w.rows.values()];
  const ranked = all.filter(r => r.score > 0).sort((a, b) => (theme.lower ? a.score - b.score : b.score - a.score));
  const meRow = pid && w.rows.get(pid);
  const myRank = meRow && meRow.score > 0 ? ranked.indexOf(meRow) + 1 : null;
  return {
    idx, theme, start: S.weekStart(idx), end: S.weekStart(idx + 1), saved: enabled && !dbError, dbError: enabled ? dbError : null,
    total: all.length, rows: ranked.slice(0, 300),
    me: meRow ? { rank: myRank, score: meRow.score, joined: true } : { rank: null, score: 0, joined: false },
  };
}

// 最近バトルに行った人（今週と先週の記録がある人）。サーバーが再起動してもフレンド一覧を戻すために使う
async function recentPlayers(idx) {
  if (!enabled) return [];
  try {
    const r = await fetch(`${BASE}/rest/v1/weekly_scores?week=in.(${idx - 1},${idx})&select=pid,name,yokai,title,updated_at&order=updated_at.desc&limit=1000`, { headers: headers() });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return await r.json();
  } catch (e) { console.error('フレンドの読み込みに失敗:', e.message); return []; }
}

module.exports = { enabled, record, board, recentPlayers };
