// Geometry for the chain picture, with no DOM: tower-view.js draws SVG
// from these numbers and node tests check them.
//
// The picture is one row per stage, top to bottom in build order. Each
// row has a bar centred on the tower's axis whose width is log10 of that
// stage's output, from the seed's 181 bytes to GCC's hundred megabytes.
// Arcs on the left join each stage to the stage that built it.

// Log-scaled share of `max`, 0 for a byte or less.
function logShare(bytes, max) {
  if (bytes <= 1 || max <= 1) {
    return 0;
  }
  return Math.min(1, Math.log10(bytes) / Math.log10(max));
}

// Lay out the rows and arcs. `geometry` is { rowHeight, seedRowHeight,
// arcSpace, minBand, maxBand }: the seed row is seedRowHeight tall (by
// default rowHeight) to leave room for its byte map, arcSpace is the room
// left of the tower for arcs, and bars run from minBand wide to maxBand
// for the largest output.
export function towerLayout(
  views,
  {
    trustBytes,
    rowHeight,
    seedRowHeight = rowHeight,
    arcSpace,
    minBand,
    maxBand,
  },
) {
  // The seed row's output is the bytes you trust: it is fetched, not
  // produced.
  const outputOf = (view, index) => (index === 0 ? trustBytes : view.bytes);
  const max = Math.max(...views.map(outputOf));
  const span = maxBand - minBand;
  const widthOf = (bytes) => minBand + span * logShare(bytes, max);

  let y = 0;
  const rows = views.map((view, index) => {
    const height = index === 0 ? seedRowHeight : rowHeight;
    const row = {
      index,
      y,
      height,
      mid: y + height / 2,
      bar: widthOf(outputOf(view, index)),
    };
    y += height;
    return row;
  });

  // One arc per built-by edge. The bulge grows with the number of stages
  // the arc spans, so long jumps stand clear of the short ones.
  const indexOf = new Map(views.map((view, index) => [view.id, index]));
  const edges = views
    .filter((view) => view.builtBy !== null)
    .map((view) => ({ from: indexOf.get(view.builtBy), to: view.index }));
  const longest = Math.max(1, ...edges.map(({ from, to }) => to - from));
  const arcs = edges.map(({ from, to }) => ({
    from,
    to,
    bulge: arcSpace * Math.sqrt((to - from) / longest),
  }));

  return { rows, arcs, height: y, widthOf };
}

// Contiguous runs of stages sharing an era, in build order.
export function eraSpans(views) {
  const spans = [];
  for (const view of views) {
    const last = spans.at(-1);
    if (last && last.era === view.era) {
      last.last = view.index;
      continue;
    }
    spans.push({ era: view.era, first: view.index, last: view.index });
  }
  return spans;
}

// Container widths at and above which the tower gets roomy rows, a wide
// arc space and milestones on its labels.
export const WIDE = 560;

// How much taller the seed row is than the others, so its byte map reads.
const SEED_ROW_SCALE = 2;

// The narrowest bar, and the range the widest bar may take.
const MIN_BAND = 6;
const MIN_MAX_BAND = 60;
const CEILING_MAX_BAND = 320;

// The tower's columns, left to right, roomy and tight.
const ROOMY = Object.freeze({
  rowHeight: 46,
  arcSpace: 96,
  sourceGap: 4,
  sourceColumn: 34,
  labelGap: 10,
});
const TIGHT = Object.freeze({
  rowHeight: 42,
  arcSpace: 44,
  sourceGap: 4,
  sourceColumn: 20,
  labelGap: 8,
});

// Geometry for the tower drawn in a container `width` wide. `labelWidth`
// is the widest label it will draw, measured by the caller; the bars
// shrink so that the label column always ends inside the width. Returns
// the towerLayout geometry plus where the source ticks and the labels
// start.
export function towerGeometry(width, { labelWidth }) {
  const columns = width >= WIDE ? ROOMY : TIGHT;
  const fixed =
    columns.arcSpace +
    columns.sourceGap +
    columns.sourceColumn +
    columns.labelGap +
    labelWidth;
  const maxBand = Math.max(
    MIN_MAX_BAND,
    Math.min(CEILING_MAX_BAND, width - fixed),
  );
  const sourceX = columns.arcSpace + maxBand + columns.sourceGap;
  return {
    rowHeight: columns.rowHeight,
    seedRowHeight: columns.rowHeight * SEED_ROW_SCALE,
    arcSpace: columns.arcSpace,
    minBand: MIN_BAND,
    maxBand,
    sourceColumn: columns.sourceColumn,
    sourceX,
    labelX: sourceX + columns.sourceColumn + columns.labelGap,
  };
}

// The seed's byte map: `count` square cells in a `width` by `height` box,
// filled row by row. Picks the column count that gives the largest cells.
// Returns { cols, rows, cell }.
export function byteMapLayout(count, width, height) {
  let best = { cols: 1, rows: count, cell: 0 };
  for (let cols = 1; cols <= count; cols += 1) {
    const rows = Math.ceil(count / cols);
    const cell = Math.min(width / cols, height / rows);
    if (cell <= best.cell) {
      continue;
    }
    best = { cols, rows, cell };
  }
  return best;
}
