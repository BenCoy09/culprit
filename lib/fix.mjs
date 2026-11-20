import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {git,rev,patch,changedFiles} from './git.mjs';

const SYSTEM=`You repair a regression in a small web app. A browser test replayed by Kane CLI failed on the commit you are shown.
You get the breaking commit, Kane's failing-step evidence, the current files, and (after a failed try) what you already tried and what Kane said about it.
Reply with ONLY JSON: {"message":"short commit message","edits":[{"file":"path","old_str":"exact text","new_str":"replacement"}]}
Rules: old_str must appear exactly once in the file. Edit only files shown. Restore the broken behavior with the smallest change. Never delete the feature, and never touch tests.
If a previous try failed, do not repeat it: use Kane's new evidence to change your approach.`;

export const agentConfigured=()=>!!(process.env.FIX_API_URL||process.env.ANTHROPIC_API_KEY);
const clip=(s,n)=>{s=String(s??'');return s.length>n?s.slice(0,n)+'\n...(clipped)':s};

// Builds the prompt. `history` is every earlier try in THIS loop: what the agent changed and what Kane replied.
export function buildPrompt({diff,failures,files,history=[],resultMd}){
  let u=`Failing test evidence from Kane:\n${failures.map(f=>'- '+f).join('\n')||'- (none captured)'}\n`;
  if(resultMd)u+=`\nKane Result.md:\n${clip(resultMd,1800)}\n`;
  u+=`\nBreaking commit:\n${clip(diff,6000)}\n\nCurrent files:\n`+files.map(f=>`### ${f.path}\n${clip(f.text,9000)}`).join('\n\n');
  if(history.length){
    u+='\n\nPrevious tries (each was applied, committed and replayed on Kane; each is now rolled back):\n'+
      history.map(h=>`Try ${h.n}: "${h.message||'(no patch)'}"\n  edits: ${clip(JSON.stringify(h.edits||[]),1500)}\n  Kane verdict: ${h.verdict}\n  Kane said: ${(h.failures||[]).map(f=>'- '+f).join(' ')||(h.error||'(no detail)')}`).join('\n');
  }
  return u;
}

async function askAgent({prompt,model}){
  // Any OpenAI-compatible endpoint works (Gemini free tier, Groq, OpenRouter, Ollama); Anthropic is used when its key is set.
  const compat=process.env.FIX_API_URL;let text;
  if(compat){
    const res=await fetch(compat,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+(process.env.FIX_API_KEY??'')},
      body:JSON.stringify({model,max_tokens:2500,temperature:0,messages:[{role:'system',content:SYSTEM},{role:'user',content:prompt}]})});
    if(!res.ok)throw new Error(`agent API ${res.status}: ${(await res.text()).slice(0,200)}`);
    text=(await res.json()).choices?.[0]?.message?.content??'';
  }else{
    const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
      headers:{'content-type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY??'','anthropic-version':'2023-06-01'},
      body:JSON.stringify({model,max_tokens:2500,system:SYSTEM,messages:[{role:'user',content:prompt}]})});
    if(!res.ok)throw new Error(`agent API ${res.status}: ${(await res.text()).slice(0,200)}`);
    text=(await res.json()).content.filter(b=>b.type==='text').map(b=>b.text).join('');
  }
  text=text.replace(/```json|```/g,'').trim();
  const s=text.indexOf('{'),e=text.lastIndexOf('}');
  const fix=JSON.parse(s>=0&&e>s?text.slice(s,e+1):text);
  if(!fix.message||!Array.isArray(fix.edits)||!fix.edits.length)throw new Error('agent reply missing message/edits');
  return fix;
}

export async function applyEdits(repo,edits,testDirRel){
  for(const e of edits){
    const f=path.resolve(repo,e.file);
    if(!f.startsWith(path.resolve(repo)+path.sep))throw new Error('edit outside repo: '+e.file);
    if(f.startsWith(path.resolve(repo,testDirRel)+path.sep))throw new Error('agent tried to edit the tests: '+e.file);
    if(typeof e.old_str!=='string'||!e.old_str||typeof e.new_str!=='string')throw new Error('bad edit shape');
    const src=await readFile(f,'utf8');
    const n=src.split(e.old_str).length-1;
    if(n!==1)throw new Error(`old_str matched ${n} times in ${e.file}`);
    await writeFile(f,src.replace(e.old_str,()=>e.new_str));
  }
}

// Guard: a fix commit may never touch the test bundle. Otherwise "fixing" could mean weakening the test.
function guard(repo,testDirRel){
  const touched=changedFiles(repo,'HEAD~1','HEAD').filter(f=>f===testDirRel||f.startsWith(testDirRel+'/'));
  if(touched.length){git(repo,'reset','--hard','HEAD~1');throw new Error('fix touched the test bundle: '+touched.join(', '));}
}

