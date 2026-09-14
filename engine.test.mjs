import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, validate, parseCSV } from './engine.mjs';
import { Kiwoom } from './kiwoom.mjs';
const time = i => new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString();
test('reject invalid settings and CSV chronology', () => {
  assert.throws(() => validate({ short: 20, long: 5 }));
  assert.throws(() => validate({ capital: Infinity }));
  assert.throws(() => parseCSV('date,close\n2026-01-02,100\n2026-01-01,101'));
  assert.throws(() => parseCSV('date,close\n2026-01-01,0\n2026-01-02,100'));
  assert.equal(parseCSV('\uFEFFdate,close\n2026-01-01,100\n2026-01-02,101').length, 2);
});
test('cross signal waits for next price; integer shares and costs conserve cash', () => {
  const e = new Engine({ short: 2, long: 3, capital: 10000, allocation: 100, feeBps: 10, slippageBps: 10 });
  [100, 90, 80, 105].forEach((p,i) => e.step(p,time(i)));
  assert.equal(e.qty, 0); assert.equal(e.pending.side, 'buy');
  e.step(110,time(4)); assert.ok(e.qty > 0); assert.ok(Number.isInteger(e.qty)); assert.ok(e.cash >= 0);
  assert.ok(Math.abs(e.cash + e.cost - 10000) < 1e-8);
  assert.ok(Math.abs(e.trades[0].price - 110.11) < 1e-8);
});
test('loss limit sells, halts and cannot reenter', () => {
  const e = new Engine({ capital: 10000, allocation: 100, feeBps: 0, slippageBps: 0, maxLoss: 5 });
  e.buy(100,time(0),'test'); e.step(90,time(1));
  assert.equal(e.halted,true); assert.equal(e.qty,0); assert.equal(e.cash,9000);
  e.pending = { side:'buy', reason:'test' }; e.step(100,time(2)); assert.equal(e.qty,0);
});
test('sell applies fee and tax and realized PnL', () => {
  const e = new Engine({ capital: 10000, allocation: 50, feeBps: 10, sellTaxBps: 20, slippageBps: 0 });
  e.buy(100,time(0),'test'); const qty=e.qty,cost=e.cost;
  e.sell(120,time(1),'test'); const expected=qty*120*.997-cost;
  assert.ok(Math.abs(e.realized-expected)<1e-8); assert.ok(Math.abs(e.cash-10000-expected)<1e-8);
});
test('stop loss signals next-sample sale', () => {
  const e = new Engine({ capital:10000, allocation:20, feeBps:0, slippageBps:0, stopLoss:3, maxLoss:50 });
  e.buy(100,time(0),'test'); e.step(96,time(1)); assert.equal(e.pending.reason,'손절'); assert.equal(e.qty,20);
  e.step(95,time(2)); assert.equal(e.qty,0); assert.equal(e.trades.at(-1).price,95);
});
test('Kiwoom parses signed price and reuses token, without order endpoints', async () => {
  const calls=[]; const transport=async (url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>url.endsWith('/token')?{token:'fake',expires_dt:'20990101000000'}:{return_code:0,cur_prc:'-70,000',trde_qty:'123',stk_nm:'test'}}};
  const k=new Kiwoom({KIWOOM_APPKEY:'key',KIWOOM_SECRETKEY:'secret'},transport);
  assert.equal((await k.quote('005930')).price,70000); await k.quote('005930');
  assert.equal(calls.length,3); assert.ok(calls.every(c=>c.url.startsWith('https://mockapi.kiwoom.com')));
  assert.equal(JSON.parse(calls[1].opts.body).stk_cd,'005930');
});
test('Kiwoom errors and missing credentials fail closed', async () => {
  await assert.rejects(new Kiwoom({}).quote('005930'));
  const k=new Kiwoom({KIWOOM_APPKEY:'k',KIWOOM_SECRETKEY:'s'},async()=>({ok:true,json:async()=>({return_code:1})}));
  await assert.rejects(k.quote('005930'));
});
test('volume exclusion suppresses signals and cancels a queued buy at execution', () => {
  const e = new Engine({short:2,long:3});
  [100,90,80].forEach((p,i)=>e.step(p,time(i)));
  e.step(105,time(3),{allowBuy:false}); assert.equal(e.pending,null);
  e.pending={side:'buy',reason:'old signal'};
  e.step(110,time(4),{allowBuy:false}); assert.equal(e.qty,0); assert.equal(e.pending,null);
});
test('volume exclusion does not prevent protective sell', () => {
  const e = new Engine({capital:10000,allocation:20,feeBps:0,slippageBps:0,maxLoss:50});
  e.buy(100,time(0),'test'); e.step(96,time(1),{allowBuy:false});
  assert.equal(e.pending.side,'sell'); e.step(95,time(2),{allowBuy:false});
  assert.equal(e.qty,0); assert.equal(e.trades.at(-1).reason,'손절');
});
test('Kiwoom volume leaders request share-volume ranking and enforce top N', async () => {
  const calls=[];
  const k=new Kiwoom({KIWOOM_APPKEY:'k',KIWOOM_SECRETKEY:'s'},async(url,opts)=>{
    calls.push({url,opts}); return {ok:true,json:async()=>url.endsWith('/token')?{token:'fake'}:{return_code:0,tdy_trde_qty_upper:[
      {stk_cd:'005930',stk_nm:'sample',trde_qty:'1,000,000'}, {stk_cd:'000660',stk_nm:'sample2',trde_qty:'900000'}]}};
  });
  const rows=await k.volumeLeaders(1); assert.equal(rows.length,1); assert.equal(rows[0].volume,1000000);
  const request=JSON.parse(calls[1].opts.body); assert.equal(request.sort_tp,'1'); assert.equal(request.stex_tp,'1'); assert.equal(request.mang_stk_incls,'1');
  assert.equal(calls[1].opts.headers['api-id'],'ka10030');
  await assert.rejects(k.volumeLeaders(51));
});
test('invalid ranking data fails closed', async () => {
  const k=new Kiwoom({KIWOOM_APPKEY:'k',KIWOOM_SECRETKEY:'s'},async(url)=>({ok:true,json:async()=>url.endsWith('/token')?{token:'fake'}:{return_code:0,tdy_trde_qty_upper:[{stk_cd:'bad',trde_qty:'100'}]}}));
  await assert.rejects(k.volumeLeaders());
});
