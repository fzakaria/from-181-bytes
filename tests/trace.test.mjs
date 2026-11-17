// Tests site/js/trace.js, the "who built you?" walk: from any derivation
// in a chain file, follow built-by from floor to floor until the seed.
// The chain here is a hand-made miniature in the shape build-data writes.
import { test } from "node:test";
import assert from "node:assert/strict";

import { trace } from "../site/js/trace.js";

const chain = {
  floors: [
    { id: "seed", node: 0, builtBy: null },
    { id: "hex0", node: 1, builtBy: "seed" },
    { id: "cc", node: 2, builtBy: "hex0" },
  ],
  nodes: [
    { name: "seed", builtBy: null, via: [] },
    { name: "hex0", builtBy: "seed", via: [] },
    { name: "cc", builtBy: "hex0", via: [3] },
    { name: "cc-step", builtBy: "hex0", via: [] },
    { name: "prog", builtBy: "cc", via: [5] },
    { name: "prog-lib", builtBy: "cc", via: [] },
  ],
};

// A derivation that is not a floor starts the trace, and every hop names
// the floor that built the previous one and the derivations in between.
test("a trace climbs down floor by floor to the seed", () => {
  assert.deepEqual(trace(chain, 4), [
    { node: 4, floor: null, via: [] },
    { node: 2, floor: "cc", via: [5] },
    { node: 1, floor: "hex0", via: [3] },
    { node: 0, floor: "seed", via: [] },
  ]);
});

// Starting on a floor marks the first hop with that floor's id.
test("a trace that starts on a floor names it", () => {
  assert.deepEqual(trace(chain, 1), [
    { node: 1, floor: "hex0", via: [] },
    { node: 0, floor: "seed", via: [] },
  ]);
});

// A chain file that loops would hang the page; trace refuses it instead.
test("a cycle is an error, not an endless loop", () => {
  const looped = structuredClone(chain);
  looped.nodes[0].builtBy = "cc";
  assert.throws(() => trace(looped, 4), /cycle/);
});
