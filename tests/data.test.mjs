// Tests the committed data in site/data against what it claims to be.
// These run over real output of `nix run .#gen-data`, so they catch a
// pipeline bug that the unit tests' miniatures cannot: a floor that does
// not reach the seed, totals that do not add up, a seed whose size
// disagrees with the chain, data generated from a different nixpkgs than
// flake.lock pins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { floors } from "../site/js/floors.js";
import { trace } from "../site/js/trace.js";
import { floorViews } from "../site/js/view.js";

const read = (path) =>
  JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));

const lock = read("flake.lock");
const seeds = read("site/data/seeds/index.json");
const SYSTEMS = { "i686-linux": "x86", "x86_64-linux": "AMD64" };

// Edges read off pkgs/os-specific/linux/minimal-bootstrap/default.nix and
// the stage0-posix kaem scripts: [floor, the floor that built it]. The
// graph analysis has to find each of them on its own.
const KNOWN_EDGES = [
  ["hex0", "seed"],
  ["hex1", "hex0"],
  ["hex2-0", "hex1"],
  ["M0", "hex2-0"],
  ["cc_arch", "M0"],
  ["M2", "cc_arch"],
  ["M1-0", "M2"],
  ["kaem-unwrapped", "M2"],
  ["mes-m2", "mescc-tools"],
  ["tinycc-mes", "tinycc-bootstrappable"],
  ["binutils", "tinycc-musl"],
  ["gcc46", "tinycc-musl"],
  ["musl", "gcc46"],
  ["gcc46-cxx", "gcc46"],
  ["gcc10", "gcc46-cxx"],
  ["gcc-latest", "gcc10"],
  ["glibc", "gcc-latest"],
  ["gcc-glibc", "gcc-latest"],
];

// The seeds index was generated from the pinned nixpkgs.
test("the seeds index describes the locked nixpkgs", () => {
  assert.equal(seeds.nixpkgs.rev, lock.nodes.nixpkgs.locked.rev);
});

for (const [system, arch] of Object.entries(SYSTEMS)) {
  const chain = read(`site/data/chain-${system}.json`);
  const files = read(`site/data/files-${system}.json`);
  const index = new Map(chain.floors.map((floor, i) => [floor.id, i]));
  const nodeOf = (id) => chain.nodes[chain.floors[index.get(id)].node];

  // Same nixpkgs as flake.lock, and the same floors as floors.js.
  test(`${system}: chain and files match flake.lock and floors.js`, () => {
    assert.equal(chain.nixpkgs.rev, lock.nodes.nixpkgs.locked.rev);
    assert.equal(files.nixpkgs.rev, lock.nodes.nixpkgs.locked.rev);
    assert.equal(chain.system, system);
    assert.equal(chain.stage0Arch, arch);
    assert.doesNotThrow(() => floorViews(floors, chain));
  });

  // The seed floor is the seed explorer's seed, and hex0, which the seed
  // assembles from source, is the same size: nixpkgs pins it to the same
  // hash.
  test(`${system}: the seed and hex0 are both the ${arch} seed's size`, () => {
    const size = seeds.arches.find((entry) => entry.name === arch).size;
    assert.equal(nodeOf("seed").bytes, size);
    assert.equal(nodeOf("hex0").bytes, size);
    assert.equal(nodeOf("seed").kind, "source");
  });

  // Every floor but the seed was built by an earlier floor, and every
  // trace from a floor ends at the seed.
  test(`${system}: every floor is built by an earlier one and traces to the seed`, () => {
    chain.floors.forEach((floor, i) => {
      if (floor.id === "seed") {
        assert.equal(floor.builtBy, null);
        return;
      }
      assert.ok(
        index.get(floor.builtBy) < i,
        `${floor.id} built by later ${floor.builtBy}`,
      );
      const hops = trace(chain, floor.node);
      assert.equal(hops.at(-1).floor, "seed");
    });
  });

  test(`${system}: the analysis finds the edges nixpkgs spells out`, () => {
    for (const [floor, builder] of KNOWN_EDGES) {
      assert.equal(chain.floors[index.get(floor)].builtBy, builder, floor);
    }
  });

  // Running totals never shrink, and the last floor's totals are every
  // derivation in the graph but the seed.
  test(`${system}: running totals grow and end at the whole graph`, () => {
    for (let i = 1; i < chain.floors.length; i += 1) {
      const [before, after] = [
        chain.floors[i - 1].cumulative,
        chain.floors[i].cumulative,
      ];
      assert.ok(
        after.built >= before.built && after.builtCount >= before.builtCount,
      );
    }
    const built = chain.nodes.filter((node) => node.kind !== "source");
    const sources = chain.nodes.filter(
      (node) => node.kind === "source" && node !== nodeOf("seed"),
    );
    assert.equal(chain.totals.builtCount, built.length);
    assert.equal(
      chain.totals.built,
      built.reduce((sum, node) => sum + node.bytes, 0),
    );
    assert.equal(chain.totals.sourceCount, sources.length);
  });

  // Every closure path belongs to a node that lists it as an output, and
  // every file in it traces down to the seed.
  test(`${system}: every closure path is a node's output and traces to the seed`, () => {
    for (const entry of files.paths) {
      assert.ok(
        Object.values(chain.nodes[entry.node].outputs).includes(entry.path),
        entry.path,
      );
      assert.equal(trace(chain, entry.node).at(-1).floor, "seed");
    }
  });
}
