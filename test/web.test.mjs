import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseRepoUrl} from '../lib/repo.mjs';
import {validateSteps,stepsToTest} from '../lib/pipeline.mjs';
import {createStaticServer,findSiteRoot} from '../lib/static-server.mjs';
import {Jobs} from '../lib/jobs.mjs';

const ROOT=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const tmp=()=>mkdtemp(path.join(os.tmpdir(),'culprit-web-'));
const get=(port,p)=>new Promise((res,rej)=>http.get({port,path:p,host:'127.0.0.1'},r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>res({status:r.statusCode,body:b}))}).on('error',rej));

test('only public github.com repo links are accepted',()=>{
  assert.equal(parseRepoUrl('https://github.com/BenCoy09/culprit').name,'culprit');
  assert.equal(parseRepoUrl('https://github.com/BenCoy09/culprit.git/').url,'https://github.com/BenCoy09/culprit');
  for(const bad of ['http://github.com/a/b','https://evil.com/a/b','https://github.com/a','git@github.com:a/b.git','file:///etc','https://github.com/a/b/../c','https://github.com/a/b?x=1','javascript:alert(1)','']){
    assert.throws(()=>parseRepoUrl(bad),/GitHub/,bad);
  }
  assert.equal(parseRepoUrl('file:///tmp/x',{allowLocal:true}).owner,'local');
});

