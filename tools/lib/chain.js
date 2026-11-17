// Graph analysis over the parsed derivation graph: which stage built each
// derivation, along which path, and how much the chain has produced by
// each stage.

import { Kind } from "./derivations.js";

// When several stages sit on a derivation's frontier, the one that built
// it is the one doing the most translating. A C compiler beats the
// assembler it emits code for, which beats the linker after it, which
// beats a shell or a library that happened to be on hand. The seed ranks
// with the assemblers: it is one.
export const ROLE_PRIORITY = Object.freeze({
  cc: 3,
  asm: 2,
  seed: 2,
  link: 1,
  tool: 0,
  lib: 0,
});

// Every key reachable from `start` through inputs, `start` included.
export function closure(graph, start) {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length > 0) {
    const key = stack.pop();
    for (const input of graph.get(key)?.inputs ?? []) {
      if (seen.has(input)) {
        continue;
      }
      seen.add(input);
      stack.push(input);
    }
  }
  return seen;
}

// The stages a derivation reaches first: a breadth-first walk down its
// inputs that passes through anything that is not a stage and stops at
// every stage it meets. Returns Map<stageKey, path>, where the path runs
// from the input of `start` the walk left by down to the stage itself,
// and is the shortest such path.
export function frontier(graph, start, stageKeys) {
  const reached = new Map();
  const parent = new Map([[start, null]]);
  const queue = [start];

  while (queue.length > 0) {
    const key = queue.shift();

    // A stage ends this branch of the walk; record how we got here.
    if (key !== start && stageKeys.has(key)) {
      const path = [];
      for (let step = key; step !== start; step = parent.get(step)) {
        path.unshift(step);
      }
      reached.set(key, path);
      continue;
    }

    for (const input of graph.get(key)?.inputs ?? []) {
      if (parent.has(input) || !graph.has(input)) {
        continue;
      }
      parent.set(input, key);
      queue.push(input);
    }
  }
  return reached;
}

// The stages a derivation used directly: stages among its inputs, and
// stages among the inputs of its builder scripts, which is where
// kaem.runCommand names its tools. Other builds are not looked through.
export function directStages(graph, start, stageKeys) {
  const found = new Set();
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length > 0) {
    for (const input of graph.get(stack.pop())?.inputs ?? []) {
      if (seen.has(input) || !graph.has(input)) {
        continue;
      }
      seen.add(input);
      if (stageKeys.has(input)) {
        found.add(input);
      } else if (graph.get(input).kind === Kind.SCRIPT) {
        stack.push(input);
      }
    }
  }
  return found;
}

// Path costs for compilePath: stepping through a derivation named like
// either end (tinycc-boot3 on the way from tinycc-bootstrappable to mes,
// the intermediate tcc on the way from musl to tinycc-mes) is cheap,
// through anything else (bootstrap-coreutils, gnutar) is dear.
const SAME_STEM_COST = 1;
const OTHER_STEM_COST = 4;

// The first word of a derivation name: tinycc, gcc, M2, mes, hex2.
const stem = (name) => name.split(/[-._]/)[0].toLowerCase();

// The derivations between `start` and the stage `target` that built it,
// along the cheapest path that touches no other stage. Cheapest favours
// derivations sharing the start's or the target's stem, so it follows the
// compiler's own lineage (tinycc-boot3, boot2, ...) rather than the
// shortest route through a tool the build also used. Returns the keys
// strictly between start and target, nearest the start first.
export function compilePath(graph, start, target, stageKeys) {
  const want = new Set([
    stem(graph.get(start).name),
    stem(graph.get(target).name),
  ]);
  const cost = new Map([[start, 0]]);
  const parent = new Map([[start, null]]);
  const done = new Set();

  // Dijkstra by linear scan; the graph has a few hundred nodes.
  while (true) {
    let key = null;
    for (const [candidate, c] of cost) {
      if (!done.has(candidate) && (key === null || c < cost.get(key))) {
        key = candidate;
      }
    }
    if (key === null) {
      return null;
    }
    if (key === target) {
      break;
    }
    done.add(key);
    if (key !== start && stageKeys.has(key)) {
      continue;
    }
    for (const input of graph.get(key)?.inputs ?? []) {
      if (!graph.has(input) || done.has(input)) {
        continue;
      }
      const step = want.has(stem(graph.get(input).name))
        ? SAME_STEM_COST
        : OTHER_STEM_COST;
      const next = cost.get(key) + step;
      if (!cost.has(input) || next < cost.get(input)) {
        cost.set(input, next);
        parent.set(input, key);
      }
    }
  }

  const path = [];
  for (let step = parent.get(target); step !== start; step = parent.get(step)) {
    path.unshift(step);
  }
  return path;
}

