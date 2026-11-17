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

// Lay out the rows and arcs. `geometry` is { rowHeight, width, arcSpace,
// minBand, maxBand }: arcSpace is the room left of the tower for arcs,
// and bands run from minBand wide to maxBand at the last floor.
export function towerLayout(
  views,
  { trustBytes, rowHeight, arcSpace, minBand, maxBand },
) {
  const max = views.at(-1).cumulative.built;
  const span = maxBand - minBand;
  const widthOf = (bytes) => minBand + span * logShare(bytes, max);

  const rows = views.map((view, index) => {
    // The seed has produced nothing; its row is the bytes you trust.
    const produced = index === 0 ? trustBytes : view.cumulative.built;
    const band = widthOf(produced);
    return {
      index,
      y: index * rowHeight,
      mid: index * rowHeight + rowHeight / 2,
      band,
      core: Math.min(band, widthOf(view.bytes)),
    };
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

  return { rows, arcs, height: views.length * rowHeight };
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
