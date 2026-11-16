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
                [--fix revert|agent|none] [--baseline] [--stability 3] [--setup "npm ci"] [--bundle <dir with test + output-*>] [--port 3000] [--out culprit-report]
env: KANE_BIN (default kane-cli), ANTHROPIC_API_KEY + MODEL for --fix agent`);
  process.exit(need.length&&['run','gate0'].includes(cmd)?2:0);
}
o.kaneBin=o['kane-bin']||process.env.KANE_BIN||'kane-cli';
if(o.kaneBin.includes('/'))o.kaneBin=path.resolve(o.kaneBin); // probes run from temp dirs
if(o.bundle)o.bundle=path.resolve(o.bundle);
o.stability=o.stability?Number(o.stability):3;
o.fix=o.fix===true?'revert':(o.fix||'none');
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
  if(r.fix)console.log(r.fix.error?`Fix failed: ${r.fix.error}`:`Fix (${r.fix.mode}): ${r.fix.message||'-'}  re-verify: ${r.fix.verdict||'-'}`);
}
console.log(`Report: ${o.out}/index.html`);
process.exit(r.bisect.status==='found'&&(!r.fix||r.fix.skipped||r.fix.verdict==='good')?0:1);
