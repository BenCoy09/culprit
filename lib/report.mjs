const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const secs=ms=>(ms/1000).toFixed(1)+'s';

export function renderReport(r){
  const last={};for(const p of r.bisect.probes)last[p.sha]=p.verdict;
  const c=r.culprit,found=r.bisect.status==='found';
  const fixed=r.fix?.verdict==='good';
  const headline=!c?'Not bisected':fixed?'Found, fixed, re-verified':found?'Culprit found':'Inconclusive';
  const rows=r.commits.map(x=>{
    const v=last[x.sha],cls=c&&x.sha===c.sha?'bad culprit':v==='good'?'good':v==='bad'?'bad':'';
    return `<li class="${cls}"><i></i><span>${esc(x.subject)}</span><code>${x.short}</code></li>`}).join('');
  const probes=r.bisect.probes.map((p,i)=>`<tr><td>${i+1}</td><td>${esc(p.label)}</td><td><code>${p.sha.slice(0,7)}</code></td><td class="${p.verdict}">${p.verdict}</td><td>${secs(p.ms)}</td></tr>`).join('');
  const diff=c?c.diff.split('\n').map(l=>`<div class="${l.startsWith('+')&&!l.startsWith('+++')?'a':l.startsWith('-')&&!l.startsWith('---')?'d':''}">${esc(l)||' '}</div>`).join(''):'';
  const fails=c?[...new Set(r.bisect.probes.filter(p=>p.sha===c.sha).flatMap(p=>p.failures))]:[];
  const cmp=r.baseline?`<section><h2>Bisect vs. linear scan</h2><p>Same harness, same test, same commits (${r.commits.length-1} between good and bad).</p>
<table><tr><th></th><th>Probes to locate it</th></tr><tr><td>Linear scan from the good commit</td><td>${r.baseline.probes} (${secs(r.baseline.ms)})</td></tr>
<tr><td>Bisect (search only)</td><td>${r.searchProbes}</td></tr></table>
<p class="m">Bisect also spends probes on stability and boundary checks. They are listed above, not hidden.</p></section>`:'';
  const fix=r.fix?`<section><h2>Fix</h2>${r.fix.error?`<p class="bad">Fix failed: ${esc(r.fix.error)}</p>`:r.fix.skipped?'<p>No fix requested.</p>':
`<p>Mode: <b>${esc(r.fix.mode)}</b>. Commit <code>${esc((r.fix.commit||'').slice(0,7))}</code>: ${esc(r.fix.message)}</p>
<p>Re-verified with the same frozen recordings: <b class="${r.fix.verdict}">${r.fix.verdict==='good'?'passes':esc(r.fix.verdict)}</b>${r.fix.failures?.length?' ('+esc(r.fix.failures[0])+')':''}</p>`}</section>`:'';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Culprit report</title><style>
:root{--bg:#0E1013;--sf:#151920;--ln:#232932;--tx:#E6E8EB;--mu:#8B94A0;--bad:#FF6B5E;--good:#4ADE9B;--ac:#E8B04A;color-scheme:dark}
@media(prefers-color-scheme:light){:root{--bg:#F5F6F8;--sf:#fff;--ln:#DFE3E8;--tx:#16191D;--mu:#5A636E;--bad:#C93B2E;--good:#0E8A55;--ac:#A86A00;color-scheme:light}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.55 system-ui,sans-serif;padding:max(20px,env(safe-area-inset-top)) 20px 48px}
main{max-width:860px;margin:0 auto}code,pre,.mono{font-family:ui-monospace,Menlo,monospace;font-size:.85em}
header{display:flex;align-items:center;gap:10px;margin-bottom:28px;font-weight:600;font-size:1.1rem}header svg{width:26px;height:26px}
h1{font-size:clamp(1.6rem,4vw,2.3rem);line-height:1.15;margin:0 0 6px;letter-spacing:-.02em}h2{font-size:1.05rem;margin:0 0 12px}
section{background:var(--sf);border:1px solid var(--ln);border-radius:10px;padding:18px 20px;margin-top:16px;overflow-x:auto}
.m,.sub{color:var(--mu)}.good{color:var(--good)}.bad{color:var(--bad)}.skip{color:var(--ac)}
ul{list-style:none;margin:0;padding:0;border-left:2px solid var(--ln);margin-left:6px}
li{position:relative;display:flex;gap:12px;align-items:baseline;padding:5px 0 5px 20px}li span{flex:1}li code{color:var(--mu)}
li i{position:absolute;left:-7px;top:12px;width:12px;height:12px;border-radius:50%;background:var(--ln);border:2px solid var(--sf)}
li.good i{background:var(--good)}li.bad i{background:var(--bad)}li.culprit{font-weight:600}li.culprit i{box-shadow:0 0 0 3px color-mix(in srgb,var(--bad) 35%,transparent)}
table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:6px 10px 6px 0;border-bottom:1px solid var(--ln)}
pre{margin:0;white-space:pre}pre div.a{background:color-mix(in srgb,var(--good) 14%,transparent)}pre div.d{background:color-mix(in srgb,var(--bad) 14%,transparent)}
</style></head><body><main>
<header><svg viewBox="0 0 48 48" fill="none" stroke-linecap="round"><path d="M24 4v40" stroke="var(--ln)" stroke-width="3"/><circle cx="24" cy="10" r="3.5" fill="var(--mu)"/><circle cx="24" cy="38" r="3.5" fill="var(--mu)"/><circle cx="24" cy="24" r="9" stroke="var(--ac)" stroke-width="3.5"/><circle cx="24" cy="24" r="3.5" fill="var(--ac)"/></svg>Culprit</header>
<h1 class="${fixed?'good':found?'bad':'skip'}">${headline}</h1>
<p class="sub">${c?`<b>${esc(c.subject)}</b> <code>${c.short}</code> by ${esc(c.author)}`:esc(r.bisect.reason||'')}</p>
${r.bisect.status==='abort'?`<section><h2>Aborted</h2><p>${esc(r.bisect.reason)}</p></section>`:''}
<section><h2>History (${r.commits.length-1} commits after the known-good one)</h2><ul>${rows}</ul></section>
${fails.length?`<section><h2>What failed at the culprit</h2>${fails.map(f=>`<p class="mono">${esc(f)}</p>`).join('')}</section>`:''}
${c?`<section><h2>Culprit diff</h2><pre>${diff}</pre></section>`:''}
${fix}${cmp}
<section><h2>Every probe</h2><table><tr><th>#</th><th>Why</th><th>Commit</th><th>Result</th><th>Time</th></tr>${probes}</table>
<p class="m">Each probe replays the test frozen from the known-good commit against a fresh checkout. Adaptive healing is off.</p></section>
</main></body></html>`;
}
