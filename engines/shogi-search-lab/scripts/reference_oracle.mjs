// Independent shallow oracle: tsshogi rules + explicit black max / white min.
// Deliberately no alpha-beta, previous-PV ordering, or C++ evaluation code.
import { Position, Square, handPieceTypes } from '../vendor/tsshogi/index.js';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const executable = fileURLToPath(new URL('build/shogi-lab', root));
const values = {pawn:100, lance:300, knight:320, silver:450, gold:550,
  bishop:800, rook:1000, king:0, promPawn:550, promLance:550, promKnight:550,
  promSilver:550, horse:1000, dragon:1200};
function material(p) {
  let total = 0;
  for (const sq of p.board.listNonEmptySquares()) {
    const piece = p.board.at(sq);
    assert.ok(piece.type in values);
    total += (piece.color === 'black' ? 1 : -1) * values[piece.type];
  }
  for (const color of ['black', 'white']) for (const type of handPieceTypes)
    total += (color === 'black' ? 1 : -1) * p.hand(color).count(type) * values[type];
  return total;
}
const legalCache = new Map();
function legal(p) {
  const key = p.sfen.split(' ').slice(0,3).join(' ');
  if (legalCache.has(key)) return legalCache.get(key);
  const sources = [...p.board.listSquaresByColor(p.color), ...handPieceTypes.filter(t => p.hand(p.color).count(t) > 0)];
  const result = new Set();
  for (const from of sources) for (let file = 1; file <= 9; ++file) for (let rank = 1; rank <= 9; ++rank) {
    const m = p.createMove(from, new Square(file, rank));
    if (!m) continue;
    if (p.isValidMove(m)) result.add(m.usi);
    if (p.isValidMove(m.withPromote())) result.add(m.withPromote().usi);
  }
  const sorted = [...result].sort();
  legalCache.set(key, sorted);
  return sorted;
}
let nodes = 0;
function exact(p, depth, ply = 0) {
  ++nodes;
  const moves = legal(p);
  if (!moves.length) return p.color === 'black' ? -100000 + ply : 100000 - ply;
  if (!depth) return material(p);
  let best = p.color === 'black' ? -Infinity : Infinity;
  for (const text of moves) {
    const child = p.clone();
    assert.ok(child.doMove(child.createMoveByUSI(text)));
    const score = exact(child, depth - 1, ply + 1);
    best = p.color === 'black' ? Math.max(best, score) : Math.min(best, score);
  }
  return best;
}
const suite = JSON.parse(readFileSync(new URL('experiments/positions.json', root))).positions;
const cases = [
  {...suite[0], depth:2}, {...suite[1], depth:2},
  {id:'trap-black', initial:'8k/9/4g4/4p4/4R4/9/9/9/K8 b - 1', moves:[], depth:2},
  {id:'trap-white', initial:'8k/9/4g4/4p4/4R4/9/9/9/K8 w - 1', moves:[], depth:2},
  {id:'mate-in-one', initial:'3lkl3/3p1p3/4G4/4R4/9/9/9/9/K8 b - 1', moves:[], depth:2},
  {id:'mated-white', initial:'3lkl3/3pGp3/4R4/9/9/9/9/9/K8 w - 1', moves:[], depth:2},
  {id:'promotion', initial:'4k4/9/P8/9/9/9/9/9/4K4 b - 1', moves:[], depth:3},
  {...suite.find(x => x.id === 'bishop-exchange'), depth:2},
  {...suite.find(x => x.id === 'pin-and-drop'), depth:2},
];
const rows = [];
for (const item of cases) {
  legalCache.clear(); nodes = 0;
  const p = Position.newBySFEN(item.initial);
  for (const m of item.moves) assert.ok(p.doMove(p.createMoveByUSI(m)));
  const absolute = exact(p, item.depth);
  const expected = p.color === 'black' ? absolute : -absolute;
  const actual = JSON.parse(execFileSync(executable, ['--sfen', item.initial, '--moves', item.moves.join(' '),
    '--depth', String(item.depth), '--iterative'], {encoding:'utf8'}));
  assert.equal(actual.score, expected, item.id);
  const rootColor = p.color;
  // Verify every displayed move is legal using the independent library.
  for (const text of actual.pv) {
    assert.ok(legal(p).includes(text), `${item.id}: illegal PV move ${text}`);
    assert.ok(p.doMove(p.createMoveByUSI(text)));
  }
  const absoluteEnd = legal(p).length ? material(p) : p.color === 'black' ? -100000 + actual.pv.length : 100000 - actual.pv.length;
  assert.equal(rootColor === 'black' ? absoluteEnd : -absoluteEnd, actual.score, 'PV leaf value');
  if (item.id === 'mate-in-one') assert.equal(actual.score, 99999);
  rows.push({id:item.id, depth:item.depth, expected, actual:actual.score, oracle_nodes:nodes, pv:actual.pv});
  console.log(item.id, expected, nodes);
}
mkdirSync(new URL('results/v0.2/', root), {recursive:true});
writeFileSync(new URL('results/v0.2/independent-oracle.json', root), JSON.stringify({status:'passed',
  method:'Independent tsshogi legal moves and explicit black max / white min, shallow fixed trees. Repetition tested separately in C++.', cases:rows}, null, 2) + '\n');
