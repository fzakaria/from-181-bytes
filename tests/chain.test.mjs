// Tests tools/lib/chain.js, the graph analysis behind the stages: which
// stage built a derivation, by what path through the derivation graph,
// and how many bytes the chain has produced by each stage. The graph is
// a hand-made miniature of minimal-bootstrap in the real
// `nix derivation show` v4 shape: a fetched seed, an assembler whose
// builder is the previous stage, a shell, and compilers that the shell
// runs through a builder script, the way kaem.runCommand does.
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseDerivations } from "../tools/lib/derivations.js";
import {
  analyse,
  frontier,
  closure,
  directStages,
  compilePath,
} from "../tools/lib/chain.js";

// One fake derivation. Output paths are /nix/store/<name>, which keeps
// the expectations readable.
function drv(
  name,
  { builder = "/bin/sh", inputs = [], fixed = false, script = false } = {},
) {
  const out = `/nix/store/${name}`;
  const env = { name, out };
  if (script) {
    env.text = "...";
    env.passAsFile = "text";
  }
  if (fixed) {
    env.outputHash = "sha256-AAAA";
  }
  return [
    `${name}.drv`,
    {
      name,
      builder,
      env,
      inputs: {
        drvs: Object.fromEntries(
          inputs.map((input) => [`${input}.drv`, { outputs: ["out"] }]),
        ),
        srcs: [],
      },
      outputs: {
        out: fixed ? { hash: "sha256-AAAA", method: "nar" } : { path: name },
      },
    },
  ];
}

const show = {
  version: 4,
  derivations: Object.fromEntries([
    drv("seed", { builder: "builtin:fetchurl", fixed: true }),
    drv("src", { builder: "builtin:fetchurl", fixed: true }),
    drv("hex0", {
      builder: "/nix/store/seed",
      inputs: ["seed", "src"],
      fixed: true,
    }),
    drv("asm", { builder: "/nix/store/hex0", inputs: ["hex0", "src"] }),
    drv("ccA", { builder: "/nix/store/asm", inputs: ["asm", "src"] }),
    drv("shell", { builder: "/nix/store/asm", inputs: ["asm", "src"] }),
    drv("ccB-builder", {
      builder: "/nix/store/shell/bin/sh",
      inputs: ["shell", "ccA", "src"],
      script: true,
    }),
    drv("ccB", {
      builder: "/nix/store/shell/bin/sh",
      inputs: ["shell", "ccB-builder"],
    }),
    drv("lib-builder", {
      builder: "/nix/store/shell/bin/sh",
      inputs: ["shell", "ccB"],
      script: true,
    }),
    drv("lib", {
      builder: "/nix/store/shell/bin/sh",
      inputs: ["shell", "lib-builder"],
    }),
    drv("prog", {
      builder: "/nix/store/shell/bin/sh",
      inputs: ["shell", "asm", "ccB", "lib"],
    }),
    drv("patch", {
      builder: "/nix/store/shell/bin/sh",
      inputs: ["shell", "ccB"],
    }),
    drv("make", {
      builder: "/nix/store/shell/bin/sh",
      inputs: ["shell", "ccA", "patch"],
    }),
    drv("top", {
      builder: "/nix/store/shell/bin/sh",
      inputs: ["shell", "prog", "lib", "make"],
    }),
  ]),
};

// Stages in build order with their roles, as site/js/stages.js gives them.
const stages = [
  { id: "seed", role: "seed", key: "seed.drv" },
  { id: "hex0", role: "asm", key: "hex0.drv" },
  { id: "asm", role: "asm", key: "asm.drv" },
  { id: "ccA", role: "cc", key: "ccA.drv" },
  { id: "shell", role: "tool", key: "shell.drv" },
  { id: "ccB", role: "cc", key: "ccB.drv" },
  { id: "lib", role: "lib", key: "lib.drv" },
  { id: "top", role: "cc", key: "top.drv" },
];

// Every built derivation is 100 bytes, every fetched one 10, the seed 1.
const bytesOf = (node) =>
  node.name === "seed" ? 1 : node.kind === "source" ? 10 : 100;

