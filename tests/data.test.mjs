// Tests the committed data in site/data against what it claims to be.
// These run over real output of `nix run .#gen-data`, so they catch a
// pipeline bug that the unit tests' miniatures cannot: a stage that does
// not reach the seed, totals that do not add up, a seed whose size
// disagrees with the chain, data generated from a different nixpkgs than
// flake.lock pins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { stages, Role } from "../site/js/stages.js";
import { stageViews } from "../site/js/view.js";

const read = (path) =>
  JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));

const lock = read("flake.lock");
const seeds = read("site/data/seeds/index.json");
const SYSTEM = "i686-linux";
const ARCH = "x86";

// Entropy levels are hex digits, one per slice, at most 128 slices.
const LEVELS_PATTERN = /^[0-9a-f]{1,128}$/;

// Edges read off pkgs/os-specific/linux/minimal-bootstrap/default.nix and
// the stage0-posix kaem scripts: [stage, the stage that built it]. The
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

const chain = read("site/data/chain.json");
const index = new Map(chain.stages.map((stage, i) => [stage.id, i]));
const nodeOf = (id) => chain.nodes[chain.stages[index.get(id)].node];

// Same nixpkgs as flake.lock, and the same stages as stages.js.
test("the chain matches flake.lock and stages.js", () => {
  assert.equal(chain.nixpkgs.rev, lock.nodes.nixpkgs.locked.rev);
  assert.equal(chain.system, SYSTEM);
  assert.equal(chain.stage0Arch, ARCH);
  assert.doesNotThrow(() => stageViews(stages, chain));
});

// The seed stage is the seed explorer's seed, and hex0, which the seed
// assembles from source, is the same size: nixpkgs pins it to the same
// hash.
test("the seed and hex0 are both the seed's size", () => {
  const { size } = seeds.seed;
  assert.equal(nodeOf("seed").bytes, size);
  assert.equal(nodeOf("hex0").bytes, size);
  assert.equal(nodeOf("seed").kind, "source");
});

// Every stage but the seed was built by an earlier stage, so following
// built-by from any stage ends at the seed.
test("every stage is built by an earlier one", () => {
  chain.stages.forEach((stage, i) => {
    if (stage.id === "seed") {
      assert.equal(stage.builtBy, null);
      return;
    }
    assert.ok(
      index.get(stage.builtBy) < i,
      `${stage.id} built by later ${stage.builtBy}`,
    );
  });
});

test("the analysis finds the edges nixpkgs spells out", () => {
  for (const [stage, builder] of KNOWN_EDGES) {
    assert.equal(chain.stages[index.get(stage)].builtBy, builder, stage);
  }
});

// Running totals never shrink, and the last stage's totals are every
// derivation in the graph but the seed.
test("running totals grow and end at the whole graph", () => {
  for (let i = 1; i < chain.stages.length; i += 1) {
    const [before, after] = [
      chain.stages[i - 1].cumulative,
      chain.stages[i].cumulative,
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

// Every stage has a texture from its largest output file, no larger than
// the stage's output. The seed's texture is the seed itself.
test("every stage has a texture from a file in its output", () => {
  for (const stage of chain.stages) {
    const { texture } = stage;
    assert.match(texture.levels, LEVELS_PATTERN, stage.id);
    assert.ok(texture.size <= chain.nodes[stage.node].bytes, stage.id);
    assert.ok(texture.file.length > 0, stage.id);
  }
  assert.equal(chain.stages[index.get("seed")].texture.size, seeds.seed.size);
});

// A stage written in a script language was run, not compiled, so no
// compiler, assembler or linker can have built it. gcc-wrapper-16.2.0,
// shell scripts and symlinks, once claimed GCC 16 as its builder.
const SCRIPT_LANGUAGES = new Set(["shell"]);
const TRANSLATORS = new Set([Role.CC, Role.ASM, Role.LINK, Role.SEED]);
test("no script stage claims a compiler, assembler or linker as builder", () => {
  const roleOf = new Map(stages.map((stage) => [stage.id, stage.role]));
  for (const [i, stage] of stages.entries()) {
    if (!SCRIPT_LANGUAGES.has(stage.writtenIn)) {
      continue;
    }
    const builtBy = chain.stages[i].builtBy;
    assert.ok(
      !TRANSLATORS.has(roleOf.get(builtBy)),
      `${stage.id} is ${stage.writtenIn} but built by ${builtBy}`,
    );
  }
});

// The standard environment gets the last stage through a wrapper that is
// not a stage: its store path and size are recorded for the last card,
// and the totals end at the last stage, without it.
test("the handoff wrapper is recorded and not counted", () => {
  const { handoff } = chain;
  assert.match(handoff.path, /^\/nix\/store\/[a-z0-9]{32}-gcc-wrapper-/);
  assert.ok(handoff.bytes > 0);
  assert.ok(
    !chain.nodes.some((node) =>
      Object.values(node.outputs).includes(handoff.path),
    ),
  );
  assert.deepEqual(chain.totals, chain.stages.at(-1).cumulative);
});
