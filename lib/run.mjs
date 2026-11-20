import {mkdtemp,mkdir,writeFile,cp} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {rev,commitsBetween,subject,author,patch,short,git} from './git.mjs';
import {probe} from './probe.mjs';
import {bisect,linearScan} from './bisect.mjs';
import {applyFix} from './fix.mjs';
import {renderReport} from './report.mjs';

const brief=r=>({verdict:r.verdict,ms:r.ms,failures:(r.failures||[]).slice(0,3),kaneUrl:r.kane?.testUrl||null,credits:r.kane?.credits??null,evidence:r.evidence||[]});

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
    port:Number(o.port||3000),kaneBin:o.kaneBin,kaneExtra:o.kaneExtra||[],appEnv:o.appEnv,evidenceDir:o.evidence?path.resolve(o.evidence):undefined});
  return {repo,probeFn};
}

export async function runCulprit(o){
  const {repo,probeFn:mk}=setup(o);
  const emit=o.onEvent||(()=>{});
  // One log hook for everyone: the CLI prints lines, the website turns them into live events.
  const log=(label,sha,v,extra)=>{
    o.log?.(label,sha,v,extra);
    if(extra&&'verdict' in extra)emit({type:'probe',label,sha,...brief(extra)});
    else if(extra?.asking)emit({type:'agent',n:Number(label.split(' ').pop()),state:'asking'});
    else if(extra?.message)emit({type:'agent',n:extra.n,state:'patched',commit:sha,message:extra.message,files:(extra.edits||[]).map(e=>e.file)});
    else if(label==='revert')emit({type:'note',text:'A plain undo did not apply cleanly. Handing it to the agent.'});
  };
  const good=rev(repo,o.good),bad=rev(repo,o.bad||'HEAD');
  const commits=commitsBetween(repo,good,bad);
  const testDirRel=path.dirname(o.test);
  const bundleDir=await freeze(repo,good,testDirRel,o.bundle);
  const probeFn=mk(bundleDir);
  const startedAt=new Date().toISOString();const t0=Date.now();
  const b=await bisect({good,commits,probeFn,stability:o.stability??3,log,onStart:(label,sha)=>emit({type:'probe_start',label,sha})});
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
      const confirm=b.probes.filter(p=>p.label==='confirm-culprit');
      const failures=[...new Set(confirm.flatMap(p=>p.failures))];
      try{
        // Re-verification replays the SAME frozen recordings on the patched commit (inside applyFix, once per try).
        const verify=async sha=>{emit({type:'probe_start',label:'fix-verify',sha});const r=await probeFn(sha);emit({type:'probe',label:'fix-verify',sha,...brief(r)});return r};
        result.fix=await applyFix({mode:o.fix,repo,culprit:b.culprit,testDirRel,failures,resultMd:confirm[0]?.resultMd,
          verify,model:o.model,maxAttempts:Number(o.attempts||3),log});
        if(result.fix?.commit){try{result.fix.patch=patch(repo,result.fix.commit)}catch{}}
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
  const shown={};
  const side=async(name,sha,want)=>{for(let i=0;i<n;i++){
    const r=await probeFn(sha);res[name].push(r.verdict);o.log?.(name,i+1,r.verdict);
    if(r.verdict!==want&&!shown[name]){shown[name]=true;o.detail?.(name,r)} // show WHY once per side
  }};
  await side('good',good,'good');await side('bad',bad,'bad');
  const goodPass=res.good.filter(v=>v==='good').length,badFail=res.bad.filter(v=>v==='bad').length;
  return {runs:n,goodPass,badFail,errors:[...res.good,...res.bad].filter(v=>v==='skip').length,ok:goodPass===n&&badFail===n};
}
