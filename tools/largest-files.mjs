// Prints "<stage> <file>" for every stage: the largest regular file in
// its outputs, which gen-data fetches whole so build-data can draw the
// stage's texture from it.
//
//   node tools/largest-files.mjs <work-dir>
//
// The work directory holds stages.json (nix/chain.nix) and
// ls/<path>.json (cache.nixos.org listings).
import { readFileSync } from "node:fs";

import { stages } from "../site/js/stages.js";
import { largestAcross } from "./lib/listing.js";

const [work] = process.argv.slice(2);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const basename = (path) => path.slice(path.lastIndexOf("/") + 1);
const evaluated = readJson(`${work}/stages.json`);

for (const stage of stages) {
  const outputs = Object.values(evaluated.stages[stage.attr].outputs);
  const largest = largestAcross(outputs, (path) =>
    readJson(`${work}/ls/${basename(path)}.json`),
  );
  if (!largest) {
    throw new Error(`stage ${stage.id} has no regular file in its outputs`);
  }
  process.stdout.write(`${stage.id} ${largest.path}\n`);
}
