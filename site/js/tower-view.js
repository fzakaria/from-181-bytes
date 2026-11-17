// Draws the chain picture into an <svg> from tower.js's geometry, and
// highlights a floor, its builder and the floors it used, or a whole
// "who built you?" trace. No library: the chain is a spine with one
// builder per floor, so an arc diagram along a tower needs no graph
// layout.

import {
  towerLayout,
  eraSpans,
  towerGeometry,
  byteMapLayout,
  TowerKind,
  WIDE,
} from "./tower.js";
import { humanBytes } from "./format.js";
import { ERAS } from "./floors.js";

const ERA_LABEL = new Map(ERAS.map((era) => [era.id, era.label]));

const SVG_NS = "http://www.w3.org/2000/svg";

// The share of a row's height its band and core fill, and the share of
// the seed row its byte map fills.
const BAND_FILL = 0.64;
const SEED_FILL = 0.8;

// The seed's byte map: below this cell size the map is a smudge and the
// seed is drawn as a plain core. Each cell leaves a gap of CELL_GAP of its
// size, and its fill runs from MIN_BYTE_OPACITY for 0x00 to full for 0xFF.
const MIN_CELL = 1.5;
const CELL_GAP = 0.18;
const MIN_BYTE_OPACITY = 0.15;
const MAX_BYTE = 0xff;

function svgEl(tag, attrs = {}, text = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, String(value));
  }
  if (text !== null) {
    node.textContent = text;
  }
  return node;
}

// The widest of `texts` drawn in `svg` with `className`, in pixels.
// Measured in the page so the label column fits the fonts in use.
function widestText(svg, texts, className) {
  const probe = svgEl("text", { class: className, x: 0, y: 0 });
  svg.append(probe);
  let widest = 0;
  for (const text of texts) {
    probe.textContent = text;
    widest = Math.max(widest, probe.getComputedTextLength());
  }
  probe.remove();
  return widest;
}

// The size line under a floor's title. The milestone rides on it only
// where there is room; on a phone the chips above the picture carry it.
function sizeLine(view, index, trustBytes, width) {
  const produced =
    index === 0 ? `${trustBytes} B trusted` : `${humanBytes(view.bytes)} out`;
  if (!view.milestone || width < WIDE) {
    return produced;
  }
  return `${produced} · ${view.milestone}`;
}

// The seed drawn as what it is: one cell per byte, filled row by row in
// the seed's era colour, darker for larger values, over the band. Falls
// back to a plain core when the cells would be too small to see.
function seedBytesNodes(bytes, { axis, mid, width, height }) {
  const map = byteMapLayout(bytes.length, width, height);
  if (map.cell < MIN_CELL) {
    return null;
  }
  const left = axis - (map.cols * map.cell) / 2;
  const top = mid - (map.rows * map.cell) / 2;
  const gap = map.cell * CELL_GAP;
  const nodes = [
    svgEl("rect", {
      x: left,
      y: top,
      width: map.cols * map.cell,
      height: map.rows * map.cell,
      rx: 1,
      class: "band",
    }),
  ];
  bytes.forEach((value, offset) => {
    nodes.push(
      svgEl("rect", {
        x: left + (offset % map.cols) * map.cell + gap / 2,
        y: top + Math.floor(offset / map.cols) * map.cell + gap / 2,
        width: map.cell - gap,
        height: map.cell - gap,
        "fill-opacity":
          MIN_BYTE_OPACITY + (1 - MIN_BYTE_OPACITY) * (value / MAX_BYTE),
        class: "byte",
      }),
    );
  });
  return nodes;
}

