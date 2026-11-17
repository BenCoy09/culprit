#!/usr/bin/env node
import {runCulprit,gate0} from '../lib/run.mjs';
import path from 'node:path';
import {short} from '../lib/git.mjs';

const [cmd,...rest]=process.argv.slice(2);
const o={};
for(let i=0;i<rest.length;i++){const a=rest[i];if(a.startsWith('--')){const k=a.slice(2);o[k]=(rest[i+1]&&!rest[i+1].startsWith('--'))?rest[++i]:true}}
const need=['repo','test','good','app'].filter(k=>!o[k]);
if(!['run','gate0'].includes(cmd)||need.length){
  console.log(`usage:
  culprit gate0 --repo <path> --test tests/x_test.md --good <sha> --bad HEAD --app "node server.js" [--runs 10]
  culprit run   --repo <path> --test tests/x_test.md --good <sha> --bad HEAD --app "node server.js"
                [--fix auto|revert|agent|none] [--attempts 3] [--baseline] [--stability 3] [--setup "npm ci"]
                [--bundle <dir with test + output-*>] [--evidence <dir for Kane .evidence packs>] [--port 3000] [--out culprit-report]
--fix (bare, = auto; off unless given, because it commits to your repo): plain git revert if it applies and Kane confirms it, otherwise the agent loop:
  Kane evidence -> agent patch -> Kane replays the same frozen test -> on failure Kane's new evidence goes back to the agent (--attempts).
env: KANE_BIN (default kane-cli); for the agent: FIX_API_URL + FIX_API_KEY + MODEL (any OpenAI-compatible endpoint) or ANTHROPIC_API_KEY`);
  process.exit(need.length&&['run','gate0'].includes(cmd)?2:0);
}
o.kaneBin=o['kane-bin']||process.env.KANE_BIN||'kane-cli';
if(o.kaneBin.includes('/'))o.kaneBin=path.resolve(o.kaneBin); // probes run from temp dirs
if(o.bundle)o.bundle=path.resolve(o.bundle);
o.stability=o.stability?Number(o.stability):3;
o.fix=o.fix===true?'auto':(o.fix||'none'); // fixing commits into your repo is opt-in; bare --fix means auto
if(o.evidence===true)o.evidence='culprit-report/evidence';
o.out=o.out===true?'culprit-report':o.out||'culprit-report';
o.log=(label,sha,v)=>console.log(`  ${String(label).padEnd(16)} ${typeof sha==='string'?short(sha):sha}  ${v}`);

o.detail=(side,r)=>{console.log(`\n--- why the first unexpected ${side} probe was "${r.verdict}" (exit ${r.exit}, ${r.ms}ms)`);
  console.log('failures:',JSON.stringify(r.failures));
  if(r.stderrTail)console.log('stderr tail:\n'+r.stderrTail.trim());
  if(r.resultMd)console.log('Result.md:\n'+r.resultMd.trim());console.log('---\n')};
if(cmd==='gate0'){
  const g=await gate0(o);
  console.log(`\nGate 0: good commit passed ${g.goodPass}/${g.runs}, bad commit failed ${g.badFail}/${g.runs}, errors ${g.errors}`);
  console.log(g.ok?'Replay is stable enough to bisect.':'NOT stable. Do not trust a bisect result on this test yet.');
  process.exit(g.ok?0:1);
}
const r=await runCulprit(o);
console.log('');
if(r.bisect.status==='abort'){console.log('Aborted: '+r.bisect.reason);}
else{
  console.log(`Culprit: ${r.culprit.short} ${r.culprit.subject}`);
  console.log(`Search probes: ${r.searchProbes} of ${r.commits.length-1} commits`);
  if(r.baseline)console.log(`Linear scan:   ${r.baseline.probes} probes`);
  if(r.fix){
    const n=r.fix.attempts?.length;
    if(r.fix.error)console.log(`Fix failed: ${r.fix.error}`);
    else console.log(`Fix (${r.fix.mode}): ${r.fix.message||'-'}  re-verify: ${r.fix.verdict||'-'}${n?`  attempts: ${n}`:''}`);
    for(const a of r.fix.attempts||[])console.log(`  try ${a.n}: ${a.error?'error: '+a.error:`Kane said ${a.verdict}${a.failures?.length?' ('+a.failures[0]+')':''}`}`);
    const url=r.fix.kane?.testUrl||r.fix.attempts?.at(-1)?.kane?.testUrl;if(url)console.log(`Kane run: ${url}`);
  }
}
console.log(`Report: ${o.out}/index.html`);
process.exit(r.bisect.status==='found'&&(!r.fix||r.fix.skipped||(!r.fix.error&&r.fix.verdict==='good'))?0:1);
