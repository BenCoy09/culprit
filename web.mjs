// Tiny web server: a Run button that executes Culprit on the seeded demo and streams the output.
// Default Kane = the stand-in (demo/fake-kane.mjs). Set KANE_BIN to use something else.
import http from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const PORT=Number(process.env.PORT||8080);
const PASSWORD=process.env.RUN_PASSWORD||'';          // if set, the Run button needs it
const KANE=process.env.KANE_BIN||path.join(ROOT,'demo/fake-kane.mjs');
const REAL=!!process.env.KANE_BIN;
const WORK='/tmp/culprit-web';
const COOLDOWN_MS=Number(process.env.COOLDOWN_MS||30000);
let running=false,last=0;

const PAGE=`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Culprit</title><style>body{font-family:system-ui;background:#0b0f17;color:#e8edf5;max-width:760px;margin:0 auto;padding:24px}
button,input{font-size:18px;padding:12px 18px;border-radius:10px;border:0;margin:6px 6px 6px 0}button{background:#2b6cff;color:#fff;font-weight:700}
pre{background:#05070b;padding:16px;border-radius:12px;overflow:auto;white-space:pre-wrap;min-height:200px}a{color:#7fb0ff}.n{color:#9fb0c8}</style>
<h1>🔎 Culprit</h1><p class=n>Finds the commit that broke checkout by bisecting a seeded 16-commit demo history.
Kane mode: <b>${REAL?'custom KANE_BIN':'stand-in (not real Kane)'}</b></p>
${PASSWORD?'<input id=pw type=password placeholder="run password">':''}
<button id=go>Run Culprit</button><div id=rep></div><pre id=out>Press Run.</pre>
<script>
const out=document.getElementById('out');
document.getElementById('go').onclick=async()=>{
 out.textContent='';document.getElementById('rep').innerHTML='';
 const pw=document.getElementById('pw');
 const r=await fetch('/run',{method:'POST',headers:{'x-run-password':pw?pw.value:''}});
 if(!r.ok){out.textContent=await r.text();return}
 const rd=r.body.getReader(),dec=new TextDecoder();
 for(;;){const {done,value}=await rd.read();if(done)break;out.textContent+=dec.decode(value);window.scrollTo(0,document.body.scrollHeight)}
 document.getElementById('rep').innerHTML='<p><a href="/report/" target=_blank>Open the report</a></p>';
};
</script>`;

http.createServer(async (req,res)=>{
  const url=new URL(req.url,'http://x');
  if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'content-type':'text/html'});return res.end(PAGE)}
  if(req.method==='GET'&&url.pathname==='/health'){res.writeHead(200);return res.end('ok')}
  if(req.method==='GET'&&url.pathname.startsWith('/report')){
    try{const f=url.pathname.endsWith('result.json')?'result.json':'index.html';
      res.writeHead(200,{'content-type':f.endsWith('json')?'application/json':'text/html'});
      return res.end(await readFile(path.join(WORK,'report',f)))}
    catch{res.writeHead(404);return res.end('No report yet. Press Run first.')}}
  if(req.method==='POST'&&url.pathname==='/run'){
    if(PASSWORD&&req.headers['x-run-password']!==PASSWORD){res.writeHead(401);return res.end('Wrong password.')}
    if(running){res.writeHead(429);return res.end('A run is already in progress. Try again in a minute.')}
    if(Date.now()-last<COOLDOWN_MS){res.writeHead(429);return res.end('Please wait a few seconds between runs.')}
    running=true;last=Date.now();
    res.writeHead(200,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});
    try{
      await rm(path.join(WORK,'repo'),{recursive:true,force:true});
      execFileSync('node',[path.join(ROOT,'demo/seed.mjs'),path.join(WORK,'repo'),'--clean-revert'],{stdio:'ignore'});
      const G=execFileSync('git',['-C',path.join(WORK,'repo'),'rev-list','--max-parents=0','HEAD']).toString().trim();
      const p=spawn('node',[path.join(ROOT,'bin/culprit.mjs'),'run','--repo',path.join(WORK,'repo'),'--test','tests/checkout_test.md',
        '--good',G,'--bad','HEAD','--app','node server.js','--kane-bin',KANE,'--fix','revert','--out',path.join(WORK,'report')],{cwd:ROOT});
      p.stdout.on('data',d=>res.write(d));p.stderr.on('data',d=>res.write(d));
      await new Promise(r=>p.on('close',c=>{res.write(`\n[exit ${c}]\n`);r()}));
    }catch(e){res.write('\nServer error: '+e.message+'\n')}
    running=false;return res.end();
  }
  res.writeHead(404);res.end('not found');
}).listen(PORT,()=>console.log('culprit web on :'+PORT));
