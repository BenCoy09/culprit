import {spawn,execSync} from 'node:child_process';
import {mkdtemp,cp,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {git} from './git.mjs';
import {runTestmd} from './kane.mjs';

export async function waitReady(url,ms=15000){
  const t=Date.now();
  while(Date.now()-t<ms){try{const r=await fetch(url);if(r.status<500)return true}catch{}await new Promise(r=>setTimeout(r,150))}
  return false;
}

// One probe: check out `sha` into a throwaway worktree, start the app, replay the FROZEN test bundle against it.
// The bundle is copied per probe so a replay can never alter the recordings the next probe uses.
export async function probe({repo,sha,bundleDir,testRel,appCmd,setupCmd,port,kaneBin,kaneExtra=[],evidenceDir,appEnv}){
  const t0=Date.now();
  const work=await mkdtemp(path.join(os.tmpdir(),'culprit-'));
  const wt=path.join(work,'app');
  let app;
  try{
    git(repo,'worktree','add','--detach',wt,sha);
    const bundle=path.join(work,'bundle');
    await cp(bundleDir,bundle,{recursive:true});
    if(setupCmd)execSync(setupCmd,{cwd:wt,stdio:'ignore'});
    const url=`http://localhost:${port}`; // same origin form as authoring: recordings may be keyed to it
    app=spawn(appCmd,{cwd:wt,shell:true,detached:true,stdio:'ignore',env:{...(appEnv||process.env),PORT:String(port)}});
    if(!await waitReady(url))return {sha,verdict:'skip',exit:2,failures:['app did not start'],ms:Date.now()-t0};
    const r=await runTestmd({testPath:path.join(bundle,path.basename(testRel)),url,cwd:work,bin:kaneBin,extra:kaneExtra});
    const failures=r.failures.length||r.verdict!=='skip'?r.failures:[`kane exited ${r.exit}: ${(r.stderrTail||'no output').trim().split('\n').pop()}`];
    // Keep Kane's sealed .evidence packs (testmd always writes them under <cwd>/.testmuai/evidence) before the temp dir is removed.
    let evidence=[];
    if(evidenceDir){
      try{
        const src=path.join(work,'.testmuai','evidence');
        const dest=path.join(evidenceDir,`${sha.slice(0,7)}-${Date.now()}`);
        await cp(src,dest,{recursive:true});
        evidence=(await readdir(dest)).filter(f=>f.endsWith('.evidence')).map(f=>path.join(path.basename(dest),f));
      }catch{/* no pack produced (stand-in Kane, or Kane refused to start): nothing to keep */}
    }
    return {sha,verdict:r.verdict,exit:r.exit,failures,resultMd:r.resultMd,stderrTail:r.stderrTail,kane:r.kane,evidence,ms:Date.now()-t0};
  }catch(e){
    return {sha,verdict:'skip',exit:2,failures:[String(e.message||e)],ms:Date.now()-t0};
  }finally{
    if(app?.pid){try{process.kill(-app.pid,'SIGKILL')}catch{}}
    try{git(repo,'worktree','remove','--force',wt)}catch{}
    await rm(work,{recursive:true,force:true});
  }
}