async function tryRevert({repo,culprit,testDirRel}){
  try{git(repo,'-c','user.name=culprit','-c','user.email=culprit@local','revert','--no-edit',culprit)}
  catch(e){
    const msg=String(e.stderr||e.stdout||e.message);
    try{git(repo,'revert','--abort')}catch{}
    return {error:/conflict/i.test(msg)?'revert conflicted; needs a manual or agent fix':'revert failed: '+msg.trim().split('\n')[0]};
  }
  guard(repo,testDirRel);
  return {commit:rev(repo,'HEAD'),message:git(repo,'log','-1','--format=%s')};
}

// THE CLOSED LOOP. Kane's evidence -> agent patch -> Kane replays the same frozen recordings on the patched commit.
// If Kane still says "bad", the new Kane evidence goes back to the agent with what it already tried (up to maxAttempts).
// A failed try is rolled back, so the repo never keeps a patch Kane did not confirm.
async function agentLoop({repo,culprit,testDirRel,failures,resultMd,verify,model,maxAttempts,log}){
  const start=rev(repo,'HEAD');
  const names=git(repo,'show','--name-only','--format=',culprit).split('\n').filter(f=>f&&!f.startsWith(testDirRel+'/'));
  const diff=patch(repo,culprit);
  const history=[];const attempts=[];
  for(let n=1;n<=maxAttempts;n++){
    const files=await Promise.all(names.map(async p=>({path:p,text:await readFile(path.join(repo,p),'utf8').catch(()=>'(deleted in the working tree)')})));
    const rec={n};
    try{
      log?.(`agent try ${n}`,'-','asking the agent',{asking:true});
      const fix=await askAgent({prompt:buildPrompt({diff,failures,files,history,resultMd}),model});
      rec.message=fix.message;rec.edits=fix.edits;
      await applyEdits(repo,fix.edits,testDirRel);
      git(repo,'add','-A');
      git(repo,'-c','user.name=culprit-agent','-c','user.email=agent@culprit.local','commit','-m',`fix: ${fix.message} (culprit ${culprit.slice(0,7)})`);
      guard(repo,testDirRel);
      rec.commit=rev(repo,'HEAD');
      log?.(`agent try ${n}`,rec.commit,'patched; asking Kane',{n,message:rec.message,edits:rec.edits});
      const r=await verify(rec.commit);
      rec.verdict=r.verdict;rec.failures=r.failures;rec.ms=r.ms;rec.kane=r.kane;rec.evidence=r.evidence;
      log?.(`kane re-verify ${n}`,rec.commit,r.verdict);
      attempts.push(rec);
      if(r.verdict==='good')return {mode:'agent',commit:rec.commit,message:rec.message,edits:rec.edits,verdict:'good',failures:[],ms:r.ms,attempts};
      history.push({...rec});failures=r.failures.length?r.failures:failures;resultMd=r.resultMd||resultMd;
      git(repo,'reset','--hard',start);          // roll the failed patch back: next try starts from the broken state again
    }catch(e){
      rec.error=String(e.message||e);rec.verdict=rec.verdict||'error';
      attempts.push(rec);history.push({...rec});
      try{git(repo,'reset','--hard',start)}catch{}
    }
  }
  const last=attempts[attempts.length-1];
  return {mode:'agent',error:`Kane still failed after ${maxAttempts} agent tries`+(last?.error?` (last: ${last.error})`:''),verdict:'bad',attempts};
}

// mode: none | revert | agent | auto.  auto = plain revert if it applies AND Kane confirms it, otherwise the agent loop.
// `verify(sha)` must replay the frozen Kane test on that commit and return its probe result.
export async function applyFix({mode,repo,culprit,testDirRel,failures,resultMd,verify,model=process.env.MODEL||'claude-sonnet-5-5',maxAttempts=3,log}){
  if(mode==='none')return {mode,skipped:true};
  if(!['revert','agent','auto'].includes(mode))throw new Error('unknown fix mode: '+mode);
  let reverted=null;
  if(mode==='revert'||mode==='auto'){
    const start=rev(repo,'HEAD');
    const r=await tryRevert({repo,culprit,testDirRel});
    if(r.error){
      if(mode==='revert')return {mode,error:r.error};
      log?.('revert','-',r.error);
    }else{
      const v=await verify(r.commit);
      log?.('kane re-verify revert',r.commit,v.verdict);
      const done={mode:'revert',commit:r.commit,message:r.message,verdict:v.verdict,failures:v.failures,ms:v.ms,kane:v.kane,evidence:v.evidence};
      if(v.verdict==='good'||mode==='revert')return done;
      git(repo,'reset','--hard',start);reverted=done;   // auto: a revert Kane did not confirm is rolled back, then the agent takes over
    }
  }
  if(!agentConfigured()){
    return {mode,error:reverted?'revert did not pass Kane and no agent is configured (set FIX_API_URL+FIX_API_KEY+MODEL or ANTHROPIC_API_KEY)'
      :'a plain revert is not enough here and no agent is configured (set FIX_API_URL+FIX_API_KEY+MODEL or ANTHROPIC_API_KEY)'};
  }
  const out=await agentLoop({repo,culprit,testDirRel,failures,resultMd,verify,model,maxAttempts,log});
  if(reverted)out.revertTried=reverted;   // the report says what actually fixed it: "revert" or "agent"
  return out;
}
