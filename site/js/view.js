// Page logic that does not touch the DOM, kept apart so node can test it.

// Join the hand-written stages (site/js/stages.js) to the measured ones
// (chain.json). Both list the same stages in the same order, or
// the data is stale.
export function stageViews(meta, chain) {
  if (meta.length !== chain.stages.length) {
    throw new Error(
      `${meta.length} stages in stages.js, ${chain.stages.length} in the data`,
    );
  }
  const titleOf = new Map(meta.map((stage) => [stage.id, stage.title]));

  return meta.map((stage, index) => {
    const measured = chain.stages[index];
    if (measured.id !== stage.id) {
      throw new Error(
        `stage ${index} is ${stage.id} in stages.js but ${measured.id} in the data`,
      );
    }
    const node = chain.nodes[measured.node];
    return {
      ...stage,
      index,
      title: titleOf.get(stage.id),
      reads: stage.reads ?? null,
      node,
      bytes: node.bytes,
      builtBy: measured.builtBy,
      builtByTitle: measured.builtBy ? titleOf.get(measured.builtBy) : null,
      using: measured.using.map((id) => ({ id, title: titleOf.get(id) })),
      compiledNames: measured.compiled.map(
        (nodeIndex) => chain.nodes[nodeIndex].name,
      ),
      cumulative: measured.cumulative,
      texture: measured.texture ?? null,
    };
  });
}
