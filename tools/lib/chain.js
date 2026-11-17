// Graph analysis over the parsed derivation graph: which floor built each
// derivation, along which path, and how much the chain has produced by
// each floor.

import { Kind } from "./derivations.js";

// When several floors sit on a derivation's frontier, the one that built
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

// The floors a derivation reaches first: a breadth-first walk down its
// inputs that passes through anything that is not a floor and stops at
// every floor it meets. Returns Map<floorKey, path>, where the path runs
// from the input of `start` the walk left by down to the floor itself,
// and is the shortest such path.
export function frontier(graph, start, floorKeys) {
  const reached = new Map();
  const parent = new Map([[start, null]]);
  const queue = [start];

  while (queue.length > 0) {
    const key = queue.shift();

    // A floor ends this branch of the walk; record how we got here.
    if (key !== start && floorKeys.has(key)) {
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

// The floors a derivation used directly: floors among its inputs, and
// floors among the inputs of its builder scripts, which is where
// kaem.runCommand names its tools. Other builds are not looked through.
export function directFloors(graph, start, floorKeys) {
  const found = new Set();
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length > 0) {
    for (const input of graph.get(stack.pop())?.inputs ?? []) {
      if (seen.has(input) || !graph.has(input)) {
        continue;
      }
      seen.add(input);
      if (floorKeys.has(input)) {
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

// The derivations between `start` and the floor `target` that built it,
// along the cheapest path that touches no other floor. Cheapest favours
// derivations sharing the start's or the target's stem, so it follows the
// compiler's own lineage (tinycc-boot3, boot2, ...) rather than the
// shortest route through a tool the build also used. Returns the keys
// strictly between start and target, nearest the start first.
export function compilePath(graph, start, target, floorKeys) {
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
    if (key !== start && floorKeys.has(key)) {
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

// Pick the floor that built a derivation out of its frontier. Highest
// role priority first. Within a priority, a floor the derivation uses
// directly, as an input or named in its builder script, beats one reached
// only through another build: that one built a tool, not this. An
// ambient floor, one on every build's PATH, is never direct. Then the
// latest floor in build order.
function pickBuilder(graph, reached, floorByKey) {
  let best = null;
  for (const [key, path] of reached) {
    const floor = floorByKey.get(key);
    const via = path.slice(0, -1);
    const candidate = {
      floor: floor.id,
      priority: ROLE_PRIORITY[floor.role],
      direct:
        !floor.ambient &&
        via.every((step) => graph.get(step).kind === Kind.SCRIPT)
          ? 1
          : 0,
      rank: floor.rank,
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
  return { floor: best.floor, via: best.via };
}

// Order builder candidates: priority, then directness, then rank.
function compareCandidates(a, b) {
  return a.priority - b.priority || a.direct - b.direct || a.rank - b.rank;
}

// Analyse the graph against the floors, given in build order as
// { id, role, key, ambient }. bytesOf(node) is the size a node counts for.
//
// Returns:
//   builtBy     Map<key, { floor, via }> for every built derivation that
//               has a floor below it; via lists the derivations between
//               it and that floor
//   compiled    Map<floorId, key[]>: the derivations that are not floors
//               and that each floor built
//   cumulative  Map<floorId, { built, builtCount, source, sourceCount }>:
//               bytes and derivations produced, and source fetched, by
//               the time each floor is done, every derivation counted once
export function analyse(graph, floors, bytesOf) {
  const floorByKey = new Map(
    floors.map((floor, rank) => [floor.key, { ...floor, rank }]),
  );
  const floorKeys = new Set(floorByKey.keys());
  const seedKeys = new Set(
    floors.filter((floor) => floor.role === "seed").map((f) => f.key),
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
      frontier(graph, node.key, floorKeys),
      floorByKey,
    );
    if (!builder) {
      continue;
    }
    // Show the compiler's lineage between the two, not the shortest path.
    const target = floors.find((floor) => floor.id === builder.floor).key;
    builtBy.set(node.key, {
      floor: builder.floor,
      via: compilePath(graph, node.key, target, floorKeys),
    });
  }

  // The rest of what each floor compiled, besides the next floors.
  const compiled = new Map(floors.map((floor) => [floor.id, []]));
  for (const [key, { floor }] of builtBy) {
    if (floorKeys.has(key)) {
      continue;
    }
    compiled.get(floor).push(key);
  }

  // Running totals in build order over the union of floor closures.
  const cumulative = new Map();
  const counted = new Set();
  const totals = { built: 0, builtCount: 0, source: 0, sourceCount: 0 };
  for (const floor of floors) {
    for (const key of closure(graph, floor.key)) {
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
    cumulative.set(floor.id, { ...totals });
  }

  return { builtBy, compiled, cumulative };
}
