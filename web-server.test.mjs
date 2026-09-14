import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import { once } from 'node:events';

test('hosted HTTP login protects account, rejects foreign origins and revokes session', async t => {
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const password='integration-test-password-only';
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'production',PUBLIC_ORIGIN:'https://trader.example',DASHBOARD_PASSWORD:password,KIWOOM_APPKEY:'',KIWOOM_SECRETKEY:''},stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Test server did not start')),10000);
    child.once('error',err=>{clearTimeout(timer);reject(err)});
    child.once('exit',code=>{clearTimeout(timer);reject(Error('Test server exited: '+code))});
    child.stdout.on('data',()=>{clearTimeout(timer);resolve()});
  });
  const request=(path,options={})=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path,method:options.method||'GET',headers:{host:'trader.example',...options.headers}},res=>{
      let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:{get:name=>Array.isArray(res.headers[name])?res.headers[name][0]:res.headers[name]},text:async()=>text,json:async()=>JSON.parse(text)}));
    });req.on('error',reject);req.end(options.body);
  });
  assert.equal((await request('/healthz')).status,200);
  assert.match(await(await request('/')).text(),/관리자 비밀번호/);
  assert.equal((await request('/api/state')).status,401);
  assert.equal((await request('/api/export')).status,401);
  assert.equal((await request('/volume-ui.js')).status,401);
  const json={'content-type':'application/json',origin:'https://trader.example'};
  const bad=await request('/api/login',{method:'POST',headers:json,body:JSON.stringify({password:'wrong'})});assert.equal(bad.status,401);
  const login=await request('/api/login',{method:'POST',headers:json,body:JSON.stringify({password})});assert.equal(login.status,200);
  assert.match(login.headers.get('set-cookie'),/Secure/);const cookie=login.headers.get('set-cookie').split(';')[0];
  const state=await(await request('/api/state',{headers:{cookie}})).json();assert.equal(state.authEnabled,true);assert.equal(state.hosted,true);
  assert.match(await(await request('/',{headers:{cookie}})).text(),/거래량|volume-ui/);
  const blocked=await request('/api/start',{method:'POST',headers:{...json,cookie,origin:'https://evil.example'},body:'{}'});assert.equal(blocked.status,403);
  const start=await request('/api/start',{method:'POST',headers:{...json,cookie},body:'{}'});assert.equal(start.status,200);
  const stop=await request('/api/stop',{method:'POST',headers:{...json,cookie},body:'{}'});assert.equal((await stop.json()).running,false);
  assert.equal((await request('/.env',{headers:{cookie}})).status,404);
  await request('/api/logout',{method:'POST',headers:{...json,cookie},body:'{}'});
  assert.equal((await request('/api/state',{headers:{cookie}})).status,401);
});