const graph = parseDerivations(show);
const stageKeys = new Set(stages.map((stage) => stage.key));

// The frontier stops at the first stage down each input path and walks
// straight through anything that is not a stage, builder scripts
// included, which is how a kaem-built compiler reaches the compiler
// named only in its script.
test("the frontier walks through non-stages and stops at stages", () => {
  const reached = frontier(graph, "ccB.drv", stageKeys);
  assert.deepEqual([...reached.keys()].sort(), ["ccA.drv", "shell.drv"]);
  assert.deepEqual(reached.get("ccA.drv"), ["ccB-builder.drv", "ccA.drv"]);
  assert.deepEqual(reached.get("shell.drv"), ["shell.drv"]);
});

// Who built a derivation: of the stages on its frontier, a compiler beats
// an assembler, which beats a linker, which beats a tool or a library;
// within a role, a stage used directly beats one reached through another
// build, and then the later stage wins.
test("built-by prefers compilers, then the latest stage", () => {
  const result = analyse(graph, stages, bytesOf);
  const builtBy = (name) => result.builtBy.get(`${name}.drv`);

  assert.equal(builtBy("seed"), undefined);
  assert.equal(builtBy("hex0").stage, "seed");
  assert.equal(builtBy("asm").stage, "hex0");
  assert.equal(builtBy("ccA").stage, "asm");
  assert.equal(builtBy("ccB").stage, "ccA");
  assert.deepEqual(builtBy("ccB").via, ["ccB-builder.drv"]);
  assert.equal(builtBy("prog").stage, "ccB");
  assert.equal(builtBy("top").stage, "ccB");
  assert.deepEqual(builtBy("top").via, ["prog.drv"]);
});

// Fetched derivations have no builder in the chain; scripts are not
// compiled by anything either, so neither gets a built-by entry.
test("sources and scripts are not attributed to a stage", () => {
  const result = analyse(graph, stages, bytesOf);
  assert.equal(result.builtBy.get("src.drv"), undefined);
  assert.equal(result.builtBy.get("ccB-builder.drv"), undefined);
});

// The derivations a stage built that are not stages themselves are
// listed under it, so a stage can say what else it compiled.
test("non-stage builds are listed under the stage that built them", () => {
  const result = analyse(graph, stages, bytesOf);
  assert.deepEqual(result.compiled.get("ccB").sort(), [
    "patch.drv",
    "prog.drv",
  ]);
  assert.deepEqual(result.compiled.get("ccA"), ["make.drv"]);
  assert.deepEqual(result.compiled.get("asm"), []);
});

// A compiler the derivation is handed directly beats a later compiler
// that only built one of its tools: make is compiled by ccA even though
// the patch it uses was compiled by ccB. This is gnumake in nixpkgs,
// built by tinycc-bootstrappable with a gnupatch that a later tcc built.
test("a compiler used directly beats one reached through a tool", () => {
  const result = analyse(graph, stages, bytesOf);
  assert.equal(result.builtBy.get("make.drv").stage, "ccA");
  assert.deepEqual(result.builtBy.get("make.drv").via, []);
});

// Bytes produced by each stage count every built derivation needed so
// far exactly once, even when several stages share it. Fetched source is
// counted apart, and the seed is in neither: it is what you trust, not
// something the chain produced or read.
test("cumulative bytes count shared derivations once and keep the seed apart", () => {
  const result = analyse(graph, stages, bytesOf);
  const at = (id) => result.cumulative.get(id);

  assert.deepEqual(at("seed"), {
    built: 0,
    builtCount: 0,
    source: 0,
    sourceCount: 0,
  });
  assert.deepEqual(at("hex0"), {
    built: 100,
    builtCount: 1,
    source: 10,
    sourceCount: 1,
  });
  assert.deepEqual(at("ccA"), {
    built: 300,
    builtCount: 3,
    source: 10,
    sourceCount: 1,
  });

  // The shell stage adds the shell; ccB then adds its builder script and
  // itself, and the shell it also needs is not counted a second time.
  assert.deepEqual(at("shell"), {
    built: 400,
    builtCount: 4,
    source: 10,
    sourceCount: 1,
  });
  assert.deepEqual(at("ccB"), {
    built: 600,
    builtCount: 6,
    source: 10,
    sourceCount: 1,
  });

  // The last stage holds everything in the graph but the seed.
  const builtNodes = [...graph.values()].filter(
    (node) => node.kind !== "source",
  );
  assert.equal(at("top").builtCount, builtNodes.length);
  assert.equal(at("top").built, 100 * builtNodes.length);
});

