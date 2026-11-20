// commits: oldest -> newest, excludes `good`, last one is the known-bad end.
// Errors (verdict 'skip') never count as 'bad': an environment problem must not frame a commit.
export async function bisect({good,commits,probeFn,stability=3,log=()=>{},onStart=()=>{}}){
  const probes=[];
  // onStart/log's 4th argument feed live progress (the website); the CLI ignores them.
  const run=async(sha,label)=>{onStart(label,sha);const r=await probeFn(sha);probes.push({...r,label});log(label,sha,r.verdict,r);return r};
  const abort=reason=>({status:'abort',reason,probes});
  const bad=commits[commits.length-1];
  if(!bad)return abort('no commits between good and bad');
  for(let i=0;i<stability;i++){
    const r=await run(good,'baseline-good');
    if(r.verdict==='skip')return abort('environment error at the known-good commit: '+(r.failures[0]||'unknown'));
    if(r.verdict!=='good')return abort('the known-good commit does not pass the test');
  }
  for(let i=0;i<stability;i++){
    const r=await run(bad,'baseline-bad');
    if(r.verdict==='skip')return abort('environment error at the bad commit: '+(r.failures[0]||'unknown'));
    if(r.verdict!=='bad')return abort('the bad commit passes: there is no regression, or the test is flaky');
  }
  let lo=-1,hi=commits.length-1;
  while(hi-lo>1){
    const mid=(lo+hi)>>1;
    const r=await run(commits[mid],'search');
    if(r.verdict==='skip')return abort(`environment error at ${commits[mid]}: ${r.failures[0]||'unknown'}`);
    if(r.verdict==='good')lo=mid;else hi=mid;
  }
  const culprit=commits[hi],parent=lo>=0?commits[lo]:good;
  for(let i=0;i<2;i++){
    const a=await run(parent,'confirm-parent');
    const b=await run(culprit,'confirm-culprit');
    if(a.verdict!=='good'||b.verdict!=='bad')
      return {status:'inconclusive',reason:'boundary probes disagreed: flaky test or non-monotonic history',culprit,parent,probes};
  }
  return {status:'found',culprit,parent,probes};
}

// What bisect replaces: walk forward from the good commit until the first failure.
export async function linearScan({commits,probeFn}){
  const t0=Date.now();let n=0;
  for(const sha of commits){
    const r=await probeFn(sha);n++;
    if(r.verdict==='bad')return {culprit:sha,probes:n,ms:Date.now()-t0};
    if(r.verdict==='skip')return {culprit:null,probes:n,ms:Date.now()-t0,error:r.failures[0]};
  }
  return {culprit:null,probes:n,ms:Date.now()-t0};
}
