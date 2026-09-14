import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function webConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const port = Number(env.PORT || 8765);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT는 1~65535 정수여야 합니다.');
  const rawOrigin = env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${port}`;
  const url = new URL(rawOrigin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('PUBLIC_ORIGIN에는 사이트의 기본 주소만 입력하세요.');
  const password = env.DASHBOARD_PASSWORD || '';
  if (production && (url.protocol !== 'https:' || password.length < 16)) throw new Error('웹 배포에는 HTTPS 주소와 16자 이상 DASHBOARD_PASSWORD가 필요합니다.');
  const host = env.HOST || (production ? '0.0.0.0' : '127.0.0.1');
  if (host !== '127.0.0.1' && password.length < 16) throw new Error('외부 접속에는 16자 이상 DASHBOARD_PASSWORD가 필요합니다.');
  return { production, port, origin: url.origin, allowedHost: url.host, secure: url.protocol === 'https:', host, password };
}

export function createAuth(config, now = Date.now) {
  const sessions = new Map();
  const expected = createHash('sha256').update(config.password).digest();
  const ttl = 12 * 60 * 60 * 1000;
  let failures = 0, windowStart = now();
  function cleanup() { for (const [token, expiry] of sessions) if (expiry <= now()) sessions.delete(token); }
  function cookieToken(req) { return req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('autotrader_session='))?.slice('autotrader_session='.length); }
  function cookie(token, age) { return `autotrader_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${config.secure ? '; Secure' : ''}`; }
  return {
    enabled: Boolean(config.password),
    authorized(req) { if (!config.password) return true; cleanup(); return sessions.has(cookieToken(req)); },
    login(password) {
      if (now() - windowStart >= 60000) { failures = 0; windowStart = now(); }
      if (failures >= 10) return { status: 429, error: '로그인 시도가 많습니다. 1분 후 다시 시도하세요.' };
      const actual = createHash('sha256').update(typeof password === 'string' ? password : '').digest();
      if (!config.password || !timingSafeEqual(expected, actual)) { failures++; return { status: 401, error: '비밀번호가 올바르지 않습니다.' }; }
      cleanup();
      if (sessions.size >= 20) sessions.delete(sessions.keys().next().value);
      const token = randomBytes(32).toString('hex'); sessions.set(token, now() + ttl);
      return { status: 200, cookie: cookie(token, ttl / 1000) };
    },
    logout(req) { sessions.delete(cookieToken(req)); return cookie('', 0); }
  };
}
