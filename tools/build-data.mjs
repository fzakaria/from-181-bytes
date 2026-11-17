// Turns what gen-data collected for one system into the two files the
// site reads:
//
//   chain-<system>.json  floors, every derivation in the graph, who built
//                        each one and the running totals
//   files-<system>.json  every file in the runtime closure of the last
//                        floor, for "who built you?"
//
//   node tools/build-data.mjs <system> <nixpkgs-rev> <work-dir> <out-dir>
//
// The work directory holds floors.json (nix/chain.nix), derivations.json
// (`nix derivation show -r`), path-info.json and ls/<path>.json (from
// cache.nixos.org) and closure.txt (`nix path-info -r` of the root).
import { readFileSync, writeFileSync } from "node:fs";

import { floors } from "../site/js/floors.js";
import { parseDerivations } from "./lib/derivations.js";
import { analyse, directFloors } from "./lib/chain.js";
import { listingBytes, listingFiles, capFiles } from "./lib/listing.js";

const SCHEMA = 1;

// Most files listed for one store path in files-<system>.json. The
// closure holds libstdc++'s 13,000 headers and the unpacked GCC source;
// listing those would make the file several megabytes.
const FILE_CAP = 2000;

const [system, rev, work, outDir] = process.argv.slice(2);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const basename = (path) => path.slice(path.lastIndexOf("/") + 1);

const evaluated = readJson(`${work}/floors.json`);
const graph = parseDerivations(readJson(`${work}/derivations.json`));
const pathInfo = readJson(`${work}/path-info.json`);
const listing = (path) => readJson(`${work}/ls/${basename(path)}.json`);

// Every floor's derivation, which must be in the graph the last floor
// roots.
const floorNodes = floors.map((floor) => {
  const key = basename(evaluated.floors[floor.attr].drvPath);
  if (!graph.has(key)) {
    throw new Error(
      `floor ${floor.id} (${key}) is not in the graph of the last floor`,
    );
  }
  return {
    id: floor.id,
    role: floor.role,
    ambient: floor.ambient ?? false,
    key,
  };
});

// Sizes. bytes is file content from the cache's listing; nar is the NAR
// size the cache reports. Every output has to be in the cache: a missing
// one would quietly shrink the totals.
const sizeOf = (path) => {
  const info = pathInfo[path];
  if (!info) {
    throw new Error(`${path} is not on cache.nixos.org`);
  }
  return { bytes: listingBytes(listing(path)), nar: info.narSize };
};
for (const node of graph.values()) {
  node.bytes = 0;
  node.nar = 0;
  for (const path of Object.values(node.outputs)) {
    const size = sizeOf(path);
    node.bytes += size.bytes;
    node.nar += size.nar;
  }
}

const { builtBy, compiled, cumulative } = analyse(
  graph,
  floorNodes,
  (node) => node.bytes,
);

// Nodes in a stable order: by name, then by key for the many
// derivations that share one (libc.a, crt, ...).
const ordered = [...graph.values()].sort(
  (a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
);
const indexOf = new Map(ordered.map((node, index) => [node.key, index]));
const floorKeys = new Set(floorNodes.map((floor) => floor.key));
const floorIdOf = new Map(floorNodes.map((floor) => [floor.key, floor.id]));

const nodes = ordered.map((node) => {
  const by = builtBy.get(node.key);
  return {
    name: node.name,
    drv: node.key,
    outputs: node.outputs,
    kind: node.kind,
    bytes: node.bytes,
    nar: node.nar,
    builtBy: by?.floor ?? null,
    via: (by?.via ?? []).map((key) => indexOf.get(key)),
  };
});

const floorData = floorNodes.map((floor) => {
  const by = builtBy.get(floor.key);
  return {
    id: floor.id,
    node: indexOf.get(floor.key),
    builtBy: by?.floor ?? null,
    // The floors this one's build used directly, in build order.
    using: floorNodes
      .filter(({ key }) => directFloors(graph, floor.key, floorKeys).has(key))
      .map(({ id }) => id),
    compiled: compiled.get(floor.id).map((key) => indexOf.get(key)),
    cumulative: cumulative.get(floor.id),
  };
});

const root = floorData.at(-1);
const chain = {
  schema: SCHEMA,
  nixpkgs: { rev },
  system,
  stage0Arch: evaluated.stage0Arch,
  floors: floorData,
  nodes,
  totals: root.cumulative,
};
writeFileSync(`${outDir}/chain-${system}.json`, `${JSON.stringify(chain)}\n`);

// The files of the root's runtime closure, each store path tied to the
// node that built it.
const nodeOfPath = new Map();
for (const node of graph.values()) {
  for (const path of Object.values(node.outputs)) {
    nodeOfPath.set(path, indexOf.get(node.key));
  }
}
const closurePaths = readFileSync(`${work}/closure.txt`, "utf8")
  .split("\n")
  .filter(Boolean);
const files = {
  schema: SCHEMA,
  nixpkgs: { rev },
  system,
  paths: closurePaths.sort().map((path) => {
    if (!nodeOfPath.has(path)) {
      throw new Error(
        `${path} is in the closure but no derivation in the graph built it`,
      );
    }
    const all = listingFiles(listing(path));
    const { files: kept, omitted } = capFiles(all, FILE_CAP);
    return {
      path,
      node: nodeOfPath.get(path),
      count: all.length,
      omitted,
      files: kept,
    };
  }),
};
writeFileSync(`${outDir}/files-${system}.json`, `${JSON.stringify(files)}\n`);

console.log(
  `${system}: ${floorData.length} floors, ${nodes.length} derivations, ` +
    `${root.cumulative.built} bytes built, ${closurePaths.length} paths in the closure`,
);
