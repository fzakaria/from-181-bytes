// Tests site/js/view.js, the page logic that does not touch the DOM:
// joining the hand-written floors to the measured chain, which milestones
// a reader has passed, and the file filter in
// "who built you?". The chain is a two-floor miniature in build-data's
// shape.
import { test } from "node:test";
import assert from "node:assert/strict";

import { floorViews, milestonesReached, filterFiles } from "../site/js/view.js";

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
    title: "{cc}",
    writtenIn: "M1",
    milestone: "First C compiler",
    note: "n",
    link: "l",
  },
];
const chain = {
  system: "i686-linux",
  floors: [
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

// Each floor view carries the prose and the measurements side by side,
// with {cc} filled in for the system and node indices resolved to names.
test("floor views join prose to measurements", () => {
  const views = floorViews(meta, chain);
  assert.equal(views.length, 2);
  assert.equal(views[1].title, "cc_x86");
  assert.equal(views[1].bytes, 5);
  assert.equal(views[1].builtByTitle, "hex0-seed");
  assert.deepEqual(views[1].compiledNames, ["extra-1.0"]);
  assert.equal(views[0].builtByTitle, null);
});

// The prose and the data must describe the same floors in the same
// order; a mismatch means the data is stale, and it is an error.
test("floor views refuse data for different floors", () => {
  assert.throws(() => floorViews([meta[1], meta[0]], chain), /floor/);
});

// A milestone is reached once the reader is on or past its floor.
test("milestones are reached on and after their floor", () => {
  const views = floorViews(meta, chain);
  assert.deepEqual(milestonesReached(views, 0), [
    { label: "First C compiler", index: 1, reached: false },
  ]);
  assert.deepEqual(milestonesReached(views, 1), [
    { label: "First C compiler", index: 1, reached: true },
  ]);
});

// The filter matches a case-insensitive substring of the path, keeps the
// list order, and caps the result, reporting how many matched in all.
test("files filter by substring and stop at the limit", () => {
  const files = [
    ["bin/gcc", 10],
    ["bin/g++", 10],
    ["lib/libgcc.a", 5],
    ["include/stdio.h", 1],
  ];
  assert.deepEqual(filterFiles(files, "GCC", 10), {
    shown: [files[0], files[2]],
    total: 2,
  });
  assert.deepEqual(filterFiles(files, "", 2), {
    shown: files.slice(0, 2),
    total: 4,
  });
});
