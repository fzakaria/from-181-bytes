// Tests site/js/tower.js, the geometry of the chain picture: one row per
// floor, a band whose width grows with log10 of the bytes produced so
// far, an arc from each floor's builder down to it, era bands behind the
// rows, and the path a trace draws. Pure numbers in, numbers out; the
// SVG is drawn from these elsewhere.
import { test } from "node:test";
import assert from "node:assert/strict";

import { towerLayout, eraSpans, tracePoints } from "../site/js/tower.js";

// Four floors in build order, as floorViews returns them.
const views = [
  {
    id: "seed",
    index: 0,
    era: "hex",
    builtBy: null,
    bytes: 181,
    cumulative: { built: 0, source: 0 },
  },
  {
    id: "hex0",
    index: 1,
    era: "hex",
    builtBy: "seed",
    bytes: 181,
    cumulative: { built: 181, source: 100 },
  },
  {
    id: "cc",
    index: 2,
    era: "c",
    builtBy: "hex0",
    bytes: 5000,
    cumulative: { built: 5181, source: 100 },
  },
  {
    id: "gcc",
    index: 3,
    era: "gcc",
    builtBy: "hex0",
    bytes: 1e8,
    cumulative: { built: 1e8 + 5181, source: 1e6 },
  },
];
const geometry = {
  rowHeight: 40,
  width: 600,
  arcSpace: 80,
  minBand: 20,
  maxBand: 300,
};

// Rows stack top to bottom in build order, one rowHeight apart.
test("rows stack in build order", () => {
  const { rows, height } = towerLayout(views, { trustBytes: 181, ...geometry });
  assert.deepEqual(
    rows.map((row) => row.y),
    [0, 40, 80, 120],
  );
  assert.equal(height, 160);
});

// The band is log-scaled bytes produced so far, from minBand to maxBand
// at the last floor. The seed row is the seed itself, the bytes you
// trust. The band never narrows going down.
test("bands widen with log bytes produced, the seed row sized by trust", () => {
  const { rows } = towerLayout(views, { trustBytes: 181, ...geometry });
  assert.equal(rows.at(-1).band, geometry.maxBand);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(
      rows[i].band >= rows[i - 1].band,
      `row ${i} narrower than ${i - 1}`,
    );
  }
  // 181 bytes out of ~1e8 on a log scale: about 2.26 / 8.0 of the way.
  const expected =
    geometry.minBand +
    (geometry.maxBand - geometry.minBand) *
      (Math.log10(181) / Math.log10(1e8 + 5181));
  assert.ok(Math.abs(rows[0].band - expected) < 1e-6);
  assert.equal(rows[1].band, rows[0].band);
});

// The core is the floor's own output on the same scale, never wider
// than the band.
test("the core is the floor's own output and fits inside the band", () => {
  const { rows } = towerLayout(views, { trustBytes: 181, ...geometry });
  for (const row of rows) {
    assert.ok(row.core <= row.band);
  }
  assert.ok(rows[3].core > rows[2].core);
});

// Every floor but the seed gets an arc from its builder's row to its
// own; a longer span bulges further into the arc space, never past it.
test("each floor gets an arc from its builder", () => {
  const { arcs } = towerLayout(views, { trustBytes: 181, ...geometry });
  assert.deepEqual(
    arcs.map(({ from, to }) => [from, to]),
    [
      [0, 1],
      [1, 2],
      [1, 3],
    ],
  );
  assert.ok(arcs[2].bulge > arcs[1].bulge);
  for (const arc of arcs) {
    assert.ok(arc.bulge <= geometry.arcSpace);
  }
});

// Eras are contiguous runs of floors, in order of first appearance.
test("eras are contiguous spans of floors", () => {
  assert.deepEqual(eraSpans(views), [
    { era: "hex", first: 0, last: 1 },
    { era: "c", first: 2, last: 2 },
    { era: "gcc", first: 3, last: 3 },
  ]);
});

// A trace is drawn through the rows of its floors, at each row's middle.
test("a trace becomes points at the middle of each hop's row", () => {
  const { rows } = towerLayout(views, { trustBytes: 181, ...geometry });
  assert.deepEqual(tracePoints(rows, ["gcc", "hex0", "seed"], views), [
    { index: 3, y: 140 },
    { index: 1, y: 60 },
    { index: 0, y: 20 },
  ]);
});
