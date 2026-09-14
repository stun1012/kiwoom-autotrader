export const defaults = { capital: 10000000, short: 5, long: 20, allocation: 20, stopLoss: 3, takeProfit: 6, maxLoss: 5, feeBps: 2, sellTaxBps: 0, slippageBps: 5 };
export function validate(input) {
  const c = { ...defaults, ...input };
  for (const key of Object.keys(defaults)) if (typeof c[key] !== 'number' || !Number.isFinite(c[key])) throw new Error(`${key}: 유효한 숫자가 필요합니다.`);
  if (c.capital < 10000 || c.capital > 1e12) throw new Error('초기 자금은 1만원~1조원입니다.');
  if (!Number.isInteger(c.short) || !Number.isInteger(c.long) || c.short < 2 || c.long <= c.short || c.long > 200) throw new Error('이동평균은 2 ≤ 단기 < 장기 ≤ 200이어야 합니다.');
  for (const key of ['allocation', 'stopLoss', 'takeProfit', 'maxLoss']) if (c[key] <= 0 || c[key] > 100) throw new Error(`${key}: 0 초과 100 이하로 입력하세요.`);
  for (const key of ['feeBps', 'sellTaxBps', 'slippageBps']) if (c[key] < 0 || c[key] > 100) throw new Error(`${key}: 0~100bp로 입력하세요.`);
  return Object.fromEntries(Object.keys(defaults).map(k => [k, c[k]]));
}
export class Engine {
  constructor(config = {}) {
    this.config = validate(config); this.cash = this.config.capital; this.qty = 0; this.cost = 0;
    this.prices = []; this.trades = []; this.equity = []; this.pending = null;
    this.halted = false; this.reason = ''; this.lastTime = null; this.realized = 0;
  }
  buy(price, time, reason) {
    const c = this.config, fill = price * (1 + c.slippageBps / 10000);
    const perShare = fill * (1 + c.feeBps / 10000);
    const qty = Math.floor(Math.min(this.cash, this.nav(price) * c.allocation / 100) / perShare);
    if (qty < 1 || this.qty) return;
    this.cost = qty * perShare; this.cash -= this.cost; this.qty = qty;
    this.trades.push({ time, side: '매수', price: fill, qty, fee: qty * fill * c.feeBps / 10000, tax: 0, pnl: 0, reason });
  }
  sell(price, time, reason) {
    if (!this.qty) return;
    const c = this.config, fill = price * (1 - c.slippageBps / 10000), qty = this.qty;
    const fee = qty * fill * c.feeBps / 10000, tax = qty * fill * c.sellTaxBps / 10000;
    const proceeds = qty * fill - fee - tax, pnl = proceeds - this.cost;
    this.cash += proceeds; this.realized += pnl; this.qty = 0; this.cost = 0;
    this.trades.push({ time, side: '매도', price: fill, qty, fee, tax, pnl, reason });
  }
  nav(price) { return this.cash + this.qty * price; }
  step(price, time, { allowBuy = true } = {}) {
    if (!Number.isFinite(price) || price <= 0) throw new Error('시세는 양수여야 합니다.');
    if (!Number.isFinite(Date.parse(time)) || (this.lastTime && Date.parse(time) <= Date.parse(this.lastTime))) throw new Error('시각은 중복 없이 오름차순이어야 합니다.');
    this.lastTime = time;
    const c = this.config;
    // Previous close's signal fills on the next supplied price, never on the signal price.
    if (!this.halted) {
      const loss = this.nav(price) <= c.capital * (1 - c.maxLoss / 100);
      if (loss) { this.sell(price, time, '누적 손실 한도'); this.halted = true; this.reason = '초기 자금 대비 누적 손실 한도 도달'; }
      else if (this.pending?.side === 'sell') this.sell(price, time, this.pending.reason);
      else if (this.pending?.side === 'buy' && allowBuy) this.buy(price, time, this.pending.reason);
    }
    this.pending = null; this.prices.push({ time, price });
    if (!this.halted && this.nav(price) <= c.capital * (1 - c.maxLoss / 100)) {
      this.sell(price, time, '비용 반영 후 손실 한도'); this.halted = true; this.reason = '초기 자금 대비 누적 손실 한도 도달';
    }
    if (!this.halted) {
      const n = this.prices.length, mean = (length, end = n) => this.prices.slice(end - length, end).reduce((s, p) => s + p.price, 0) / length;
      const change = this.qty ? (price * this.qty / this.cost - 1) * 100 : 0;
      if (this.qty && change <= -c.stopLoss) this.pending = { side: 'sell', reason: '손절' };
      else if (this.qty && change >= c.takeProfit) this.pending = { side: 'sell', reason: '익절' };
      else if (n > c.long) {
        const diff = mean(c.short) - mean(c.long), prev = mean(c.short, n - 1) - mean(c.long, n - 1);
        if (allowBuy && !this.qty && prev <= 0 && diff > 0) this.pending = { side: 'buy', reason: '이동평균 상향 교차' };
        if (this.qty && prev >= 0 && diff < 0) this.pending = { side: 'sell', reason: '이동평균 하향 교차' };
      }
    }
    this.equity.push({ time, value: this.nav(price) });
  }
  snapshot() {
    const price = this.prices.at(-1)?.price || 0, nav = this.nav(price);
    let peak = this.config.capital, mdd = 0;
    for (const p of this.equity) { peak = Math.max(peak, p.value); mdd = Math.max(mdd, (peak - p.value) / peak * 100); }
    return { config: this.config, cash: this.cash, qty: this.qty, average: this.qty ? this.cost / this.qty : 0, price, nav, realized: this.realized,
      returnPct: (nav / this.config.capital - 1) * 100, mdd, pending: this.pending, halted: this.halted, reason: this.reason,
      prices: this.prices.slice(-300), equity: this.equity.slice(-300), trades: this.trades.slice(-200), tradeCount: this.trades.length };
  }
}
export function parseCSV(csv) {
  const lines = csv.trim().replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length < 3 || lines.length > 100001) throw new Error('CSV는 헤더와 2~100000개 가격 행이 필요합니다.');
  const header = lines.shift().split(',').map(s => s.trim().toLowerCase());
  const ti = header.indexOf('date'), pi = header.indexOf('close');
  if (ti < 0 || pi < 0) throw new Error('CSV에 date,close 열이 필요합니다.');
  let last = -Infinity;
  return lines.map((line, i) => {
    const cells = line.split(','), time = cells[ti]?.trim(), price = Number(cells[pi]?.trim()), stamp = Date.parse(time);
    if (!Number.isFinite(stamp) || stamp <= last || !Number.isFinite(price) || price <= 0) throw new Error(`CSV ${i + 2}행: 날짜 순서 또는 가격이 잘못되었습니다.`);
    last = stamp; return { time: new Date(stamp).toISOString(), price };
  });
}
