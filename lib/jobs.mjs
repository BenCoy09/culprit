// A tiny job system: one run at a time, a short queue, a live event log per job, and results saved to disk
// so a run's link keeps working after the page is closed.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

export class Jobs{
  constructor({dataDir,maxQueue=4}){
    this.dir=path.join(dataDir,'jobs');this.maxQueue=maxQueue;
    this.map=new Map();this.queue=[];this.running=null;this.listeners=new Map();
    this.counters={day:'',total:0,ip:new Map()};
  }

  // ---- fair use: a daily total and a per-visitor limit, so free credits last through judging ----
  checkQuota(ip,{dailyCap,perIpCap}){
    const day=new Date().toISOString().slice(0,10),c=this.counters;
    if(c.day!==day){c.day=day;c.total=0;c.ip.clear()}
    if(c.total>=dailyCap)return `Today's free runs are used up (${dailyCap}). Watch the recorded real run, or come back tomorrow.`;
    if((c.ip.get(ip)||0)>=perIpCap)return `You have used your ${perIpCap} runs for today. Watch the recorded real run, or come back tomorrow.`;
    return null;
  }
  spend(ip){this.counters.total++;this.counters.ip.set(ip,(this.counters.ip.get(ip)||0)+1)}
  left({dailyCap}){return Math.max(0,dailyCap-this.counters.total)}

  create(kind,params,mode){
    const id=crypto.randomBytes(6).toString('hex');
    const job={id,kind,mode,params,status:'queued',createdAt:Date.now(),events:[],result:null,error:null};
    this.map.set(id,job);return job;
  }

  emit(job,ev){
    const e={seq:job.events.length,t:Date.now()-(job.startedAt||job.createdAt),...ev};
    job.events.push(e);
    for(const f of this.listeners.get(job.id)||[])f(e);
    return e;
  }

  subscribe(job,fn){
    const s=this.listeners.get(job.id)||new Set();s.add(fn);this.listeners.set(job.id,s);
    return()=>{s.delete(fn);if(!s.size)this.listeners.delete(job.id)};
  }

  async get(id){
    if(this.map.has(id))return this.map.get(id);
    if(!/^[a-f0-9]{12}$/.test(String(id)))return null;
    try{const j=JSON.parse(await readFile(path.join(this.dir,id,'job.json'),'utf8'));this.map.set(id,j);return j}catch{return null}
  }

  jobDir(id){return path.join(this.dir,id)}

  async save(job){
    try{await mkdir(this.jobDir(job.id),{recursive:true});await writeFile(path.join(this.jobDir(job.id),'job.json'),JSON.stringify(job))}catch{}
  }

  // Queue a runner: async ({job,emit}) => result. Returns false when the line is full.
  enqueue(job,runner){
    if(this.queue.length>=this.maxQueue)return false;
    this.queue.push({job,runner});this.announce();this.pump();return true;
  }

  announce(){this.queue.forEach(({job},i)=>this.emit(job,{type:'status',status:'queued',position:i+1,ahead:i+(this.running?1:0)}))}

  async pump(){
    if(this.running||!this.queue.length)return;
    const {job,runner}=this.queue.shift();this.running=job;
    job.status='running';job.startedAt=Date.now();
    this.emit(job,{type:'status',status:'running'});
    this.announce();
    try{
      job.result=await runner({job,emit:ev=>this.emit(job,ev)});
      job.status='done';this.emit(job,{type:'result',result:job.result});
    }catch(e){
      job.status='error';job.error=String(e?.message||e);
      this.emit(job,{type:'error',message:job.error,hint:e?.hint||null,detail:e?.detail||null});
    }finally{
      job.finishedAt=Date.now();this.emit(job,{type:'end',status:job.status});
      await this.save(job);this.running=null;this.pump();
    }
  }

  stats(){return {running:!!this.running,waiting:this.queue.length}}
}
