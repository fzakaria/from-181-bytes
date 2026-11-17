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

- `seeds/index.json`, `seeds/x86.bin`, `seeds/hex0_x86.hex0`: the
  `i686-linux` hex0 seed, the hex0 source it must reproduce, the URL
  nixpkgs fetches it from and the hash it checks. The page maps bytes to
  source lines itself, by assembling the source in the browser.
- `chain.json`: for `i686-linux`, every derivation in the build graph of
  `minimal-bootstrap.gcc-glibc-unwrapped`, the last stage, with the
  stages, who built each derivation, running totals, each stage's
  texture, and the handoff: the store path and size of
  `minimal-bootstrap.gcc-glibc`, the wrapper `pkgs/stdenv/linux/stage0.nix`
  takes GCC 16 and glibc through. The wrapper is shell scripts and
  symlinks that bash writes, so it is not a stage, and it is outside the
  graph: the totals end at the last stage and do not count it.

## What the numbers mean

- **Size of a store path** is the sum of the sizes of its regular files,
  from the cache's `.ls` listing (`nix store ls --store
https://cache.nixos.org -R --json`). It is not the NAR size: hex0's
  output is 181 bytes of file and a 328 byte NAR. Where the cache has no
  `.ls` file, `nix store ls` reads the NAR to list it, so the number is
  still measured.
- **Bytes produced** at a stage is the total size of every built
  derivation in the union of the build closures of that stage and every
  stage before it, each counted once. The seed is not counted: it is
  trusted, not produced. Builder scripts and unpacked source trees count,
  because the chain produced them. `gcc-16.2.0-src`, the unpacked GCC
  source, is 908,239,393 bytes of the 1,761,663,954 on i686-linux.
- **Source read** is the same over fetched derivations: tarballs, patches
  and the stage0-posix source tree.
- **Built by** is computed from the derivation graph, not written by hand.
  For each derivation, a breadth-first walk down its inputs stops at the
  first stage on every path. Of the stages reached, a C compiler beats an
  assembler, which beats a linker, which beats a tool or library. Within
  that, a stage the derivation uses directly (as an input, or named in its
  builder script) beats one reached only through another build, and then
  the later stage wins. `mescc-tools` and `mescc-tools-extra` are marked
  ambient: `kaem.runCommand` puts them on every build's PATH, so being an
  input says nothing about them. `tests/data.test.mjs` checks the result
  against 18 edges read off `pkgs/os-specific/linux/minimal-bootstrap`.
- **Texture** is each stage's largest regular output file, picked from
  the cache's listings and fetched whole with `nix store cat`, cut into
  at most 128 slices of equal length (at least 15 bytes each), each slice
  reduced to its Shannon entropy in bits per byte on a 0 to 15 scale. The
  file's name and size are kept beside the levels. A slice of 16 bytes
  can hold at most 4 bits per byte, so the small early stages read
  darker than large binaries: that is what so few bytes can carry.
- **By way of** (in `chain.json`, not drawn) is the path between a
  derivation and the stage that built it. It is the cheapest path that touches no other stage, where stepping
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
