#!/usr/bin/env python3
"""Six-position native bridge pilot. Each invocation runs at most two new pairs."""
import argparse
import hashlib
import json
import os
import platform
import queue
import re
import subprocess
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'results/v1.0-phase0'
BUILD = ROOT / 'build/phase0'
FEATURES = 'tt,history,killer,counter,mate-distance,qsearch,capture-history'
NATIVE_OPTIONS = {
    'Threads': '1', 'USI_Hash': '16', 'MultiPV': '1', 'USI_Ponder': 'false',
    'USI_OwnBook': 'false', 'BookFile': 'no_book', 'GenerateAllLegalMoves': 'true',
    'EnteringKingRule': 'NoEnteringKing', 'DrawValueBlack': '0', 'DrawValueWhite': '0',
    'NetworkDelay': '0', 'NetworkDelay2': '0', 'PvInterval': '0',
}

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def atomic(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    with tmp.open('w') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write('\n'); f.flush(); os.fsync(f.fileno())
    tmp.replace(path)

def freeze():
    src = next((BUILD / 'upstream').iterdir()) / 'source'
    native = src / 'YaneuraOu-by-gcc'
    model = src / 'eval/nn.bin'
    lab = ROOT / 'build/shogi-lab'
    inputs = [Path(__file__), ROOT/'scripts/build_phase0_native.py', OUT/'positions.json', ROOT/'Makefile']
    inputs += sorted((ROOT/'src').glob('*'))
    inputs += sorted(p for p in (ROOT/'vendor/yaneuraou').rglob('*') if p.suffix in ('.h', '.hpp', '.cpp'))
    manifest_path = OUT/'manifest.json'
    base_commit = (json.loads(manifest_path.read_text())['source_base_commit'] if manifest_path.exists()
                   else subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip())
    config = {
        'schema': 1, 'source_base_commit': base_commit,
        'input_sha256': {str(p.relative_to(ROOT)): sha(p) for p in inputs if p.is_file()},
        'lab_sha256': sha(lab), 'native_sha256': sha(native), 'model_sha256': sha(model),
        'native_build': json.loads((BUILD/'native-build.json').read_text()),
        'features': FEATURES, 'lab_tt_entries': 100000, 'lab_qdepth': 6,
        'native_options': NATIVE_OPTIONS, 'nodes_requested': 10000, 'movetime_ms': 200,
        'search_timeout_seconds': 8, 'processes_at_once': 1,
        'environment': {'platform': platform.platform(), 'python': platform.python_version(),
                        'cpu': next((s.split(':', 1)[1].strip() for s in Path('/proc/cpuinfo').read_text().splitlines() if s.startswith('model name')), 'unknown')},
        'limitations': [
            'Historical 6.03/KP256, not current strongest YaneuraOu.',
            'Existing native custom search with compatible NNUE inference; no USER_ENGINE migration yet.',
            'Lab TT is an entry-capped unordered map; native Hash is MiB. Memory/layout are not matched.',
            'Lab -O2/rules NO_SSE vs native -O3/AVX2; timing includes remaining implementation differences.',
            'Reported node definitions differ. Native may exceed requested nodes between clock checks.',
            'Six known fixture positions, detached SFEN histories, single observation per budget.',
            'No teacher-loss, rating, game-strength, or statistical improvement claim.',
        ],
    }
    digest = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    config['condition_sha256'] = digest
    path = OUT/'manifest.json'
    if path.exists() and json.loads(path.read_text()) != config:
        raise RuntimeError('Conditions changed: use a separate result directory; do not mix checkpoints')
    atomic(path, config)
    return src, lab, native, model, digest

class USI:
    def __init__(self, cmd, cwd):
        self.log = []
        self.q = queue.Queue()
        self.p = subprocess.Popen(cmd, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, text=True, bufsize=1)
        def read():
            for line in self.p.stdout:
                self.q.put(line.rstrip('\n'))
            self.q.put(None)
        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()

    def send(self, s):
        self.log.append('> ' + s)
        self.p.stdin.write(s + '\n'); self.p.stdin.flush()

    def until(self, prefix, seconds=8):
        deadline = time.monotonic() + seconds
        lines = []
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(prefix)
            try:
                line = self.q.get(timeout=remaining)
            except queue.Empty:
                raise TimeoutError(prefix)
            if line is None:
                raise RuntimeError('Engine exited while waiting for ' + prefix)
            self.log.append('< ' + line); lines.append(line)
            if 'info string error' in line or 'No such option' in line:
                raise RuntimeError(line)
            if line.startswith(prefix):
                return lines

    def close(self):
        if self.p.poll() is None:
            try:
                self.send('quit'); self.p.wait(timeout=2)
            except (subprocess.TimeoutExpired, BrokenPipeError):
                self.p.kill(); self.p.wait()
        for stream in (self.p.stdin, self.p.stdout):
            stream.close()
        self.reader.join(timeout=1)

def start(which, paths):
    src, lab, native, model, _ = paths
    cmd = [str(native)] if which == 'native' else [str(lab), '--usi', '--eval', 'nnue',
        '--eval-model', str(model), '--features', FEATURES, '--tt-entries', '100000', '--qdepth', '6']
    e = USI(cmd, src if which == 'native' else ROOT)
    try:
        e.send('usi'); e.until('usiok')
        if which == 'native':
            for key, value in NATIVE_OPTIONS.items():
                e.send(f'setoption name {key} value {value}')
        e.send('isready'); e.until('readyok')
        e.send('usinewgame')
        return e
    except BaseException:
        e.close(); raise

def legal(sfen, moves=''):
    cmd = [str(ROOT/'build/shogi-lab'), '--legal', '--sfen', sfen]
    if moves:
        cmd += ['--moves', moves]
    return json.loads(subprocess.check_output(cmd, text=True, timeout=3))['moves']

def eval_pair(position, paths):
    # Root and two legal successors per root: 18 cross-implementation comparisons total.
    children = sorted(legal(position['sfen']))[:2]
    histories = ['', *children]
    scores, logs = {}, {}
    for which in ['lab', 'native']:
        e = start(which, paths)
        try:
            scores[which] = []
            for history in histories:
                e.send('position sfen ' + position['sfen'] + (' moves ' + history if history else ''))
                e.send('eval')
                line = e.until('eval = ')[-1]
                scores[which].append(int(line.split('=')[1]))
        finally:
            e.close(); logs[which] = e.log
    result = {'id': position['id'], 'sfen': position['sfen'], 'histories': histories,
              'raw_pawn90': scores, 'equal': scores['lab'] == scores['native'], 'usi_logs': logs}
    if not result['equal']:
        atomic(OUT/'eval-failure.json', result)
        raise RuntimeError('Static evaluation mismatch')
    return result

def parse_search(lines, which, elapsed):
    best = next(s.split()[1] for s in reversed(lines) if s.startswith('bestmove '))
    if which == 'lab':
        raw = json.loads(next(s[len('info string lab_result '):] for s in lines if s.startswith('info string lab_result ')))
        result = {'bestmove': best, 'depth': max(0, raw['completed_depth']),
                  'seldepth': raw['stats'].get('selective_depth', 0), 'nodes': raw['nodes'],
                  'engine_ms': raw['elapsed_ms'], 'pv': raw['pv'] or raw['fallback_pv'],
                  'has_completed_iteration': raw['has_result'], 'raw': raw}
    else:
        infos = [s for s in lines if s.startswith('info depth ') and ' nodes ' in s and ' pv ' in s]
        if not infos:
            raise RuntimeError('Native engine returned no search telemetry')
        s = infos[-1]
        def integer(key):
            m = re.search(r'\b' + key + r' (\d+)', s)
            return int(m[1]) if m else None
        result = {'bestmove': best, 'depth': integer('depth'), 'seldepth': integer('seldepth'),
                  'nodes': integer('nodes'), 'engine_ms': integer('time'),
                  'pv': s.split(' pv ', 1)[1].split(), 'score_usi': re.search(r' score (.*?)(?: nodes | pv )', s)[1],
                  'last_reported_depth': integer('depth'),
                  'seldepth_note': 'Native PV-node seldepth, not identical to lab maximum visited ply.'}
        final = next(s for s in lines if s.startswith('phase0stats '))
        result['depth'] = int(re.search(r'completed_depth (\d+)', final)[1])
        result['nodes'] = int(re.search(r'nodes (\d+)', final)[1])
        result['has_completed_iteration'] = result['depth'] > 0
    result['wall_ms_after_go'] = elapsed
    result['nps_from_engine_time'] = result['nodes'] * 1000 / max(result['engine_ms'], 1)
    return result

def search_pair(position, paths, stage, index):
    result = {'id': position['id'], 'sfen': position['sfen'], 'stage': stage, 'engines': {}}
    command = 'go nodes 10000' if stage == 'nodes' else 'go movetime 200'
    result['command'] = command
    result['order'] = ['lab', 'native'] if index % 2 == 0 else ['native', 'lab']
    for which in result['order']:
        e = start(which, paths)
        try:
            e.send('position sfen ' + position['sfen'])
            started = time.perf_counter(); e.send(command)
            lines = e.until('bestmove ', 8)
            elapsed = (time.perf_counter() - started) * 1000
            if which == 'native':
                e.send('phase0stats')
                lines += e.until('phase0stats ')
            row = parse_search(lines, which, elapsed)
            if row['bestmove'] not in legal(position['sfen']):
                raise RuntimeError('Illegal/resigned pilot move: ' + row['bestmove'])
            history = []
            for move in row['pv']:
                if move not in legal(position['sfen'], ' '.join(history)):
                    raise RuntimeError('Illegal PV move: ' + move)
                history.append(move)
            if not history or history[0] != row['bestmove']:
                raise RuntimeError('PV and selected move mismatch')
            row['legal_pv_verified'] = True
            if stage == 'nodes':
                row['node_overshoot'] = row['nodes'] - 10000
            result['engines'][which] = row
        except BaseException as error:
            result['error'] = str(error); result['partial_usi_log'] = e.log
            atomic(OUT/f'{stage}/{position["id"]}.failed.json', result)
            raise
        finally:
            e.close()
        row['usi_log'] = e.log
    result['bestmove_agreement'] = result['engines']['lab']['bestmove'] == result['engines']['native']['bestmove']
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=['eval', 'nodes', 'time'])
    parser.add_argument('--max-new', type=int, default=1, choices=[1, 2])
    args = parser.parse_args()
    paths = freeze()
    positions = json.loads((OUT/'positions.json').read_text())
    if args.stage != 'eval':
        for p in positions:
            q = OUT/f'eval/{p["id"]}.json'
            if not q.exists() or not json.loads(q.read_text()).get('equal'):
                raise RuntimeError('Complete all six eval pairs before search')
    completed = 0
    for index, p in enumerate(positions):
        target = OUT/f'{args.stage}/{p["id"]}.json'
        if target.exists():
            if json.loads(target.read_text())['condition_sha256'] != paths[-1]:
                raise RuntimeError('Checkpoint condition mismatch')
            continue
        result = eval_pair(p, paths) if args.stage == 'eval' else search_pair(p, paths, args.stage, index)
        result['condition_sha256'] = paths[-1]
        atomic(target, result)
        completed += 1
        print(json.dumps({'saved': str(target.relative_to(ROOT)), 'equal': result.get('equal'),
                          'bestmove_agreement': result.get('bestmove_agreement')}, ensure_ascii=False), flush=True)
        if completed >= args.max_new:
            break
    done = sum((OUT/f'{args.stage}/{p["id"]}.json').exists() for p in positions)
    print(json.dumps({'stage': args.stage, 'new_pairs': completed, 'complete_pairs': done, 'total_pairs': 6}))

if __name__ == '__main__':
    main()
