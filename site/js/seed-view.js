// The seed explorer: every byte of the seed in a grid beside the hex0
// source that produces it. The mapping is computed here, in the browser,
// by assembling the source with site/js/hex0.js and comparing the result
// with the seed's bytes.

import {
  assemble,
  describeLine,
  headings,
  expandTabs,
  lineStops,
  lineSegments,
  hangColumn,
  tokenizeSegment,
  Token,
} from "./hex0.js";
import { el } from "./dom.js";

const HEX_RADIX = 16;
const hex2 = (n) => n.toString(HEX_RADIX).toUpperCase().padStart(2, "0");

// The listing wraps instead of scrolling sideways. A wrapped line hangs
// from the rightmost of its columns that leaves COMMENT_ROOM columns for
// the rest, so a comment wraps under itself when there is room and under
// the hex when there is not. A mnemonic or comment that starts right of
// the hang column moves to a new row whole rather than splitting after
// its marker. The line numbers sit in a gutter of GUTTER_PAD columns more
// than the widest number.
const COMMENT_ROOM = 24;
const GUTTER_PAD = 2;
const PROBE_TEXT = "0".repeat(100);

// A segment's words as highlighted tokens: plain text stays a text node,
// every other kind is a span the stylesheet colours by its class.
function highlighted(words) {
  return tokenizeSegment(words).map(({ kind, text }) =>
    kind === Token.PLAIN ? text : el("span", { class: `tok-${kind}` }, text),
  );
}

// Whether selecting a byte may scroll the source pane to its line. A
// byte picked in the grid may; a line picked in the pane is already
// under the pointer, and scrolling would slide another line under it.
const PaneScroll = Object.freeze({
  IF_HIDDEN: "if-hidden",
  NEVER: "never",
});

// One observer for the listing pane; it re-hangs whichever source is
// shown when the pane changes width.
let rehang = () => {};
let paneObserver = null;

// The width of one character of the listing's font, in pixels.
function charWidth(pre) {
  const probe = el(
    "span",
    { class: "probe", "aria-hidden": "true" },
    PROBE_TEXT,
  );
  pre.append(probe);
  const width = probe.getBoundingClientRect().width / PROBE_TEXT.length;
  probe.remove();
  return width;
}

