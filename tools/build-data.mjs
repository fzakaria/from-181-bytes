// Turns what gen-data collected for one system into the file the site
// reads:
//
//   chain.json  stages, every derivation in the graph, who built each
//               one, the running totals and each stage's texture
//
//   node tools/build-data.mjs <system> <nixpkgs-rev> <work-dir> <out-dir>
//
// The work directory holds stages.json (nix/chain.nix), derivations.json
// (`nix derivation show -r`), path-info.json and ls/<path>.json (from
// cache.nixos.org), and files/<stage>.bin, each stage's largest output
// file (tools/largest-files.mjs).
import { readFileSync, writeFileSync } from "node:fs";

import { stages } from "../site/js/stages.js";
import { parseDerivations } from "./lib/derivations.js";
import { analyse, directStages } from "./lib/chain.js";
import { listingBytes, largestAcross } from "./lib/listing.js";
import { entropyStrip } from "./lib/texture.js";

const SCHEMA = 1;

const [system, rev, work, outDir] = process.argv.slice(2);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const basename = (path) => path.slice(path.lastIndexOf("/") + 1);

const evaluated = readJson(`${work}/stages.json`);
const graph = parseDerivations(readJson(`${work}/derivations.json`));
const pathInfo = readJson(`${work}/path-info.json`);
const listing = (path) => readJson(`${work}/ls/${basename(path)}.json`);

// Every stage's derivation, which must be in the graph the last stage
// roots.
const stageNodes = stages.map((stage) => {
  const key = basename(evaluated.stages[stage.attr].drvPath);
  if (!graph.has(key)) {
    throw new Error(
      `stage ${stage.id} (${key}) is not in the graph of the last stage`,
    );
  }
  return {
    id: stage.id,
    role: stage.role,
    ambient: stage.ambient ?? false,
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
  stageNodes,
  (node) => node.bytes,
);

// Nodes in a stable order: by name, then by key for the many
// derivations that share one (libc.a, crt, ...).
const ordered = [...graph.values()].sort(
  (a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
);
const indexOf = new Map(ordered.map((node, index) => [node.key, index]));
const stageKeys = new Set(stageNodes.map((stage) => stage.key));
const stageIdOf = new Map(stageNodes.map((stage) => [stage.key, stage.id]));

const nodes = ordered.map((node) => {
  const by = builtBy.get(node.key);
  return {
    name: node.name,
    drv: node.key,
    outputs: node.outputs,
    kind: node.kind,
    bytes: node.bytes,
    nar: node.nar,
    builtBy: by?.stage ?? null,
    via: (by?.via ?? []).map((key) => indexOf.get(key)),
  };
});

// Each stage's texture: the entropy strip of its largest output file,
// and which file that is.
const textureOf = (stage) => {
  const outputs = Object.values(graph.get(stage.key).outputs);
  const largest = largestAcross(outputs, listing);
  const bytes = readFileSync(`${work}/files/${stage.id}.bin`);
  if (bytes.length !== largest.size) {
    throw new Error(
      `files/${stage.id}.bin is ${bytes.length} bytes, ${largest.file} is ${largest.size}`,
    );
  }
  return { file: largest.file, size: largest.size, ...entropyStrip(bytes) };
};

const stageData = stageNodes.map((stage) => {
  const by = builtBy.get(stage.key);
  return {
    id: stage.id,
    node: indexOf.get(stage.key),
    builtBy: by?.stage ?? null,
    // The stages this one's build used directly, in build order.
    using: stageNodes
      .filter(({ key }) => directStages(graph, stage.key, stageKeys).has(key))
      .map(({ id }) => id),
    compiled: compiled.get(stage.id).map((key) => indexOf.get(key)),
    cumulative: cumulative.get(stage.id),
    texture: textureOf(stage),
  };
});

const root = stageData.at(-1);
const chain = {
  schema: SCHEMA,
  nixpkgs: { rev },
  system,
  stage0Arch: evaluated.stage0Arch,
  stages: stageData,
  nodes,
  totals: root.cumulative,
};
writeFileSync(`${outDir}/chain.json`, `${JSON.stringify(chain)}\n`);

console.log(
  `${system}: ${stageData.length} stages, ${nodes.length} derivations, ` +
    `${root.cumulative.built} bytes built`,
);
