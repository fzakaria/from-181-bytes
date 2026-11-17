# `nix run .#gen-data`, from the repository root: regenerates site/data
# from the nixpkgs this flake locks and from cache.nixos.org. It needs
# the network and a Nix daemon, so it runs here and not inside a build;
# docs/data.md says why the output is committed.
#
# Nothing in the chain is built. Evaluation writes the .drv files, the
# seeds and the stage0 source tree are fetched, and every size and file
# list comes from the cache's narinfo and .ls files.
{ pkgs, nixpkgs }:
pkgs.writeShellApplication {
  name = "gen-data";
  runtimeInputs = [
    pkgs.nodejs
    pkgs.jq
  ];
  text = ''
    if [ ! -f site/js/floors.js ]; then
      echo "gen-data: run this from the from-181-bytes checkout" >&2
      exit 1
    fi

    out=site/data
    cache=https://cache.nixos.org
    # Parallel requests to the cache for the .ls listings.
    jobs=8
    # $GEN_DATA_WORK keeps what was downloaded, so tools/build-data.mjs
    # can be rerun on it offline; otherwise a temporary directory is used
    # and removed.
    if [ -n "''${GEN_DATA_WORK:-}" ]; then
      work=$GEN_DATA_WORK
      mkdir -p "$work"
    else
      work=$(mktemp -d)
      trap 'rm -rf "$work"' EXIT
    fi

    # Every seed stage0-posix ships for a system nixpkgs knows, with the
    # hex0 source it must reproduce. Only i686 and x86_64 have a chain
    # below; the others are there for the seed explorer.
    mkdir -p "$out/seeds"
    for system in i686-linux x86_64-linux aarch64-linux riscv64-linux; do
      seed_json="$work/seed-$system.json"
      nix eval --json --impure --expr \
        "import ${./seed.nix} { nixpkgs = ${nixpkgs}; system = \"$system\"; }" \
        > "$seed_json"
      nix-store --realise "$(jq -r .seedDrv "$seed_json")" "$(jq -r .srcDrv "$seed_json")" > /dev/null

      arch=$(jq -r .arch "$seed_json")
      cp --no-preserve=mode "$(jq -r .seed "$seed_json")" "$out/seeds/$arch.bin"
      cp --no-preserve=mode "$(jq -r .src "$seed_json")/$arch/hex0_$arch.hex0" "$out/seeds/"
    done
    node tools/build-seeds.mjs "${nixpkgs.rev}" "$out/seeds" "$work"/seed-*.json

    # The chain, per system: evaluate the floors, dump the derivation
    # graph under the last one, and ask the cache about every output.
    attrs=$(node tools/floor-attrs.mjs)
    for system in i686-linux x86_64-linux; do
      dir="$work/$system"
      mkdir -p "$dir/ls"

      FLOOR_ATTRS="$attrs" nix eval --json --impure --expr \
        "import ${./chain.nix} { nixpkgs = ${nixpkgs}; system = \"$system\"; attrs = builtins.getEnv \"FLOOR_ATTRS\"; }" \
        > "$dir/floors.json"
      root_attr=$(jq -r '.[-1]' <<< "$attrs")
      root_drv=$(jq -r --arg a "$root_attr" '.floors[$a].drvPath' "$dir/floors.json")
      root_out=$(jq -r --arg a "$root_attr" '.floors[$a].outputs.out' "$dir/floors.json")

      nix derivation show -r "$root_drv" > "$dir/derivations.json"
      jq -r '(.derivations // .) | .[] | . as $d | .outputs | keys[] | $d.env[.]' \
        "$dir/derivations.json" | sort -u > "$dir/outputs.txt"
      nix path-info --store "$cache" -r "$root_out" | sort -u > "$dir/closure.txt"

      xargs nix path-info --store "$cache" --json --json-format 1 \
        < "$dir/outputs.txt" > "$dir/path-info.json"
      # The script is single-quoted on purpose: sh expands $1 to $3.
      # shellcheck disable=SC2016
      sort -u "$dir/outputs.txt" "$dir/closure.txt" |
        xargs -P "$jobs" -I{} sh -c \
          'nix store ls --store "$1" -R --json "$2" > "$3/$(basename "$2").json"' \
          _ "$cache" {} "$dir/ls"

      node tools/build-data.mjs "$system" "${nixpkgs.rev}" "$dir" "$out"
    done
  '';
}
