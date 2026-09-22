// Verified inference choice by default; selective search changes stay opt-in.
import {spawn} from 'node:child_process';
import {BIN} from './arena_lib.mjs';
import {args,read,D} from './experiment_v20.mjs';
const cli=process.argv.slice(2);let variant=read(D+'/selection.json').inference;
if(variant==='original')variant='base';
const i=cli.indexOf('--variant');if(i>=0){variant=cli[i+1];if(!variant)throw Error('Missing variant');cli.splice(i,2);}
const child=spawn(BIN,[...args(variant),...cli],{stdio:'inherit'});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
