// web.mjs: the Culprit website. Zero dependencies.
//   pages   /  /app  /r/<run id>          (files in site/, with docs/ as a fallback for images and the old report)
//   api     /api/status  /api/jobs  /api/jobs/<id>[/stream|/patch|/report|/evidence]  /api/repo/inspect
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Jobs} from './lib/jobs.mjs';
import {runDemo,runRepo,buildRecorded,validateSteps} from './lib/pipeline.mjs';
import {inspectRepo,parseRepoUrl} from './lib/repo.mjs';
import {agentConfigured} from './lib/fix.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const SITE=path.join(ROOT,'site'),DOCS=path.join(ROOT,'docs');
const env=process.env;

const REAL=env.REAL_KANE==='1';
const cfg={
  real:REAL,
  kaneBin:REAL?(env.KANE_BIN||path.join(ROOT,'kane-wrapper.sh')):path.join(ROOT,'demo/fake-kane.mjs'),
  bundleDir:env.BUNDLE_DIR?path.resolve(env.BUNDLE_DIR):path.join(ROOT,'frozen'),
  probePort:Number(env.PROBE_PORT||3000),      // the port recordings were made on; the website itself must not use it
  staticServer:path.join(ROOT,'lib/static-server.mjs'),
  dataDir:path.resolve(env.DATA_DIR||path.join(ROOT,'data')),
  agentOn:agentConfigured(),
  allowLocalRepos:env.ALLOW_LOCAL_REPOS==='1', // tests only
};
cfg.reposDir=path.join(cfg.dataDir,'repos');
const PORT=Number(env.PORT||8080);
if(PORT===cfg.probePort){console.error(`PORT ${PORT} is reserved for Kane replays. Use another PORT.`);process.exit(1)}
const PASSWORD=env.RUN_PASSWORD||'';
const DAILY_CAP=Number(env.DAILY_CAP||(REAL?30:500));
const PER_IP_CAP=Number(env.PER_IP_CAP||(REAL?4:50));
for(const f of [cfg.kaneBin,path.join(ROOT,'kane-wrapper.sh'),path.join(ROOT,'demo/fake-kane.mjs')]){try{fs.chmodSync(f,0o755)}catch{}}

const jobs=new Jobs({dataDir:cfg.dataDir,maxQueue:Number(env.MAX_QUEUE||4)});
const repoMeta=new Map();
let recorded=null;
try{recorded=await buildRecorded(path.join(DOCS,'result.json'))}catch(e){console.error('recorded run unavailable:',e.message)}
const bundleOk=!REAL||fs.existsSync(path.join(cfg.bundleDir,'checkout_test.md'));

const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
  '.svg':'image/svg+xml','.ico':'image/x-icon','.webp':'image/webp','.evidence':'application/octet-stream'};
const CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const baseHeaders={'x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','content-security-policy':CSP};

