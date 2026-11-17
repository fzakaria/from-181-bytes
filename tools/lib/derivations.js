// Reads `nix derivation show -r` output into a graph of nodes.
//
// Newer Nix wraps the output as { version, derivations }, keys it by .drv
// basename and nests input derivations under `inputs.drvs`. Older Nix
// returns a bare map keyed by full .drv path, with `inputDrvs` keyed the
// same way. Both come out keyed by basename.

const STORE_DIR = "/nix/store/";

// What a derivation is, for the pipeline's purposes.
export const Kind = Object.freeze({
  // Downloaded or otherwise fixed by hash, with no builder in the graph:
  // source tarballs, patches, the stage0 source tree, the seed.
  SOURCE: "source",
  // A builder script written out by writeText, which kaem.runCommand
  // produces for every step it runs.
  SCRIPT: "script",
  // Everything else: a program, library or file a build step produced.
  BUILD: "build",
});

// The store path a file path sits in, or null for anything that is not
// under the store (builtin:fetchurl, a builder given as inline text).
export function storePathOf(path) {
  if (!path.startsWith(STORE_DIR)) {
    return null;
  }
  const slash = path.indexOf("/", STORE_DIR.length);
  return slash < 0 ? path : path.slice(0, slash);
}

const basename = (path) => path.slice(path.lastIndexOf("/") + 1);

// Every output of a derivation as a full store path. The env always
// carries them, input-addressed and fixed-output alike, which the
// `outputs` field does not.
function outputPaths(drv) {
  return Object.fromEntries(
    Object.keys(drv.outputs).map((name) => [name, drv.env[name]]),
  );
}

const isFixedOutput = (drv) =>
  Object.values(drv.outputs).some((output) => output.hash) ||
  "outputHash" in (drv.env ?? {});

const isScript = (drv) =>
  (drv.env?.passAsFile ?? "").split(" ").includes("text");

// Parse `nix derivation show -r` JSON into Map<key, node>, where a node
// is { key, name, builder, outputs, inputs, kind } and inputs lists the
// keys of the derivations it depends on.
export function parseDerivations(json) {
  const entries = Object.entries(json.derivations ?? json);

  // Which node produced each store path, so a builder path can be traced
  // back to the derivation that built the builder.
  const producedBy = new Map();
  for (const [key, drv] of entries) {
    for (const path of Object.values(outputPaths(drv))) {
      producedBy.set(path, basename(key));
    }
  }

  const graph = new Map();
  for (const [rawKey, drv] of entries) {
    const key = basename(rawKey);
    const builderStorePath = storePathOf(drv.builder);
    const builderNode = builderStorePath
      ? (producedBy.get(builderStorePath) ?? null)
      : null;

    // Fixed-output alone is not enough to call something fetched: hex0
    // is fixed-output and built by the seed.
    let kind = Kind.BUILD;
    if (isFixedOutput(drv) && builderNode === null) {
      kind = Kind.SOURCE;
    } else if (isScript(drv)) {
      kind = Kind.SCRIPT;
    }

    graph.set(key, {
      key,
      name: drv.name,
      builder: drv.builder,
      builderNode,
      outputs: outputPaths(drv),
      inputs: Object.keys(drv.inputs?.drvs ?? drv.inputDrvs).map(basename),
      kind,
    });
  }
  return graph;
}
