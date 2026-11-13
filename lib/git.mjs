import {execFileSync} from 'node:child_process';
export const git=(cwd,...a)=>execFileSync('git',a,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1<<28}).trim();
export const rev=(cwd,r)=>git(cwd,'rev-parse',r);
// Oldest to newest, excludes `good`, includes `bad`. First-parent keeps merges from breaking the ordering.
export const commitsBetween=(cwd,good,bad)=>git(cwd,'rev-list','--reverse','--first-parent',`${good}..${bad}`).split('\n').filter(Boolean);
export const subject=(cwd,sha)=>git(cwd,'log','-1','--format=%s',sha);
export const author=(cwd,sha)=>git(cwd,'log','-1','--format=%an',sha);
export const patch=(cwd,sha)=>git(cwd,'show','--patch','--format=%h %s',sha);
export const changedFiles=(cwd,a,b)=>git(cwd,'diff','--name-only',a,b).split('\n').filter(Boolean);
export const short=sha=>sha.slice(0,7);