// Pick the stage that built a derivation out of its frontier. Highest
// role priority first. Within a priority, a stage the derivation uses
// directly, as an input or named in its builder script, beats one reached
// only through another build: that one built a tool, not this. An
// ambient stage, one on every build's PATH, is never direct. Then the
// latest stage in build order.
function pickBuilder(graph, reached, stageByKey) {
  let best = null;
  for (const [key, path] of reached) {
    const stage = stageByKey.get(key);
    const via = path.slice(0, -1);
    const candidate = {
      stage: stage.id,
      priority: ROLE_PRIORITY[stage.role],
      direct:
        !stage.ambient &&
        via.every((step) => graph.get(step).kind === Kind.SCRIPT)
          ? 1
          : 0,
      rank: stage.rank,
      via,
    };
    if (best !== null && compareCandidates(candidate, best) <= 0) {
      continue;
    }
    best = candidate;
  }
  if (best === null) {
    return undefined;
  }
  return { stage: best.stage, via: best.via };
}

// Order builder candidates: priority, then directness, then rank.
function compareCandidates(a, b) {
  return a.priority - b.priority || a.direct - b.direct || a.rank - b.rank;
}

// Analyse the graph against the stages, given in build order as
// { id, role, key, ambient }. bytesOf(node) is the size a node counts for.
//
// Returns:
//   builtBy     Map<key, { stage, via }> for every built derivation that
//               has a stage below it; via lists the derivations between
//               it and that stage
//   compiled    Map<stageId, key[]>: the derivations that are not stages
//               and that each stage built
//   cumulative  Map<stageId, { built, builtCount, source, sourceCount }>:
//               bytes and derivations produced, and source fetched, by
//               the time each stage is done, every derivation counted once
export function analyse(graph, stages, bytesOf) {
  const stageByKey = new Map(
    stages.map((stage, rank) => [stage.key, { ...stage, rank }]),
  );
  const stageKeys = new Set(stageByKey.keys());
  const seedKeys = new Set(
    stages.filter((stage) => stage.role === "seed").map((f) => f.key),
  );

  // Who built what. Fetched sources and builder scripts are not compiled
  // by anything, so they are left out.
  const builtBy = new Map();
  for (const node of graph.values()) {
    if (node.kind !== Kind.BUILD) {
      continue;
    }
    const builder = pickBuilder(
      graph,
      frontier(graph, node.key, stageKeys),
      stageByKey,
    );
    if (!builder) {
      continue;
    }
    // Show the compiler's lineage between the two, not the shortest path.
    const target = stages.find((stage) => stage.id === builder.stage).key;
    builtBy.set(node.key, {
      stage: builder.stage,
      via: compilePath(graph, node.key, target, stageKeys),
    });
  }

  // The rest of what each stage compiled, besides the next stages.
  const compiled = new Map(stages.map((stage) => [stage.id, []]));
  for (const [key, { stage }] of builtBy) {
    if (stageKeys.has(key)) {
      continue;
    }
    compiled.get(stage).push(key);
  }

  // Running totals in build order over the union of stage closures.
  const cumulative = new Map();
  const counted = new Set();
  const totals = { built: 0, builtCount: 0, source: 0, sourceCount: 0 };
  for (const stage of stages) {
    for (const key of closure(graph, stage.key)) {
      if (counted.has(key) || seedKeys.has(key)) {
        continue;
      }
      counted.add(key);
      const node = graph.get(key);
      if (node.kind === Kind.SOURCE) {
        totals.source += bytesOf(node);
        totals.sourceCount += 1;
      } else {
        totals.built += bytesOf(node);
        totals.builtCount += 1;
      }
    }
    cumulative.set(stage.id, { ...totals });
  }

  return { builtBy, compiled, cumulative };
}
