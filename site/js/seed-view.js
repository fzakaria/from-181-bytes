// The seed explorer: every byte of the seed in a grid beside the hex0
// source that produces it. The mapping is computed here, in the browser,
// by assembling the source with site/js/hex0.js and comparing the result
// with the seed's bytes.

import { assemble, describeLine, headings } from "./hex0.js";
import { el } from "./dom.js";

const HEX_RADIX = 16;
const hex2 = (n) => n.toString(HEX_RADIX).toUpperCase().padStart(2, "0");

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
        onmouseenter: () => select(offset),
        onfocus: () => select(offset),
        onclick: () => select(offset),
      },
      hex2(value),
    );
  });
  grid.replaceChildren(...buttons);

  const lineNodes = text.map((content, index) => {
    const produced = bytesOfLine.has(index);
    return el(
      "span",
      {
        class: produced ? "line code" : "line",
        onmouseenter: produced ? () => select(bytesOfLine.get(index)[0]) : null,
        onclick: produced ? () => select(bytesOfLine.get(index)[0]) : null,
      },
      el("span", { class: "num" }, String(index + 1)),
      content,
    );
  });
  pre.replaceChildren(...lineNodes);

  let hot = [];
  let hotLine = null;

  // Highlight a byte, the other bytes from its line and the line itself,
  // and describe it.
  function select(offset) {
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

    // Scroll the source pane only, never the page.
    pre.scrollTop = hotLine.offsetTop - pre.clientHeight / 2;

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

  select(0);
}
