// Tests tools/lib/derivations.js, which reads `nix derivation show -r`
// output into the graph the rest of the pipeline walks. The fixture is a
// slice of the real output for i686-linux at the pinned nixpkgs: the
// seed, hex0, hex1, the stage0-posix source and one kaem builder script.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseDerivations, storePathOf } from "../tools/lib/derivations.js";

const slice = JSON.parse(
  readFileSync(
    new URL("./fixtures/derivation-show-slice.json", import.meta.url),
    "utf8",
  ),
);

const byName = (graph, name) =>
  [...graph.values()].find((node) => node.name === name);

// Every derivation becomes a node keyed by its .drv basename, with its
// output paths spelled as full store paths.
test("nodes are keyed by drv basename and carry full output paths", () => {
  const graph = parseDerivations(slice);
  const hex1 = byName(graph, "hex1-1.9.1");

  assert.equal(hex1.key, "7v0v3kw2jiid9kb86z9y5vhjnpxiyv6q-hex1-1.9.1.drv");
  assert.deepEqual(hex1.outputs, {
    out: "/nix/store/c2plnpd41cgf3mypqy4gxihcivld8p3h-hex1-1.9.1",
  });
  assert.ok(
    hex1.inputs.includes("rj9f41bs41c91z7hl769awsvaw438h3a-hex0-1.9.1.drv"),
  );
});

// The seed and the source tree are fetched, not built: fixed-output
// derivations whose builder no node in the graph produced. hex0 is also
// fixed-output, because nixpkgs pins its hash to the seed's, but the seed
// builds it, so it counts as a build.
test("fetched, built and script derivations are told apart", () => {
  const graph = parseDerivations(slice);

  assert.equal(byName(graph, "hex0-seed").kind, "source");
  assert.equal(byName(graph, "stage0-posix-1.9.1-source").kind, "source");
  assert.equal(byName(graph, "hex0-1.9.1").kind, "build");
  assert.equal(byName(graph, "hex1-1.9.1").kind, "build");
  assert.equal(byName(graph, "libgetopt.a-builder").kind, "script");
});

// A builder is named by a path inside a store path, and the node that
// built that store path is what the graph needs.
test("a builder path resolves to its store path", () => {
  assert.equal(
    storePathOf(
      "/nix/store/hqv8h6w14khjb53g28mqk2kb2d58x27h-kaem-1.9.1/bin/kaem",
    ),
    "/nix/store/hqv8h6w14khjb53g28mqk2kb2d58x27h-kaem-1.9.1",
  );
  assert.equal(storePathOf("builtin:fetchurl"), null);
});

// The older output format, a bare map keyed by full .drv paths with
// `inputDrvs` keyed the same way, parses to the same keys and edges.
test("the older map keyed by full drv paths parses too", () => {
  const legacy = Object.fromEntries(
    Object.entries(slice.derivations).map(([key, { inputs, ...drv }]) => [
      `/nix/store/${key}`,
      {
        ...drv,
        inputDrvs: Object.fromEntries(
          Object.entries(inputs.drvs).map(([input, spec]) => [
            `/nix/store/${input}`,
            spec,
          ]),
        ),
        inputSrcs: inputs.srcs,
      },
    ]),
  );
  const graph = parseDerivations(legacy);
  const hex1 = graph.get("7v0v3kw2jiid9kb86z9y5vhjnpxiyv6q-hex1-1.9.1.drv");
  assert.ok(
    hex1.inputs.includes("rj9f41bs41c91z7hl769awsvaw438h3a-hex0-1.9.1.drv"),
  );
});
