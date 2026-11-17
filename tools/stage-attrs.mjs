// Prints the stages' attribute paths as a JSON list, in build order, for
// nix/chain.nix to evaluate. Used by `nix run .#gen-data`.
import { stages } from "../site/js/stages.js";

process.stdout.write(JSON.stringify(stages.map((stage) => stage.attr)));
