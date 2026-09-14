// Read-only adapter. Credentials stay in the server process.
export class Kiwoom {
  constructor(env = process.env, transport = fetch) {
    this.key = env.KIWOOM_APPKEY; this.secret = env.KIWOOM_SECRETKEY;
    this.base = env.KIWOOM_ENV === 'production' ? 'https://api.kiwoom.com' : 'https://mockapi.kiwoom.com';
    this.transport = transport; this.token = null; this.expires = 0;
  }
  async request(path, payload, apiId) {
    const response = await this.transport(this.base + path, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json;charset=UTF-8', ...(apiId ? { authorization: `Bearer ${this.token}`, 'api-id': apiId } : {}) }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`키움 HTTP 오류 ${response.status}`);
    const data = await response.json();
    if (data.return_code !== undefined && Number(data.return_code) !== 0) throw new Error(`키움 API 오류 코드 ${data.return_code}: 키와 서비스 신청 상태를 확인하세요.`);
    return data;
  }
  async authenticate() {
    if (!this.key || !this.secret) throw new Error('.env에 KIWOOM_APPKEY와 KIWOOM_SECRETKEY를 입력하고 재시작하세요.');
    if (!this.token || Date.now() > this.expires) {
      const auth = await this.request('/oauth2/token', { grant_type: 'client_credentials', appkey: this.key, secretkey: this.secret });
      if (!auth.token) throw new Error('키움 토큰이 반환되지 않았습니다.');
      this.token = auth.token;
      const e = String(auth.expires_dt || '');
      const end = /^\d{14}$/.test(e) ? Date.parse(`${e.slice(0,4)}-${e.slice(4,6)}-${e.slice(6,8)}T${e.slice(8,10)}:${e.slice(10,12)}:${e.slice(12,14)}+09:00`) : Date.now() + 3600000;
      this.expires = end - 60000;
    }
  }
  async quote(symbol) {
    if (!/^[0-9]{6}$/.test(symbol)) throw new Error('종목코드는 숫자 6자리입니다.');
    await this.authenticate();
    const data = await this.request('/api/dostk/stkinfo', { stk_cd: symbol }, 'ka10001');
    const price = Math.abs(Number(String(data.cur_prc ?? '').replaceAll(',', '')));
    if (!Number.isFinite(price) || price <= 0) throw new Error('키움 현재가 응답이 유효하지 않습니다.');
    const volume = Number(data.trde_qty);
    if (!Number.isFinite(volume) || volume < 0) throw new Error('키움 거래량 응답이 유효하지 않습니다.');
    return { price, volume, name: String(data.stk_nm || symbol), time: new Date().toISOString() };
  }
  async volumeLeaders(limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('거래량 순위 범위는 1~50입니다.');
    await this.authenticate();
    const data = await this.request('/api/dostk/rkinfo', {
      mrkt_tp: '000', sort_tp: '1', mang_stk_incls: '1', crd_tp: '0',
      trde_qty_tp: '0', pric_tp: '0', trde_prica_tp: '0', mrkt_open_tp: '1', stex_tp: '1'
    }, 'ka10030');
    if (!Array.isArray(data.tdy_trde_qty_upper)) throw new Error('키움 거래량 순위 응답이 유효하지 않습니다.');
    const seen = new Set();
    return data.tdy_trde_qty_upper.slice(0, limit).map((row, index) => {
      const symbol = String(row.stk_cd || ''), volume = Number(String(row.trde_qty ?? '').replaceAll(',', ''));
      if (!/^[0-9]{6}$/.test(symbol) || seen.has(symbol) || !Number.isFinite(volume) || volume <= 0) throw new Error('키움 거래량 순위에 잘못된 종목 또는 거래량이 있습니다.');
      seen.add(symbol);
      return { rank: index + 1, symbol, name: String(row.stk_nm || symbol), volume };
    });
  }
}
