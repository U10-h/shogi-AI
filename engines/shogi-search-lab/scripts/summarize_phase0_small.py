#!/usr/bin/env python3
"""Summarize only the frozen six-position phase-0 pilot, never extrapolate strength."""
import csv
import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'results/v1.0-phase0'
positions = json.loads((OUT/'positions.json').read_text())
manifest = json.loads((OUT/'manifest.json').read_text())
rows = []
summary = {'positions': len(positions), 'static_comparisons': 0, 'static_matches': 0,
           'searches': 0, 'legal_pvs': 0, 'condition_sha256': manifest['condition_sha256'], 'stages': {}}
for stage in ['eval', 'nodes', 'time']:
    data = []
    for pos in positions:
        r = json.loads((OUT/f'{stage}/{pos["id"]}.json').read_text())
        assert r['condition_sha256'] == manifest['condition_sha256']
        data.append(r)
        if stage == 'eval':
            a, b = r['raw_pawn90']['lab'], r['raw_pawn90']['native']
            summary['static_comparisons'] += len(a)
            summary['static_matches'] += sum(x == y for x, y in zip(a, b))
        else:
            for name, x in r['engines'].items():
                summary['searches'] += 1
                summary['legal_pvs'] += int(x['legal_pv_verified'])
                rows.append({'stage': stage, 'id': r['id'], 'engine': name,
                    **{k: x.get(k) for k in ['bestmove', 'depth', 'seldepth', 'nodes', 'engine_ms',
                       'wall_ms_after_go', 'nps_from_engine_time', 'node_overshoot', 'has_completed_iteration']}})
    if stage == 'eval':
        continue
    group = {'bestmove_agreement': sum(r['bestmove_agreement'] for r in data)}
    for name in ['lab', 'native']:
        part = [r['engines'][name] for r in data]
        group[name] = {
            'mean_completed_depth': statistics.mean(x['depth'] for x in part),
            'mean_reported_seldepth': statistics.mean(x['seldepth'] for x in part),
            'mean_nodes': statistics.mean(x['nodes'] for x in part),
            'mean_engine_ms': statistics.mean(x['engine_ms'] for x in part),
            'mean_wall_ms_after_go': statistics.mean(x['wall_ms_after_go'] for x in part),
            'incomplete_first_iterations': sum(not x['has_completed_iteration'] for x in part),
        }
        if stage == 'nodes':
            group[name]['max_node_overshoot'] = max(x['node_overshoot'] for x in part)
    summary['stages'][stage] = group
(OUT/'summary.json').write_text(json.dumps(summary, indent=2)+'\n')
with (OUT/'searches.csv').open('w') as f:
    writer = csv.DictWriter(f, fieldnames=list(rows[0]), lineterminator='\n')
    writer.writeheader(); writer.writerows(rows)
print(json.dumps(summary, indent=2))
