// Writes site/data/seeds/index.json from the seed description gen-data
// evaluated (nix/seed.nix), after gen-data copied the seed and its hex0
// source beside it.
//
//   node tools/build-seeds.mjs <nixpkgs-rev> <out-dir> <seed.json>
import { readFileSync, statSync, writeFileSync } from "node:fs";

const [rev, outDir, description] = process.argv.slice(2);
const seed = JSON.parse(readFileSync(description, "utf8"));

const index = {
  nixpkgs: { rev },
  seed: {
    arch: seed.arch,
    system: seed.system,
    size: statSync(`${outDir}/${seed.arch}.bin`).size,
    source: `hex0_${seed.arch}.hex0`,
    url: seed.url,
    hash: seed.hash,
    stage0Version: seed.version,
  },
};
writeFileSync(`${outDir}/index.json`, `${JSON.stringify(index, null, 2)}\n`);
