#!/usr/bin/env node
// STAND-IN for kane-cli, for offline tests of the bisect logic only. It is NOT Kane and proves nothing about Kane.
// It speaks the documented testmd surface (args, NDJSON ending in test_md_done, exit 0/1/2, Result.md) and
// decides pass/fail by really executing the page's script in a tiny DOM stub, so a real behavioural bug fails it.
import vm from 'node:vm';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';

const a=process.argv.slice(2);
const testPath=a[2],url=a[a.indexOf('--url')+1];
const out=o=>process.stdout.write(JSON.stringify(o)+'\n');
out({type:'stream_start',surface:'testmd',v:1});

let html;
try{const r=await fetch(url);html=await r.text()}catch(e){console.error('cannot reach '+url);out({type:'test_md_done',overall_status:'error'});process.exit(2)}

function simulate(html){
  const els={},adds=[];let ctx;
  const mk=id=>({id,hidden:false,textContent:'',onclick:null,attr:'',ls:[],
    addEventListener(t,f){if(t==='click')this.ls.push(f)},
    click(){if(this.attr)vm.runInContext(this.attr,ctx);if(this.onclick)this.onclick();this.ls.forEach(f=>f())}});
  for(const m of html.matchAll(/<(\w+)([^>]*?\bid="([^"]+)"[^>]*)>/g)){
    const el=mk(m[3]);el.hidden=/\shidden(\s|$)/.test(m[2].replace(/id="[^"]*"/,''));
    const oc=m[2].match(/onclick="([^"]*)"/);if(oc)el.attr=oc[1];els[m[3]]=el;
  }
  for(const _ of html.matchAll(/<button class="add"[^>]*>/g))adds.push(mk('add'));
  const document={getElementById:id=>els[id],querySelectorAll:s=>s==='.add'?adds:[],addEventListener:(t,f)=>{if(t==='DOMContentLoaded')f()}};
  ctx=vm.createContext({document,window:{},Math,console});
  const script=(html.match(/<script>([\s\S]*?)<\/script>/)||[])[1]||'';
  vm.runInContext(script,ctx);
  return {els,adds};
}

const steps=[];let failed=false;
const step=(title,obj,fn)=>{
  if(failed){steps.push({title,obj,status:'skipped'});return}
  try{fn();steps.push({title,obj,status:'passed'});out({step:steps.length,status:'done',remark:title})}
  catch(e){failed=true;steps.push({title,obj,status:'failed'});out({step:steps.length,status:'failed',remark:`${title}: ${e.message}`})}
};
let page;
try{page=simulate(html)}catch(e){page=null;step('Load page','Open the page.',()=>{throw new Error('page script threw: '+e.message)})}
if(page){
  step('Add a bag','Click "Add to cart" on the first coffee in the menu. Verify the cart count shows 1.',()=>{
    if(!page.adds[0])throw new Error('no Add to cart button');page.adds[0].click();
    if(String(page.els.count.textContent)!=='1')throw new Error('cart count is '+page.els.count.textContent);
  });
  step('Pay','Click "Pay now". Verify an order confirmation appears with an order number starting with BL-.',()=>{
    page.els.pay.click();
    if(page.els.confirm.hidden)throw new Error('clicking Pay now showed no confirmation');
    if(!/^BL-/.test(page.els.num.textContent))throw new Error('no order number');
  });
}
const stem=path.basename(testPath).replace(/_test\.md$/,'');
const dir=path.join(path.dirname(testPath),`output-${stem}`);
await mkdir(dir,{recursive:true});
const icon={passed:'✓ passed',failed:'✗ failed',skipped:'⏭ skipped'};
await writeFile(path.join(dir,'Result.md'),`---\ntest: ../${path.basename(testPath)}\nstatus: ${failed?'failed':'passed'}\n---\n\n`+
  steps.map(s=>`## ${s.title} ${icon[s.status]}${s.status==='skipped'?'':' (0s)'}\n${s.obj}\n`).join('\n'));
out({type:'test_md_done',overall_status:failed?'failed':'passed',duration_s:0.1,session_id:'stand-in'});
process.exit(failed?1:0);
