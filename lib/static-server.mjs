#!/usr/bin/env node
// Serves ONE checked-out commit of a static site, from the current directory, on $PORT.
// This is the only thing that ever runs for a visitor's repo: their code runs inside the browser sandbox,
// never on this server, and no install or build step is executed.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const MIME={'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg',
  '.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8','.woff':'font/woff',
  '.woff2':'font/woff2','.map':'application/json','.xml':'application/xml'};
// Where a static site usually lives, in order. The first folder that has an index.html wins.
export const SITE_DIRS=['.','public','docs','dist','build','www','site','src','app'];

export function findSiteRoot(base){
  for(const d of SITE_DIRS){const p=path.resolve(base,d);if(fs.existsSync(path.join(p,'index.html')))return p}
  return null;
}

export function createStaticServer(base){
  const root=findSiteRoot(base);
  return http.createServer((req,res)=>{
    const headers={'cache-control':'no-store','x-content-type-options':'nosniff'};
    if(!root){res.writeHead(404,{...headers,'content-type':'text/plain'});return res.end('No index.html found in this commit.')}
    let rel;try{rel=decodeURIComponent(new URL(req.url,'http://x').pathname)}catch{res.writeHead(400);return res.end('Bad request')}
    let p=path.resolve(root,'.'+rel);
    if(p!==root&&!p.startsWith(root+path.sep)){res.writeHead(403,headers);return res.end('Forbidden')}
    try{if(fs.statSync(p).isDirectory())p=path.join(p,'index.html')}catch{}
    // Never follow a symlink out of the checkout (a repo can contain links to files on this machine).
    try{const real=fs.realpathSync(p);if(!real.startsWith(fs.realpathSync(root)+path.sep)&&real!==fs.realpathSync(root))throw new Error('outside')}
    catch{res.writeHead(404,{...headers,'content-type':'text/plain'});return res.end('Not found')}
    res.writeHead(200,{...headers,'content-type':MIME[path.extname(p).toLowerCase()]||'application/octet-stream'});
    fs.createReadStream(p).pipe(res);
  });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const port=Number(process.env.PORT||3000);
  createStaticServer(process.cwd()).listen(port); // dual-stack, like a normal dev server: Chrome may resolve localhost to ::1
}
