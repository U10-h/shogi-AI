#!/usr/bin/env python3
"""Small regression checks for the USI/checkpoint additions (two tiny searches)."""
import json
import subprocess
import tempfile
from pathlib import Path
import run_phase0_small as pilot

paths = pilot.freeze()
positions = json.loads((pilot.OUT/'positions.json').read_text())
sfen = positions[0]['sfen']
checks = {}
e = pilot.start('lab', paths)
try:
    e.send('position sfen ' + sfen)
    e.send('go nodes 1')
    lines = e.until('bestmove ')
    r = pilot.parse_search(lines, 'lab', 0)
    assert r['nodes'] == 1 and not r['has_completed_iteration']
    assert r['bestmove'] in pilot.legal(sfen)
    checks['one_node_abort_returns_legal_fallback_and_totals'] = True
    e.send('eval')
    score = int(e.until('eval = ')[-1].split('=')[1])
    expected = json.loads((pilot.OUT/'eval/startpos.json').read_text())['raw_pawn90']['lab'][0]
    assert score == expected
    checks['abort_restores_root_for_eval'] = True
    e.send('go nodes 1000')
    r = pilot.parse_search(e.until('bestmove '), 'lab', 0)
    assert r['nodes'] == 1000 and r['raw']['stop_reason'] == 'node_limit'
    assert r['bestmove'] in pilot.legal(sfen)
    checks['next_search_completes_after_abort'] = True
finally:
    e.close()

before = {str(p): pilot.sha(p) for p in (pilot.OUT/'nodes').glob('*.json')}
p = subprocess.run(['python3', str(pilot.ROOT/'scripts/run_phase0_small.py'), 'nodes', '--max-new', '2'],
                   capture_output=True, text=True, check=True, timeout=10)
assert json.loads(p.stdout.splitlines()[-1])['new_pairs'] == 0
assert before == {str(p): pilot.sha(p) for p in (pilot.OUT/'nodes').glob('*.json')}
checks['resume_skips_completed_pairs_without_overwrite'] = True

# Exercise the actual checkpoint reader's condition guard without touching real results.
with tempfile.TemporaryDirectory() as temp:
    out = Path(temp)
    wrong = {'condition_sha256': 'wrong'}
    (out/'positions.json').write_text(json.dumps(positions[:1]))
    (out/'eval').mkdir(); (out/'eval/startpos.json').write_text(json.dumps(wrong))
    code = '''import sys
from pathlib import Path
import run_phase0_small as p
p.OUT=Path(sys.argv[1])
p.freeze=lambda: (None,None,None,None,'expected')
sys.argv=['pilot','eval']
p.main()
'''
    p = subprocess.run(['python3', '-c', code, str(out)], cwd=pilot.ROOT/'scripts',
                       capture_output=True, text=True, timeout=5)
    assert p.returncode != 0 and 'Checkpoint condition mismatch' in p.stderr
    checks['wrong_checkpoint_condition_is_rejected'] = True
pilot.atomic(pilot.OUT/'harness-verification.json', {'checks': checks, 'usi_log': e.log})
print(json.dumps(checks, indent=2))
