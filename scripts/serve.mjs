import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('dist');
const arg=process.argv.indexOf('--port');
const port=Number(process.env.PORT || (arg>=0?process.argv[arg+1]:4173));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.wasm':'application/wasm','.webmanifest':'application/manifest+json','.txt':'text/plain; charset=utf-8'};
http.createServer((req,res)=>{
  const rel=decodeURIComponent(new URL(req.url,'http://local').pathname);
  const file=path.resolve(root,'.'+(rel==='/'?'/index.html':rel));
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  res.setHeader('Cache-Control','no-cache');res.setHeader('X-Content-Type-Options','nosniff');
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
}).listen(port,'0.0.0.0',()=>console.log('Shogi practice listening on '+port));
