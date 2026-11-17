// Writes site/data/seeds/index.json from the seed descriptions gen-data
// evaluated (nix/seed.nix), after gen-data copied each seed and its hex0
// source beside it.
//
//   node tools/build-seeds.mjs <nixpkgs-rev> <out-dir> <seed.json>...
import { readFileSync, statSync, writeFileSync } from "node:fs";

const [rev, outDir, ...descriptions] = process.argv.slice(2);

// The order the seed explorer offers them in: x86 first, the 181 byte
// seed the site is named for.
const ARCH_ORDER = ["x86", "AMD64", "AArch64", "riscv64"];

const arches = descriptions
  .map((path) => JSON.parse(readFileSync(path, "utf8")))
  .map((seed) => ({
    name: seed.arch,
    system: seed.system,
    size: statSync(`${outDir}/${seed.arch}.bin`).size,
    source: `hex0_${seed.arch}.hex0`,
    url: seed.url,
    hash: seed.hash,
    stage0Version: seed.version,
  }))
  .sort((a, b) => ARCH_ORDER.indexOf(a.name) - ARCH_ORDER.indexOf(b.name));

const index = { nixpkgs: { rev }, arches };
writeFileSync(`${outDir}/index.json`, `${JSON.stringify(index, null, 2)}\n`);
