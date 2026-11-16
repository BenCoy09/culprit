import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {git,rev,patch,changedFiles} from './git.mjs';

const SYSTEM=`You repair a regression in a small web app. You get the commit that broke a browser test, the failing step, and the current files.
Reply with ONLY JSON: {"message":"short commit message","edits":[{"file":"path","old_str":"exact text","new_str":"replacement"}]}
Rules: old_str must appear exactly once in the file. Edit only files shown. Restore the broken behavior with the smallest change. Never delete the feature, and never touch tests.`;

async function askAgent({diff,failures,files,model}){
  const user=`Failing test evidence:\n${failures.map(f=>'- '+f).join('\n')||'- (none captured)'}\n\nBreaking commit:\n${diff}\n\nCurrent files:\n`+
    files.map(f=>`### ${f.path}\n${f.text}`).join('\n\n');
  // Any OpenAI-compatible endpoint works (Gemini free tier, Groq, OpenRouter, Ollama); Anthropic is used when its key is set.
  const compat=process.env.FIX_API_URL;let text;
  if(compat){
    const res=await fetch(compat,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+(process.env.FIX_API_KEY??'')},
      body:JSON.stringify({model,max_tokens:2500,temperature:0,messages:[{role:'system',content:SYSTEM},{role:'user',content:user}]})});
    if(!res.ok)throw new Error(`agent API ${res.status}: ${(await res.text()).slice(0,200)}`);
    text=(await res.json()).choices?.[0]?.message?.content??'';
  }else{
    const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
      headers:{'content-type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY??'','anthropic-version':'2023-06-01'},
      body:JSON.stringify({model,max_tokens:2500,system:SYSTEM,messages:[{role:'user',content:user}]})});
    if(!res.ok)throw new Error(`agent API ${res.status}: ${(await res.text()).slice(0,200)}`);
    text=(await res.json()).content.filter(b=>b.type==='text').map(b=>b.text).join('');
  }
  text=text.replace(/```json|```/g,'').trim();
  const fix=JSON.parse(text);
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

export async function applyFix({mode,repo,culprit,testDirRel,failures,model=process.env.MODEL||'claude-sonnet-5-5'}){
  if(mode==='none')return {mode,skipped:true};
  if(mode==='revert'){
    try{git(repo,'-c','user.name=culprit','-c','user.email=culprit@local','revert','--no-edit',culprit)}
    catch(e){
      const msg=String(e.stderr||e.stdout||e.message);
      try{git(repo,'revert','--abort')}catch{}
      return {mode,error:/conflict/i.test(msg)?'revert conflicted; needs a manual or agent fix':'revert failed: '+msg.trim().split('\n')[0]};
    }
    guard(repo,testDirRel);
    return {mode,commit:rev(repo,'HEAD'),message:git(repo,'log','-1','--format=%s')};
  }
  if(mode==='agent'){
    const names=git(repo,'show','--name-only','--format=',culprit).split('\n').filter(f=>f&&!f.startsWith(testDirRel+'/'));
    const files=await Promise.all(names.map(async p=>({path:p,text:await readFile(path.join(repo,p),'utf8')})));
    const fix=await askAgent({diff:patch(repo,culprit),failures,files,model});
    await applyEdits(repo,fix.edits,testDirRel);
    git(repo,'add','-A');
    git(repo,'-c','user.name=culprit-agent','-c','user.email=agent@culprit.local','commit','-m',`fix: ${fix.message} (culprit ${culprit.slice(0,7)})`);
    guard(repo,testDirRel);
    return {mode,commit:rev(repo,'HEAD'),message:fix.message,edits:fix.edits};
  }
  throw new Error('unknown fix mode: '+mode);
}
