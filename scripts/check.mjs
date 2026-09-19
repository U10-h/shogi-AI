import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]);}
for(const path of [...walk('dist'),...walk('scripts')]){
 if(/\.(js|mjs)$/.test(path)){execFileSync(process.execPath,['--check',path]);const text=readFileSync(path,'utf8');for(const m of text.matchAll(/(?:from\s+|import\s+)['"](\.\.?\/[^'"]+)['"]/g)){if(!existsSync(resolve(dirname(path),m[1])))throw Error('Missing import '+path+': '+m[1]);}}
 if(path.endsWith('.html'))for(const m of readFileSync(path,'utf8').matchAll(/(?:href|src)="(\.\/[^"#]+)"/g)){if(!existsSync(resolve(dirname(path),m[1])))throw Error('Missing asset '+m[1]);}
}
for(const [name,sha] of [['yaneuraou.wasm','0a630de6b2d6e0e96f7ca3adc20b011691543c1c'],['yaneuraou.data','b8ac99947ddef4b5ff100a96754c148c00e034b0']]){const buf=readFileSync('dist/vendor/yaneuraou/'+name);const actual=createHash('sha1').update('blob '+buf.length+'\0').update(buf).digest('hex');if(actual!==sha)throw Error('Engine integrity failure: '+name);}
console.log('PASS: JavaScript syntax, local assets/imports, engine binary integrity');
