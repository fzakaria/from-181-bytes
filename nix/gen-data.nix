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
    if [ ! -f site/js/stages.js ]; then
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

    # The page describes one system: i686-linux, whose x86 seed is the 181
    # bytes in the title.
    system=i686-linux

    # The seed, with the hex0 source it must reproduce.
    mkdir -p "$out/seeds"
    seed_json="$work/seed.json"
    nix eval --json --impure --expr \
      "import ${./seed.nix} { nixpkgs = ${nixpkgs}; system = \"$system\"; }" \
      > "$seed_json"
    nix-store --realise "$(jq -r .seedDrv "$seed_json")" "$(jq -r .srcDrv "$seed_json")" > /dev/null

    arch=$(jq -r .arch "$seed_json")
    cp --no-preserve=mode "$(jq -r .seed "$seed_json")" "$out/seeds/$arch.bin"
    cp --no-preserve=mode "$(jq -r .src "$seed_json")/$arch/hex0_$arch.hex0" "$out/seeds/"
    node tools/build-seeds.mjs "${nixpkgs.rev}" "$out/seeds" "$seed_json"

    # The chain: evaluate the stages, dump the derivation graph under the
    # last one, and ask the cache about every output.
    attrs=$(node tools/stage-attrs.mjs)
    dir="$work/chain"
    mkdir -p "$dir/ls" "$dir/files"

    STAGE_ATTRS="$attrs" nix eval --json --impure --expr \
      "import ${./chain.nix} { nixpkgs = ${nixpkgs}; system = \"$system\"; attrs = builtins.getEnv \"STAGE_ATTRS\"; }" \
      > "$dir/stages.json"
    root_attr=$(jq -r '.stages[-1]' <<< "$attrs")
    root_drv=$(jq -r --arg a "$root_attr" '.stages[$a].drvPath' "$dir/stages.json")

    nix derivation show -r "$root_drv" > "$dir/derivations.json"
    jq -r '(.derivations // .) | .[] | . as $d | .outputs | keys[] | $d.env[.]' \
      "$dir/derivations.json" | sort -u > "$dir/outputs.txt"
    # The wrapper the standard environment receives is not in the graph,
    # but its size is shown, so the cache is asked about it too.
    jq -r '.handoff.outputs[]' "$dir/stages.json" > "$dir/handoff.txt"

    sort -u "$dir/outputs.txt" "$dir/handoff.txt" > "$dir/paths.txt"
    xargs nix path-info --store "$cache" --json --json-format 1 \
      < "$dir/paths.txt" > "$dir/path-info.json"
    # The script is single-quoted on purpose: sh expands $1 to $3.
    # shellcheck disable=SC2016
    xargs -P "$jobs" -I{} sh -c \
      'nix store ls --store "$1" -R --json "$2" > "$3/$(basename "$2").json"' \
      _ "$cache" {} "$dir/ls" < "$dir/paths.txt"

    # Each stage's largest output file, fetched whole, for the texture its
    # bar is drawn with. tools/largest-files.mjs prints "<stage> <file>",
    # which xargs appends as $3 and $4.
    # shellcheck disable=SC2016
    node tools/largest-files.mjs "$dir" |
      xargs -P "$jobs" -L1 sh -c \
        'nix store cat --store "$1" "$4" > "$2/$3.bin"' \
        _ "$cache" "$dir/files"

    node tools/build-data.mjs "$system" "${nixpkgs.rev}" "$dir" "$out"
  '';
}
