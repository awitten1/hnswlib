'use strict';
const assert = require('node:assert/strict');
const { createDataset, defaultDataset, squaredDistance, search } = require('./search.js');

assert.deepEqual(createDataset(42), defaultDataset);
assert.notDeepEqual(createDataset(43).points, defaultDataset.points);
assert.notDeepEqual(createDataset(43).layers, defaultDataset.layers);
assert.deepEqual(search(defaultDataset.defaultQuery, 4), search(defaultDataset.defaultQuery, 4));

for (const seed of [0, 1, 2, 7, 42, 43, 100, 999, 4294967295]) {
  const dataset = createDataset(seed);
  const { points, layers, adjacency, defaultQuery, entryPoint } = dataset;
  assert.deepEqual(layers.map(l => l.nodes.length), [30, 9, 3]);
  assert(layers.at(-1).nodes.includes(entryPoint));
  for (const point of points) {
    assert(point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100);
    for (const other of points) if (point.id !== other.id) assert(squaredDistance(point, other) > 0);
  }
  for (let level = 0; level < layers.length; level++) {
    assert.equal(new Set(layers[level].edges.map(([a, b]) => [a, b].sort((x, y) => x - y).join('-'))).size, layers[level].edges.length);
    for (const id of layers[level].nodes) {
      if (level > 0) assert(layers[level - 1].nodes.includes(id));
      assert(!adjacency[level][id].includes(id));
      for (const neighbor of adjacency[level][id]) assert(adjacency[level][neighbor].includes(id));
    }
    const reached = new Set([layers[level].nodes[0]]);
    for (const id of reached) for (const neighbor of adjacency[level][id]) reached.add(neighbor);
    assert.equal(reached.size, layers[level].nodes.length, 'Every layer should be connected.');
  }

  const queries = [...points, defaultQuery, { x: 0, y: 0 }, { x: 100, y: 100 }, { x: 50, y: 50 }];
  for (const query of queries) {
    for (const ef of [1, 4, 20]) {
      const trace = search(query, ef, dataset);
      const final = trace.at(-1);
      assert.equal(trace[0].current, entryPoint);
      assert.equal(final.kind, 'finish');
      assert.deepEqual(trace.filter(s => s.kind === 'descend').map(s => s.layer), [1, 0]);
      const expanded = new Set();
      for (let i = 0; i < trace.length; i++) {
        const state = trace[i];
        assert(state.evaluations <= points.length);
        assert(state.best.length <= ef);
        assert.equal(new Set(state.pending.map(p => p.id)).size, state.pending.length);
        if (i) assert(state.evaluations >= trace[i - 1].evaluations);
        if (state.kind === 'descend') assert.equal(state.current, trace[i - 1].current);
        if (state.kind === 'move') assert(squaredDistance(points[state.current], query) < squaredDistance(points[trace[i - 1].current], query));
        if (state.kind === 'expand') {
          assert(!expanded.has(state.current));
          expanded.add(state.current);
        }
        for (let j = 1; j < state.best.length; j++) assert(state.best[j - 1].distance <= state.best[j].distance);
        for (const entry of [...state.pending, ...state.best]) assert.equal(entry.distance, squaredDistance(points[entry.id], query));
      }
      const exactDistance = Math.min(...points.map(p => squaredDistance(p, query)));
      assert.equal(squaredDistance(points[final.exact], query), exactDistance);
      if (ef === 20) assert.equal(squaredDistance(points[final.result], query), exactDistance);
      const stop = trace.at(-2);
      assert.equal(stop.kind, 'stop');
      if (stop.pending.length) {
        assert.equal(stop.best.length, ef);
        assert(stop.pending[0].distance > stop.best.at(-1).distance);
      }
    }
  }
  for (const point of points) assert.equal(search(point, 20, dataset).at(-1).result, point.id);
}
assert.throws(() => search(defaultDataset.defaultQuery, 0));
assert.throws(() => search({ x: NaN, y: 0 }));
console.log('Search checks passed across 9 seeds: generation, connectivity, hierarchy, exact queries, queues, termination, and replay.');
