import {mkdtemp,mkdir,writeFile,cp} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {rev,commitsBetween,subject,author,patch,short,git} from './git.mjs';
import {probe} from './probe.mjs';
import {bisect,linearScan} from './bisect.mjs';
import {applyFix} from './fix.mjs';
import {renderReport} from './report.mjs';

// The test bundle (test file + recorded replays) is frozen from the GOOD commit and reused for every probe.
async function freeze(repo,good,testDirRel,bundle){
  const frozen=await mkdtemp(path.join(os.tmpdir(),'culprit-bundle-'));
  if(bundle){await cp(bundle,frozen,{recursive:true});return frozen} // recordings authored outside the repo
  const tar=execFileSync('git',['archive','--format=tar',good,testDirRel],{cwd:repo,maxBuffer:1<<28});
  execFileSync('tar',['-x','-C',frozen],{input:tar});
  return path.join(frozen,testDirRel);
}

function setup(o){
  const repo=path.resolve(o.repo);
  const probeFn=(bundleDir)=>sha=>probe({repo,sha,bundleDir,testRel:o.test,appCmd:o.app,setupCmd:o.setup,
    port:Number(o.port||3100),kaneBin:o.kaneBin,kaneExtra:o.kaneExtra||[]});
  return {repo,probeFn};
}

export async function runCulprit(o){
  const {repo,probeFn:mk}=setup(o);
  const log=o.log||(()=>{});
  const good=rev(repo,o.good),bad=rev(repo,o.bad||'HEAD');
  const commits=commitsBetween(repo,good,bad);
  const testDirRel=path.dirname(o.test);
  const bundleDir=await freeze(repo,good,testDirRel,o.bundle);
  const probeFn=mk(bundleDir);
  const startedAt=new Date().toISOString();const t0=Date.now();
  const b=await bisect({good,commits,probeFn,stability:o.stability??3,log});
  const result={repo,good,bad,test:o.test,startedAt,
    commits:[good,...commits].map(sha=>({sha,short:short(sha),subject:subject(repo,sha)})),
    bisect:{status:b.status,reason:b.reason??null,probes:b.probes,ms:Date.now()-t0}};
  result.searchProbes=b.probes.filter(p=>p.label==='search').length;
  if(b.status==='found'||b.status==='inconclusive'){
    result.culprit={sha:b.culprit,short:short(b.culprit),subject:subject(repo,b.culprit),author:author(repo,b.culprit),
      parent:b.parent,diff:patch(repo,b.culprit)};
    if(b.status==='found'&&o.baseline){
      result.baseline=await linearScan({commits,probeFn});
    }
    if(b.status==='found'&&(o.fix||'none')!=='none'){
      const failures=b.probes.filter(p=>p.label==='confirm-culprit').flatMap(p=>p.failures);
      try{
        result.fix=await applyFix({mode:o.fix,repo,culprit:b.culprit,testDirRel,failures:[...new Set(failures)],model:o.model});
        if(result.fix.commit){
          const r=await probeFn(result.fix.commit); // re-verify with the same frozen recordings
          result.fix.verdict=r.verdict;result.fix.failures=r.failures;result.fix.ms=r.ms;
        }
      }catch(e){result.fix={mode:o.fix,error:String(e.message||e)}}
    }
  }
  if(o.out){
    await mkdir(o.out,{recursive:true});
    await writeFile(path.join(o.out,'result.json'),JSON.stringify(result,null,2));
    await writeFile(path.join(o.out,'index.html'),renderReport(result));
  }
  return result;
}

// Gate 0: is replay stable enough to bisect with? N runs at the good commit and N at the bad one.
export async function gate0(o){
  const {repo,probeFn:mk}=setup(o);
  const good=rev(repo,o.good),bad=rev(repo,o.bad||'HEAD');
  const bundleDir=await freeze(repo,good,path.dirname(o.test),o.bundle);
  const probeFn=mk(bundleDir);const n=Number(o.runs||10);const res={good:[],bad:[]};
  for(let i=0;i<n;i++){res.good.push((await probeFn(good)).verdict);o.log?.('good',i+1,res.good.at(-1))}
  for(let i=0;i<n;i++){res.bad.push((await probeFn(bad)).verdict);o.log?.('bad',i+1,res.bad.at(-1))}
  const goodPass=res.good.filter(v=>v==='good').length,badFail=res.bad.filter(v=>v==='bad').length;
  return {runs:n,goodPass,badFail,errors:[...res.good,...res.bad].filter(v=>v==='skip').length,ok:goodPass===n&&badFail===n};
}
