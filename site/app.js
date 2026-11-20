(function(){
const $=s=>document.querySelector(s),{esc,api}=C;
let st=null,repo=null;

function tab(name){
  for(const n of ['demo','repo']){
    $('#t-'+n).setAttribute('aria-selected',String(n===name));
    $('#p-'+n).classList.toggle('hide',n!==name);
  }
  const u=new URL(location);u.searchParams.set('tab',name);history.replaceState(null,'',u);
}
$('#t-demo').onclick=()=>tab('demo');$('#t-repo').onclick=()=>tab('repo');
tab(new URLSearchParams(location.search).get('tab')==='repo'?'repo':'demo');

C.status().then(s=>{
  st=s;const b=$('#banner');
  if(!s){b.innerHTML='<span>Could not reach the server. Reload to try again.</span>';return}
  if(s.mode==='real'){
    b.className='banner real';
    b.innerHTML=`<span><b>Real Kane mode.</b> Every check is a real browser replay by Kane. The demo takes about 7 minutes, your own repo about 10. You can close the tab and come back to the run link. ${s.runsLeft} runs left today (${s.perVisitor} per visitor). Want it instantly? <a href="/r/real-nov16">Watch the recorded real run</a>.</span>`;
  }else{
    b.innerHTML=`<span><b>Stand-in mode.</b> Search, undo and verify are real, but browser replays are simulated, so this tests Culprit's logic, not Kane. Real Kane evidence is on the <a href="/r/real-nov16">recorded real run</a>.</span>`;
  }
  if(s.agent)$('#hardrow').classList.remove('hide');
  if(s.passwordRequired){$('#coderow').classList.remove('hide')}
  if(!s.ownRepo){$('#repo-off').style.display='block';$('#repo-on').style.display='none'}
  if(s.agent)$('#agentrow').classList.remove('hide');
  if(!s.demoReady){$('#go-demo').disabled=true;$('#msg-demo').textContent='The demo recording is missing on this server. Watch the recorded real run instead.';$('#msg-demo').className='msg err'}
});

const say=(sel,text,err)=>{const m=$(sel);m.textContent=text||'';m.className='msg'+(err?' err':'')};
function fail(sel,e){say(sel,e.message+(e.hint?' '+e.hint:''),true)}
const code=()=>($('#code')&&$('#code').value)||'';

$('#go-demo').onclick=async()=>{
  const b=$('#go-demo');b.disabled=true;say('#msg-demo','Starting…');
  try{const r=await api('/api/jobs',{body:{kind:'demo',variant:$('#hard').checked?'hard':'easy'},code:code()});location.href='/r/'+r.id}
  catch(e){fail('#msg-demo',e);b.disabled=false}
};

// ---- your repo ----
const EXAMPLES={
  'Add to cart, then pay':'Click "Add to cart" on the first product. Check the cart shows 1.\nClick "Pay now". Check an order confirmation appears.',
  'Sign-up form':'Type test@example.com in the email field and click "Sign up". Check a success message appears.',
  'Search':'Type "coffee" in the search box and press Enter. Check at least one result is shown.',
  'Open the menu':'Click the menu button. Check the navigation links are visible.',
};
for(const [k,v] of Object.entries(EXAMPLES)){const b=document.createElement('button');b.type='button';b.textContent=k;b.onclick=()=>{$('#steps').value=v;$('#steps').focus()};$('#chips').appendChild(b)}

$('#load').onclick=async()=>{
  const b=$('#load');b.disabled=true;say('#msg-load','Fetching your repo. This takes a few seconds…');$('#step2').classList.add('hide');
  try{
    repo=await api('/api/repo/inspect',{body:{url:$('#url').value}});
    say('#msg-load',`Loaded ${repo.owner}/${repo.name} · branch ${repo.branch} · ${repo.commits.length} recent commits${repo.shallow?' (showing the latest)':''}`);
    const pick=$('#pick');pick.innerHTML='';
    repo.commits.forEach((c,i)=>{
      const l=document.createElement('label');if(i===0)l.className='dis';
      l.innerHTML=`<input type="radio" name="good" value="${esc(c.sha)}" ${i===0?'disabled':''}><span class="s">${esc(c.subject)}</span><code>${esc(c.short)}${i===0?' · latest':''}</code>`;
      pick.appendChild(l);
    });
    $('#step2').classList.remove('hide');
  }catch(e){fail('#msg-load',e)}
  b.disabled=false;
};
$('#url').addEventListener('keydown',e=>{if(e.key==='Enter')$('#load').click()});

$('#go-repo').onclick=async()=>{
  const g=document.querySelector('input[name=good]:checked');
  if(!g)return say('#msg-repo','Pick the last commit that worked.',true);
  const b=$('#go-repo');b.disabled=true;say('#msg-repo','Starting…');
  try{
    const r=await api('/api/jobs',{body:{kind:'repo',repoId:repo.repoId,good:g.value,steps:$('#steps').value.split('\n'),agent:$('#agent')?$('#agent').checked:false},code:code()});
    location.href='/r/'+r.id;
  }catch(e){fail('#msg-repo',e);b.disabled=false}
};
})();
