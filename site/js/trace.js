// "Who built you?": from a derivation in a chain file, follow built-by
// from floor to floor until nothing built the floor, which is the seed.

// Returns the hops in order, starting with `start`: { node, floor, via },
// where node indexes chain.nodes, floor is the id of the floor that node
// is (null for a derivation that is not a floor), and via lists the
// derivations between the previous hop and this one.
export function trace(chain, start) {
  const floorByNode = new Map(
    chain.floors.map((floor) => [floor.node, floor.id]),
  );
  const nodeOfFloor = new Map(
    chain.floors.map((floor) => [floor.id, floor.node]),
  );

  const hops = [
    { node: start, floor: floorByNode.get(start) ?? null, via: [] },
  ];
  const seen = new Set([start]);
  let current = start;

  // Each step moves to the floor that built the current derivation.
  while (chain.nodes[current].builtBy !== null) {
    const { builtBy, via } = chain.nodes[current];
    const next = nodeOfFloor.get(builtBy);
    if (seen.has(next)) {
      throw new Error(`built-by cycle through floor ${builtBy}`);
    }
    seen.add(next);
    hops.push({ node: next, floor: builtBy, via });
    current = next;
  }
  return hops;
}
