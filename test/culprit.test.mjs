import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {seed} from '../demo/seed.mjs';
import {runCulprit,gate0} from '../lib/run.mjs';
import {parseTestmd} from '../lib/kane.mjs';
import {git} from '../lib/git.mjs';

const FAKE=path.join(path.dirname(fileURLToPath(import.meta.url)),'../demo/fake-kane.mjs');
const base={test:'tests/checkout_test.md',app:'node server.js',kaneBin:FAKE,stability:1};
let port=3300;
const tmp=()=>mkdtemp(path.join(os.tmpdir(),'culprit-test-'));

test('parseTestmd reads test_md_done and failed step remarks, ignoring junk',()=>{
  const r=parseTestmd(['junk','{"type":"test_md_done","overall_status":"failed"}','{"step":2,"status":"failed","remark":"Pay: nothing happened"}','{"type":"future_event"}']);
  assert.equal(r.done.overall_status,'failed');assert.deepEqual(r.failures,['Pay: nothing happened']);
});

test('gate0 passes when the test is stable at both ends',async()=>{
  const s=await seed(await tmp());
  const g=await gate0({...base,repo:s.dir,good:s.good,bad:s.bad,runs:3,port:port++});
  assert.equal(g.ok,true);assert.equal(g.goodPass,3);assert.equal(g.badFail,3);
});

test('bisect finds the seeded regression in log2(n) search probes, reverts it, and re-verifies',async()=>{
  const s=await seed(await tmp(),{cleanRevert:true});
  const res=await runCulprit({...base,repo:s.dir,good:s.good,bad:s.bad,fix:'revert',baseline:true,port:port++});
  assert.equal(res.bisect.status,'found');
  assert.equal(res.culprit.subject,s.culpritSubject);
  assert.ok(res.searchProbes<=4,'search probes: '+res.searchProbes);   // 15 commits -> at most 4
  assert.equal(res.baseline.probes,7);                                   // linear scan has to walk 7 commits
  assert.equal(res.fix.verdict,'good');
  assert.match(git(s.dir,'log','-1','--format=%s'),/^Revert/);
});

test('when a plain revert conflicts, it says so instead of pretending',async()=>{
  const s=await seed(await tmp());               // later commit edits the same button line
  const res=await runCulprit({...base,repo:s.dir,good:s.good,bad:s.bad,fix:'revert',port:port++});
  assert.equal(res.bisect.status,'found');
  assert.match(res.fix.error,/conflicted/);
});

test('agent fix path: patch applied, committed, re-verified green (API call stubbed, not a real model)',async()=>{
  const s=await seed(await tmp());
  const real=globalThis.fetch;
  globalThis.fetch=async(u,i)=>String(u).includes('api.anthropic.com')
    ? new Response(JSON.stringify({content:[{type:'text',text:JSON.stringify({message:'rewire Pay now',edits:[{file:'public/index.html',
        old_str:'<button id="pay" aria-label="Pay now">',new_str:'<button id="pay" aria-label="Pay now" onclick="submitOrder()">'}]})}]}),{status:200})
    : real(u,i);
  try{
    const res=await runCulprit({...base,repo:s.dir,good:s.good,bad:s.bad,fix:'agent',port:port++});
    assert.equal(res.fix.verdict,'good');
    assert.match(git(s.dir,'log','-1','--format=%s'),/^fix: rewire Pay now/);
  }finally{globalThis.fetch=real}
});

test('agent fix via an OpenAI-compatible endpoint (free-tier providers); API call stubbed',async()=>{
  const s=await seed(await tmp());
  const real=globalThis.fetch;process.env.FIX_API_URL='http://stub.local/v1/chat/completions';
  globalThis.fetch=async(u,i)=>String(u).includes('stub.local')
    ? new Response(JSON.stringify({choices:[{message:{content:'```json\n'+JSON.stringify({message:'rewire Pay now',edits:[{file:'public/index.html',
        old_str:'<button id="pay" aria-label="Pay now">',new_str:'<button id="pay" aria-label="Pay now" onclick="submitOrder()">'}]})+'\n```'}}]}),{status:200})
    : real(u,i);
  try{
    const res=await runCulprit({...base,repo:s.dir,good:s.good,bad:s.bad,fix:'agent',port:port++});
    assert.equal(res.fix.verdict,'good');
  }finally{globalThis.fetch=real;delete process.env.FIX_API_URL}
});

test('aborts instead of guessing when the known-good commit actually fails',async()=>{
  const s=await seed(await tmp());
  const culpritSha=git(s.dir,'log','--format=%H','--grep','centralize event wiring');
  const res=await runCulprit({...base,repo:s.dir,good:culpritSha,bad:s.bad,port:port++});
  assert.equal(res.bisect.status,'abort');
  assert.match(res.bisect.reason,/known-good commit does not pass/);
});

test('an environment error is a skip, never a bad commit',async()=>{
  const s=await seed(await tmp());
  const res=await runCulprit({...base,repo:s.dir,good:s.good,bad:s.bad,app:'node nonexistent.js',port:port++});
  assert.equal(res.bisect.status,'abort');
  assert.match(res.bisect.reason,/environment error/);
});

test('the fix cannot touch the test bundle',async()=>{
  const s=await seed(await tmp());
  const {applyEdits}=await import('../lib/fix.mjs');
  await assert.rejects(applyEdits(s.dir,[{file:'tests/checkout_test.md',old_str:'Pay',new_str:'Skip'}],'tests'),/edit the tests/);
});
