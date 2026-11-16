import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const BASE=`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Brewline</title></head>
<body>
<h1>Brewline</h1>
<section id="menu"><h2>Menu</h2>
<ul>
<li>Ethiopia Guji <button class="add">Add to cart</button></li>
<li>Colombia Huila <button class="add">Add to cart</button></li>
</ul></section>
<section id="cart"><h2>Cart (<span id="count">0</span>)</h2>
<button id="pay" onclick="submitOrder()">Pay now</button></section>
<p id="confirm" hidden>Order confirmed. Your order number is <b id="num"></b></p>
<script>
let n=0;
document.querySelectorAll('.add').forEach(b=>b.onclick=()=>{n++;document.getElementById('count').textContent=n});
function submitOrder(){
  if(!n)return;
  document.getElementById('num').textContent='BL-'+(1000+Math.floor(Math.random()*9000));
  document.getElementById('confirm').hidden=false;
}
</script>
</body></html>
`;
const rep=(a,b)=>h=>{if(!h.includes(a))throw new Error('seed edit did not apply: '+a);return h.replace(a,b)};

// 15 more commits in the style of an agent's day of work. Commit 8 silently breaks "Pay now".
export const EDITS=[
 ['feat: add Kenya Nyeri to the menu',rep('</ul></section>','<li>Kenya Nyeri <button class="add">Add to cart</button></li>\n</ul></section>')],
 ['style: base typography',rep('</head>','<style>body{font-family:system-ui;margin:2rem}</style>\n</head>')],
 ['feat: footer with opening hours',rep('<script>','<footer>Open daily 7am to 5pm</footer>\n<script>')],
 ['style: emphasise the cart count',rep('</style>','#count{font-weight:600}</style>')],
 ['chore: update page title',rep('<title>Brewline</title>','<title>Brewline | Coffee subscriptions</title>')],
 ['feat: free shipping promo banner',rep('<h1>Brewline</h1>','<h1>Brewline</h1>\n<p class="promo">Free shipping over $30</p>')],
 ['refactor: centralize event wiring',h=>rep('</script>','function wire(){document.getElementById(\'pay\').addEventListener(\'click\',submitOrder)}\n</script>')(rep(' onclick="submitOrder()"','')(h))],
 ['style: button hover states',rep('</style>','button:hover{opacity:.85}</style>')],
 ['feat: second footer line',rep('Open daily 7am to 5pm','Open daily 7am to 5pm. Closed on holidays')],
 ['chore: add meta description',rep('</head>','<meta name="description" content="Fresh coffee, delivered">\n</head>')],
 ['a11y: label the pay button',rep('<button id="pay">','<button id="pay" aria-label="Pay now">')],
 ['style: section spacing',rep('</style>','section{margin-bottom:1.5rem}</style>')],
 ['feat: shipping note under the cart',rep('Pay now</button></section>','Pay now</button> <small>Ships in 2 days</small></section>')],
 ['chore: menu heading copy',rep('<h2>Menu</h2>',"<h2>This week's menu</h2>")],
 ['style: muted footer',rep('</style>','footer{opacity:.7}</style>')],
];

// CommonJS on purpose: a bare checkout (no package.json) must start with plain `node server.js`.
const SERVER=`const {createServer}=require('node:http');
const {readFile}=require('node:fs/promises');
const path=require('node:path');
createServer(async(_q,res)=>{
  try{const html=await readFile(path.join(__dirname,'public','index.html'));res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)}
  catch(e){res.writeHead(500);res.end(String(e))}
}).listen(process.env.PORT||3000);
`;
const TEST=`---
mode: testing
headless: true
---

# Brewline checkout

## Add a bag
Click "Add to cart" on the first coffee in the menu. Verify the cart count shows 1.

## Pay
Click "Pay now". Verify an order confirmation appears with an order number starting with BL-.
`;

export async function seed(dir,opts={}){
  dir=path.resolve(dir);
  await rm(dir,{recursive:true,force:true});
  await mkdir(path.join(dir,'public'),{recursive:true});await mkdir(path.join(dir,'tests'),{recursive:true});
  const env={...process.env,GIT_AUTHOR_NAME:'coding-agent',GIT_AUTHOR_EMAIL:'agent@example.com',GIT_COMMITTER_NAME:'coding-agent',GIT_COMMITTER_EMAIL:'agent@example.com'};
  const g=(...a)=>execFileSync('git',a,{cwd:dir,env,encoding:'utf8'}).trim();
  g('init','-q','-b','main');
  let html=BASE;
  await writeFile(path.join(dir,'public/index.html'),html);
  await writeFile(path.join(dir,'server.js'),SERVER);
  await writeFile(path.join(dir,'tests/checkout_test.md'),TEST);
  g('add','-A');g('commit','-q','-m','feat: menu, cart and checkout');
  const good=g('rev-parse','HEAD');
  // cleanRevert: later commits avoid the pay-button line, so a plain `git revert` applies cleanly.
  const clean={a11y:rep('<footer>','<footer role="contentinfo">'),
    'feat: shipping':rep('Closed on holidays','Closed on holidays. Ships in 2 days')};
  const edits=EDITS.map(([m,e])=>{const k=Object.keys(clean).find(k=>m.startsWith(k));return opts.cleanRevert&&k?[m,clean[k]]:[m,e]});
  for(const [msg,edit] of edits){
    html=edit(html);
    await writeFile(path.join(dir,'public/index.html'),html);
    g('add','-A');g('commit','-q','-m',msg);
  }
  return {dir,good,bad:g('rev-parse','HEAD'),culpritSubject:'refactor: centralize event wiring'};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);const s=await seed(args.find(a=>!a.startsWith('--'))||'demo/repo',{cleanRevert:args.includes('--clean-revert')});
  console.log(`Seeded ${s.dir}\n  good: ${s.good.slice(0,7)}\n  bad:  ${s.bad.slice(0,7)}\n  planted regression: "${s.culpritSubject}"`);
}
