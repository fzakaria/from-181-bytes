// Page logic that does not touch the DOM, kept apart so node can test it.

import { fill } from "./floors.js";

// Join the hand-written floors (site/js/floors.js) to the measured ones
// (chain-<system>.json). Both list the same floors in the same order, or
// the data is stale.
export function floorViews(meta, chain) {
  if (meta.length !== chain.floors.length) {
    throw new Error(
      `${meta.length} floors in floors.js, ${chain.floors.length} in the data`,
    );
  }
  const titleOf = new Map(
    meta.map((floor) => [floor.id, fill(floor.title, chain.system)]),
  );

  return meta.map((floor, index) => {
    const measured = chain.floors[index];
    if (measured.id !== floor.id) {
      throw new Error(
        `floor ${index} is ${floor.id} in floors.js but ${measured.id} in the data`,
      );
    }
    const node = chain.nodes[measured.node];
    return {
      ...floor,
      index,
      title: titleOf.get(floor.id),
      writtenIn: fill(floor.writtenIn, chain.system),
      reads: floor.reads ? fill(floor.reads, chain.system) : null,
      node,
      bytes: node.bytes,
      builtBy: measured.builtBy,
      builtByTitle: measured.builtBy ? titleOf.get(measured.builtBy) : null,
      using: measured.using.map((id) => ({ id, title: titleOf.get(id) })),
      compiledNames: measured.compiled.map(
        (nodeIndex) => chain.nodes[nodeIndex].name,
      ),
      cumulative: measured.cumulative,
    };
  });
}

// Every milestone, and whether a reader on floor `current` has reached it.
export function milestonesReached(views, current) {
  return views
    .filter((view) => view.milestone)
    .map((view) => ({
      label: view.milestone,
      index: view.index,
      reached: view.index <= current,
    }));
}

// Files whose path contains `query`, ignoring case, in list order and at
// most `limit` of them, with the number that matched in all.
export function filterFiles(files, query, limit) {
  const needle = query.trim().toLowerCase();
  const matches =
    needle === ""
      ? files
      : files.filter(([path]) => path.toLowerCase().includes(needle));
  return { shown: matches.slice(0, limit), total: matches.length };
}
