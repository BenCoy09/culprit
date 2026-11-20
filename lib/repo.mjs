// Fetching a visitor's public GitHub repo safely, and listing its recent commits.
import {execFile} from 'node:child_process';
import {mkdir,rm,readdir,stat} from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {git} from './git.mjs';

export const MAX_COMMITS=40;     // commits offered as "last good"; bisect needs at most 6 checks for 40
const CLONE_DEPTH=60;
const CLONE_TIMEOUT_MS=90_000;
const MAX_REPO_KB=250_000;       // 250 MB on disk after a shallow clone
const KEEP_MS=2*60*60*1000;      // clones are throw-away: swept after 2 hours

const GH=/^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/;

// Returns {url,owner,name} or throws a message meant for the visitor.
export function parseRepoUrl(input,{allowLocal=false}={}){
  const raw=String(input||'').trim();
  if(allowLocal&&/^file:\/\//.test(raw))return {url:raw,owner:'local',name:path.basename(raw.replace(/^file:\/\//,''))};
  const m=GH.exec(raw);
  if(!m)throw new Error('Paste a public GitHub repo link, like https://github.com/your-name/your-repo');
  if(m[2]==='.'||m[2]==='..')throw new Error('That repo name does not look right.');
  return {url:`https://github.com/${m[1]}/${m[2]}`,owner:m[1],name:m[2]};
}

const run=(args,opts)=>new Promise((resolve,reject)=>{
  execFile('git',args,{...opts,maxBuffer:1<<26},(err,stdout,stderr)=>err?reject(Object.assign(err,{stderr:String(stderr||'')})):resolve(String(stdout)));
});

export async function sweep(reposDir){
  try{
    for(const d of await readdir(reposDir)){
      const p=path.join(reposDir,d);
      const st=await stat(p).catch(()=>null);
      if(st&&Date.now()-st.mtimeMs>KEEP_MS)await rm(p,{recursive:true,force:true});
    }
  }catch{}
}

async function sizeKb(dir){
  const out=await new Promise(r=>execFile('du',['-sk',dir],(e,o)=>r(e?'0':String(o))));
  return Number(out.split(/\s+/)[0])||0;
}

export function listCommits(dir,n=MAX_COMMITS){
  const out=git(dir,'log','--first-parent',`-n${n}`,'--format=%H%x1f%an%x1f%aI%x1f%s');
  return out.split('\n').filter(Boolean).map(l=>{const [sha,author,date,subject]=l.split('\x1f');return {sha,short:sha.slice(0,7),author,date,subject}});
}

// Shallow-clones into <reposDir>/<id> and returns what the page needs to let the visitor pick "the last commit that worked".
export async function inspectRepo({input,reposDir,allowLocal=false}){
  const {url,owner,name}=parseRepoUrl(input,{allowLocal});
  await mkdir(reposDir,{recursive:true});
  await sweep(reposDir);
  const id=crypto.randomBytes(5).toString('hex');
  const dir=path.join(reposDir,id);
  try{
    await run(['-c','protocol.file.allow='+(allowLocal?'always':'never'),'-c','core.hooksPath=/dev/null','-c','filter.lfs.smudge=','-c','filter.lfs.required=false',
      'clone','--depth',String(CLONE_DEPTH),'--no-tags','--single-branch','--no-local',url,dir],
      {timeout:CLONE_TIMEOUT_MS,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_LFS_SKIP_SMUDGE:'1'}});
  }catch(e){
    await rm(dir,{recursive:true,force:true});
    const msg=String(e.stderr||e.message);
    if(e.killed||/timed out|SIGTERM/i.test(msg))throw new Error('Cloning took too long. Try a smaller repo.');
    if(/not found|could not read|authentication|Repository not found|terminal prompts disabled/i.test(msg))
      throw new Error('Could not open that repo. It must be public, and the link must be right.');
    throw new Error('Could not fetch that repo.');
  }
  if(await sizeKb(dir)>MAX_REPO_KB){await rm(dir,{recursive:true,force:true});throw new Error('That repo is too big for the free demo (over 250 MB).')}
  const commits=listCommits(dir);
  if(commits.length<2){await rm(dir,{recursive:true,force:true});throw new Error('This repo needs at least two commits to search.')}
  const branch=git(dir,'rev-parse','--abbrev-ref','HEAD');
  return {repoId:id,url,owner,name,branch,head:commits[0].sha,commits,shallow:commits.length>=MAX_COMMITS};
}

export const repoDir=(reposDir,id)=>{
  if(!/^[a-f0-9]{10}$/.test(String(id)))throw new Error('Unknown repo. Load it again.');
  return path.join(reposDir,id);
};
