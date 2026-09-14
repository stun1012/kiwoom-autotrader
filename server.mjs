import http from 'node:http';
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Engine, parseCSV } from './engine.mjs';
import { Kiwoom } from './kiwoom.mjs';

try { process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url))); } catch (err) { if (err.code !== 'ENOENT') throw err; }
const kiwoom = new Kiwoom();
let source = 'demo', symbol = '005930', nextPoll = 0, lastVolume = null;
let volumeTop = 20, leaders = [], rankingAt = null, eligible = false;

const html = await readFile(new URL('./index.html', import.meta.url));
const volumeUI = await readFile(new URL('./volume-ui.js', import.meta.url));
const dataDir = new URL('./data/', import.meta.url);
await mkdir(dataDir, { recursive: true });
let engine = new Engine(), running = false, ticks = 0, lastError = '';
let seed = 42, price = 70000;
const port = Number(process.env.PORT || 8765);
const origin = `http://127.0.0.1:${port}`;
async function log(trades) {
  for (const t of trades) await appendFile(new URL('trades.jsonl', dataDir), JSON.stringify({ ...t, mode: source + '-paper', symbol: source === 'demo' ? 'DEMO-KR' : symbol, recordedAt: new Date().toISOString() }) + '\n');
}
function state() { return { ...engine.snapshot(), running, lastError, mode: source === 'demo' ? '가상 시세 · 로컬 모의매매' : '키움 시세 · 로컬 모의매매', symbol: source === 'demo' ? 'DEMO-KR' : symbol, ticks,
  volumeFilter: { top: volumeTop, active: source === 'kiwoom', eligible, leaders, updatedAt: rankingAt } }; }
function reply(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" });
  res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
}
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 5e6) throw new Error('업로드는 5MB 이하로 제한됩니다.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
let busy = false;
async function tick() {
  if (!running || busy || Date.now() < nextPoll) return;
  busy = true;
  try {
    let time;
    if (source === 'kiwoom') {
      nextPoll = Date.now() + 60000;
      // Refresh eligibility before every possible entry; never reuse an old ranking on error.
      eligible = false;
      let ranking = [];
      try { ranking = await kiwoom.volumeLeaders(volumeTop); lastError = ''; rankingAt = new Date().toISOString(); }
      catch (err) { lastError = '거래량 순위 조회 실패: 신규 매수 차단. ' + err.message; rankingAt = null; }
      if (!running) return;
      leaders = ranking;
      eligible = leaders.some(row => row.symbol === symbol);
      if (!eligible && engine.pending?.side === 'buy') engine.pending = null;
      const q = await kiwoom.quote(symbol);
      // Stop may be clicked while a quote is in flight. Never fill after stop.
      if (!running) return;
      if (q.volume === lastVolume) return;
      lastVolume = q.volume; price = q.price; time = q.time; ticks++;
    } else {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      price = Math.max(1000, Math.round(price * (1 + 0.006 * Math.sin(ticks / 12) + (seed / 4294967296 - 0.5) * 0.008)));
      time = new Date(Date.UTC(2026, 0, 1) + ticks++ * 60000).toISOString();
    }
    const count = engine.trades.length;
    engine.step(price, time, { allowBuy: source === 'demo' || eligible });
    await log(engine.trades.slice(count));
    if (engine.halted) running = false;
    if (ticks >= 20000) { running = false; lastError = '세션 20000봉 도달: 초기화 후 다시 시작하세요.'; }
  } catch (err) { running = false; lastError = err.message; }
  finally { busy = false; }
}
setInterval(tick, 1000).unref();
http.createServer(async (req, res) => {
  if (req.headers.host !== `127.0.0.1:${port}`) return reply(res, 403, { error: '허용되지 않은 호스트' });
  try {
    if (req.method === 'GET' && req.url === '/') return reply(res, 200, html, 'text/html; charset=utf-8');
    if (req.method === 'GET' && req.url === '/volume-ui.js') return reply(res, 200, volumeUI, 'text/javascript; charset=utf-8');
    if (req.method === 'GET' && req.url === '/api/state') return reply(res, 200, state());
    if (req.method === 'GET' && req.url === '/api/export') {
      const header = 'time,side,price,qty,fee,tax,pnl,reason';
      const lines = engine.trades.map(t => [t.time, t.side, t.price, t.qty, t.fee, t.tax, t.pnl, t.reason].join(','));
      res.setHeader('Content-Disposition', 'attachment; filename="trades.csv"');
      return reply(res, 200, '\uFEFF' + [header, ...lines].join('\r\n'), 'text/csv; charset=utf-8');
    }
    if (req.method !== 'POST') return reply(res, 404, { error: '찾을 수 없습니다.' });
    if (req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json')) return reply(res, 403, { error: '로컬 대시보드에서만 조작할 수 있습니다.' });
    const input = await body(req);
    if (req.url === '/api/stop') { running = false; return reply(res, 200, state()); }
    if (busy) return reply(res, 409, { error: '시세 조회 또는 체결 기록 저장 중입니다. 잠시 후 다시 시도하세요.' });
    if (req.url === '/api/start') {
      if (engine.halted || ticks >= 20000) throw new Error('초기화 후 다시 시작하세요.');
      running = true; lastError = '';
    } else if (req.url === '/api/stop') running = false;
    else if (req.url === '/api/reset') {
      if (running) throw new Error('정지한 뒤 설정을 적용하세요.');
      if (!['demo', 'kiwoom'].includes(input.source)) throw new Error('시세 소스를 선택하세요.');
      if (!/^[0-9]{6}$/.test(input.symbol)) throw new Error('종목코드는 숫자 6자리입니다.');
      const top = input.volumeTop ?? 20;
      if (!Number.isInteger(top) || top < 1 || top > 50) throw new Error('거래량 상위 범위는 1~50입니다.');
      const next = new Engine(input); engine = next; source = input.source; symbol = input.symbol;
      volumeTop = top; leaders = []; rankingAt = null; eligible = false;
      ticks = 0; seed = 42; price = 70000; lastError = ''; nextPoll = 0; lastVolume = null;
    } else if (req.url === '/api/backtest') {
      const rows = parseCSV(input.csv), test = new Engine(input.config);
      for (const row of rows) test.step(row.price, row.time);
      return reply(res, 200, { ...test.snapshot(), bars: rows.length });
    } else return reply(res, 404, { error: '찾을 수 없습니다.' });
    reply(res, 200, state());
  } catch (err) { reply(res, 400, { error: err.message }); }
}).listen(port, '127.0.0.1', () => console.log(`KR AutoTrader: ${origin}\n실제 주문 없음. 가상 시세를 사용하는 모의매매입니다.\n매매 기록: ${fileURLToPath(dataDir)}`));