test('plain-English steps are validated and cannot inject test structure',()=>{
  assert.deepEqual(validateSteps('Click Add\n\n  Check cart shows 1  '),['Click Add','Check cart shows 1']);
  assert.throws(()=>validateSteps(''),/at least one/);
  assert.throws(()=>validateSteps('a\nb\nc\nd\ne\nf\ng'),/6 steps/);
  assert.throws(()=>validateSteps('Go to https://evil.com'),/links/);
  assert.throws(()=>validateSteps('x'.repeat(301)),/300/);
  const md=stepsToTest(['# fake heading','---\nmode: evil'],'## Title\ninjected');
  assert.equal((md.match(/^## /gm)||[]).length,2);          // only our own "## Step n" headings
  assert.match(md,/^---\nmode: testing\nheadless: true\n---/);
});

test('static server finds the site folder and cannot be walked out of',async()=>{
  const d=await tmp();
  await mkdir(path.join(d,'public'));await writeFile(path.join(d,'public/index.html'),'<h1>hi</h1>');await writeFile(path.join(d,'secret.txt'),'nope');
  await symlink('/etc/passwd',path.join(d,'public/link.txt'));
  assert.equal(findSiteRoot(d),path.join(d,'public'));
  const srv=createStaticServer(d);await new Promise(r=>srv.listen(0,'127.0.0.1',r));const port=srv.address().port;
  try{
    assert.match((await get(port,'/')).body,/hi/);
    for(const evil of ['/..%2fsecret.txt','/%2e%2e/secret.txt','/../secret.txt','/..%5csecret.txt']){
      const r=await get(port,evil);
      assert.ok([403,404].includes(r.status),evil+' -> '+r.status);
      assert.ok(!r.body.includes('nope'),evil+' leaked a file');
    }
    assert.equal((await get(port,'/..%2fsecret.txt')).status,403);
    const link=await get(port,'/link.txt');                      // a symlink out of the checkout must not be followed
    assert.equal(link.status,404);assert.ok(!link.body.includes('root:'));
    assert.equal((await get(port,'/missing.png')).status,404);
  }finally{srv.close()}
});

test('job quotas: daily total and per-visitor limits',()=>{
  const j=new Jobs({dataDir:os.tmpdir()}),q={dailyCap:3,perIpCap:2};
  assert.equal(j.checkQuota('a',q),null);j.spend('a');j.spend('a');
  assert.match(j.checkQuota('a',q),/2 runs/);
  assert.equal(j.checkQuota('b',q),null);j.spend('b');
  assert.match(j.checkQuota('c',q),/used up/);
  assert.equal(j.left(q),0);
});

test('website: full run over the API, guards, and the recorded run',async()=>{
  const dataDir=await tmp(),port=8300+Math.floor(Math.random()*500);
  const srv=spawn('node',['web.mjs'],{cwd:ROOT,env:{...process.env,PORT:String(port),DATA_DIR:dataDir,REAL_KANE:'',FIX_API_URL:''}});
  try{
    await new Promise((res,rej)=>{srv.stdout.on('data',d=>/culprit web on/.test(String(d))&&res());srv.on('exit',()=>rej(new Error('server exited')));setTimeout(()=>rej(new Error('server did not start')),8000)});
    const call=(method,p,body,headers={})=>new Promise((res,rej)=>{
      const r=http.request({port,host:'127.0.0.1',path:p,method,headers:{'content-type':'application/json',...headers}},x=>{let b='';x.on('data',c=>b+=c);x.on('end',()=>res({status:x.statusCode,body:b}))});
      r.on('error',rej);if(body)r.write(JSON.stringify(body));r.end();
    });
    assert.equal((await call('POST','/api/jobs',{kind:'demo'})).status,403);                         // no page header
    assert.equal((await call('POST','/api/jobs',{kind:'demo'},{'x-culprit':'1',origin:'https://evil.example'})).status,403);
    assert.equal((await call('POST','/api/jobs',{kind:'repo'},{'x-culprit':'1'})).status,400);        // own repo needs real Kane
    const st=JSON.parse((await call('GET','/api/status')).body);assert.equal(st.mode,'standin');
    const rec=JSON.parse((await call('GET','/api/jobs/real-nov16')).body);
    assert.equal(rec.mode,'recorded');assert.equal(rec.result.bisect.status,'found');assert.equal(rec.result.fix.verdict,'good');
    const made=await call('POST','/api/jobs',{kind:'demo'},{'x-culprit':'1'});assert.equal(made.status,201);
    const {id}=JSON.parse(made.body);
    let job;for(let i=0;i<60;i++){job=JSON.parse((await call('GET','/api/jobs/'+id)).body);if(job.status==='done'||job.status==='error')break;await new Promise(r=>setTimeout(r,500))}
    assert.equal(job.status,'done',job.error);
    assert.equal(job.result.bisect.status,'found');assert.equal(job.result.culprit.subject,'refactor: centralize event wiring');
    assert.equal(job.result.fix.verdict,'good');assert.ok(job.result.fix.patch.includes('Revert'));
    const types=new Set(job.events.map(e=>e.type));for(const t of ['commits','probe_start','probe','result','end'])assert.ok(types.has(t),t);
    assert.equal((await call('GET',`/api/jobs/${id}/patch`)).status,200);
    assert.equal((await call('GET',`/api/jobs/${id}/report/`)).status,200);
    assert.equal((await call('GET',`/api/jobs/${id}/report/..%2f..%2fjob.json`)).status,404);
    assert.equal((await call('GET','/r/'+id)).status,200);
    assert.equal((await call('GET','/api/jobs/zzzzzzzzzzzz')).status,404);
  }finally{srv.kill()}
});

import {trustedStart} from '../lib/repo.mjs';
import {mkdtempSync,writeFileSync} from 'node:fs';
test('trustedStart: only listed owners, only `node <file>`',()=>{
  const d=mkdtempSync(path.join(os.tmpdir(),'ts-'));
  const w=c=>writeFileSync(path.join(d,'culprit.json'),JSON.stringify({start:c}));
  w('node server.js');
  assert.equal(trustedStart({dir:d,owner:'BenCoy09',trusted:'bencoy09'}),'node server.js');
  assert.equal(trustedStart({dir:d,owner:'stranger',trusted:'bencoy09'}),null);
  assert.equal(trustedStart({dir:d,owner:'BenCoy09',trusted:''}),null);
  for(const bad of ['npm start','node ../x.js','node a.js; rm -rf /','node $(id).js','sh run.sh','node server.js && curl x']){w(bad);assert.equal(trustedStart({dir:d,owner:'bencoy09',trusted:'bencoy09'}),null,bad)}
});
