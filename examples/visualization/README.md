# HNSW search walkthrough

Open `index.html` for search or `insertion.html` for insertion in a browser.
There is no install or build step. Keep the files in this directory together;
an internet connection is needed for the pinned D3 7.9.0 CDN script.

1. Press **Step** or the **Right Arrow** key to inspect one decision, or **Play**
   to advance every 700 ms. Stepping pauses playback. When the ef slider has
   focus, arrow keys adjust the slider instead.
2. Watch the search descend from layer 2 to layer 0 at the same point.
3. Compare **ef=1** and **ef=4** to see how the retained candidates and distance
   evaluations change. Both can find the exact answer; a wider search explores more.
4. Click any plot to move the query. Changing the query or ef pauses and resets
   the trace. **Reset** keeps your dataset, query, and ef.
5. Press **New dataset** for 30 fresh points in four irregular clusters, new
   upper-layer memberships, and rebuilt connections. This pauses playback and
   starts a new query while keeping ef. Reload to restore the initial dataset.

The three plots use identical coordinates and equal scales. Candidate chips
show point IDs and squared Euclidean distances. The dashed pink ring shown at
completion marks the exact nearest point. Distances are cached across layers;
the evaluation counter excludes the separate exhaustive comparison.

## Deliberate simplifications

These generated graphs have 30 points in 2D, three nested layers (30, 9, and 3
points), symmetric connections, and k=1. Upper layers are randomly sampled
subsets. For each insertion in each layer, the builder scans all earlier points
and selects up to three neighbors using HNSW's diversity heuristic: reject a
candidate if it is closer to an already selected neighbor than to the new point.
Reciprocal connections remain without degree pruning, so each layer stays
connected. This is a simplified teaching graph, not a full HNSW construction
implementation or an index exported from hnswlib. Higher ef allows more
exploration but does not guarantee an exact answer for every query.

`search.js` holds a seeded dataset generator and a pure search function that
returns snapshots. `createDataset(seed)` reproduces a graph for debugging;
`search(query, ef, dataset)` searches it. The initial seed is 42. New dataset
chooses a fresh seed and places the query uniformly at random across the plot.
`index.html` contains D3 rendering and playback controls; `style.css` holds shared styles. Queues use
sorted arrays because this graph is tiny. Bottom-layer search retains at most ef
best candidates; its pending queue and visited set may be larger than ef.

Run the dependency-free algorithm checks with:

```sh
node examples/visualization/search.test.js
node examples/visualization/insertion.test.js
```

## Single-layer insertion

The insertion page shows one layer throughout. It first searches for up to
`efConstruction` candidates, then selects at most `M=3` outgoing neighbors for
the new point. It considers reciprocal links and prunes existing outgoing lists
that would exceed six neighbors. Arrowheads show the direction of traversal;
removing one direction does not remove its reverse.

- **Nearest neighbors** (default) takes the closest discovered candidates.
- **Diversity heuristic** rejects candidate C when a selected R satisfies
  `distance(C, R) < distance(C, Q)`, where Q is the center whose neighbors are
  being selected. Dashed lines and the comparison panel show these distances.
  As in hnswlib, fewer candidates than the limit are all retained. There is no
  candidate extension or refilling of rejected candidates.

The selected rule also applies when pruning a full neighbor list, with the
existing node as Q and a limit of six. Distances shown are squared Euclidean
distances; this preserves their ordering and the heuristic's comparisons.

The starting graph always uses nearest-neighbor insertion with width 10 and
point 0 as its entry point. Switching methods keeps that graph, the proposed
point, and the candidate-search results fixed. Moving the point or changing a
control pauses and restarts playback. **Reset** replays the same insertion;
completed insertions do not accumulate. **New dataset** replaces the baseline
and randomizes the proposed point while preserving method and width.

`insertion.js` exports `buildGraph(points)` and
`insertionTrace(graph, point, efConstruction, selectionMethod)`, where the method
is `nearest` or `diversity`. The trace contains independent graph snapshots and
does not mutate the baseline. Baseline construction uses the same insertion
routine. Candidate search reuses the search demo's single-layer interface;
the final exhaustive comparison is excluded from insertion playback and its
search counter. Diversity comparisons are counted separately.

This lesson omits level assignment, upper-layer navigation, deletions, and
concurrent insertion. The separate search demo retains its original simplified
graph builder. Both pages share `style.css` and load the same pinned D3 version.
