// web.mjs: serves the Culprit landing page (docs/) at "/", a Run button at "/try",
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

const TRY_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Run Culprit</title>
<style>body{font-family:system-ui;max-width:760px;margin:0 auto;padding:16px;background:#111;color:#eee}
button,input{font-size:16px;padding:10px 14px;border-radius:8px;border:1px solid #444;background:#222;color:#eee}
button{background:#2b7;border:0;color:#fff}pre{background:#000;padding:12px;border-radius:8px;white-space:pre-wrap;min-height:120px}
.note{color:#fb4}a{color:#6cf}</style></head><body>
<h1>🔎 Run Culprit</h1>
<p class="note">${REAL ? "Mode: real Kane replays (limited runs per day)." : "Mode: STAND-IN Kane on a seeded demo history. Not real Kane. Real Kane evidence is on the main page."}</p>
${PASSWORD ? '<p><input id="pw" type="password" placeholder="Run code"></p>' : ""}
<p><button id="go">Run Culprit</button></p>
<pre id="out">Press the button. A run takes a few minutes in real mode, seconds with the stand-in.</pre>
<p id="rep" style="display:none"><a href="/last-report/">Open the report</a></p>
<script>
const out=document.getElementById("out");
document.getElementById("go").onclick=async()=>{
  out.textContent="Starting...\\n";
  const pw=document.getElementById("pw");
  const r=await fetch("/run",{method:"POST",headers:{"x-run-code":pw?pw.value:""}});
  if(!r.ok){out.textContent=await r.text();return;}
  const rd=r.body.getReader(),dec=new TextDecoder();out.textContent="";
  for(;;){const {done,value}=await rd.read();if(done)break;out.textContent+=dec.decode(value);window.scrollTo(0,document.body.scrollHeight);}
  document.getElementById("rep").style.display="block";
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
