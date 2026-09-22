// Optional independent rules comparison: Node.js >= 18, vendored tsshogi (MIT).
import { Position, Square, handPieceTypes } from '../vendor/tsshogi/index.js';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const executable = fileURLToPath(new URL('build/shogi-lab', root));
function legalMoves(position) {
  const sources = [...position.board.listSquaresByColor(position.color),
    ...handPieceTypes.filter(type => position.hand(position.color).count(type) > 0)];
  const moves = new Set();
  for (const source of sources) for (let rank = 1; rank <= 9; ++rank) for (let file = 1; file <= 9; ++file) {
    const move = position.createMove(source, new Square(file, rank));
    if (!move) continue;
    if (position.isValidMove(move)) moves.add(move.usi);
    const promotion = move.withPromote();
    if (position.isValidMove(promotion)) moves.add(promotion.usi);
  }
  return [...moves].sort();
}
const cases = JSON.parse(readFileSync(new URL('experiments/positions.json', root))).positions;
const fixtures = [
  '4k4/9/9/9/9/9/4P4/9/4K4 b P 1',
  '4k4/P8/9/9/9/9/9/9/4K4 b - 1',
  '4k4/9/P8/9/9/9/9/9/4K4 b - 1',
  '3lkl3/3p1p3/4G4/9/9/9/9/9/K8 b P 1',
  'k3r4/9/9/9/9/9/4G4/9/4K4 b P 1',
  '3lkl3/3pGp3/4R4/9/9/9/9/9/K8 w - 1'
];
let compared = 0;
const checked = [];
function compare(position, label) {
  const expected = legalMoves(position);
  const actual = JSON.parse(execFileSync(executable, ['--sfen', position.sfen, '--legal'], {encoding:'utf8'}));
  assert.deepEqual(actual.moves, expected, label);
  checked.push({label, sfen:position.sfen, count:expected.length});
  ++compared;
  return expected;
}
for (const [i, sfen] of fixtures.entries()) compare(Position.newBySFEN(sfen), `fixture-${i}`);
for (const item of cases) {
  const position = Position.newBySFEN(item.initial);
  for (const text of item.moves) assert.ok(position.doMove(position.createMoveByUSI(text)));
  compare(position, item.id);
}
// Fixed-seed legal playouts are validation data, not a strength benchmark.
let seed = 20260921;
for (let game = 0; game < 3; ++game) {
  const position = Position.newBySFEN(cases[0].initial);
  for (let ply = 0; ply < 32; ++ply) {
    const moves = compare(position, `random-${game}-${ply}`);
    if (!moves.length) break;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    assert.ok(position.doMove(position.createMoveByUSI(moves[seed % moves.length])));
  }
}
writeFileSync(new URL('results/rules-crosscheck.json', root), JSON.stringify({status:'passed', compared, seed:20260921, checked}, null, 2) + '\n');
console.log(JSON.stringify({crosscheck:'passed', positions:compared}));
