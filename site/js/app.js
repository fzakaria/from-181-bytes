// Entry point: load the seed, its hex0 source and the chain, then render
// the seed explorer, the climb and the footer. A fragment naming a stage
// (#stage-gcc46) opens the climb with that stage pinned.

import { stages } from "./stages.js";
import { stageViews } from "./view.js";
import { renderSeed } from "./seed-view.js";
import { renderClimb } from "./climb-view.js";

// The data the page fetches. nix/site.nix rewrites these two names, and
// the seed index's `files`, to content-hashed ones, so a browser holding
// one deploy's page never fetches another deploy's data.
const DATA = "data";
const SEED_INDEX = "seeds/index.json";
const CHAIN = "chain.json";
const SEEDS = "seeds";
const NIXPKGS_COMMIT_URL = "https://github.com/NixOS/nixpkgs/commit/";
const SHORT_REV = 7;

// nix/site.nix fills these in at build time; served straight from the
// checkout they are still placeholders, and the footer leaves them out.
const PLACEHOLDER_PREFIX = "__";

const fetchJson = async (path) => (await fetch(`${DATA}/${path}`)).json();
const fetchBytes = async (path) =>
  new Uint8Array(await (await fetch(`${DATA}/${path}`)).arrayBuffer());
const fetchText = async (path) => (await fetch(`${DATA}/${path}`)).text();

const { seed: entry } = await fetchJson(SEED_INDEX);
const [seed, source, chain] = await Promise.all([
  fetchBytes(`${SEEDS}/${entry.files.binary}`),
  fetchText(`${SEEDS}/${entry.files.source}`),
  fetchJson(CHAIN),
]);

// The seed explorer, and where the seed comes from.
renderSeed({ seed, source, arch: entry });
document.getElementById("seed-provenance").replaceChildren(
  "Fetched by nixpkgs from ",
  Object.assign(document.createElement("a"), {
    href: entry.url,
    textContent: "bootstrap-seeds",
  }),
  `, checked against ${entry.hash}. stage0-posix ${entry.stage0Version}.`,
);

// The climb.
renderClimb(stageViews(stages, chain), {
  trustBytes: entry.size,
  seedBytes: seed,
  handoff: chain.handoff,
});

// The footer: the nixpkgs commit the data describes, and what nix build
// filled in.
const rev = document.getElementById("footer-rev");
rev.textContent = chain.nixpkgs.rev.slice(0, SHORT_REV);
rev.href = NIXPKGS_COMMIT_URL + chain.nixpkgs.rev;
for (const id of ["footer-date", "store"]) {
  const node = document.getElementById(id);
  if (node.textContent.includes(PLACEHOLDER_PREFIX)) {
    node.hidden = true;
  }
}