// closure includes the start and everything it depends on.
test("closure is the start plus every transitive input", () => {
  const keys = closure(graph, "ccA.drv");
  assert.deepEqual([...keys].sort(), [
    "asm.drv",
    "ccA.drv",
    "hex0.drv",
    "seed.drv",
    "src.drv",
  ]);
});

// The stages a derivation used directly: its own inputs, or stages named
// only in its builder script. A stage reached through some other build
// (top reaches ccB only through prog) is not one of them.
test("direct stages look through builder scripts and nothing else", () => {
  assert.deepEqual([...directStages(graph, "ccB.drv", stageKeys)].sort(), [
    "ccA.drv",
    "shell.drv",
  ]);
  assert.deepEqual([...directStages(graph, "top.drv", stageKeys)].sort(), [
    "lib.drv",
    "shell.drv",
  ]);
});

// An ambient stage, one put on every build's PATH the way kaem.runCommand
// adds mescc-tools, is a direct input of everything and so says nothing
// about who compiled what. It never wins on directness: with ccA ambient,
// make goes to the later ccB instead.
test("an ambient stage does not count as used directly", () => {
  const ambient = stages.map((stage) =>
    stage.id === "ccA" ? { ...stage, ambient: true } : stage,
  );
  const result = analyse(graph, ambient, bytesOf);
  assert.equal(result.builtBy.get("make.drv").stage, "ccB");
});

// The path shown between a derivation and the stage that built it should
// follow the compiler's own lineage, not the shortest route through a
// side tool. Here tcc-final reaches tcc-old in two steps through
// coreutils and in three through the tcc builds; the three-step path is
// the one that compiled it. This is tinycc-musl in nixpkgs, whose
// shortest path to tinycc-mes runs through bootstrap-coreutils.
test("the path to a builder follows the derivations named like the start", () => {
  const lineage = parseDerivations({
    version: 4,
    derivations: Object.fromEntries([
      drv("tcc-old"),
      drv("tcc-mid", { inputs: ["tcc-old"] }),
      drv("tcc-build", { inputs: ["tcc-mid"] }),
      drv("coreutils", { inputs: ["tcc-old"] }),
      drv("tcc-final", { inputs: ["coreutils", "tcc-build"] }),
    ]),
  });
  const keys = new Set(["tcc-old.drv", "tcc-final.drv"]);
  assert.deepEqual(
    frontier(lineage, "tcc-final.drv", keys).get("tcc-old.drv"),
    ["coreutils.drv", "tcc-old.drv"],
  );
  assert.deepEqual(compilePath(lineage, "tcc-final.drv", "tcc-old.drv", keys), [
    "tcc-build.drv",
    "tcc-mid.drv",
  ]);
});

// The lineage may be named for the stage rather than the start: musl
// built by tcc reaches tinycc-mes through the intermediate tcc, not
// through the tar its build also used.
test("the path may follow derivations named like the builder", () => {
  const lineage = parseDerivations({
    version: 4,
    derivations: Object.fromEntries([
      drv("tcc-old"),
      drv("tcc-mid", { inputs: ["tcc-old"] }),
      drv("tar", { inputs: ["tcc-old"] }),
      drv("musl", { inputs: ["tar", "tcc-mid"] }),
    ]),
  });
  const keys = new Set(["tcc-old.drv", "musl.drv"]);
  assert.deepEqual(compilePath(lineage, "musl.drv", "tcc-old.drv", keys), [
    "tcc-mid.drv",
  ]);
});
