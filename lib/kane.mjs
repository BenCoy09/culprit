import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

// testmd streams are typed on every line and end with `test_md_done`. The process exit code
// is the source of truth for the verdict (0 pass, 1 failed, 2 error, 3 timeout/cancel).
export function parseTestmd(lines){
  const out={done:null,end:null,failures:[]};
  for(const l of lines){
    let e;try{e=JSON.parse(l)}catch{continue}
    if(!e||typeof e!=='object')continue;
    if(e.type==='test_md_done')out.done=e;
    else if(e.type==='run_end')out.end=e;
    else if(e.status==='failed'){const m=e.remark||e.reason||e.summary;if(m)out.failures.push(String(m))}
  }
  return out;
}

// Pulls the fields Kane documents on run_end (and tolerates them being absent: new releases add and move fields).
// Nothing here is invented: a field Kane did not print stays null.
export function kaneMeta(parsed){
  const e={...(parsed.done||{}),...(parsed.end||{})};
  const pick=(...k)=>{for(const x of k)if(e[x]!=null)return e[x];return null};
  return {testUrl:pick('test_url','share_url'),sessionDir:pick('session_dir'),sessionId:pick('session_id'),
    credits:pick('credits_consumed'),summary:pick('summary'),oneLiner:pick('one_liner'),reason:pick('reason')};
}

// Result.md is written next to the test in output-<stem>/ on every run.
export async function readResultMd(testPath){
  const stem=path.basename(testPath).replace(/_test\.md$/,'');
  try{
    const text=await readFile(path.join(path.dirname(testPath),`output-${stem}`,'Result.md'),'utf8');
    const failedSteps=[...text.matchAll(/^## (.+?)\s+\S+\s+failed[^\n]*\n([^\n]*)/gm)].map(m=>`${m[1].trim()}: ${m[2].trim()}`);
    return {text,failedSteps};
  }catch{return {text:null,failedSteps:[]}}
}

export function runTestmd({testPath,url,cwd,bin=process.env.KANE_BIN||'kane-cli',extra=[],timeoutMs=300000}){
  return new Promise(resolve=>{
    // --no-adaptive-heal matters: healing can re-author a broken step and turn a real regression into a pass.
    const args=['testmd','run',testPath,'--url',url,'--agent','--headless','--no-adaptive-heal',...extra];
    // KANE_CLI_USER_AGENT tags the run as coming from this agent harness (Kane's documented convention).
    const p=spawn(bin,args,{cwd,stdio:['ignore','pipe','pipe'],env:{...process.env,KANE_CLI_USER_AGENT:process.env.KANE_CLI_USER_AGENT||'culprit'}});
    const lines=[];let buf='',err='',killed=false,settled=false;
    const finish=async(exit)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      if(buf.trim())lines.push(buf);
      const parsed=parseTestmd(lines);
      const res=await readResultMd(testPath);
      const failures=[...new Set([...parsed.failures,...res.failedSteps])];
      resolve({exit,verdict:exit===0?'good':exit===1?'bad':'skip',overall:parsed.done?.overall_status??parsed.end?.status??null,
        failures,resultMd:res.text,stderrTail:err.slice(-1200),kane:kaneMeta(parsed)});
    };
    const timer=setTimeout(()=>{killed=true;p.kill('SIGTERM')},timeoutMs);
    p.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){lines.push(buf.slice(0,i));buf=buf.slice(i+1)}});
    p.stderr.on('data',d=>{err+=d});
    p.on('error',e=>{err+=String(e);finish(2)});
    p.on('close',code=>finish(killed?3:(code??3)));
  });
}
