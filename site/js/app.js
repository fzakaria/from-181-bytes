// Entry point: load the data for the chosen architecture and system and
// render the three sections. The URL query keeps the choice:
// ?system=x86_64-linux&arch=AArch64.

import { floors, fill } from "./floors.js";
import { tabs } from "./dom.js";
import { floorViews } from "./view.js";
import { renderSeed } from "./seed-view.js";
import { renderClimb } from "./climb-view.js";
import { renderWho } from "./who-view.js";

const DATA = "data";

// The systems that have a chain, and the seed each starts from.
const SYSTEMS = [
  { value: "i686-linux", arch: "x86" },
  { value: "x86_64-linux", arch: "AMD64" },
];
const DEFAULT_SYSTEM = SYSTEMS[0].value;

const fetchJson = async (path) => (await fetch(`${DATA}/${path}`)).json();
const params = new URLSearchParams(location.search);

function remember(name, value) {
  params.set(name, value);
  history.replaceState(null, "", `?${params}${location.hash}`);
}

const seedIndex = await fetchJson("seeds/index.json");
const archByName = new Map(seedIndex.arches.map((arch) => [arch.name, arch]));

// The seed explorer.
const markArch = tabs(
  document.getElementById("arch-tabs"),
  seedIndex.arches.map((arch) => ({
    value: arch.name,
    label: `${arch.name} · ${arch.size} B`,
  })),
  (name) => showSeed(name),
);

async function showSeed(name) {
  const arch = archByName.get(name);
  markArch(name);
  remember("arch", name);
  const [seed, source] = await Promise.all([
    fetch(`${DATA}/seeds/${name}.bin`).then((r) => r.arrayBuffer()),
    fetch(`${DATA}/seeds/${arch.source}`).then((r) => r.text()),
  ]);
  renderSeed({ seed: new Uint8Array(seed), source, arch });
  document.getElementById("seed-provenance").replaceChildren(
    `${name}: fetched by nixpkgs from `,
    Object.assign(document.createElement("a"), {
      href: arch.url,
      textContent: "bootstrap-seeds",
    }),
    ` and checked against ${arch.hash}. stage0-posix ${arch.stage0Version}.`,
  );
}

// The climb and the trace, for one system.
let climb = null;
const markSystem = tabs(
  document.getElementById("system-tabs"),
  SYSTEMS.map(({ value, arch }) => ({
    value,
    label: `${value} · ${archByName.get(arch).size} B seed`,
  })),
  (system) => showSystem(system),
);

async function showSystem(system) {
  const { arch } = SYSTEMS.find(({ value }) => value === system);
  markSystem(system);
  remember("system", system);

  const [chain, files, seed] = await Promise.all([
    fetchJson(`chain-${system}.json`),
    fetchJson(`files-${system}.json`),
    fetch(`${DATA}/seeds/${arch}.bin`).then((r) => r.arrayBuffer()),
  ]);
  const views = floorViews(floors, chain);
  const trustBytes = archByName.get(arch).size;
  const seedBytes = new Uint8Array(seed);

  document.getElementById("intro-system").textContent = system;
  document.getElementById("intro-size").textContent = String(trustBytes);
  const rev = document.getElementById("footer-rev");
  rev.textContent = chain.nixpkgs.rev.slice(0, 12);
  rev.href = `https://github.com/NixOS/nixpkgs/tree/${chain.nixpkgs.rev}`;

  climb?.stop();
  climb = renderClimb(views, { trustBytes, seedBytes });
  renderWho(
    chain,
    files,
    new Map(floors.map((floor) => [floor.id, fill(floor.title, system)])),
    {
      views,
      trustBytes,
      seedBytes,
      onTrace: (floorIds) => climb.setTrace(floorIds),
    },
  );
}

const system = SYSTEMS.some(({ value }) => value === params.get("system"))
  ? params.get("system")
  : DEFAULT_SYSTEM;
const arch = archByName.has(params.get("arch"))
  ? params.get("arch")
  : SYSTEMS.find(({ value }) => value === system).arch;

await Promise.all([showSeed(arch), showSystem(system)]);

// A link to a floor anywhere on the page (the card, the trace) scrolls
// the picture to that floor's row rather than to an element.
document.addEventListener("click", (event) => {
  const link = event.target.closest?.('a[href^="#floor-"]');
  if (!link) {
    return;
  }
  const index = floors.findIndex(
    (floor) => `#floor-${floor.id}` === link.getAttribute("href"),
  );
  if (index < 0) {
    return;
  }
  event.preventDefault();
  climb.jumpTo(index);
});

// A floor named in the hash (#floor-gcc46) is a row of the picture; a
// section is an element. Both exist only once rendered.
const target = location.hash.slice(1);
const floorIndex = floors.findIndex((floor) => `floor-${floor.id}` === target);
if (floorIndex >= 0) {
  climb.jumpTo(floorIndex);
} else if (target) {
  document.getElementById(target)?.scrollIntoView();
}
