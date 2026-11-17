// Draws the chain picture into an <svg> from tower.js's geometry, and
// highlights a floor, its builder and the floors it used, or a whole
// "who built you?" trace. No library: the chain is a spine with one
// builder per floor, so an arc diagram along a tower needs no graph
// layout.

import { towerLayout, eraSpans } from "./tower.js";
import { humanBytes } from "./format.js";
import { ERAS } from "./floors.js";

const ERA_LABEL = new Map(ERAS.map((era) => [era.id, era.label]));

const SVG_NS = "http://www.w3.org/2000/svg";

// Room on the right of the bands for the source layer, then labels.
const SOURCE_COLUMN = 34;
const LABEL_GAP = 10;
// Widths above which the labels get their own column at full size.
const WIDE = 560;

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

// Geometry for a container `width` wide. A compact tower (the one beside
// "who built you?") has short rows and no labels.
function geometryFor(width, compact) {
  if (compact) {
    return {
      rowHeight: 16,
      arcSpace: 56,
      minBand: 6,
      maxBand: Math.max(60, width - 56 - 16),
      labels: false,
    };
  }
  const arcSpace = width >= WIDE ? 96 : 52;
  const labelWidth = width >= WIDE ? 220 : 150;
  const maxBand = Math.max(
    80,
    Math.min(320, width - arcSpace - SOURCE_COLUMN - LABEL_GAP - labelWidth),
  );
  return {
    rowHeight: width >= WIDE ? 46 : 42,
    arcSpace,
    minBand: 6,
    maxBand,
    labels: true,
  };
}

// Draw `views` into `svg`. `sourceDelta[i]` is the source fetched at
// floor i. Returns { setFocus, setTrace }, both taking a floor index (or
// list of floor ids) or null.
export function drawTower(
  svg,
  views,
  { trustBytes, sourceDelta, compact = false, onPick = null },
) {
  const width = svg.parentElement.clientWidth;
  const geometry = geometryFor(width, compact);
  const { rows, arcs, height } = towerLayout(views, {
    trustBytes,
    ...geometry,
    width,
  });
  const axis = geometry.arcSpace + geometry.maxBand / 2;
  const sourceX = geometry.arcSpace + geometry.maxBand + 4;
  const labelX = sourceX + SOURCE_COLUMN + LABEL_GAP;
  const maxSource = Math.max(1, ...sourceDelta);

  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);

  // Era bands behind everything, labelled at their top right.
  const eras = svgEl("g", { class: "eras" });
  for (const span of eraSpans(views)) {
    const y = rows[span.first].y;
    const h = rows[span.last].y + geometry.rowHeight - y;
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
    const top = row.y + geometry.rowHeight * 0.18;
    const bandHeight = geometry.rowHeight * 0.64;

    g.append(
      svgEl("rect", {
        x: 0,
        y: row.y,
        width,
        height: geometry.rowHeight,
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
    g.append(
      svgEl("rect", {
        x: axis - row.band / 2,
        y: top,
        width: row.band,
        height: bandHeight,
        rx: 2,
        class: "band",
      }),
    );
    g.append(
      svgEl("rect", {
        x: axis - row.core / 2,
        y: top,
        width: row.core,
        height: bandHeight,
        rx: 2,
        class: "core",
      }),
    );

    if (geometry.labels) {
      const source = sourceDelta[index];
      if (source > 0) {
        const w = Math.max(
          2,
          SOURCE_COLUMN * (Math.log10(source) / Math.log10(maxSource)),
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
      const produced =
        index === 0
          ? `${trustBytes} B trusted`
          : `${humanBytes(view.bytes)} out`;
      // The milestone rides on the size line only where there is room;
      // on a phone the chips above the picture carry it.
      const withMilestone = view.milestone && width >= WIDE;
      g.append(
        svgEl(
          "text",
          { x: labelX, y: row.mid + 11, class: "size" },
          withMilestone ? `${produced} · ${view.milestone}` : produced,
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
