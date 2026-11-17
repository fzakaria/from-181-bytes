// Tests site/js/view.js, the page logic that does not touch the DOM:
// joining the hand-written stages to the measured chain. The chain is a
// two-stage miniature in build-data's shape.
import { test } from "node:test";
import assert from "node:assert/strict";

import { stageViews } from "../site/js/view.js";

const meta = [
  {
    id: "seed",
    title: "hex0-seed",
    writtenIn: "machine code",
    note: "n",
    link: "l",
  },
  {
    id: "cc_arch",
    title: "cc_x86",
    writtenIn: "M1",
    milestone: "First C compiler",
    note: "n",
    link: "l",
  },
];
const chain = {
  system: "i686-linux",
  stages: [
    {
      id: "seed",
      node: 0,
      builtBy: null,
      using: [],
      compiled: [],
      cumulative: { built: 0 },
    },
    {
      id: "cc_arch",
      node: 1,
      builtBy: "seed",
      using: ["seed"],
      compiled: [2],
      cumulative: { built: 5 },
    },
  ],
  nodes: [
    { name: "hex0-seed", bytes: 181 },
    { name: "cc_arch-1.9.1", bytes: 5 },
    { name: "extra-1.0", bytes: 9 },
  ],
};

// Each stage view carries the prose and the measurements side by side,
// with node indices resolved to names.
test("stage views join prose to measurements", () => {
  const views = stageViews(meta, chain);
  assert.equal(views.length, 2);
  assert.equal(views[1].title, "cc_x86");
  assert.equal(views[1].bytes, 5);
  assert.equal(views[1].builtByTitle, "hex0-seed");
  assert.deepEqual(views[1].compiledNames, ["extra-1.0"]);
  assert.equal(views[0].builtByTitle, null);
});

// The prose and the data must describe the same stages in the same
// order; a mismatch means the data is stale, and it is an error.
test("stage views refuse data for different stages", () => {
  assert.throws(() => stageViews([meta[1], meta[0]], chain), /stage/);
});