// Draw `views` into `svg`. `sourceDelta[i]` is the source fetched at
// floor i, `seedBytes` the seed itself for the seed row's byte map.
// Returns { setFocus, setTrace }, both taking a floor index (or list of
// floor ids) or null.
export function drawTower(
  svg,
  views,
  {
    trustBytes,
    seedBytes = null,
    sourceDelta,
    kind = TowerKind.FULL,
    onPick = null,
  },
) {
  const compact = kind === TowerKind.COMPACT;
  const width = svg.parentElement.clientWidth;
  svg.replaceChildren();

  // The label column is as wide as the widest title or size line.
  const sizes = views.map((view, index) =>
    sizeLine(view, index, trustBytes, width),
  );
  const labelWidth = compact
    ? 0
    : Math.ceil(
        Math.max(
          widestText(
            svg,
            views.map((view) => view.title),
            "title",
          ),
          widestText(svg, sizes, "size"),
        ),
      );
  const geometry = towerGeometry(width, { kind, labelWidth });
  const { rows, arcs, height } = towerLayout(views, {
    trustBytes,
    ...geometry,
  });
  const axis = geometry.arcSpace + geometry.maxBand / 2;
  const { sourceX, labelX } = geometry;
  const maxSource = Math.max(1, ...sourceDelta);

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);

  // Era bands behind everything, labelled at their top right.
  const eras = svgEl("g", { class: "eras" });
  for (const span of eraSpans(views)) {
    const y = rows[span.first].y;
    const h = rows[span.last].y + rows[span.last].height - y;
    eras.append(
      svgEl("rect", {
        x: 0,
        y,
        width,
        height: h,
        class: `era-bg era-${span.era}`,
      }),
    );
    if (!compact) {
      eras.append(
        svgEl(
          "text",
          { x: 4, y: y + 12, class: `era-label era-text-${span.era}` },
          ERA_LABEL.get(span.era),
        ),
      );
    }
  }
  svg.append(eras);

  // Built-by arcs, from the builder's row down to the floor it built,
  // bulging left.
  const arcLayer = svgEl("g", { class: "arcs" });
  const arcNodes = arcs.map(({ from, to, bulge }) => {
    const x = geometry.arcSpace;
    const [y1, y2] = [rows[from].mid, rows[to].mid];
    const path = svgEl("path", {
      d: `M ${x} ${y1} C ${x - bulge} ${y1}, ${x - bulge} ${y2}, ${x} ${y2}`,
      class: "arc",
    });
    arcLayer.append(path);
    return { from, to, path };
  });
  svg.append(arcLayer);

  // One row per floor: a connector from the arcs to the band, the band
  // (bytes produced so far), its core (this floor's output), the source
  // fetched here, and the label.
  const rowLayer = svgEl("g", { class: "rows" });
  const rowNodes = rows.map((row, index) => {
    const view = views[index];
    const g = svgEl("g", {
      class: `row era-${view.era}${index === 0 ? " seed" : ""}`,
      "data-index": index,
      tabindex: compact ? -1 : 0,
    });
    const bandHeight = row.height * BAND_FILL;
    const top = row.mid - bandHeight / 2;

    g.append(
      svgEl("rect", {
        x: 0,
        y: row.y,
        width,
        height: row.height,
        class: "hit",
      }),
    );
    g.append(
      svgEl("line", {
        x1: geometry.arcSpace,
        y1: row.mid,
        x2: axis - row.band / 2,
        y2: row.mid,
        class: "connector",
      }),
    );

    // The seed row is its bytes, when they are known and fit.
    const byteNodes =
      index === 0 && seedBytes
        ? seedBytesNodes(seedBytes, {
            axis,
            mid: row.mid,
            width: row.core,
            height: row.height * SEED_FILL,
          })
        : null;
    if (byteNodes) {
      g.append(
        svgEl(
          "title",
          {},
          `${seedBytes.length} bytes, one cell each, darker for larger values`,
        ),
        ...byteNodes,
      );
    } else {
      g.append(
        svgEl("rect", {
          x: axis - row.band / 2,
          y: top,
          width: row.band,
          height: bandHeight,
          rx: 2,
          class: "band",
        }),
        svgEl("rect", {
          x: axis - row.core / 2,
          y: top,
          width: row.core,
          height: bandHeight,
          rx: 2,
          class: "core",
        }),
      );
    }

    if (geometry.labels) {
      const source = sourceDelta[index];
      if (source > 0) {
        const w = Math.max(
          2,
          geometry.sourceColumn * (Math.log10(source) / Math.log10(maxSource)),
        );
        g.append(
          svgEl("rect", {
            x: sourceX,
            y: row.mid - 3,
            width: w,
            height: 6,
            rx: 1,
            class: "source",
          }),
        );
      }
      g.append(
        svgEl(
          "text",
          { x: labelX, y: row.mid - 3, class: "title" },
          view.title,
        ),
      );
      g.append(
        svgEl(
          "text",
          { x: labelX, y: row.mid + 11, class: "size" },
          sizes[index],
        ),
      );
    }
    if (onPick) {
      g.addEventListener("mouseenter", () => onPick(index, "hover"));
      g.addEventListener("focus", () => onPick(index, "hover"));
      g.addEventListener("click", () => onPick(index, "click"));
    }
    rowLayer.append(g);
    return g;
  });
  svg.append(rowLayer);
  if (onPick) {
    svg.addEventListener("mouseleave", () => onPick(null, "leave"));
  }

  // The line a trace draws: down the axis through every hop, over the
  // arcs that carry it.
  const traceLine = svgEl("polyline", { class: "trace-line", points: "" });
  svg.append(traceLine);

  const indexOf = new Map(views.map((view, index) => [view.id, index]));

  // Highlight one floor, the arc from its builder and the floors it used.
  function setFocus(index) {
    svg.classList.toggle("focused", index !== null);
    const related = new Set();
    if (index !== null) {
      for (const { id } of views[index].using) {
        related.add(indexOf.get(id));
      }
    }
    rowNodes.forEach((g, i) => {
      g.classList.toggle("focus", i === index);
      g.classList.toggle(
        "builder",
        index !== null &&
          views[index].builtBy !== null &&
          i === indexOf.get(views[index].builtBy),
      );
      g.classList.toggle("related", related.has(i));
    });
    arcNodes.forEach(({ to, path }) =>
      path.classList.toggle("focus", to === index),
    );
  }

  // Draw a trace: its floors lit, its built-by arcs lit, a line through.
  function setTrace(floorIds) {
    const hops = new Set(
      (floorIds ?? [])
        .map((id) => indexOf.get(id))
        .filter((i) => i !== undefined),
    );
    svg.classList.toggle("tracing", hops.size > 0);
    rowNodes.forEach((g, i) => g.classList.toggle("hop", hops.has(i)));
    arcNodes.forEach(({ from, to, path }) =>
      path.classList.toggle("hop", hops.has(from) && hops.has(to)),
    );
    const points = [...hops]
      .sort((a, b) => a - b)
      .map((i) => `${axis},${rows[i].mid}`);
    traceLine.setAttribute("points", points.join(" "));
  }

  return { setFocus, setTrace, rows };
}
