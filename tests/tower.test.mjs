// Tests site/js/tower.js, the geometry of the chain picture: one row per
// stage, a bar whose width grows with log10 of that stage's output, an
// arc from each stage's builder down to it, era bands behind the rows,
// and the seed's byte map. Pure numbers in, numbers out; the SVG is drawn
// from these elsewhere.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  towerLayout,
  eraSpans,
  byteMapLayout,
  towerGeometry,
} from "../site/js/tower.js";

// Four stages in build order, as stageViews returns them.
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
  assert.deepEqual(
    rows.map((row) => row.height),
    [40, 40, 40, 40],
  );
});

// The seed row can be taller than the rest, so its byte map has room;
// the rows below it move down by the difference.
test("a taller seed row pushes the rest down", () => {
  const { rows, height } = towerLayout(views, {
    trustBytes: 181,
    ...geometry,
    seedRowHeight: 100,
  });
  assert.deepEqual(
    rows.map((row) => [row.y, row.height, row.mid]),
    [
      [0, 100, 50],
      [100, 40, 120],
      [140, 40, 160],
      [180, 40, 200],
    ],
  );
  assert.equal(height, 220);
});

// Each bar is that stage's own output on a log10 scale, so the largest
// output gets maxBand and the rest are proportional to their log size.
// The seed row is the bytes you trust. A stage that outputs less than the
// one above it gets a narrower bar.
test("bars are each stage's output on a log scale", () => {
  const { rows } = towerLayout(views, { trustBytes: 181, ...geometry });
  const share = (bytes) => Math.log10(bytes) / Math.log10(1e8);
  const expected = [181, 181, 5000, 1e8].map(
    (bytes) =>
      geometry.minBand + (geometry.maxBand - geometry.minBand) * share(bytes),
  );
  rows.forEach((row, i) => {
    assert.ok(Math.abs(row.bar - expected[i]) < 1e-9, `row ${i}`);
  });
  assert.equal(rows.at(-1).bar, geometry.maxBand);
  assert.equal(rows[0].bar, rows[1].bar);

  // A smaller stage after a bigger one is narrower: no running total.
  const shrinking = [...views.slice(0, 3), { ...views[3], bytes: 1000 }];
  const smaller = towerLayout(shrinking, { trustBytes: 181, ...geometry });
  assert.ok(smaller.rows[3].bar < smaller.rows[2].bar);
});

// The layout hands back its scale, so gridlines can be drawn at sizes on
// the same log axis as the bars.
test("the layout's scale puts a size where its bar would end", () => {
  const { rows, widthOf } = towerLayout(views, {
    trustBytes: 181,
    ...geometry,
  });
  assert.equal(widthOf(5000), rows[2].bar);
  assert.equal(widthOf(1e8), geometry.maxBand);
  assert.ok(widthOf(1024) < widthOf(1024 * 1024));
});

// Every stage but the seed gets an arc from its builder's row to its
// own; a longer span bulges further into the arc space, never past it.
test("each stage gets an arc from its builder", () => {
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

// Eras are contiguous runs of stages, in order of first appearance.
test("eras are contiguous spans of stages", () => {
  assert.deepEqual(eraSpans(views), [
    { era: "hex", first: 0, last: 1 },
    { era: "c", first: 2, last: 2 },
    { era: "gcc", first: 3, last: 3 },
  ]);
});

// The seed is drawn as one square cell per byte. The layout picks the
// column count that gives the largest cells inside the box, and every
// byte gets a cell.
test("the byte map fits every byte in the box with the largest cells", () => {
  const map = byteMapLayout(181, 83, 59);
  assert.equal(map.cols, 16);
  assert.equal(map.rows, 12);
  assert.ok(map.cols * map.rows >= 181);
  assert.ok(map.cols * map.cell <= 83 + 1e-9);
  assert.ok(map.rows * map.cell <= 59 + 1e-9);
  assert.ok(Math.abs(map.cell - 59 / 12) < 1e-9);

  // A tall narrow box gets few columns.
  const narrow = byteMapLayout(181, 28, 54);
  assert.ok(narrow.cols < 16);
  assert.ok(narrow.cols * narrow.rows >= 181);
  assert.ok(narrow.cols * narrow.cell <= 28 + 1e-9);
  assert.ok(narrow.rows * narrow.cell <= 54 + 1e-9);
});

// The full tower's labels never run past the right edge, from a 360px
// phone (328px of column) to a desktop, for the longest label the page
// draws; the bands keep a usable width.
test("the label column fits inside the tower at every width", () => {
  const labelWidth = 170;
  for (let width = 328; width <= 1100; width += 2) {
    const g = towerGeometry(width, { labelWidth });
    assert.ok(
      g.labelX + labelWidth <= width,
      `label runs to ${g.labelX + labelWidth} at width ${width}`,
    );
    assert.ok(g.maxBand >= g.minBand * 10, `band ${g.maxBand} at ${width}`);
    assert.ok(g.seedRowHeight > g.rowHeight);
  }
});
