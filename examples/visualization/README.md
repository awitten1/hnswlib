# HNSW search walkthrough

Open `index.html` in a browser. There is no install or build step. Keep `search.js`
beside it; an internet connection is needed for the pinned D3 7.9.0 CDN script.

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
`index.html` contains the styling, D3 rendering, and playback controls. Queues use
sorted arrays because this graph is tiny. Bottom-layer search retains at most ef
best candidates; its pending queue and visited set may be larger than ef.

Run the dependency-free algorithm checks with:

```sh
node examples/visualization/search.test.js
```
