import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, webConfig } from './web-security.mjs';
const config = () => webConfig({NODE_ENV:'production',RENDER_EXTERNAL_URL:'https://trader.example',DASHBOARD_PASSWORD:'a-long-test-password-only'});
test('cloud deployment fails closed without HTTPS or strong password',()=>{
  assert.throws(()=>webConfig({NODE_ENV:'production'}));
  assert.throws(()=>webConfig({HOST:'0.0.0.0'}));
  assert.throws(()=>webConfig({NODE_ENV:'production',PUBLIC_ORIGIN:'http://test.example',DASHBOARD_PASSWORD:'long-enough-test-password'}));
  assert.throws(()=>webConfig({PUBLIC_ORIGIN:'https://example.org/path'}));
  assert.equal(config().host,'0.0.0.0'); assert.equal(config().allowedHost,'trader.example');
});
test('sessions require password, expire, and are revoked on logout',()=>{
  let time=0;const auth=createAuth(config(),()=>time);
  assert.equal(auth.authorized({headers:{}}),false);
  assert.equal(auth.login('wrong').status,401);
  const login=auth.login('a-long-test-password-only');assert.equal(login.status,200);
  assert.match(login.cookie,/HttpOnly/);assert.match(login.cookie,/Secure/);assert.match(login.cookie,/SameSite=Strict/);
  const req={headers:{cookie:login.cookie.split(';')[0]}};assert.equal(auth.authorized(req),true);
  auth.logout(req);assert.equal(auth.authorized(req),false);
  const second=auth.login('a-long-test-password-only');time=13*60*60*1000;
  assert.equal(auth.authorized({headers:{cookie:second.cookie.split(';')[0]}}),false);
});
test('login guesses are throttled without allocating per-IP state',()=>{
  let time=0;const auth=createAuth(config(),()=>time);
  for(let i=0;i<10;i++)assert.equal(auth.login('wrong').status,401);
  assert.equal(auth.login('a-long-test-password-only').status,429);
  time=61000;assert.equal(auth.login('a-long-test-password-only').status,200);
});
test('localhost works without password and honors configured port',()=>{
  const c=webConfig({PORT:'8767'});assert.equal(c.origin,'http://127.0.0.1:8767');
  assert.equal(createAuth(c).authorized({headers:{}}),true);
});
