# Data

Everything the page states as a number comes from `site/data/`, which
`nix run .#gen-data` writes. This file says where each number comes from
and why the data is committed rather than built.

## Why it is committed

The data needs the network and a Nix daemon. gen-data evaluates nixpkgs,
which writes `.drv` files to the store, and asks cache.nixos.org for NAR
info and file listings. Neither works inside a sandboxed build, so the data
cannot be a derivation that `nix build` produces. Generating it in CI
instead would make every deploy depend on cache.nixos.org answering a few
hundred requests, and on the cache still holding these paths.

The data also changes only when the pin does. It describes
`pkgs.minimal-bootstrap` at the nixpkgs revision in `flake.lock`, and the
same revision always produces the same derivations, sizes and file lists.
Committing it makes `nix build` hermetic and the deployed site a function
of the commit. `checks.data-pin` compares the revision recorded in each
data file with `flake.lock`, offline, so a bumped pin without regenerated
data fails `nix flake check` rather than deploying.

## Files

- `seeds/index.json`, `seeds/<arch>.bin`, `seeds/hex0_<arch>.hex0`: the
  hex0 seed for each stage0 architecture nixpkgs evaluates (x86, AMD64,
  AArch64, riscv64), the hex0 source it must reproduce, the URL nixpkgs
  fetches it from and the hash it checks. The page maps bytes to source
  lines itself, by assembling the source in the browser.
- `chain-<system>.json`: for `i686-linux` and `x86_64-linux`, every
  derivation in the build graph of `minimal-bootstrap.gcc-glibc`, the
  floors, who built each derivation, and running totals.
- `files-<system>.json`: every file in the runtime closure of that last
  floor, for "who built you?".

## What the numbers mean

- **Size of a store path** is the sum of the sizes of its regular files,
  from the cache's `.ls` listing (`nix store ls --store
https://cache.nixos.org -R --json`). It is not the NAR size: hex0's
  output is 181 bytes of file and a 328 byte NAR. Where the cache has no
  `.ls` file, `nix store ls` reads the NAR to list it, so the number is
  still measured.
- **Bytes produced** at a floor is the total size of every built
  derivation in the union of the build closures of that floor and every
  floor before it, each counted once. The seed is not counted: it is
  trusted, not produced. Builder scripts and unpacked source trees count,
  because the chain produced them. `gcc-16.2.0-src`, the unpacked GCC
  source, is 908,239,393 bytes of the 1,763,330,048 on i686-linux.
- **Source read** is the same over fetched derivations: tarballs, patches
  and the stage0-posix source tree.
- **Built by** is computed from the derivation graph, not written by hand.
  For each derivation, a breadth-first walk down its inputs stops at the
  first floor on every path. Of the floors reached, a C compiler beats an
  assembler, which beats a linker, which beats a tool or library. Within
  that, a floor the derivation uses directly (as an input, or named in its
  builder script) beats one reached only through another build, and then
  the later floor wins. `mescc-tools` and `mescc-tools-extra` are marked
  ambient: `kaem.runCommand` puts them on every build's PATH, so being an
  input says nothing about them. `tests/data.test.mjs` checks the result
  against 18 edges read off `pkgs/os-specific/linux/minimal-bootstrap`.
- **By way of** is the path between a derivation and the floor that built
  it. It is the cheapest path that touches no other floor, where stepping
  through a derivation named like either end (`tinycc-boot3` between
  `tinycc-bootstrappable` and `mes`) is cheaper than through anything else.
  That makes it follow the compiler's lineage rather than the shortest
  route through a tool such as coreutils.

## What is left out

- **Build times.** Hydra's JSON API for
  `minimal-bootstrap.gcc-latest.x86_64-linux` returned a build whose start
  and stop times are equal (1794043214), and per-step times are only on
  HTML build pages, for whatever derivations Hydra built most recently
  rather than the pinned ones. No time on the page would have been
  measured for these derivations, so there are none.
- **Large file lists.** `libstdcxx-16.2.0` has 13,753 files, most of them
  headers, and `gcc-16.2.0-src` has 158,989. `files-<system>.json` lists
  at most 2,000 files per store path: over that, files under `include/`
  and `share/` are dropped, and if that is still too many the path is
  listed by count only. The page says how many it left out.
