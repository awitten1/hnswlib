/* Small generated teaching graphs, not indexes produced by hnswlib. */
(function (root) {
  'use strict';

  const squaredDistance = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

  function createDataset(seed = 42) {
    let state = seed >>> 0;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const centers = [[24, 24], [76, 24], [24, 76], [76, 76]].map(([x, y]) => ({
      x: x + (random() - 0.5) * 10,
      y: y + (random() - 0.5) * 10
    }));
    const points = [];
    for (let id = 0; id < 30; id++) {
      const center = centers[id % centers.length];
      let point;
      let clearance = -1;
      // Spread labels apart while retaining irregular, clustered positions.
      for (let attempt = 0; attempt < 100; attempt++) {
        const angle = random() * Math.PI * 2;
        const radius = Math.sqrt(random()) * 18;
        const candidate = {
          id,
          x: Number((center.x + Math.cos(angle) * radius).toFixed(1)),
          y: Number((center.y + Math.sin(angle) * radius).toFixed(1))
        };
        const gap = Math.min(...points.map(p => squaredDistance(p, candidate)));
        if (gap > clearance) { point = candidate; clearance = gap; }
        if (clearance >= 49) break;
      }
      points.push(point);
    }

    const shuffled = points.map(p => p.id);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const layers = [points.map(p => p.id), shuffled.slice(0, 9), shuffled.slice(0, 3)]
      .map(ids => ({ nodes: ids.sort((a, b) => a - b), edges: [] }));
    for (const layer of layers) {
      for (let i = 1; i < layer.nodes.length; i++) {
        const id = layer.nodes[i];
        const candidates = layer.nodes.slice(0, i).sort((a, b) =>
          squaredDistance(points[id], points[a]) - squaredDistance(points[id], points[b]) || a - b);
        const selected = [];
        for (const candidate of candidates) {
          // HNSW's diversity idea: skip a neighbor already covered by a closer
          // selected neighbor. Scan all earlier points here to keep the builder small.
          if (selected.every(other => squaredDistance(points[candidate], points[other]) >= squaredDistance(points[id], points[candidate]))) {
            selected.push(candidate);
            layer.edges.push([candidate, id]);
            if (selected.length === 3) break;
          }
        }
      }
    }
    const adjacency = layers.map(layer => {
      const neighbors = Object.fromEntries(layer.nodes.map(id => [id, []]));
      for (const [a, b] of layer.edges) {
        neighbors[a].push(b);
        neighbors[b].push(a);
      }
      for (const list of Object.values(neighbors)) list.sort((a, b) => a - b);
      return neighbors;
    });
    const entryPoint = layers[2].nodes[0];
    const defaultQuery = { x: random() * 100, y: random() * 100 };
    return { seed: seed >>> 0, points, layers, adjacency, entryPoint, defaultQuery };
  }

  const defaultDataset = createDataset();

  function search(query, ef = 4, dataset = defaultDataset) {
    const { points, layers, adjacency, entryPoint } = dataset;
    if (!Number.isFinite(query.x) || !Number.isFinite(query.y)) throw new Error('Query must have finite coordinates.');
    if (!Number.isInteger(ef) || ef < 1 || ef > 20) throw new Error('ef must be an integer from 1 to 20.');

    const trace = [];
    const distances = new Map();
    const visited = layers.map(() => new Set());
    let layer = layers.length - 1;
    let current = entryPoint;
    let pending = [];
    let best = [];
    function distance(id) {
      if (!distances.has(id)) distances.set(id, squaredDistance(points[id], query));
      return distances.get(id);
    }
    const compare = (a, b) => distance(a) - distance(b) || a - b;
    const entries = ids => ids.map(id => ({ id, distance: distance(id) }));
    function emit(kind, explanation, edge = null) {
      trace.push({
        kind, explanation, layer, current, edge,
        pending: entries(pending), best: entries(best),
        visited: visited.map(ids => [...ids]),
        evaluations: distances.size
      });
    }

    visited[layer].add(current);
    distance(current);
    best = [current];
    emit('start', `Start at point ${current} in the sparsest layer. Look for a neighbor closer to the query.`);
    while (layer > 0) {
      let next = current;
      for (const id of adjacency[layer][current]) {
        visited[layer].add(id);
        const closer = distance(id) < distance(next);
        if (closer) next = id;
        emit('inspect', `Inspect ${current} → ${id}: squared distance ${distance(id).toFixed(1)}. ${closer ? 'This is the closest option so far.' : 'It does not improve the closest option.'}`, [current, id]);
      }
      if (next !== current) {
        const previous = current;
        current = next;
        best = [current];
        emit('move', `Move to point ${current}, which is closer to the query.`, [previous, current]);
      } else {
        layer--;
        visited[layer].add(current);
        emit('descend', `No neighbor is closer. Descend to layer ${layer} at the same point, ${current}.${layer === 0 ? ' Now keep several promising candidates using ef.' : ''}`);
      }
    }

    pending = [current];
    best = [current];
    emit('seed', `Seed the bottom-layer search with point ${current}. ef=${ef} limits the retained best candidates, not the total points visited.`);
    while (pending.length) {
      pending.sort(compare);
      const candidate = pending[0];
      if (best.length === ef && distance(candidate) > distance(best[best.length - 1])) {
        emit('stop', 'The closest pending candidate is farther than the worst retained candidate, and the retained set is full. Stop exploring.');
        break;
      }
      current = pending.shift();
      emit('expand', `Expand point ${current}, the closest pending candidate. Inspect its unvisited neighbors.`);
      for (const id of adjacency[0][current]) {
        if (visited[0].has(id)) continue;
        visited[0].add(id);
        const accepted = best.length < ef || distance(id) < distance(best[best.length - 1]);
        // Measure rejected points too: the decision required their distance.
        distance(id);
        if (accepted) {
          pending.push(id);
          pending.sort(compare);
          best.push(id);
          best.sort(compare);
          if (best.length > ef) best.pop();
        }
        emit('inspect', `Inspect ${current} → ${id}: squared distance ${distance(id).toFixed(1)}. ${accepted ? 'Queue it for exploration and update the retained best candidates.' : 'The retained set is full and this point is no closer; skip it.'}`, [current, id]);
      }
    }
    if (!pending.length) emit('stop', 'There are no pending candidates left. Stop exploring.');
    const result = best[0];
    // Exact search is for the final comparison only; it does not guide HNSW.
    const exact = [...points].sort((a, b) => squaredDistance(a, query) - squaredDistance(b, query) || a.id - b.id)[0].id;
    const matches = squaredDistance(points[result], query) === squaredDistance(points[exact], query);
    emit('finish', `Return point ${result}. ${matches ? 'It matches the exact nearest distance.' : `The exact nearest point is ${exact}. Try a larger ef to explore more candidates.`}`);
    Object.assign(trace[trace.length - 1], { result, exact, matches });
    return trace;
  }

  const api = { createDataset, defaultDataset, squaredDistance, search };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HnswDemo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
