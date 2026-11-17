// Prints { stages, handoff } as JSON for nix/chain.nix to evaluate: the
// stages' attribute paths in build order, and the attribute path of the
// wrapper the standard environment receives. Used by `nix run .#gen-data`.
import { stages, HANDOFF_ATTR } from "../site/js/stages.js";

process.stdout.write(
  JSON.stringify({
    stages: stages.map((stage) => stage.attr),
    handoff: HANDOFF_ATTR,
  }),
);