const json=(res,code,obj,extra={})=>{res.writeHead(code,{...baseHeaders,'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extra});res.end(JSON.stringify(obj))};
const fail=(res,code,message,hint)=>json(res,code,{error:message,hint:hint||null});
const ipOf=req=>String(req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket.remoteAddress||'?';

function sendFile(res,file,{cache=false}={}){
  try{
    const real=fs.realpathSync(file);
    if(!fs.statSync(real).isFile())throw new Error('not a file');
    const headers={...baseHeaders,'content-type':MIME[path.extname(real).toLowerCase()]||'application/octet-stream',
      'cache-control':cache?'public, max-age=3600':'no-cache'};
    res.writeHead(200,headers);fs.createReadStream(real).pipe(res);return true;
  }catch{return false}
}
// Serve a file from inside `base` only (no path tricks, no symlinks out).
function serveFrom(base,rel,res,opts){
  let p;try{p=path.resolve(base,'.'+decodeURIComponent(rel))}catch{return false}
  if(p!==base&&!p.startsWith(base+path.sep))return false;
  try{if(fs.statSync(p).isDirectory())p=path.join(p,'index.html')}catch{return false}
  try{const rb=fs.realpathSync(base);const rp=fs.realpathSync(p);if(rp!==rb&&!rp.startsWith(rb+path.sep))return false}catch{return false}
  return sendFile(res,p,opts);
}

async function readBody(req,max=20_000){
  let n=0;const chunks=[];
  for await(const c of req){n+=c.length;if(n>max)throw Object.assign(new Error('Request too large'),{status:413});chunks.push(c)}
  try{return JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{throw Object.assign(new Error('Bad JSON'),{status:400})}
}

// A web page that Kane drives can reach this server too, so every POST must come from our own pages.
function sameOrigin(req){
  if(req.headers['x-culprit']!=='1')return false;
  const o=req.headers.origin;
  if(!o)return true;
  try{return new URL(o).host===req.headers.host}catch{return false}
}

const publicJob=j=>({id:j.id,kind:j.kind,mode:j.mode,status:j.status,createdAt:j.createdAt,startedAt:j.startedAt||null,finishedAt:j.finishedAt||null,
  recordedAt:j.recordedAt||null,realMs:j.realMs||null,events:j.events,result:j.result,error:j.error,
  params:{variant:j.params?.variant||null,repo:j.params?.repo||null,steps:j.params?.steps||null}});

function status(){
  return {mode:REAL?'real':'standin',agent:cfg.agentOn,model:cfg.agentOn?(env.MODEL||'claude-sonnet-5-5'):null,
    demoReady:bundleOk,recorded:!!recorded,queue:jobs.stats(),runsLeft:jobs.left({dailyCap:DAILY_CAP}),perVisitor:PER_IP_CAP,
    passwordRequired:!!PASSWORD,ownRepo:REAL||env.ALLOW_STANDIN_REPO==='1',maxSteps:6};
}

async function createJob(req,res){
  const body=await readBody(req);
  if(PASSWORD&&String(req.headers['x-run-code']||body.code||'')!==PASSWORD)return fail(res,401,'That run code is not right.');
  const ip=ipOf(req);
  const kind=body.kind;
  if(!['demo','repo'].includes(kind))return fail(res,400,'Unknown run type.');
  if(kind==='demo'&&!bundleOk)return fail(res,503,'The demo shop recording is missing on this server.','Run the author-frozen workflow once, or set BUNDLE_DIR.');
  const quota=jobs.checkQuota(ip,{dailyCap:DAILY_CAP,perIpCap:PER_IP_CAP});
  if(quota)return fail(res,429,quota);
  let params,runner;
  if(kind==='demo'){
    const variant=body.variant==='hard'&&cfg.agentOn?'hard':'easy';
    params={variant};
    runner=ctx=>runDemo({...ctx,cfg,jobDir:jobs.jobDir(ctx.job.id)});
  }else{
    if(!(REAL||env.ALLOW_STANDIN_REPO==='1'))return fail(res,400,'Running your own repo needs real Kane, which is not switched on for this server.');
    let steps;try{steps=validateSteps(body.steps)}catch(e){return fail(res,400,e.message)}
    const meta=repoMeta.get(body.repoId);
    if(!meta)return fail(res,400,'Load your repo first.');
    params={repoId:body.repoId,good:String(body.good||''),steps,agent:!!body.agent,repo:{url:meta.url,name:`${meta.owner}/${meta.name}`}};
    runner=ctx=>runRepo({...ctx,cfg,jobDir:jobs.jobDir(ctx.job.id)});
  }
  const job=jobs.create(kind,params,REAL?'real':'standin');
  const ok=jobs.enqueue(job,async ctx=>{await fs.promises.mkdir(jobs.jobDir(job.id),{recursive:true});return runner(ctx)});
  if(!ok){jobs.map.delete(job.id);return fail(res,429,'The line is full right now. Try again in a minute, or watch the recorded real run.')}
  jobs.spend(ip);
  json(res,201,{id:job.id});
}

async function inspect(req,res){
  const body=await readBody(req);
  if(!(REAL||env.ALLOW_STANDIN_REPO==='1'))return fail(res,400,'Running your own repo needs real Kane, which is not switched on for this server.');
  const ip=ipOf(req);
  const quota=jobs.checkQuota(ip,{dailyCap:DAILY_CAP,perIpCap:PER_IP_CAP});
  if(quota)return fail(res,429,quota);
  try{
    const r=await inspectRepo({input:body.url,reposDir:cfg.reposDir,allowLocal:cfg.allowLocalRepos});
    repoMeta.set(r.repoId,{url:r.url,owner:r.owner,name:r.name});
    json(res,200,r);
  }catch(e){fail(res,400,e.message)}
}

function stream(req,res,job){
  const last=Number(req.headers['last-event-id']);
  const from=Number.isFinite(last)&&req.headers['last-event-id']!==undefined?last+1:Number(new URL(req.url,'http://x').searchParams.get('from')||0);
  res.writeHead(200,{...baseHeaders,'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform',connection:'keep-alive','x-accel-buffering':'no'});
  res.write('retry: 3000\n\n');
  const send=e=>res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
  let closed=false;
  const finish=()=>{if(closed)return;closed=true;clearInterval(ping);unsub();res.end()};
  const onEvent=e=>{send(e);if(e.type==='end')finish()};
  const unsub=jobs.subscribe(job,onEvent);
  const ping=setInterval(()=>res.write(': ping\n\n'),15000);
  for(const e of job.events.slice(from))send(e);
  if(['done','error'].includes(job.status)&&job.events.length&&job.events.at(-1).type==='end')finish();
  req.on('close',()=>{closed=true;clearInterval(ping);unsub()});
}

async function api(req,res,url){
  const p=url.pathname;
  if(p==='/api/status'&&req.method==='GET')return json(res,200,status());
  if(req.method==='POST'){
    if(!sameOrigin(req))return fail(res,403,'Blocked: this request did not come from the Culprit page.');
    if(p==='/api/jobs')return createJob(req,res);
    if(p==='/api/repo/inspect')return inspect(req,res);
    return fail(res,404,'Not found');
  }
  const m=/^\/api\/jobs\/([a-z0-9-]{6,24})(?:\/(stream|patch|report|evidence)(\/.*)?)?$/.exec(p);
  if(!m||req.method!=='GET')return fail(res,404,'Not found');
  const [,id,sub,rest]=m;
  const job=id==='real-nov16'?recorded:await jobs.get(id);
  if(!job)return fail(res,404,'That run was not found. Runs are kept while the server stays up.');
  if(!sub)return json(res,200,publicJob(job));
  if(sub==='stream')return stream(req,res,job);
  if(sub==='patch'){
    const patch=job.result?.fix?.patch;
    if(!patch)return fail(res,404,'This run has no fix patch.');
    res.writeHead(200,{...baseHeaders,'content-type':'text/x-diff; charset=utf-8','content-disposition':`attachment; filename="culprit-fix-${job.result.culprit?.short||id}.patch"`});
    return res.end(patch);
  }
  if(id==='real-nov16'&&sub==='report'){return serveFrom(path.join(DOCS,'report'),rest||'/',res)||fail(res,404,'Not found')}
  const base=path.join(jobs.jobDir(job.id),sub);
  return serveFrom(base,rest||'/',res)||fail(res,404,'Not found');
}

http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://x');const p=url.pathname;
    if(p==='/health'){res.writeHead(200);return res.end('ok')}
    if(p.startsWith('/api/'))return await api(req,res,url);
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end()}
    if(p==='/try'){res.writeHead(302,{location:'/app'});return res.end()}
    if(p==='/live.html'){res.writeHead(302,{location:'/r/real-nov16'});return res.end()}
    if(p==='/app'||p==='/app/')return sendFile(res,path.join(SITE,'app.html'))||(res.writeHead(404),res.end());
    if(/^\/r\/[a-z0-9-]{6,24}\/?$/.test(p))return sendFile(res,path.join(SITE,'run.html'))||(res.writeHead(404),res.end());
    const rel=p==='/'?'/index.html':p;
    if(serveFrom(SITE,rel,res,{cache:/\.(png|jpg|svg|ico|webp)$/.test(rel)}))return;
    if(serveFrom(DOCS,rel,res,{cache:/\.(png|jpg|svg|ico|webp)$/.test(rel)}))return;
    res.writeHead(404,{...baseHeaders,'content-type':'text/plain'});res.end('Not found');
  }catch(e){
    if(!res.headersSent)fail(res,e.status||500,e.status?e.message:'Something went wrong on the server.');else res.end();
    if(!e.status)console.error(e);
  }
}).listen(PORT,()=>console.log(`culprit web on :${PORT} | ${REAL?'REAL Kane':'stand-in Kane'} | agent ${cfg.agentOn?'on':'off'} | data ${cfg.dataDir}`));

process.on('unhandledRejection',e=>console.error('unhandledRejection',e));
process.on('uncaughtException',e=>console.error('uncaughtException',e));
