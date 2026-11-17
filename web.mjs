/ web.mjs: serves the Culprit landing page (docs/) at "/", a Run button at "/try",
// and the last run's report at "/last-report/". Zero dependencies.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = process.env.PORT || 3000;
const ROOT = process.cwd();
const DOCS = path.join(ROOT, "docs");
const REPORT_DIR = path.join(ROOT, process.env.REPORT_DIR || "culprit-report");
const PASSWORD = process.env.RUN_PASSWORD || "";
const KANE_BIN = process.env.KANE_BIN || ""; // empty = stand-in Kane
const BUNDLE_DIR = process.env.BUNDLE_DIR || "";
const REAL = !!KANE_BIN;
const DAILY_CAP = Number(process.env.DAILY_CAP || (REAL ? 20 : 1000));
const COOLDOWN_MS = 30_000;

let busy = false;
let lastRunAt = 0;
let day = new Date().toDateString();
let runsToday = 0;

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".mjs": "text/javascript", ".json": "application/json", ".txt": "text/plain; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".webp": "image/webp",
};

function serveStatic(base, rel, res) {
  let p = path.normalize(path.join(base, decodeURIComponent(rel)));
  if (!p.startsWith(base)) { res.writeHead(403); return res.end("Forbidden"); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(p).toLowerCase()] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}

const TRY_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Try Culprit live</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root{--bg:#F4F1EA;--sf:#FBF9F4;--ink:#1B1D1F;--mu:#5E625F;--ln:#D9D4C7;--mk:#D9A400;--ok:#2E6F4E;--no:#A8402B;--sans:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
@media(prefers-color-scheme:dark){:root{--bg:#141615;--sf:#1C1F1D;--ink:#ECE9E1;--mu:#9A9E98;--ln:#2D312E;--mk:#E0B21A;--ok:#5FAE86;--no:#E0735A}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 var(--sans)}
.w{max-width:760px;margin:0 auto;padding:0 18px}
header{display:flex;justify-content:space-between;align-items:center;padding:16px 0;border-bottom:1px solid var(--ln)}
header a{color:var(--ink);text-decoration:none;font-weight:600}
header nav{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px 14px}header nav a{font-weight:500;color:var(--mu);font-size:14px;white-space:nowrap}
h1{font-size:clamp(30px,7.4vw,44px);line-height:1.08;margin:28px 0 12px;letter-spacing:-.02em}
.lead{font-size:18px;color:var(--mu);margin:0 0 20px;max-width:34em}
.lim{background:var(--sf);border:1px solid var(--ln);border-radius:8px;padding:14px 16px;font-size:14px;color:var(--mu);margin:0 0 22px}
.lim b{color:var(--ink)}a{color:var(--ink)}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 22px;border-radius:6px;background:var(--ink);color:var(--bg);font:600 16px var(--sans);border:1px solid var(--ink);cursor:pointer}
.btn:disabled{opacity:.5;cursor:wait}.btn.g{background:transparent;color:var(--ink);border-color:var(--ln);text-decoration:none}
input{font:16px var(--sans);min-height:48px;padding:0 12px;border-radius:6px;border:1px solid var(--ln);background:var(--sf);color:var(--ink);margin-right:8px}
:focus-visible{outline:3px solid var(--mk);outline-offset:2px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 18px}
#status{font:500 14px var(--mono);color:var(--mu);margin:0 0 14px;min-height:22px}
.res{display:none;margin:0 0 18px}.res.on{display:block}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.st{background:var(--sf);border:1px solid var(--ln);border-radius:8px;padding:14px 16px}
.st small{display:block;font:500 12px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--mu);margin-bottom:6px}
.st b{display:block;font:500 20px/1.3 var(--mono)}.st.bad b{color:var(--no)}.st.good b{color:var(--ok)}
details{border-bottom:1px solid var(--ln);margin-top:8px}summary{cursor:pointer;padding:14px 0;font-weight:600;min-height:44px}
pre{background:var(--sf);border:1px solid var(--ln);border-radius:8px;padding:12px;white-space:pre-wrap;word-break:break-word;font:400 12.5px/1.5 var(--mono);color:var(--mu);margin:0 0 14px;max-height:50vh;overflow:auto}
h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--mu);margin:30px 0 12px;font-weight:600}
ol{margin:0;padding:0;list-style:none;counter-reset:s}ol li{counter-increment:s;display:grid;grid-template-columns:34px 1fr;padding:10px 0;border-bottom:1px solid var(--ln);font-size:15px;color:var(--mu)}
ol li:before{content:counter(s);font:500 14px var(--mono);color:var(--mu)}ol strong{color:var(--ink);display:block}
footer{border-top:1px solid var(--ln);padding:18px 0 28px;margin-top:36px;color:var(--mu);font-size:13px}footer a{color:var(--mu)}
</style></head><body><div class="w">
<header><a href="/">Culprit</a><nav><a href="/try">Try it live</a><a href="/live.html">Real run</a><a href="/report/">Report</a><a href="https://github.com/BenCoy09/culprit">GitHub</a></nav></header>
<main>
<h1>Try Culprit live</h1>
<p class="lead">Culprit will search a demo shop's 16 commits for the one that broke checkout, undo it, and confirm checkout works again.</p>
<div class="lim">${REAL ? "<b>Real Kane mode.</b> This runs real browser replays. The number of runs per day is limited, and a full run takes a few minutes." : "<b>This is a demo.</b> It uses a stand-in for Kane, so it tests Culprit's own logic, not real browser replays. The real Kane results are on the <a href='/live.html'>Real run</a> page."}</div>
${PASSWORD ? '<div class="row"><input id="pw" type="password" placeholder="Run code" aria-label="Run code"></div>' : ""}
<div class="row"><button class="btn" id="go" type="button">Run the demo</button><a class="btn g" id="rep" style="display:none" href="/last-report/">Open the report</a></div>
<p id="status" role="status" aria-live="polite"></p>
<div class="res" id="res"><div class="grid">
<div class="st bad"><small>Broke checkout</small><b id="r1">-</b></div>
<div class="st"><small>Checks needed</small><b id="r2">-</b></div>
<div class="st good"><small>After the fix</small><b id="r3">-</b></div></div></div>
<details id="logd" style="display:none"><summary>Show the technical log</summary><pre id="out"></pre></details>
<h2>What happens when you press the button</h2>
<ol><li><div><strong>Builds a demo shop history</strong>16 commits, with one bug planted.</div></li>
<li><div><strong>Searches for the bad commit</strong>Jumps through the history, replaying a checkout test on each version it visits.</div></li>
<li><div><strong>Undoes it and checks again</strong>Reverts the culprit, then re-runs the same test to confirm checkout works.</div></li></ol>
</main>
<footer>Culprit · built for the Kane CLI hackathon · <a href="https://github.com/BenCoy09/culprit">source</a></footer></div>
<script>
var go=document.getElementById("go"),st=document.getElementById("status"),out=document.getElementById("out");
function $(i){return document.getElementById(i)}
go.onclick=async function(){
  go.disabled=true;out.textContent="";$("res").className="res";$("rep").style.display="none";$("logd").style.display="none";
  st.textContent="Running... this usually takes a few seconds.";
  var pw=$("pw");var r;
  try{r=await fetch("/run",{method:"POST",headers:{"x-run-code":pw?pw.value:""}});}catch(e){st.textContent="Could not reach the server. Try again.";go.disabled=false;return;}
  if(!r.ok){st.textContent=await r.text();go.disabled=false;return;}
  var rd=r.body.getReader(),dec=new TextDecoder(),all="";$("logd").style.display="block";
  for(;;){var x=await rd.read();if(x.done)break;var t=dec.decode(x.value);all+=t;out.textContent=all;out.scrollTop=out.scrollHeight;}
  var c=all.match(/Culprit:\\s*([^\\n]+)/),p=all.match(/Search probes:\\s*(\\d+)\\s*of\\s*(\\d+)/),ok=/\\[exit 0\\]/.test(all);
  if(ok&&c){
    var name=c[1].trim();
    $("r1").textContent=name.length>80?name.slice(0,80)+"...":name;
    $("r2").textContent=p?(p[1]+" of "+p[2]+" commits"):"see log";
    $("r3").textContent=/re-?verif[^\\n]*good/i.test(all)||/fix(ed)?[^\\n]*good/i.test(all)?"Checkout works again":"See the log";
    $("res").className="res on";$("rep").style.display="inline-flex";st.textContent="Done.";
  }else{st.textContent=ok?"Finished. See the technical log below.":"The run stopped early. Open the technical log below to see why.";}
  go.disabled=false;
};
</script></body></html>`;

function handleRun(req, res) {
  if (PASSWORD && req.headers["x-run-code"] !== PASSWORD) {
    res.writeHead(401); return res.end("Wrong or missing run code.");
  }
  const today = new Date().toDateString();
  if (today !== day) { day = today; runsToday = 0; }
  if (runsToday >= DAILY_CAP) { res.writeHead(429); return res.end("Daily run limit reached. Try tomorrow."); }
  if (busy) { res.writeHead(429); return res.end("A run is already in progress. Try again shortly."); }
  const wait = lastRunAt + COOLDOWN_MS - Date.now();
  if (wait > 0) { res.writeHead(429); return res.end(`Please wait ${Math.ceil(wait / 1000)}s between runs.`); }

  busy = true; runsToday++; lastRunAt = Date.now();
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });

  const kane = REAL
    ? `--kane-bin "${KANE_BIN}" ${BUNDLE_DIR ? `--bundle "${BUNDLE_DIR}"` : ""}`
    : `--kane-bin demo/fake-kane.mjs`;
  const script = `
