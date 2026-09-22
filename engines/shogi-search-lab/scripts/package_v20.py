import pathlib,json,hashlib,tarfile,gzip,os
R=pathlib.Path(__file__).resolve().parents[1];D=pathlib.Path(os.environ.get('V20_RESULTS',R/'results/v0.20'))
files=sorted(p for p in D.rglob('*') if p.is_file() and p.name not in {'raw-results.tar.gz','manifest.json','summary-console.json'} and not p.name.endswith('.tmp'))
for p in (D/'matches').glob('*.json'):
 if json.loads(p.read_text())['status']!='finished':raise RuntimeError('Cannot package unfinished game')
manifest={'files':[{'path':str(p.relative_to(R)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]}
archive=D/'raw-results.tar.gz'
with archive.open('wb') as raw:
 with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as gz:
  with tarfile.open(fileobj=gz,mode='w') as tar:
   for p in files:
    info=tar.gettarinfo(str(p),arcname=str(p.relative_to(R)));info.mtime=0;info.uid=info.gid=0;info.uname=info.gname=''
    with p.open('rb') as f:tar.addfile(info,f)
manifest['archive']={'path':str(archive.relative_to(R)),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}
with tarfile.open(archive,'r:gz') as tar:
 for e in manifest['files']:
  data=tar.extractfile(e['path']).read()
  if len(data)!=e['bytes'] or hashlib.sha256(data).hexdigest()!=e['sha256']:raise RuntimeError('Archive mismatch: '+e['path'])
(D/'manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({'files':len(files),'archive':manifest['archive']}))
