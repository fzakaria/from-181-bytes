// Prints the floors' attribute paths as a JSON list, in build order, for
// nix/chain.nix to evaluate. Used by `nix run .#gen-data`.
import { floors } from "../site/js/floors.js";

process.stdout.write(JSON.stringify(floors.map((floor) => floor.attr)));
