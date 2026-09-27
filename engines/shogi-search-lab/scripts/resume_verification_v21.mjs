// Complete the teacher-depth sensitivity census and repeat equivalent-work speed.
// Historical results and engine/model parameters are never modified.
import {readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync, openSync, closeSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import {ROOT, START, ASSETS, BIN, lab, yaneura, hash} from './arena_lib.mjs';
import {recordAt, checkedPV} from './record_helpers.mjs';

const prior = resolve(process.env.V21_PRIOR || ROOT+'/results/retrospective-20260927');
const out = resolve(process.env.V21_RESUME || ROOT+'/results/verification-resume-20260927');
if (prior === out) throw Error('A separate output directory is required');
const read = p => JSON.parse(readFileSync(p));
const save = (p, x) => {mkdirSync(resolve(p,'..'),{recursive:true}); writeFileSync(p+'.tmp',JSON.stringify(x,null,2)+'\n'); renameSync(p+'.tmp',p);};
const roots = read(prior+'/roots.json');
const priorProtocol = read(prior+'/protocol.json');
const names = ['nocache','latest','scalar'];
const equivalentFields = ['score','pv','nodes','completed_depth','stop_reason','has_result','fallback_pv'];
function args(name) {
  return ['--advanced','--driver','adaptive','--eval',name==='nocache'?'nnue':name==='scalar'?'nnue-scalar':'nnue-cache',
    '--eval-model',ASSETS+'/yaneuraou.data','--features','tt,history,killer,counter,mate-distance,qsearch,capture-history',
    '--depth','16','--iterative','--policy-model',ROOT+'/models/v0.17/all-policy.txt','--policy-mode','root',
    ...(name==='scalar'?['--eager-order']:[]),'--max-nodes','100000'];
}
const fingerprint = {
  binary:hash(BIN), model:hash(ASSETS+'/yaneuraou.data'), policy:hash(ROOT+'/models/v0.17/all-policy.txt'),
  wasm:hash(ASSETS+'/yaneuraou.wasm'), script:hash(new URL(import.meta.url)),
  roots:hash(prior+'/roots.json'), priorProtocol:hash(prior+'/protocol.json'),
  candidates:Object.fromEntries(roots.map(r=>[r.id,hash(prior+'/teacher/'+r.id+'.json')]))
};
mkdirSync(out,{recursive:true});
const lock=out+'/run.lock';
const fd=openSync(lock,'wx'); writeFileSync(fd,String(process.pid)); closeSync(fd);
try {
  if (!existsSync(out+'/protocol.json')) {
    if(fingerprint.model!==priorProtocol.model || fingerprint.policy!==priorProtocol.policy) throw Error('Prior model mismatch');
    save(out+'/protocol.json',{
      at:new Date().toISOString(),source:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),fingerprint,
      kind:'Continuation verification; exhaustive sensitivity on the existing 24 roots, not new held-out positions',
      roots:roots.map(r=>({id:r.id,game:r.game})),teacherDepth:16,speedNodes:100000,speedRepeats:3,
      args:Object.fromEntries(names.map(n=>[n,args(n)])),equivalentFields,
      notes:['All 24 original roots retained regardless of earlier outcome. All teacher evaluations rerun, including prior 7.',
        'Exactly the original common candidate sets; depth-16 unrestricted bestmove is not added.',
        'Engine, policy and model unchanged. Serial execution. Root/rep rotation fixed in advance.',
        'No new games. Prior 48 games are independently replayed and reported separately.',
        'Exclude a complete root from cp means if any candidate is mate/special; also report common eligibility across depths.',
        'Intervals resample 8 trajectories; descriptive and exploratory, not independent evidence of strength.']
    });
    save(out+'/environment.json',{at:new Date().toISOString(),node:process.version,cpu:os.cpus()[0],arch:os.arch(),release:os.release(),
      compiler:execFileSync('g++',['--version'],{encoding:'utf8'}),selftests:readFileSync(ROOT+'/build/resume-selftests.txt','utf8')});
    save(out+'/prior-audit.json',read(prior+'/audit.json'));
    save(out+'/roots.json',roots);
  } else if(JSON.stringify(read(out+'/protocol.json').fingerprint)!==JSON.stringify(fingerprint)) throw Error('Frozen inputs changed');
  const mode=process.argv[2] || 'all';
  if(!['all','speed','teacher'].includes(mode))throw Error('Use all, speed or teacher');
  if(mode==='all'||mode==='speed') {
    for(let rep=0;rep<3;rep++) for(let i=0;i<roots.length;i++) {
      const root=roots[i],path=out+'/speed/'+root.id+'-'+rep+'.json';
      if(existsSync(path))continue;
      const runs=[];
      for(let j=0;j<3;j++) {
        const variant=names[(i+rep+j)%3],begin=performance.now();
        const a=await lab(root.prefix,args(variant));
        const wallMs=performance.now()-begin,pv=a.has_result?a.pv:a.fallback_pv;
        if(!pv.length || checkedPV(recordAt(START,root.prefix).position,pv).length!==pv.length)throw Error('Illegal speed PV');
        if(a.nodes!==100000)throw Error('Incorrect node count');
        runs.push({...a,variant,wallMs,pvLength:pv.length,chosenMove:pv[0]});
      }
      for(const a of runs) for(const field of equivalentFields) if(JSON.stringify(a[field])!==JSON.stringify(runs[0][field]))throw Error('Equivalence failed '+root.id+' '+field);
      const old=read(prior+'/speed/'+root.id+'-'+rep+'.json');
      const historicalMatches=runs.every(a=>equivalentFields.every(f=>JSON.stringify(a[f])===JSON.stringify(old.runs.find(b=>b.variant===a.variant)[f])));
      save(path,{root,rep,runs,equivalent:true,historicalMatches});
      if(i%6===0)console.log(JSON.stringify({stage:'speed',rep,root:root.id}));
    }
  }
  if(mode==='all'||mode==='teacher') {
    const t=await yaneura(out+'/teacher-usi.jsonl',{allLegalMoves:true});
    save(out+'/opponent.json',{name:t.name,options:t.options,handshake:t.handshake});
    try {for(const root of roots) {
      const path=out+'/depth16/'+root.id+'.json';if(existsSync(path))continue;
      const old=read(prior+'/teacher/'+root.id+'.json'),moves=old.candidates.map(c=>c.move);
      await t.reset();const response=await t.search(root.prefix,{depth:16,multipv:moves.length,searchmoves:moves});
      const found=new Map();for(const x of response.infos)if(!x.bound&&x.depth>=16&&moves.includes(x.pv[0]))found.set(x.pv[0],x);
      if(found.size!==moves.length)throw Error('Incomplete teacher '+root.id);
      const candidates=[...found].map(([move,x])=>({move,...x}));
      for(const x of candidates)if(checkedPV(recordAt(START,root.prefix).position,x.pv).length!==x.pv.length)throw Error('Illegal teacher PV');
      save(path,{root,candidates,priorCandidates:old.candidates,response});
      console.log(JSON.stringify({stage:'teacher',root:root.id,candidates:moves.length,wallMs:response.wallMs}));
    }} finally {t.close();}
  }
} finally {unlinkSync(lock);}
