// "Who built you?": pick a file from the last floor's runtime closure and
// walk from the derivation that produced it down to the seed.

import { el } from "./dom.js";
import { humanBytes } from "./format.js";
import { trace } from "./trace.js";
import { filterFiles } from "./view.js";
import { drawTower } from "./tower-view.js";

// How many matching files the list shows at once.
const FILE_LIMIT = 300;

// The file the section opens on: GCC's driver, if the closure has it.
const DEFAULT_FILE = "bin/gcc";

const storeName = (path) => path.slice("/nix/store/".length + 33);

function hopItem(chain, titleOf, hop, index) {
  const node = chain.nodes[hop.node];
  const name = hop.floor ? titleOf.get(hop.floor) : node.name;
  const lead = index === 0 ? "produced by" : "built by";
  const via = hop.via.map((i) => chain.nodes[i].name);

  return el(
    "li",
    {},
    el(
      "div",
      {},
      `${lead} `,
      hop.floor
        ? el("a", { href: `#floor-${hop.floor}` }, name)
        : el("strong", {}, name),
      el("span", { class: "muted" }, ` (${humanBytes(node.bytes)})`),
    ),
    via.length
      ? el("div", { class: "via muted" }, `by way of ${via.join(" → ")}`)
      : null,
    node.builtBy === null
      ? el(
          "div",
          { class: "via muted" },
          "Nothing on this page built this one. It is fetched and checked by hash.",
        )
      : null,
  );
}

// renderWho draws the trace three ways: as a list, on a compact copy of
// the tower beside it, and on the main tower through `onTrace`.
export function renderWho(
  chain,
  files,
  titleOf,
  { views, trustBytes, onTrace },
) {
  const select = document.getElementById("who-path");
  const filter = document.getElementById("who-filter");
  const list = document.getElementById("who-list");
  const more = document.getElementById("who-more");
  const out = document.getElementById("who-trace");
  const svg = document.getElementById("who-tower");
  let mini = null;
  let lastTrace = null;

  // The compact tower is redrawn when its column changes width.
  const drawMini = () => {
    mini = drawTower(svg, views, {
      trustBytes,
      sourceDelta: views.map(() => 0),
      compact: true,
    });
    mini.setTrace(lastTrace);
  };
  new ResizeObserver(drawMini).observe(svg.parentElement);

  // The derivation's own name, then the output path's name when it adds
  // an output suffix.
  select.replaceChildren(
    ...files.paths.map((entry, i) =>
      el(
        "option",
        { value: i },
        `${storeName(entry.path)} (${entry.count} files)`,
      ),
    ),
  );

  // Show a file's trace. The main picture only carries it once the
  // reader picked a file, so the climb opens clean.
  function show(entry, file, picked) {
    const hops = trace(chain, entry.node);
    lastTrace = hops.map((hop) => hop.floor).filter(Boolean);
    mini?.setTrace(lastTrace);
    onTrace(picked ? lastTrace : null);
    out.replaceChildren(
      el(
        "li",
        {},
        el("strong", {}, file[0] === "" ? storeName(entry.path) : file[0]),
        el(
          "div",
          { class: "via muted" },
          el("code", {}, `${entry.path}${file[0] ? `/${file[0]}` : ""}`),
        ),
      ),
      ...hops.map((hop, i) => hopItem(chain, titleOf, hop, i)),
    );
    if (picked) {
      out.append(
        el(
          "li",
          { class: "trace-actions" },
          el(
            "button",
            {
              onclick: () => document.getElementById("tower").scrollIntoView(),
            },
            "see it on the climb",
          ),
          " ",
          el(
            "button",
            { onclick: () => onTrace(null) },
            "clear it from the climb",
          ),
        ),
      );
    }
  }

  function list_(entry) {
    const { shown, total } = filterFiles(entry.files, filter.value, FILE_LIMIT);
    list.replaceChildren(
      ...shown.map((file) =>
        el(
          "li",
          {},
          el(
            "button",
            {
              onclick: (event) => {
                list.querySelector(".active")?.classList.remove("active");
                event.currentTarget.classList.add("active");
                show(entry, file, true);
              },
            },
            el(
              "span",
              { class: "path" },
              file[0] === "" ? "(the store path is one file)" : file[0],
            ),
            el(
              "span",
              { class: "size" },
              file[1] === null ? `→ ${file[2]}` : humanBytes(file[1]),
            ),
          ),
        ),
      ),
    );
    const parts = [];
    if (total > shown.length) {
      parts.push(`${shown.length} of ${total} shown; filter to narrow.`);
    }
    if (entry.omitted > 0) {
      parts.push(
        entry.files.length === 0
          ? `${entry.omitted} files, not listed here; the path is traced as a whole.`
          : `${entry.omitted} files under include/ and share/ are not listed.`,
      );
    }
    more.textContent = parts.join(" ");
  }

  const current = () => files.paths[Number(select.value)];
  select.onchange = () => {
    list_(current());
    show(current(), current().files[0] ?? [""], true);
  };
  filter.oninput = () => list_(current());

  // Open on gcc's driver where it exists, else the first path.
  const start = files.paths.findIndex((entry) =>
    entry.files.some(([path]) => path === DEFAULT_FILE),
  );
  select.value = String(Math.max(start, 0));
  list_(current());
  show(
    current(),
    current().files.find(([path]) => path === DEFAULT_FILE) ??
      current().files[0] ?? [""],
    false,
  );
}
