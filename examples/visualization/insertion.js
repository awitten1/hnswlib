/* Single-layer insertion. The input graph is never changed by a walkthrough. */
(function (root) {
  'use strict';
  const { squaredDistance, search } = typeof module !== 'undefined' && module.exports
    ? require('./search.js') : root.HnswDemo;
  const M = 3;
  const CAPACITY = 6;
  const copyGraph = graph => ({
    points: graph.points.map(p => ({ ...p })),
    adjacency: Object.fromEntries(Object.entries(graph.adjacency).map(([id, ids]) => [id, [...ids]])),
    entryPoint: graph.entryPoint
  });

  function selectNeighbors(points, center, candidates, limit, method, onStep = () => {}) {
    const distance = id => squaredDistance(points[center], points[id]);
    const ordered = [...candidates].sort((a, b) => distance(a) - distance(b) || a - b);
    const selected = [];
    const rejected = [];
    const shortcut = ordered.length < limit;
    for (let rank = 0; rank < ordered.length; rank++) {
      const candidate = ordered[rank];
      const detail = () => ({
        center, candidate, selected: [...selected], rejected: [...rejected],
        pending: ordered.slice(rank + 1).map(id => ({ id, distance: distance(id) }))
      });
      let accepted = selected.length < limit;
      let reason = accepted
        ? `Candidate #${candidate} is rank ${rank + 1} by distance to #${center} (d² ${distance(candidate).toFixed(1)}).`
        : `The limit of ${limit} selected neighbors has been reached.`;
      if (accepted && method === 'diversity' && !shortcut) {
        for (const neighbor of selected) {
          const toNeighbor = squaredDistance(points[candidate], points[neighbor]);
          const toCenter = distance(candidate);
          onStep({ ...detail(), kind: 'compare', comparison: { center, candidate, neighbor, toNeighbor, toCenter },
            explanation: `Compare #${candidate} with selected #${neighbor}: d²(C,R)=${toNeighbor.toFixed(1)} ${toNeighbor < toCenter ? '<' : '≥'} d²(C,Q)=${toCenter.toFixed(1)}. ${toNeighbor < toCenter ? 'This neighbor already covers the candidate’s direction.' : 'This comparison does not reject the candidate.'}` });
          if (toNeighbor < toCenter) {
            accepted = false;
            reason = `Selected #${neighbor} is closer to #${candidate} than #${center} is.`;
            break;
          }
        }
        if (accepted) reason = 'No selected neighbor is closer to this candidate than the center is.';
      } else if (accepted && method === 'diversity' && shortcut) {
        reason = `Only ${ordered.length} candidates are available, fewer than ${limit}; retain all of them.`;
      }
      (accepted ? selected : rejected).push(candidate);
      onStep({ ...detail(), kind: accepted ? 'accept' : 'reject', comparison: null,
        explanation: `${accepted ? 'Keep' : 'Skip'} #${candidate}. ${reason}` });
    }
    return selected;
  }

  function insertionTrace(input, point, efConstruction = 10, selectionMethod = 'nearest') {
    if (!['nearest', 'diversity'].includes(selectionMethod)) throw new Error('Unknown selection method.');
    if (!Number.isInteger(efConstruction) || efConstruction < M || efConstruction > 20) throw new Error('efConstruction must be an integer from 3 to 20.');
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Point coordinates must be finite.');
    const graph = copyGraph(input);
    const id = graph.points.length;
    graph.points.push({ id, x: point.x, y: point.y });
    graph.adjacency[id] = [];
    const trace = [];
    let evaluations = 0;
    let comparisons = 0;
    let pruned = 0;
    let visited = [];
    const added = [];
    const removed = [];
    function emit(phase, kind, explanation, extra = {}) {
      trace.push({
        phase, kind, explanation, graph: copyGraph(graph), newId: id,
        current: null, center: id, candidate: null, comparison: null, activeEdge: null,
        pending: [], retained: [], selected: [], rejected: [], changed: [], removed: [],
        visited: [...visited], evaluations, comparisons, ...extra
      });
    }
    if (!input.points.length) {
      graph.entryPoint = id;
      emit('complete', 'finish', `Point #${id} becomes the entry point of this single layer.`, { summary: { added: [], removed: [], pruned: 0 } });
      return trace;
    }

    const searchTrace = search(point, efConstruction, {
      points: input.points, layers: [{ nodes: input.points.map(p => p.id) }],
      adjacency: [input.adjacency], entryPoint: input.entryPoint
    });
    // Reuse bounded graph search; its exact-neighbor comparison is not part of insertion.
    for (const state of searchTrace.slice(0, -1)) {
      evaluations = state.evaluations;
      visited = state.visited[0];
      const explanation = state.kind === 'start'
        ? `Search this single layer from entry point #${input.entryPoint} to find candidates for new point #${id}.`
        : state.kind === 'seed'
          ? `Keep up to efConstruction=${efConstruction} candidates. Follow outgoing links; this is not an exhaustive nearest-neighbor search.`
          : state.explanation;
      emit('search', state.kind, explanation, { current: state.current, activeEdge: state.edge, pending: state.pending, retained: state.best });
    }
    const candidates = searchTrace.at(-2).best.map(p => p.id);
    const entries = (ids, center) => ids.map(n => ({ id: n, distance: squaredDistance(graph.points[n], graph.points[center]) }));
    function choose(center, ids, limit, phase) {
      const ordered = [...ids].sort((a, b) => squaredDistance(graph.points[a], graph.points[center]) - squaredDistance(graph.points[b], graph.points[center]) || a - b);
      emit(phase, 'selection-start', `${phase === 'prune' ? `Reconsider outgoing neighbors of #${center}` : `Choose neighbors for #${id}`} using ${selectionMethod === 'nearest' ? 'nearest neighbors' : 'the diversity heuristic'}. Keep at most ${limit}.`, {
        center, current: center, pending: entries(ordered, center)
      });
      return selectNeighbors(graph.points, center, ids, limit, selectionMethod, detail => {
        if (detail.kind === 'compare') comparisons++;
        emit(phase, detail.kind, detail.explanation, {
          ...detail, current: center, retained: entries(detail.selected, center)
        });
      });
    }
    const neighbors = choose(id, candidates, M, 'select');
    for (const neighbor of neighbors) {
      graph.adjacency[id].push(neighbor);
      added.push([id, neighbor]);
      emit('connect', 'add', `Add outgoing connection #${id} → #${neighbor}.`, {
        selected: neighbors, retained: entries(neighbors, id), current: id, activeEdge: [id, neighbor], changed: [[id, neighbor]]
      });
    }
    for (const neighbor of neighbors) {
      const previous = [...graph.adjacency[neighbor]];
      emit('connect', 'reciprocal', `Consider the reverse connection #${neighbor} → #${id}. Point #${neighbor} has ${previous.length} outgoing neighbors; its limit is ${CAPACITY}.`, {
        center: neighbor, current: neighbor, activeEdge: [neighbor, id], selected: previous, retained: entries(previous, neighbor)
      });
      if (previous.length < CAPACITY) {
        graph.adjacency[neighbor].push(id);
        added.push([neighbor, id]);
        emit('connect', 'add', `Add #${neighbor} → #${id}. There is room, so no pruning is needed here.`, {
          center: neighbor, current: neighbor, activeEdge: [neighbor, id], changed: [[neighbor, id]],
          selected: [...graph.adjacency[neighbor]], retained: entries(graph.adjacency[neighbor], neighbor)
        });
      } else {
        pruned++;
        const kept = choose(neighbor, [...previous, id], CAPACITY, 'prune');
        const dropped = previous.filter(n => !kept.includes(n)).map(n => [neighbor, n]);
        const newLinks = kept.includes(id) ? [[neighbor, id]] : [];
        graph.adjacency[neighbor] = kept;
        removed.push(...dropped);
        added.push(...newLinks);
        emit('prune', 'replace', `Update only #${neighbor}’s outgoing list. ${dropped.length} existing connection(s) removed. ${kept.includes(id) ? `The reverse link to #${id} is retained.` : `The reverse link to #${id} is rejected.`} Opposite directions remain unchanged.`, {
          center: neighbor, current: neighbor, selected: kept, retained: entries(kept, neighbor), removed: dropped, changed: newLinks
        });
      }
    }
    emit('complete', 'finish', `Inserted #${id} with ${neighbors.length} outgoing neighbors. Added ${added.length} directed connections and removed ${removed.length}. ${pruned ? `Reconsidered ${pruned} full neighbor list(s).` : 'No pruning was necessary.'} Reset replays this insertion from the original graph.`, {
      selected: neighbors, retained: entries(neighbors, id), summary: { added, removed, pruned }
    });
    return trace;
  }

  function buildGraph(points) {
    let graph = { points: [], adjacency: {}, entryPoint: null };
    for (const point of points) graph = insertionTrace(graph, point, 10, 'nearest').at(-1).graph;
    return graph;
  }

  const api = { M, CAPACITY, buildGraph, insertionTrace, selectNeighbors };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HnswInsertion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
