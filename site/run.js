// The run page: shows a Culprit run live (stream) or after the fact, and replays the recorded real run.
(function(){
const {esc,api,dur,clock,copy}=C;
const $=s=>document.querySelector(s);
const id=location.pathname.split('/').filter(Boolean).pop();
const params=new URLSearchParams(location.search);

const WHY={'baseline-good':'Check the known-good commit passes','baseline-bad':'Check the latest commit fails','search':'Search: test the middle of the range',
  'confirm-parent':'Double-check: commit before the culprit passes','confirm-culprit':'Double-check: the culprit fails','fix-verify':'Verify the fix'};
const PHASE_OF=l=>l.startsWith('baseline')?'baseline':l==='search'?'search':l.startsWith('confirm')?'confirm':'verify';
const ORDER=['prepare','author','baseline','search','confirm','fix','verify','done'];

const S={job:null,kind:'demo',mode:'real',status:'loading',phase:'prepare',phaseText:'',commits:[],good:null,bad:null,verdict:{},
  probing:null,probes:[],agent:[],notes:[],result:null,error:null,queue:null,lastT:0,lastWall:Date.now(),speed:1,fixSha:null,fixVerdict:null,tl:[]};

// ---------- reducer: one event in, state updated ----------
function apply(ev){
  S.lastT=ev.t??S.lastT;S.lastWall=Date.now();
  switch(ev.type){
    case 'status':
      if(ev.status==='queued'){S.status='queued';S.queue=ev}
      else if(ev.status==='running'){S.status='running';S.queue=null}
      break;
    case 'phase':S.phase=ev.id;S.phaseText=ev.text;S.tl.unshift({k:'live',h:ev.text});break;
    case 'commits':S.commits=ev.commits;S.good=ev.good;S.bad=ev.bad;break;
    case 'probe_start':
      S.probing={label:ev.label,sha:ev.sha,at:Date.now()};
      S.phase=PHASE_OF(ev.label);
      break;
    case 'probe':{
      S.probing=null;S.probes.push(ev);
      if(ev.label==='fix-verify'){S.fixSha=ev.sha;S.fixVerdict=ev.verdict}
      else S.verdict[ev.sha]=ev.verdict;
      const n=idx(ev.sha),where=n>=0?`#${n+1}`:'the fix';
      S.tl.unshift({k:ev.verdict==='good'?'good':ev.verdict==='bad'?'bad':'',h:`${WHY[ev.label]||ev.label}: ${where} ${ev.verdict==='good'?'passes':ev.verdict==='bad'?'fails':'errored'}`});
      break}
    case 'agent':
      if(ev.state==='asking'){S.phase='fix';S.agent.push({n:ev.n,state:'asking'});S.tl.unshift({k:'live',h:`Agent try ${ev.n}: reading Kane's evidence and writing a patch`})}
      else{const a=S.agent.find(x=>x.n===ev.n);if(a)Object.assign(a,ev);else S.agent.push(ev);S.tl.unshift({k:'',h:`Agent proposes: ${ev.message}`})}
      break;
    case 'note':S.tl.unshift({k:'',h:ev.text});break;
    case 'result':S.result=ev.result;S.status='done';S.phase='done';S.probing=null;break;
    case 'error':S.status='error';S.error=ev;S.probing=null;break;
  }
}
const idx=sha=>S.commits.findIndex(c=>c.sha===sha);

// ---------- rendering ----------
const flowName=()=>S.kind==='repo'?'your flow':'checkout';
function steps(){
  const a=[['prepare','Prepare']];if(S.kind==='repo')a.push(['author','Kane records']);
  a.push(['baseline','Check the ends'],['search','Search'],['confirm','Double-check'],['fix','Fix'],['verify','Kane proves it']);return a;
}
function renderStepper(){
  const list=steps(),cur=S.status==='done'?99:ORDER.indexOf(S.phase);
  $('#stepper').innerHTML=list.map(([k,t])=>{
    const i=ORDER.indexOf(k);
    let c=i<cur?'done':i===cur?'cur':'';
    if(k==='fix'&&cur>ORDER.indexOf('fix'))c='done';
    if(S.status==='error'&&i===cur)c='fail';
    if(S.status==='done'&&!S.result?.fix&&(k==='fix'||k==='verify'))c='';
    if(S.status==='queued')c='';
    return `<li class="${c}">${esc(t)}</li>`;
  }).join('');
}

function range(){
  let lo=0,hi=S.commits.length-1;
  for(const p of S.probes.filter(p=>p.label==='search')){const i=idx(p.sha);if(p.verdict==='good')lo=Math.max(lo,i);else if(p.verdict==='bad')hi=Math.min(hi,i)}
  return [lo,hi];
}
function renderStrip(){
  const cul=S.result?.culprit?.sha,[lo,hi]=range(),searching=S.probes.some(p=>p.label==='search');
  const li=S.commits.map((c,i)=>{
    let cls=S.verdict[c.sha]||'';
    if(c.sha===S.good&&!cls)cls='good';
    if(S.probing?.sha===c.sha&&S.probing.label!=='fix-verify')cls='probing';
    if(cul&&c.sha===cul)cls='bad cul';
    if(searching&&!cul&&(i<lo||i>hi))cls+=' dim';
    if(cul&&c.sha!==cul)cls+=' dim';
    return `<li class="${cls}" title="${esc(c.subject)} (${esc(c.short)})"><span class="dot"></span>${i+1}</li>`;
  });
  if(S.fixSha){li.push(`<li class="${S.fixVerdict==='good'?'fixed':S.probing?'probing':''}" title="The fix commit"><span class="dot"></span>↩</li>`)}
  else if(S.probing?.label==='fix-verify')li.push(`<li class="probing" title="The fix commit"><span class="dot"></span>↩</li>`);
  $('#strip').innerHTML=li.join('')||'<li class="mu" style="width:auto">Waiting for the commit list…</li>';
}

function renderNow(){
  const n=$('#now'),t=$('#nowtext'),tm=$('#nowt');
  if(S.status==='done'||S.status==='error'){n.classList.add('idle');t.innerHTML=S.status==='done'?'<b>Finished.</b>':'<b>Stopped.</b>';tm.textContent='';return}
  n.classList.remove('idle');
  if(S.status==='queued'){t.innerHTML='<b>Waiting for a free slot</b><br><span class="mu">One real Kane run at a time keeps results trustworthy.</span>';tm.textContent='';return}
  if(S.probing){
    const i=idx(S.probing.sha),c=S.commits[i];
    const where=S.probing.label==='fix-verify'?'the fixed version':c?`<b>#${i+1}</b> ${esc(c.subject)} <code>${esc(c.short)}</code>`:esc(S.probing.sha.slice(0,7));
    t.innerHTML=`<b>Kane is replaying the test on</b> ${where}<br><span class="mu">${esc(WHY[S.probing.label]||'')}</span>`;
    tm.textContent=dur((Date.now()-S.probing.at)*S.speed);return;
  }
  const last=S.agent.at(-1);
  if(last?.state==='asking'&&S.phase==='fix'){t.innerHTML=`<b>The agent is reading Kane's evidence and writing a patch</b><br><span class="mu">Try ${last.n} of 3</span>`;tm.textContent='';return}
  if(S.phase==='author'){t.innerHTML='<b>Kane is performing your steps in a real browser</b><br><span class="mu">This usually takes one to two minutes. It only happens once.</span>';tm.textContent='';return}
  const idle={prepare:S.phaseText||'Getting ready',baseline:'Lining up the next check…',search:'Picking the next commit to test…',confirm:'Lining up the double-check…',fix:'Working on the fix…',verify:'Lining up the proof…'}[S.phase]||'Working…';
  t.innerHTML=`<b>${esc(idle)}</b>`;tm.textContent='';
}

function head(){
  const modeTxt={real:'Real Kane',standin:'Stand-in demo',recorded:'Recorded real run'}[S.mode];
  const kindTxt={demo:'Demo shop',repo:S.job?.params?.repo?.name||'Your repo',replay:'Demo shop'}[S.job?.kind]||'Run';
  $('#kind').textContent=`${kindTxt} · ${modeTxt}`;
  const m=$('#mode');m.className='mode '+(S.mode==='real'?'real':S.mode==='recorded'?'rec':'standin');m.innerHTML='<i></i>'+modeTxt;
  let title='Loading…',sub='';
  const n=Math.max(0,S.commits.length-1);
  if(S.status==='queued'){title='In line…';sub=S.queue?`${S.queue.ahead} run${S.queue.ahead===1?'':'s'} ahead of you. This page updates by itself.`:''}
  else if(S.status==='error'){title='This run stopped';sub='Here is what happened.'}
  else if(S.status==='done'){title='Run complete';sub=S.job?.kind==='replay'?'The result of the real Kane run recorded on Nov 16.':'Here is what Kane and Culprit found.'}
  else{
    title={prepare:'Getting ready',author:'Kane is recording your steps',baseline:'Checking the test is reliable',search:`Searching ${n} commits`,confirm:'Double-checking the answer',fix:'Fixing it',verify:'Kane is proving the fix'}[S.phase]||'Working';
    sub={author:'Kane does your flow once, on the version that worked. After that, every check is a fast replay.',baseline:'Replaying the test on the two ends of the range to be sure it is stable.',search:'Halving the range each time, so a long history needs only a few checks.',confirm:'The answer is confirmed twice before Culprit names a commit.',verify:'Replaying the same recorded test on the fixed version.'}[S.phase]||'';
  }
  $('#title').textContent=title;$('#sub').textContent=sub;
  document.title=`${title} · Culprit`;
}

function tidy(r){ // friendly wording for the engine's reasons
  const t=r.bisect.reason||'';
  if(/known-good commit does not pass/.test(t))return {h:'The commit you marked as working does not pass',p:'Kane replayed your steps there and they failed, so there is nothing reliable to compare against. Pick an earlier commit, or make the steps simpler.'};
  if(/bad commit passes/.test(t))return {h:'Nothing looks broken',p:'Your latest commit passes this flow, so there is no regression to find. If something is still wrong, the steps may not cover it.'};
  if(/environment error/.test(t))return {h:'Kane could not run a check',p:t+'. Culprit stops instead of blaming a commit for an environment problem.'};
  return {h:'Culprit could not decide',p:t};
}

function renderVerdict(){
  const el=$('#verdict');
  if(S.status!=='done'){el.innerHTML='';return}
  const r=S.result,c=r.culprit,f=r.fix,fixed=f&&!f.error&&f.verdict==='good';
  const credits=S.probes.reduce((a,p)=>a+(Number(p.credits)||0),0);
  const stats=[['Commits searched',Math.max(0,r.commits.length-1)],['Search checks',r.searchProbes??'-'],['Total Kane checks',S.probes.length],['Time',dur(S.lastT)]];
  if(r.baseline)stats.splice(2,0,['One by one needed',r.baseline.probes]);
  if(credits)stats.push(['Kane credits',credits.toFixed(1)]);
  let h,p,cls='';
  if(r.bisect.status==='found'&&fixed){cls='ok';h='Found it. Fixed. Kane confirmed.';p=`Commit <code>${esc(c.short)}</code> “${esc(c.subject)}” broke ${flowName()}. ${f.mode==='agent'?'An agent patched it':'Undoing it'} and Kane replayed the same recording: it passes again.`}
  else if(r.bisect.status==='found'){cls='no';h='Found the culprit.';p=`Commit <code>${esc(c.short)}</code> “${esc(c.subject)}” broke ${flowName()}. ${f&&f.error?esc(f.error)+'.':'No automatic fix was requested.'} The exact diff and an undo command are below.`}
  else if(r.bisect.status==='inconclusive'){h='Inconclusive';p='The double-check disagreed with the search, so Culprit will not guess. '+esc(r.bisect.reason||'')}
  else{const t=tidy(r);h=t.h;p=esc(t.p)}
  el.innerHTML=`<div class="verdict ${cls}"><h2>${h}</h2><p>${p}</p><div class="kv">${stats.map(([k,v])=>`<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div></div>`;
}

function diffHtml(d){
  return (d||'').split('\n').slice(1).filter(l=>!/^(diff --git|index |--- |\+\+\+ |new file|deleted file)/.test(l)).map(l=>{
    const k=l.startsWith('+')?'a':l.startsWith('-')?'d':l.startsWith('@@')?'h':'';return `<div class="${k}">${esc(l)||' '}</div>`}).join('');
}
function renderCulprit(){
  const el=$('#culprit'),r=S.result,c=r?.culprit;
  if(!c||r.bisect.status==='abort'){el.classList.add('hide');return}
  const ev=[...new Set(S.probes.filter(p=>p.sha===c.sha&&p.verdict==='bad').flatMap(p=>p.failures||[]))].slice(0,2);
  el.classList.remove('hide');
  el.innerHTML=`<h2>The culprit</h2><div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><b style="font-size:20px">${esc(c.subject)}</b><button class="chip" id="cpsha" type="button" title="Copy commit id">${esc(c.short)} · copy</button></div>
  <p class="mu" style="margin:4px 0 12px">by ${esc(c.author||'unknown')}${r.commits.findIndex(x=>x.sha===c.sha)>=0?` · commit #${r.commits.findIndex(x=>x.sha===c.sha)+1} of ${r.commits.length}`:''}</p>
  ${ev.length?`<p class="eyebrow" style="margin:14px 0 4px">What Kane saw</p>${ev.map(x=>`<div class="quote">${esc(x)}</div>`).join('')}`:''}
  <p class="eyebrow" style="margin:16px 0 6px">The change</p><pre class="diff" tabindex="0">${diffHtml(c.diff)}</pre>`;
  $('#cpsha').onclick=()=>copy(c.sha,'Commit id copied');
}
function renderFix(){
  const el=$('#fix'),r=S.result,f=r?.fix,c=r?.culprit;
  if(!f||f.skipped||!c){el.classList.add('hide');return}
  el.classList.remove('hide');
  const ok=!f.error&&f.verdict==='good';
  const applyCmd=f.mode==='agent'&&f.patch?`git apply culprit-fix-${c.short}.patch`:`git revert ${c.short}`;
  const att=(f.attempts||[]).map(a=>`<li class="${a.verdict==='good'?'good':'bad'}"><b>Try ${a.n}:</b> ${esc(a.message||'(no patch)')}${a.files?.length?` <code>${esc(a.files.join(', '))}</code>`:''}<br><span class="chip ${a.verdict==='good'?'good':'bad'}">Kane: ${a.error?'error':esc(a.verdict==='good'?'PASS':'FAIL')}</span>${a.failures?.[0]?` <span class="mu" style="font-size:13.5px">${esc(a.failures[0])}</span>`:''}${a.error?` <span class="mu" style="font-size:13.5px">${esc(a.error)}</span>`:''}</li>`).join('');
  el.innerHTML=`<h2>The fix</h2>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><span class="chip info">${f.mode==='agent'?'Agent patch':'Plain undo (git revert)'}</span>${ok?'<span class="chip good">Kane replay: PASS</span>':'<span class="chip bad">Not confirmed</span>'}${f.kaneUrl?`<a class="chip" href="${esc(f.kaneUrl)}" rel="noopener">Kane run ↗</a>`:''}</div>
  ${f.error?`<p style="margin:0 0 8px">${esc(f.error)}.</p>`:`<p style="margin:0 0 8px">${esc(f.message||'')}</p>`}
  ${f.revertTried?'<p class="mu" style="margin:0 0 8px">A plain undo was tried first and Kane did not confirm it, so the agent took over.</p>':''}
  ${att?`<p class="eyebrow" style="margin:14px 0 8px">The agent and Kane, try by try</p><ul class="tl">${att}</ul>`:''}
  <p class="eyebrow" style="margin:16px 0 4px">Apply it to your repo</p>
  <div class="cmd"><span>${esc(applyCmd)}</span><button class="btn sm g" id="cpcmd" type="button">Copy</button></div>
  ${f.patch?`<a class="btn sm g" href="/api/jobs/${esc(S.job.id)}/patch" download>Download the verified fix (.patch)</a>`:''}`;
  $('#cpcmd').onclick=()=>copy(applyCmd,'Command copied');
}
function renderShare(){
  const el=$('#share');
  if(S.status!=='done'&&S.status!=='error'){el.classList.add('hide');return}
  el.classList.remove('hide');
  const rep=S.job.id==='real-nov16'?'/api/jobs/real-nov16/report/':`/api/jobs/${esc(S.job.id)}/report/`;
  el.innerHTML=`<h2>Share this run</h2><div class="cmd"><span>${esc(location.origin+'/r/'+S.job.id)}</span><button class="btn sm g" id="cplink" type="button">Copy</button></div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><a class="btn sm" href="/app">Run it yourself</a>${S.result?`<a class="btn sm g" href="${rep}">Full technical report</a>`:''}</div>
  ${S.job.params?.steps?`<p class="eyebrow" style="margin:16px 0 4px">The steps Kane followed</p><ol class="mu" style="margin:0;padding-left:20px">${S.job.params.steps.map(x=>`<li>${esc(x)}</li>`).join('')}</ol>`:''}`;
  $('#cplink').onclick=()=>copy(location.origin+'/r/'+S.job.id,'Link copied');
}
function renderLog(){
  const rows=S.probes.map((p,i)=>{
    const n=idx(p.sha),c=S.commits[n];
    return `<tr><td class="m">${i+1}</td><td>${esc(WHY[p.label]||p.label)}</td><td class="m">${n>=0?`#${n+1} `:'fix '}${esc(p.sha.slice(0,7))}</td><td><span class="chip ${p.verdict==='good'?'good':p.verdict==='bad'?'bad':'warn'}">${p.verdict==='good'?'PASS':p.verdict==='bad'?'FAIL':'ERROR'}</span></td><td class="m">${dur(p.ms)}${p.kaneUrl?` <a href="${esc(p.kaneUrl)}" rel="noopener">run ↗</a>`:''}</td></tr>`}).join('');
  const live=S.probing?`<tr><td class="m">${S.probes.length+1}</td><td>${esc(WHY[S.probing.label]||S.probing.label)}</td><td class="m">${idx(S.probing.sha)>=0?'#'+(idx(S.probing.sha)+1)+' ':'fix '}${esc(S.probing.sha.slice(0,7))}</td><td><span class="chip warn">RUNNING</span></td><td class="m">…</td></tr>`:'';
  $('#log tbody').innerHTML=rows+live||'<tr><td colspan="5" class="mu">No checks yet.</td></tr>';
}
function renderTl(){$('#tl').innerHTML=S.tl.slice(0,14).map((x,i)=>`<li class="${i===0&&S.status==='running'&&x.k==='live'?'live':x.k}">${esc(x.h)}</li>`).join('')||'<li>Waiting to start…</li>'}
function renderError(){
  const el=$('#err');
  if(S.status!=='error'){el.classList.add('hide');return}
  el.classList.remove('hide');
  const e=S.error;
  el.innerHTML=`<div class="verdict no"><h2>${esc(e.message)}</h2>${e.hint?`<p>${esc(e.hint)}</p>`:''}<div class="cta" style="margin-top:16px"><a class="btn sm" href="/app">Try again</a><a class="btn sm g" href="/r/real-nov16">Watch the recorded real run</a></div></div>${e.detail?`<details class="q" style="margin-bottom:16px"><summary>What Kane reported</summary><pre class="diff" style="padding:12px 14px;white-space:pre-wrap">${esc(e.detail)}</pre></details>`:''}`;
}
function renderQueue(){
  const el=$('#queue');
  if(S.status!=='queued'){el.classList.add('hide');return}
  el.classList.remove('hide');el.innerHTML=`<span><b>You are in line.</b> Position ${S.queue?.position||1}. Real Kane runs one at a time so each result is trustworthy. This page updates by itself.</span>`;
}
function render(){head();renderStepper();renderQueue();renderError();renderVerdict();renderStrip();renderNow();renderCulprit();renderFix();renderShare();renderLog();renderTl()}

// ---------- timer ----------
setInterval(()=>{
  let ms=S.lastT;
  if(S.status==='running')ms=S.lastT+(Date.now()-S.lastWall)*S.speed;
  const t=$('#timer');if(S.status==='loading'||S.status==='queued'){t.style.visibility='hidden';return}
  t.style.visibility='visible';t.querySelector('b').textContent=clock(ms);
  if(S.probing)$('#nowt').textContent=dur((Date.now()-S.probing.at)*S.speed);
},500);

// ---------- feeding events ----------
let paced=[],pacing=null;
function feed(ev,{pace}={}){
  if(!pace){apply(ev);render();return}
  paced.push(ev);
  if(pacing)return;
  const step=()=>{const e=paced.shift();if(!e){pacing=null;return}apply(e);render();pacing=setTimeout(step,e.type==='probe_start'?250:420)};
  step();
}

function play(job){ // recorded run: replay its real timings, compressed
  const evs=job.events.slice(),total=evs.at(-1).t;
  let speed=Number(params.get('speed'))||12,timer=null,i=0,startWall=Date.now(),startT=0;
  S.speed=speed;S.status='running';
  const bar=$('#recbar');bar.classList.remove('hide');
  const paint=()=>{bar.innerHTML=`<span><b>Recorded real run</b> · ${new Date(job.recordedAt).toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'})} · real Kane CLI, real browser replays. The whole run took <b>${dur(job.realMs)}</b>; playing at <b>${speed}×</b>.</span><span class="sp"><button class="btn sm g" data-s="12" type="button">12×</button><button class="btn sm g" data-s="40" type="button">40×</button><button class="btn sm" id="skip" type="button">Skip to result</button><a class="btn sm g" href="/app">Run it live</a></span>`;
    bar.querySelectorAll('[data-s]').forEach(b=>b.onclick=()=>{speed=Number(b.dataset.s);startT=evs[i-1]?.t??0;startWall=Date.now();S.speed=speed;paint();schedule()});
    $('#skip').onclick=()=>{clearTimeout(timer);while(i<evs.length){apply(evs[i++])}render();bar.querySelector('.sp').innerHTML='<a class="btn sm" href="/app">Run it live</a>';bar.querySelector('span').innerHTML=`<b>Recorded real run</b> · Nov 16, 2026 · real Kane CLI. The whole run took <b>${dur(job.realMs)}</b>.`}};
  const schedule=()=>{
    clearTimeout(timer);
    if(i>=evs.length){S.speed=1;render();return}
    const due=startWall+(evs[i].t-startT)/speed,wait=Math.max(0,Math.min(due-Date.now(),4000));
    timer=setTimeout(()=>{apply(evs[i++]);render();schedule()},wait);
  };
  paint();render();schedule();
}

async function main(){
  let job;
  try{job=await api('/api/jobs/'+encodeURIComponent(id))}
  catch(e){S.status='error';S.error={message:'That run was not found',hint:e.message};S.job={id,params:{}};S.mode='real';render();return}
  S.job=job;S.mode=job.mode;S.kind=job.kind==='replay'?'demo':job.kind;
  if(job.kind==='replay'&&params.get('replay')!=='0')return play(job);
  for(const ev of job.events)apply(ev);
  S.status=job.status==='queued'||job.status==='running'?S.status:job.status;
  if(job.status==='running'&&S.status==='loading')S.status='running';
  if(job.status==='queued'&&S.status==='loading')S.status='queued';
  if(job.status==='done'&&!S.result)S.result=job.result;
  render();
  if(job.status==='done'||job.status==='error')return;
  // live: follow the stream; fall back to polling if the connection cannot be kept
  let next=job.events.length,es,poll;
  const startPoll=()=>{if(poll)return;poll=setInterval(async()=>{try{const j=await api('/api/jobs/'+id);for(const ev of j.events.slice(next))feed(ev,{pace:true});next=j.events.length;if(j.status==='done'||j.status==='error')clearInterval(poll)}catch{}},2000)};
  try{
    es=new EventSource(`/api/jobs/${id}/stream?from=${next}`);
    es.onmessage=m=>{const ev=JSON.parse(m.data);if(ev.seq<next)return;next=ev.seq+1;feed(ev,{pace:true});if(ev.type==='end')es.close()};
    es.onerror=()=>{if(es.readyState===2)startPoll()};
  }catch{startPoll()}
}
main();
})();
