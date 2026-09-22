import {execFileSync} from 'node:child_process';
// Include repository source and vendored runtime, never credentials or git internals.
execFileSync('python',['-c',`
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root=Path('.')
paths=['README.md','THIRD_PARTY.md','LICENSE','package.json','.gitignore','.github','.openai','dist','docs','scripts','tests','vendor','engines']
with ZipFile('dist/shogi-ai-source.zip','w',ZIP_DEFLATED) as archive:
 for item in paths:
  p=Path(item)
  for f in ([p] if p.is_file() else sorted(p.rglob('*'))):
   if f.is_file() and f.name!='shogi-ai-source.zip' and not any(x in {'build','node_modules','__pycache__'} for x in f.parts): archive.write(f,'shogi-AI/'+str(f))
`]);
console.log('Created dist/shogi-ai-source.zip');
