// Draws the chain picture into an <svg> from tower.js's geometry, and
// outlines a stage and the stage that built it. No library: the chain is
// a spine with one builder per stage, so an arc diagram along a tower
// needs no graph layout.

import {
  towerLayout,
  eraSpans,
  towerGeometry,
  byteMapLayout,
  WIDE,
} from "./tower.js";
import { humanBytes } from "./format.js";
import { ERAS } from "./stages.js";

const ERA_LABEL = new Map(ERAS.map((era) => [era.id, era.label]));

const SVG_NS = "http://www.w3.org/2000/svg";

// The share of a row's height its bar fills, and the share of the seed
// row its byte map fills.
const BAR_FILL = 0.64;
const SEED_FILL = 0.8;

// The source tick: its height, and its narrowest width so the smallest
// fetch still shows.
const SOURCE_TICK_HEIGHT = 6;
const MIN_SOURCE_TICK = 2;

// Where the title and size line sit relative to a row's middle, and on
// a narrow tower, where the milestone line under them sits.
const TITLE_DY = -3;
const SIZE_DY = 11;
const STACKED_TITLE_DY = -8;
const STACKED_SIZE_DY = 5;
const STACKED_MILESTONE_DY = 17;

// A stage's bar is its texture: one slice per entropy level in the
// stage's data, over a faint base so zero-filled slices still show the
// bar's width. A slice's opacity is its level over the top level, raised
// to TEXTURE_GAMMA so the many mid levels spread apart.
const TEXTURE_BASE_OPACITY = 0.16;
const TEXTURE_TOP_LEVEL = 15;
const TEXTURE_GAMMA = 1.6;
const HEX_RADIX = 16;

// Gridlines on the bars' log axis, each marking a size a bar reaches,
// labelled in a strip below the last row, one label line per gridline
// so labels never collide on a narrow tower.
const KIB = 1024;
const GRIDLINES = Object.freeze([
  { bytes: KIB, label: "1 KiB" },
  { bytes: KIB ** 2, label: "1 MiB" },
]);
const GRID_LABEL_LINE = 12;
const GRID_STRIP = GRID_LABEL_LINE * GRIDLINES.length + 4;

// The marker drawn at the left edge of a pinned row.
const PIN_MARK_WIDTH = 3;

// Keys that pin or unpin the focused row.
const PIN_KEYS = new Set(["Enter", " "]);

// Pointer types that hover. A touch has no hover: a tap is a click.
const HOVERING_POINTERS = new Set(["mouse", "pen"]);

// The seed's byte map: below this cell size the map is a smudge and the
// seed is drawn as a plain bar. Each cell leaves a gap of CELL_GAP of its
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

// The lines under a stage's title: { size, milestone }. On a wide tower
// the milestone rides on the size line; on a narrow one it gets its own
// line, so the label column stays narrow.
function labelLines(view, index, trustBytes, width) {
  const produced =
    index === 0 ? `${trustBytes} B trusted` : `${humanBytes(view.bytes)} out`;
  if (!view.milestone) {
    return { size: produced, milestone: null };
  }
  if (width < WIDE) {
    return { size: produced, milestone: view.milestone };
  }
  return { size: `${produced} · ${view.milestone}`, milestone: null };
}

// A bar drawn from its stage's texture: the slices side by side across
// the bar, over a faint base the bar's full width. With no texture, the
// base alone.
function textureNodes(texture, { x, y, width, height }) {
  const nodes = [
    svgEl("rect", {
      x,
      y,
      width,
      height,
      rx: 2,
      "fill-opacity": TEXTURE_BASE_OPACITY,
      class: "bar",
    }),
  ];
  const levels = texture?.levels ?? "";
  const step = width / Math.max(1, levels.length);
  [...levels].forEach((digit, i) => {
    const share = parseInt(digit, HEX_RADIX) / TEXTURE_TOP_LEVEL;
    nodes.push(
      svgEl("rect", {
        x: x + i * step,
        y,
        width: step,
        height,
        "fill-opacity": share ** TEXTURE_GAMMA,
        class: "slice",
      }),
    );
  });
  return nodes;
}