set -e
git config --global user.email "ci@example.com"; git config --global user.name "ci"
chmod +x demo/fake-kane.mjs 2>/dev/null || true
rm -rf demo/repo
node demo/seed.mjs demo/repo --clean-revert
G=$(git -C demo/repo rev-list --max-parents=0 HEAD)
node bin/culprit.mjs run --repo demo/repo --test tests/checkout_test.md --good "$G" --bad HEAD \\
  --app "node server.js" ${kane} --fix revert
`;
  const child = spawn("bash", ["-c", script], { cwd: ROOT, env: process.env });
  child.stdout.on("data", (d) => res.write(d));
  child.stderr.on("data", (d) => res.write(d));
  child.on("close", (code) => { busy = false; res.end(`\n[exit ${code}]\n`); });
  req.on("close", () => { if (busy) child.kill(); });
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/health") { res.writeHead(200); return res.end("ok"); }
  if (p === "/try" && req.method === "GET") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(TRY_PAGE); }
  if (p === "/run" && req.method === "POST") return handleRun(req, res);
  if (p.startsWith("/last-report")) return serveStatic(REPORT_DIR, p.slice("/last-report".length) || "/", res);
  return serveStatic(DOCS, p === "/" ? "/index.html" : p, res);
}).listen(PORT, () => console.log(`culprit web on :${PORT} (${REAL ? "real" : "stand-in"} Kane)`));
