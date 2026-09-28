'use strict';
const assert = require('node:assert/strict');
const { createDataset, squaredDistance } = require('./search.js');
const { buildGraph, insertionTrace, selectNeighbors, M, CAPACITY } = require('./insertion.js');
const points = [0, 1, 1.2, -2].map((x, id) => ({ id, x, y: 0 }));
assert.deepEqual(selectNeighbors(points, 0, [3, 2, 1], 2, 'nearest'), [1, 2]);
assert.deepEqual(selectNeighbors(points, 0, [3, 2, 1], 2, 'diversity'), [1, 3]);
// Fewer candidates than the limit bypasses diversity rejection in hnswlib.
assert.deepEqual(selectNeighbors(points, 0, [2, 1], 3, 'diversity'), [1, 2]);
assert.deepEqual(selectNeighbors(points, 0, [], 3, 'nearest'), []);
const equal = [{ id: 0, x: 0, y: 0 }, { id: 1, x: 0, y: 0 }, { id: 2, x: 1, y: 0 }];
assert.deepEqual(selectNeighbors(equal, 0, [2, 1], 2, 'diversity'), [1, 2]);
const tied = [{ id: 0, x: 0, y: 0 }, { id: 1, x: 1, y: 0 }, { id: 2, x: -1, y: 0 }];
assert.deepEqual(selectNeighbors(tied, 0, [2, 1], 1, 'nearest'), [1]);

// A full central list rejects its farthest existing neighbor in favor of the new point.
const star = {
  points: Array.from({ length: 7 }, (_, id) => ({ id, x: id * 10, y: 0 })),
  adjacency: { 0: [1, 2, 3, 4, 5, 6], 1: [0], 2: [0], 3: [0], 4: [0], 5: [0], 6: [0] },
  entryPoint: 0
};
const pruning = insertionTrace(star, { x: 1, y: 0 });
const pruned = pruning.find(s => s.kind === 'replace');
assert.equal(pruned.center, 0);
assert.deepEqual(pruned.graph.adjacency[0], [7, 1, 2, 3, 4, 5]);
assert.deepEqual(pruned.removed, [[0, 6]]);
assert(pruned.graph.adjacency[6].includes(0), 'Pruning must preserve the reverse edge.');
assert(!star.adjacency[0].includes(7));
assert(pruning.at(-1).summary.pruned > 0);
const diversityPruning = insertionTrace(star, { x: 1, y: 0 }, 10, 'diversity');
assert(diversityPruning.some(s => s.phase === 'prune' && s.kind === 'compare'));
assert(diversityPruning.at(-1).graph.adjacency[0].length < CAPACITY, 'Do not refill rejected neighbors.');

const single = buildGraph([{ id: 0, x: 1, y: 1 }]);
const simple = insertionTrace(single, { x: 2, y: 2 });
assert.deepEqual(simple.at(-1).graph.adjacency, { 0: [1], 1: [0] });
assert.equal(simple.at(-1).summary.pruned, 0);
assert.deepEqual(buildGraph([]), { points: [], adjacency: {}, entryPoint: null });

function verifyGraph(graph) {
  for (const point of graph.points) {
    const outgoing = graph.adjacency[point.id];
    assert(outgoing.length <= CAPACITY);
    assert.equal(new Set(outgoing).size, outgoing.length);
    assert(!outgoing.includes(point.id));
    for (const id of outgoing) assert(graph.points[id]);
  }
}
let compared = 0;
for (const seed of [0, 1, 7, 42, 100, 999]) {
  const dataset = createDataset(seed);
  const graph = buildGraph(dataset.points);
  const baseline = JSON.stringify(graph);
  verifyGraph(graph);
  assert.equal(graph.points.length, 30);
  assert.equal(graph.entryPoint, 0);
  assert.deepEqual(buildGraph(dataset.points), graph);
  for (const query of [dataset.defaultQuery, dataset.points[0], { x: 50, y: 50 }]) {
    for (const ef of [3, 10, 20]) {
      const nearest = insertionTrace(graph, query, ef, 'nearest');
      const diverse = insertionTrace(graph, query, ef, 'diversity');
      assert.deepEqual(nearest.filter(s => s.phase === 'search'), diverse.filter(s => s.phase === 'search'));
      for (const trace of [nearest, diverse]) {
        compared++;
        assert(trace.length < 500);
        assert.equal(trace.at(-1).kind, 'finish');
        assert.equal(trace.at(-1).graph.points.length, 31);
        assert(trace.at(-1).graph.adjacency[30].length <= M);
        for (let i = 0; i < trace.length; i++) {
          const state = trace[i];
          verifyGraph(state.graph);
          assert(state.evaluations <= graph.points.length);
          if (i) {
            assert(state.evaluations >= trace[i - 1].evaluations);
            assert(state.comparisons >= trace[i - 1].comparisons);
          }
          if (state.phase === 'search') assert(state.retained.length <= ef);
          if (state.comparison) {
            const c = state.comparison;
            assert.equal(c.toCenter, squaredDistance(state.graph.points[c.center], state.graph.points[c.candidate]));
            assert.equal(c.toNeighbor, squaredDistance(state.graph.points[c.neighbor], state.graph.points[c.candidate]));
          }
        }
      }
      const found = nearest.filter(s => s.phase === 'search').at(-1).retained.map(p => p.id);
      assert.deepEqual(nearest.at(-1).graph.adjacency[30], found.slice(0, M));
      assert.deepEqual(insertionTrace(graph, query, ef, 'nearest'), nearest);
      assert.equal(JSON.stringify(graph), baseline);
      // A consumer modifying one graph snapshot must not change other steps or the baseline.
      nearest[0].graph.adjacency[0].push(12345);
      assert(!nearest.at(-1).graph.adjacency[0].includes(12345));
      assert.equal(JSON.stringify(graph), baseline);
    }
  }
}
assert.throws(() => insertionTrace(single, { x: NaN, y: 0 }));
assert.throws(() => insertionTrace(single, { x: 0, y: 0 }, 2));
assert.throws(() => insertionTrace(single, { x: 0, y: 0 }, 10, 'invalid'));
console.log(`Insertion checks passed: both selectors, directional pruning, immutable replay, and ${compared} traces across six seeds.`);