// The seed drawn as what it is: one cell per byte, filled row by row in
// the seed's era colour, darker for larger values, over a pale frame.
// Returns null when the cells would be too small to see, and the caller
// draws a plain bar.
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
      class: "seed-frame",
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
// stage i, `seedBytes` the seed itself for the seed row's byte map.
// onHover(index or null) is called as a mouse enters a row or leaves the
// tower, onToggle(index) when a row is clicked or Enter or Space is
// pressed on it. Returns { setFocus, setPinned, rows }; both setters take
// a stage index or null.
export function drawTower(
  svg,
  views,
  { trustBytes, seedBytes = null, sourceDelta, onHover, onToggle },
) {
  // The svg fills its figure's content box.
  const parent = svg.parentElement;
  const style = getComputedStyle(parent);
  const width = Math.floor(
    parent.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight),
  );
  svg.replaceChildren();

  // The label column is as wide as the widest title or line under it.
  const lines = views.map((view, index) =>
    labelLines(view, index, trustBytes, width),
  );
  const labelWidth = Math.ceil(
    Math.max(
      widestText(
        svg,
        views.map((view) => view.title),
        "title",
      ),
      widestText(
        svg,
        lines.map(({ size }) => size),
        "size",
      ),
      widestText(
        svg,
        lines.map(({ milestone }) => milestone ?? ""),
        "milestone",
      ),
    ),
  );
  const geometry = towerGeometry(width, { labelWidth });
  const { rows, arcs, height, widthOf } = towerLayout(views, {
    trustBytes,
    ...geometry,
  });
  const axis = geometry.arcSpace + geometry.maxBand / 2;
  const { sourceX, labelX } = geometry;
  const maxSource = Math.max(1, ...sourceDelta);

  const svgHeight = height + GRID_STRIP;
  svg.setAttribute("viewBox", `0 0 ${width} ${svgHeight}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", svgHeight);

  // Era bands behind everything, labelled at their top left.
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
      svgEl(
        "text",
        { x: 4, y: y + 12, class: `era-label era-text-${span.era}` },
        ERA_LABEL.get(span.era),
      ),
    );
  }
  svg.append(eras);

  // Gridlines: for each size, a pair of lines where a bar that size would
  // end on either side of the axis, from below the seed to the strip
  // under the last row. The right line of each pair is labelled there,
  // each label on its own line.
  const grid = svgEl("g", { class: "grid" });
  GRIDLINES.forEach(({ bytes, label }, i) => {
    const half = widthOf(bytes) / 2;
    for (const x of [axis - half, axis + half]) {
      grid.append(
        svgEl("line", {
          x1: x,
          y1: rows[1].y,
          x2: x,
          y2: height,
          class: "gridline",
        }),
      );
    }
    grid.append(
      svgEl(
        "text",
        {
          x: axis + half,
          y: height + GRID_LABEL_LINE * (i + 1),
          class: "grid-label",
        },
        label,
      ),
    );
  });
  svg.append(grid);

  // Built-by arcs, from the builder's row down to the stage it built,
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
    return { to, path };
  });
  svg.append(arcLayer);

  // One row per stage: a connector from the arcs to the bar, the bar
  // (this stage's output), the source fetched here, and the label.
  const rowLayer = svgEl("g", { class: "rows" });
  const rowNodes = rows.map((row, index) => {
    const view = views[index];
    const g = svgEl("g", {
      class: `row era-${view.era}${index === 0 ? " seed" : ""}`,
      "data-index": index,
      "data-stage": view.id,
      role: "button",
      "aria-pressed": "false",
      "aria-label": view.title,
      tabindex: 0,
    });
    const barHeight = row.height * BAR_FILL;

    g.append(
      svgEl("rect", {
        x: 0,
        y: row.y,
        width,
        height: row.height,
        class: "hit",
      }),
      svgEl("line", {
        x1: geometry.arcSpace,
        y1: row.mid,
        x2: axis - row.bar / 2,
        y2: row.mid,
        class: "connector",
      }),
    );

    // The seed row is its bytes, when they are known and fit; every other
    // row is one bar.
    const byteNodes =
      index === 0 && seedBytes
        ? seedBytesNodes(seedBytes, {
            axis,
            mid: row.mid,
            width: row.bar,
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
      const box = {
        x: axis - row.bar / 2,
        y: row.mid - barHeight / 2,
        width: row.bar,
        height: barHeight,
      };
      g.append(
        ...textureNodes(view.texture, box),
        svgEl("rect", { ...box, rx: 2, class: "outline" }),
      );
    }

    // The source tick, log-scaled to the most source any stage fetched.
    const source = sourceDelta[index];
    if (source > 0) {
      const w = Math.max(
        MIN_SOURCE_TICK,
        geometry.sourceColumn * (Math.log10(source) / Math.log10(maxSource)),
      );
      g.append(
        svgEl("rect", {
          x: sourceX,
          y: row.mid - SOURCE_TICK_HEIGHT / 2,
          width: w,
          height: SOURCE_TICK_HEIGHT,
          rx: 1,
          class: "source",
        }),
      );
    }

    // The label: the stage's name over its size line, and on a narrow
    // tower its milestone under that.
    const { size, milestone } = lines[index];
    g.append(
      svgEl(
        "text",
        {
          x: labelX,
          y: row.mid + (milestone ? STACKED_TITLE_DY : TITLE_DY),
          class: "title",
        },
        view.title,
      ),
      svgEl(
        "text",
        {
          x: labelX,
          y: row.mid + (milestone ? STACKED_SIZE_DY : SIZE_DY),
          class: "size",
        },
        size,
      ),
    );
    if (milestone) {
      g.append(
        svgEl(
          "text",
          { x: labelX, y: row.mid + STACKED_MILESTONE_DY, class: "milestone" },
          milestone,
        ),
      );
    }

    // The marker a pinned row shows at its left edge.
    g.append(
      svgEl("rect", {
        x: 0,
        y: row.y,
        width: PIN_MARK_WIDTH,
        height: row.height,
        class: "pin-mark",
      }),
    );

    // A mouse previews the row; a click, Enter or Space pins it.
    g.addEventListener("pointerenter", (event) => {
      if (HOVERING_POINTERS.has(event.pointerType)) {
        onHover(index);
      }
    });
    g.addEventListener("click", () => onToggle(index));
    g.addEventListener("keydown", (event) => {
      if (!PIN_KEYS.has(event.key)) {
        return;
      }
      event.preventDefault();
      onToggle(index);
    });
    rowLayer.append(g);
    return g;
  });
  svg.append(rowLayer);
  // The svg outlives redraws, so its one leave handler is assigned, not
  // added.
  svg.onpointerleave = () => onHover(null);

  const indexOf = new Map(views.map((view, index) => [view.id, index]));

  // Outline one stage and the stage that built it, and tint the arc
  // between them.
  function setFocus(index) {
    const builder =
      index === null || views[index].builtBy === null
        ? null
        : indexOf.get(views[index].builtBy);
    rowNodes.forEach((g, i) => {
      g.classList.toggle("focus", i === index);
      g.classList.toggle("builder", i === builder);
    });
    arcNodes.forEach(({ to, path }) =>
      path.classList.toggle("focus", to === index),
    );
  }

  // Mark the pinned row, or none.
  function setPinned(index) {
    rowNodes.forEach((g, i) => {
      g.classList.toggle("pinned", i === index);
      g.setAttribute("aria-pressed", String(i === index));
    });
  }

  return { setFocus, setPinned, rows };
}
