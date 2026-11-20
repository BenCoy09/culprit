// Shared helpers for every page. No dependencies.
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const store={get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{localStorage.setItem(k,v)}catch{}}};

  async function api(path,opts={}){
    const o={method:opts.method||'GET',headers:{}};
    if(opts.body!==undefined){o.method='POST';o.headers['content-type']='application/json';o.headers['x-culprit']='1';o.body=JSON.stringify(opts.body)}
    if(opts.code)o.headers['x-run-code']=opts.code;
    let r;
    try{r=await fetch(path,o)}catch{throw Object.assign(new Error('Could not reach the server. Check your connection and try again.'),{net:true})}
    let data=null;try{data=await r.json()}catch{}
    if(!r.ok)throw Object.assign(new Error(data?.error||`Request failed (${r.status})`),{hint:data?.hint,status:r.status});
    return data;
  }

  let statusP;
  const status=()=>statusP||(statusP=api('/api/status').catch(()=>null));

  function toast(msg){
    let t=document.querySelector('.toast');
    if(!t){t=document.createElement('div');t.className='toast';t.setAttribute('role','status');document.body.appendChild(t)}
    t.textContent=msg;t.classList.add('on');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('on'),1800);
  }
  async function copy(text,label='Copied'){
    try{await navigator.clipboard.writeText(text)}
    catch{const a=document.createElement('textarea');a.value=text;a.style.position='fixed';a.style.opacity='0';document.body.appendChild(a);a.select();try{document.execCommand('copy')}catch{}a.remove()}
    toast(label);
  }
  const dur=ms=>{ms=Math.max(0,Math.round(ms/100)/10);if(ms<60)return ms.toFixed(1)+'s';const m=Math.floor(ms/60);const s=Math.round(ms-m*60);return `${m}m ${String(s).padStart(2,'0')}s`};
  const clock=ms=>{const s=Math.floor(ms/1000);return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')};

  // theme: follows the system unless the visitor picks one
  const root=document.documentElement,saved=store.get('culprit-theme');
  if(saved==='light'||saved==='dark')root.dataset.theme=saved;
  document.addEventListener('DOMContentLoaded',()=>{
    const b=document.getElementById('theme');if(!b)return;
    const sync=()=>{const dark=root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;b.textContent=dark?'☀':'☾';b.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode')};
    sync();b.onclick=()=>{const dark=root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;root.dataset.theme=dark?'light':'dark';store.set('culprit-theme',root.dataset.theme);sync()};
    const m=document.getElementById('mode');
    if(m&&!m.dataset.fixed)status().then(s=>{if(!s)return;m.className='mode '+(s.mode==='real'?'real':'standin');m.innerHTML='<i></i>'+(s.mode==='real'?'Real Kane':'Stand-in demo');m.title=s.mode==='real'?'This server replays your tests with the real Kane CLI':'This server uses a stand-in for Kane. Real results are on the recorded run.'});
  });
  window.C={esc,api,status,toast,copy,dur,clock,store};
})();
