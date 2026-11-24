// The three kinds of run the website can start. All of them use the same engine (runCulprit);
// they differ only in where the repo and the recorded Kane test come from.
import {mkdir,mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {runCulprit} from './run.mjs';
import {runTestmd} from './kane.mjs';
import {waitReady} from './probe.mjs';
import {git,rev,commitsBetween,subject,author,short} from './git.mjs';
import {listCommits,repoDir,MAX_COMMITS,trustedStart} from './repo.mjs';
import {seed} from '../demo/seed.mjs';

const clip=(s,n)=>{s=String(s??'');return s.length>n?s.slice(0,n)+'\n...(clipped)':s};

// Keeps saved runs small: no raw Result.md or stderr per probe, and long diffs are clipped.
export function slim(r){
  return {
    good:r.good,bad:r.bad,startedAt:r.startedAt,
    commits:r.commits,
    bisect:{status:r.bisect.status,reason:r.bisect.reason,ms:r.bisect.ms,
      probes:r.bisect.probes.map(p=>({label:p.label,sha:p.sha,verdict:p.verdict,ms:p.ms,failures:(p.failures||[]).slice(0,3),
        kaneUrl:p.kane?.testUrl||null,credits:p.kane?.credits??null,evidence:p.evidence||[]}))},
    searchProbes:r.searchProbes,
    culprit:r.culprit?{...r.culprit,diff:clip(r.culprit.diff,20000)}:null,
    baseline:r.baseline||null,
    fix:r.fix?{mode:r.fix.mode,skipped:r.fix.skipped||false,error:r.fix.error||null,commit:r.fix.commit||null,message:r.fix.message||null,
      verdict:r.fix.verdict||null,failures:(r.fix.failures||[]).slice(0,3),kaneUrl:r.fix.kane?.testUrl||null,evidence:r.fix.evidence||[],
      patch:r.fix.patch?clip(r.fix.patch,30000):null,
      attempts:(r.fix.attempts||[]).map(a=>({n:a.n,message:a.message||null,files:(a.edits||[]).map(e=>e.file),verdict:a.verdict||null,
        error:a.error||null,failures:(a.failures||[]).slice(0,2),kaneUrl:a.kane?.testUrl||null})),
      revertTried:r.fix.revertTried?{verdict:r.fix.revertTried.verdict}:null}:null,
  };
}

function describe(dir,good,bad){
  const rows=[good,...commitsBetween(dir,good,bad)];
  return rows.map(sha=>({sha,short:short(sha),subject:subject(dir,sha),author:author(dir,sha)}));
}

function common(cfg,job,jobDir,emit){
  return {
    kaneBin:cfg.kaneBin,port:cfg.probePort,stability:Number(process.env.STABILITY||(cfg.real?1:3)), // real replays take 20-70 s each; the answer is still double-checked
    out:path.join(jobDir,'report'),evidence:cfg.real?path.join(jobDir,'evidence'):undefined,
    onEvent:emit,
  };
}

// ---- 1. The demo shop: the history the real Kane test was recorded on ----
export async function runDemo({job,emit,cfg,jobDir}){
  const hard=job.params.variant==='hard';
  emit({type:'phase',id:'prepare',text:'Building the demo shop: 16 commits, one of them quietly breaks checkout'});
  const dir=path.join(jobDir,'repo');
  const s=await seed(dir,{cleanRevert:!hard});
  const commits=describe(dir,s.good,s.bad);
  emit({type:'commits',commits,good:s.good,bad:s.bad});
  try{
    const res=await runCulprit({
      ...common(cfg,job,jobDir,emit),repo:dir,test:'tests/checkout_test.md',good:s.good,bad:s.bad,app:'node server.js',
      bundle:cfg.real?cfg.bundleDir:undefined,fix:'auto',attempts:3,baseline:false,
    });
    return slim(res);
  }finally{await rm(dir,{recursive:true,force:true}).catch(()=>{})}
}

// ---- 2. A visitor's own repo: Kane records their plain-English steps, then the same search + fix ----
export function stepsToTest(steps,title='Your flow'){
  const clean=s=>String(s).replace(/[\r\n]+/g,' ').replace(/^[#>\-\s]+/,'').trim();
  return `---\nmode: testing\nheadless: true\n---\n\n# ${clean(title).slice(0,80)||'Your flow'}\n\n`+
    steps.map((s,i)=>`## Step ${i+1}\n${clean(s)}\n`).join('\n');
}

export function validateSteps(input){
  const steps=(Array.isArray(input)?input:String(input||'').split('\n')).map(s=>String(s).trim()).filter(Boolean);
  if(!steps.length)throw new Error('Describe at least one step, like: Click "Add to cart". Check the cart shows 1.');
  if(steps.length>6)throw new Error('Keep it to 6 steps or fewer. Short flows are more reliable.');
  for(const s of steps){
    if(s.length>300)throw new Error('Each step should be one or two sentences (under 300 characters).');
    if(/https?:\/\//i.test(s))throw new Error('Leave links out. Culprit opens your site for you.');
    if(/[\u0000-\u001f]/.test(s))throw new Error('Steps can only contain plain text.');
  }
  return steps;
}

async function authorOnGood({dir,good,steps,cfg,bundle,emit,startCmd}){
  const work=await mkdtemp(path.join(os.tmpdir(),'culprit-author-'));
  const wt=path.join(work,'app');
  let srv;
  try{
    git(dir,'worktree','add','--detach',wt,good);
    await mkdir(bundle,{recursive:true});
    await writeFile(path.join(bundle,'flow_test.md'),stepsToTest(steps));
    srv=startCmd?spawn(startCmd,{cwd:wt,shell:true,detached:true,stdio:'ignore',env:{PATH:process.env.PATH,HOME:os.tmpdir(),PORT:String(cfg.probePort)}})
      :spawn('node',[cfg.staticServer],{cwd:wt,detached:true,stdio:'ignore',env:{PATH:process.env.PATH,PORT:String(cfg.probePort)}});
    const url=`http://localhost:${cfg.probePort}`;
    if(!await waitReady(url))throw Object.assign(new Error('Could not start your site at the commit you marked as working.'),{hint:startCmd?`The start command "${startCmd}" did not answer on the port. The app must listen on process.env.PORT.`:'Culprit serves static sites: an index.html in the repo root or in a public, docs, dist or build folder.'});
    emit({type:'note',text:'Your site is up. Kane is opening it in a real browser.'});
    const r=await runTestmd({testPath:path.join(bundle,'flow_test.md'),url,cwd:work,bin:cfg.kaneBin,timeoutMs:8*60_000});
    if(r.verdict!=='good'){
      const why=r.failures[0]||(r.stderrTail||'').trim().split('\n').pop()||'no detail';
      throw Object.assign(new Error(r.verdict==='bad'
        ?'Kane could not complete your steps on the version you marked as working.'
        :'Kane could not run on this machine right now.'),
        {hint:r.verdict==='bad'?`Kane said: ${why}. Try one clear action per step, and say what you expect to see.`:`Detail: ${why}`,detail:clip(r.resultMd,2000)});
    }
    return r;
  }finally{
    if(srv?.pid){try{process.kill(-srv.pid,'SIGKILL')}catch{}}
    try{git(dir,'worktree','remove','--force',wt)}catch{}
    await rm(work,{recursive:true,force:true}).catch(()=>{});
  }
}

export async function runRepo({job,emit,cfg,jobDir}){
  const {repoId,good,steps,agent}=job.params;
  emit({type:'phase',id:'prepare',text:'Opening your repo'});
  const dir=repoDir(cfg.reposDir,repoId);
  if(!existsSync(path.join(dir,'.git')))throw Object.assign(new Error('That repo expired. Load it again.'),{hint:'Loaded repos are kept for two hours.'});
  const head=rev(dir,'HEAD');
  const recent=listCommits(dir,MAX_COMMITS).map(c=>c.sha);
  const goodSha=recent.find(s=>s===good||s.startsWith(good));
  if(!goodSha)throw new Error('Pick the last commit that worked from the list.');
  if(goodSha===head)throw new Error('The last working commit cannot be the latest one. Pick an earlier commit.');
  git(dir,'reset','--hard',head);
  const commits=describe(dir,goodSha,head);
  emit({type:'commits',commits,good:goodSha,bad:head});
  const bundle=path.join(jobDir,'bundle');
  const startCmd=trustedStart({dir,owner:String(job.params.repo?.name||'').split('/')[0],trusted:process.env.TRUSTED_OWNERS});
  if(startCmd)emit({type:'note',text:`Trusted-owner app mode: starting your app with "${startCmd}" (no install step).`});
  try{
    emit({type:'phase',id:'author',text:'Kane is recording your steps on the version that worked'});
    await authorOnGood({dir,good:goodSha,steps,cfg,bundle,emit,startCmd});
    emit({type:'note',text:'Recorded. From here every check replays that same recording.'});
    const res=await runCulprit({
      ...common(cfg,job,jobDir,emit),repo:dir,test:'tests/flow_test.md',good:goodSha,bad:head,
      app:startCmd||`node ${JSON.stringify(cfg.staticServer)}`,bundle,fix:agent&&cfg.agentOn?'auto':'revert',attempts:3,baseline:false,
      appEnv:{PATH:process.env.PATH,HOME:os.tmpdir()},
    });
    return slim(res);
  }finally{
    try{git(dir,'reset','--hard',head)}catch{}     // the fix commit lives only in the saved patch; the clone stays reusable
  }
}

// ---- 3. The recorded real run: built once from the committed result of the real Kane run (Nov 16) ----
export async function buildRecorded(resultPath){
  const r=JSON.parse(await readFile(resultPath,'utf8'));
  const events=[];let t=0;
  const push=e=>events.push({seq:events.length,t,...e});
  push({type:'status',status:'running'});
  push({type:'phase',id:'prepare',text:'Demo shop history: 16 commits, one planted bug. The checkout test was recorded once with real Kane.'});
  t=400;
  const commits=r.commits.map(c=>({...c,author:'coding-agent'}));
  push({type:'commits',commits,good:r.good,bad:r.bad});
  t=900;
  const brief=p=>({verdict:p.verdict,ms:p.ms,failures:(p.failures||[]).slice(0,3),kaneUrl:p.kane?.testUrl||null,credits:p.kane?.credits??null,evidence:[]});
  for(const p of r.bisect.probes){
    push({type:'probe_start',label:p.label,sha:p.sha});t+=p.ms;
    push({type:'probe',label:p.label,sha:p.sha,...brief(p)});t+=250;
  }
  if(r.fix?.commit){
    push({type:'probe_start',label:'fix-verify',sha:r.fix.commit});t+=r.fix.ms||30000;
    push({type:'probe',label:'fix-verify',sha:r.fix.commit,...brief({verdict:r.fix.verdict,ms:r.fix.ms,failures:r.fix.failures})});t+=300;
  }
  const fix=r.fix?{...r.fix,patch:null}:null;
  const result=slim({...r,commits,fix,bisect:r.bisect});
  push({type:'result',result});t+=100;
  push({type:'end',status:'done'});
  return {id:'real-nov16',kind:'replay',mode:'recorded',status:'done',createdAt:Date.parse(r.startedAt),recordedAt:r.startedAt,
    realMs:t,events,result,error:null,params:{}};
}
