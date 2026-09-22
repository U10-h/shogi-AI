import fs from 'node:fs';
import path from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
const src = 'vendor/tsshogi/src';
const files = fs.readdirSync(src,{recursive:true}).filter(f=>f.endsWith('.ts'));
const typeNames = new Set();
for (const f of files) for (const m of fs.readFileSync(path.join(src,f),'utf8').matchAll(/export\s+(?:interface|type)\s+(\w+)/g)) typeNames.add(m[1]);
for(const f of files){
  let source=fs.readFileSync(path.join(src,f),'utf8');
  source=source.replace(/import\s*\{([\s\S]*?)\}\s*from/g,(_,names)=>'import {'+names.split(',').filter(n=>n.trim()&&!typeNames.has(n.trim().split(/\s+as\s+/)[0])).join(',')+'} from');
  let out=stripTypeScriptTypes(source,{mode:'transform'}).replace(/((?:from|import)\s+["'])(\.\.?\/[^"']+)(["'])/g,(_,a,b,c)=>a+b+'.js'+c);
  const dest=path.join('dist/vendor/tsshogi',f.replace(/\.ts$/,'.js'));
  fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,out);
}
fs.copyFileSync('vendor/tsshogi/LICENSE','dist/vendor/tsshogi/LICENSE');
console.log('Vendored tsshogi: '+files.length+' modules');
