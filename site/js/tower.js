// Geometry for the chain picture, with no DOM: tower-view.js draws SVG
// from these numbers and node tests check them.
//
// The picture is one row per floor, top to bottom in build order. Each
// row has a band centred on the tower's axis whose width is log10 of the
// bytes produced so far, so the tower widens from the seed's 181 bytes
// to gigabytes; inside it a solid core for the floor's own output. Arcs
// on the left join each floor to the floor that built it.

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
// left of the tower for arcs, and bands run from minBand wide to maxBand
// at the last floor.
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
  const max = views.at(-1).cumulative.built;
  const span = maxBand - minBand;
  const widthOf = (bytes) => minBand + span * logShare(bytes, max);

  let y = 0;
  const rows = views.map((view, index) => {
    // The seed has produced nothing; its row is the bytes you trust.
    const produced = index === 0 ? trustBytes : view.cumulative.built;
    const band = widthOf(produced);
    const height = index === 0 ? seedRowHeight : rowHeight;
    const row = {
      index,
      y,
      height,
      mid: y + height / 2,
      band,
      core: Math.min(band, widthOf(view.bytes)),
    };
    y += height;
    return row;
  });

  // One arc per built-by edge. The bulge grows with the number of floors
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

  return { rows, arcs, height: y };
}

// Contiguous runs of floors sharing an era, in build order.
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

// The points a trace's line passes through: the middle of each hop's
// floor row, in trace order. Hops that are not floors are skipped.
export function tracePoints(rows, floorIds, views) {
  const indexOf = new Map(views.map((view, index) => [view.id, index]));
  return floorIds
    .filter((id) => indexOf.has(id))
    .map((id) => ({ index: indexOf.get(id), y: rows[indexOf.get(id)].mid }));
}

// Which tower is being drawn: the full one in the climb, with labels, or
// the compact copy beside "who built you?", without.
export const TowerKind = Object.freeze({
  FULL: "full",
  COMPACT: "compact",
});

// Container widths at and above which the full tower gets roomy rows, a
// wide arc space and milestones on its labels.
export const WIDE = 560;

// How much taller the seed row is than the others, so its byte map reads.
const SEED_ROW_SCALE = 2;

// The narrowest and widest the last floor's band may be.
const MIN_BAND = 6;
const FLOOR_MAX_BAND = 60;
const CEILING_MAX_BAND = 320;

// The full tower's columns, left to right, roomy and tight.
const FULL_ROOMY = Object.freeze({
  rowHeight: 46,
  arcSpace: 96,
  sourceGap: 4,
  sourceColumn: 34,
  labelGap: 10,
});
const FULL_TIGHT = Object.freeze({
  rowHeight: 42,
  arcSpace: 44,
  sourceGap: 4,
  sourceColumn: 20,
  labelGap: 8,
});
const COMPACT = Object.freeze({
  rowHeight: 16,
  arcSpace: 56,
  rightMargin: 16,
});

// Geometry for a tower drawn in a container `width` wide. `labelWidth` is
// the widest label the full tower will draw, measured by the caller; the
// bands shrink so that the label column always ends inside the width.
// Returns the towerLayout geometry plus where the source ticks and the
// labels start.
export function towerGeometry(width, { kind, labelWidth }) {
  // The compact tower: short rows, no source ticks and no labels.
  if (kind === TowerKind.COMPACT) {
    return {
      rowHeight: COMPACT.rowHeight,
      seedRowHeight: COMPACT.rowHeight * SEED_ROW_SCALE,
      arcSpace: COMPACT.arcSpace,
      minBand: MIN_BAND,
      maxBand: Math.max(
        FLOOR_MAX_BAND,
        width - COMPACT.arcSpace - COMPACT.rightMargin,
      ),
      sourceColumn: 0,
      sourceX: 0,
      labelX: width,
      labels: false,
    };
  }

  // The full tower: the bands get whatever the arcs, the source ticks and
  // the labels leave.
  const columns = width >= WIDE ? FULL_ROOMY : FULL_TIGHT;
  const fixed =
    columns.arcSpace +
    columns.sourceGap +
    columns.sourceColumn +
    columns.labelGap +
    labelWidth;
  const maxBand = Math.max(
    FLOOR_MAX_BAND,
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
    labels: true,
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