// Render one architecture's seed. `seed` is a Uint8Array, `source` the
// text of hex0_<arch>.hex0, `arch` its seeds/index.json entry.
export function renderSeed({ seed, source, arch }) {
  const grid = document.getElementById("seed-grid");
  const pre = document.getElementById("seed-source");
  const info = document.getElementById("byte-info");
  const check = document.getElementById("seed-check");

  const text = source.split("\n");
  const { bytes: assembled, lines } = assemble(source);
  const heading = headings(text);

  // The check the page stands on: does the source reproduce the seed?
  let matching = 0;
  for (let i = 0; i < Math.min(seed.length, assembled.length); i += 1) {
    if (seed[i] === assembled[i]) {
      matching += 1;
    }
  }
  const reproduces =
    matching === seed.length && assembled.length === seed.length;
  check.className = `check ${reproduces ? "ok" : "bad"}`;
  check.textContent = reproduces
    ? `Assembled in your browser from ${arch.source}: all ${seed.length} bytes match the seed.`
    : `Assembled ${arch.source} to ${assembled.length} bytes; ${matching} of the seed's ${seed.length} match.`;

  // Which bytes each source line produced, for highlighting both ways.
  const bytesOfLine = new Map();
  lines.forEach((line, offset) => {
    if (!bytesOfLine.has(line)) {
      bytesOfLine.set(line, []);
    }
    bytesOfLine.get(line).push(offset);
  });

  // Alternate two tints whenever the heading changes, so the ELF header,
  // the program header and each labelled block of code read as groups.
  let tint = 0;
  let previousHeading = null;
  const buttons = [...seed].map((value, offset) => {
    const line = lines[offset];
    if (heading[line] !== previousHeading) {
      tint = 1 - tint;
      previousHeading = heading[line];
    }
    return el(
      "button",
      {
        class: tint ? "tint-a" : "tint-b",
        "aria-label": `byte ${offset}: ${hex2(value)}`,
        "data-line": line,
        onmouseenter: () => select(offset, PaneScroll.IF_HIDDEN),
        onfocus: () => select(offset, PaneScroll.IF_HIDDEN),
        onclick: () => select(offset, PaneScroll.IF_HIDDEN),
      },
      hex2(value),
    );
  });
  grid.replaceChildren(...buttons);

  // One block per source line: its number in the gutter, then the line
  // with tabs expanded so its columns can be counted, as highlighted
  // segments with the spaces after each kept outside it.
  const expanded = text.map(expandTabs);
  const segmentsOf = expanded.map((content) =>
    lineSegments(content).map(({ start, text: piece }) => {
      const words = piece.trimEnd();
      return {
        start,
        node: el("span", { class: "seg" }, highlighted(words)),
        gap: piece.slice(words.length),
      };
    }),
  );
  const lineNodes = segmentsOf.map((segments, index) => {
    const produced = bytesOfLine.has(index);
    return el(
      "span",
      {
        class: produced ? "line code" : "line",
        onmouseenter: produced
          ? () => select(bytesOfLine.get(index)[0], PaneScroll.NEVER)
          : null,
        onclick: produced
          ? () => select(bytesOfLine.get(index)[0], PaneScroll.NEVER)
          : null,
      },
      el("span", { class: "num" }, String(index + 1)),
      segments.flatMap(({ node, gap }) => [node, gap || null]),
    );
  });
  pre.replaceChildren(...lineNodes);
  const gutter = String(text.length).length + GUTTER_PAD;
  pre.style.setProperty("--gutter", String(gutter));

  // Hang each line for the pane's current width, now and on every resize.
  const stops = expanded.map(lineStops);
  rehang = () => {
    const padding = parseFloat(getComputedStyle(lineNodes[0]).paddingRight);
    const columns =
      Math.floor((pre.clientWidth - 2 * padding) / charWidth(pre)) - gutter;
    lineNodes.forEach((node, index) => {
      const hang = hangColumn(stops[index], columns, COMMENT_ROOM);
      node.style.setProperty("--hang", String(hang));
      for (const segment of segmentsOf[index]) {
        segment.node.classList.toggle("whole", segment.start > hang);
      }
    });
  };
  rehang();
  if (!paneObserver) {
    paneObserver = new ResizeObserver(() => rehang());
    paneObserver.observe(pre);
  }

  let hot = [];
  let hotLine = null;

  // While the reader scrolls the pane themselves, by wheel, touch or the
  // scrollbar, the page leaves the pane alone until the pointer is back
  // on the grid. Handlers are assigned, not added, so a second render
  // replaces them.
  let readerScrolling = false;
  const readerScrolls = () => {
    readerScrolling = true;
  };
  pre.onwheel = readerScrolls;
  pre.ontouchstart = readerScrolls;
  pre.onpointerdown = readerScrolls;
  grid.onpointerenter = () => {
    readerScrolling = false;
  };

  // Bring a line into the pane with one instant move, centred, and only
  // when it is not already wholly in view. The page never moves.
  function reveal(lineNode) {
    if (readerScrolling) {
      return;
    }
    const top = lineNode.offsetTop;
    const bottom = top + lineNode.offsetHeight;
    const viewTop = pre.scrollTop;
    const viewBottom = viewTop + pre.clientHeight;
    if (top >= viewTop && bottom <= viewBottom) {
      return;
    }
    pre.scrollTop = top - (pre.clientHeight - lineNode.offsetHeight) / 2;
  }

  // Highlight a byte, the other bytes from its line and the line itself,
  // and describe it.
  function select(offset, paneScroll) {
    const line = lines[offset];
    for (const index of hot) {
      buttons[index].classList.remove("same-line", "active");
    }
    hotLine?.classList.remove("hot");

    hot = bytesOfLine.get(line) ?? [];
    for (const index of hot) {
      buttons[index].classList.add("same-line");
    }
    buttons[offset].classList.add("active");
    hotLine = lineNodes[line];
    hotLine.classList.add("hot");

    if (paneScroll === PaneScroll.IF_HIDDEN) {
      reveal(hotLine);
    }

    const parts = describeLine(text[line]);
    const value = seed[offset];
    info.replaceChildren(
      el(
        "dl",
        {},
        el("dt", {}, "offset"),
        el("dd", {}, `${offset} (0x${hex2(offset)})`),
        el("dt", {}, "byte"),
        el("dd", {}, `0x${hex2(value)} = ${value}`),
        el("dt", {}, "line"),
        el("dd", {}, `${line + 1} of ${arch.source}`),
        el("dt", {}, "source"),
        el("dd", {}, el("code", {}, parts.hex)),
        parts.mnemonic
          ? [
              el("dt", {}, "instruction"),
              el("dd", {}, el("code", {}, parts.mnemonic)),
            ]
          : null,
        parts.comment
          ? [el("dt", {}, "comment"), el("dd", {}, parts.comment)]
          : null,
        heading[line]
          ? [el("dt", {}, "under"), el("dd", {}, heading[line])]
          : null,
      ),
    );
  }

  select(0, PaneScroll.IF_HIDDEN);
}
