// The hero animation replays the real search: 16 commits, probes #8 bad, #4 good, #6 good, #7 good, culprit #8.
(function(){
const NS="http://www.w3.org/2000/svg",svg=document.getElementById("logo");if(!svg)return;
const X0=48,DX=36,Y=112,px=n=>X0+(n-1)*DX;
const el=(t,a,p=svg)=>{const e=document.createElementNS(NS,t);for(const k in a)e.setAttribute(k,a[k]);p.appendChild(e);return e};
let paused=false;const wait=async ms=>{await new Promise(r=>setTimeout(r,ms));while(paused)await new Promise(r=>setTimeout(r,120))};
const tween=(a,b,ms,f)=>new Promise(res=>{const t0=performance.now();(function s(t){const k=Math.min(1,(t-t0)/ms),e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;f(a+(b-a)*e);k<1?requestAnimationFrame(s):res()})(t0)});
el("line",{x1:px(1),x2:px(16),y1:Y,y2:Y,stroke:"currentColor","stroke-width":2,opacity:.35});
const dots=[null];for(let n=1;n<=16;n++)dots[n]=el("circle",{cx:px(n),cy:Y,r:7,class:"nd"});
const br=el("rect",{y:Y-34,height:68,rx:10,fill:"none",stroke:"currentColor","stroke-width":2});
const cap=el("text",{x:320,y:178,"text-anchor":"middle","font-family":"IBM Plex Mono,ui-monospace,monospace","font-size":15,fill:"currentColor"});
const g=el("g",{opacity:0});el("path",{d:"M0 0V-44l26 10-26 10",fill:"#D9A400",stroke:"currentColor","stroke-width":2.5,"stroke-linejoin":"round"},g);
const lab=el("text",{x:0,y:30,"text-anchor":"middle","font-family":"IBM Plex Mono,ui-monospace,monospace","font-size":13,fill:"currentColor",opacity:0});
let cur={x:0,w:0};const setBr=(lo,hi)=>{cur.x=px(lo)-16;cur.w=px(hi)-px(lo)+32;br.setAttribute("x",cur.x);br.setAttribute("width",cur.w)};
const moveBr=(lo,hi,ms)=>{const x=px(lo)-16,w=px(hi)-px(lo)+32,x0=cur.x,w0=cur.w;cur={x,w};return Promise.all([tween(x0,x,ms,v=>br.setAttribute("x",v)),tween(w0,w,ms,v=>br.setAttribute("width",v))])};
const col=(n,v)=>{dots[n].style.fill=v=="good"?"var(--ok)":v=="bad"?"var(--no)":"var(--mk)"};
const dim=(lo,hi)=>{for(let n=2;n<=15;n++)dots[n].style.opacity=(n<lo||n>hi)?.2:1};
function done(){dim(8,8);col(8,"c");dots[8].setAttribute("r",9);g.setAttribute("transform",`translate(${px(8)},${Y-12})`);g.setAttribute("opacity",1);
 lab.setAttribute("x",px(8));lab.setAttribute("y",Y+34);lab.textContent="commit #8";lab.setAttribute("opacity",1);cap.textContent="4 checks, not 7. Found it.";setBr(8,8)}
function reset(){for(let n=1;n<=16;n++){dots[n].style.fill="";dots[n].style.opacity=1;dots[n].setAttribute("r",7)}col(1,"good");col(16,"bad");
 g.setAttribute("opacity",0);lab.setAttribute("opacity",0);cap.textContent="16 commits. One broke checkout.";setBr(2,16)}
const steps=[[8,"bad",2,8],[4,"good",5,8],[6,"good",7,8],[7,"good",8,8]];
const still=matchMedia("(prefers-reduced-motion: reduce)").matches;
const pz=document.getElementById("pz");if(still&&pz)pz.hidden=true;
if(pz)pz.onclick=()=>{paused=!paused;pz.setAttribute("aria-pressed",paused);pz.textContent=paused?"Play animation":"Pause animation"};
(async function loop(){reset();if(still){done();return}
 for(;;){reset();await wait(1400);
  for(const [n,v,lo,hi] of steps){dots[n].setAttribute("r",11);await wait(450);col(n,v);dots[n].setAttribute("r",7);await wait(300);dim(lo,hi);await moveBr(lo,hi,650);await wait(250)}
  await wait(300);done();await wait(4200)}})();
})();
