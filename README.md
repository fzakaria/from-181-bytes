# from 181 bytes

nixpkgs' full-source bootstrap, from the 181 byte hex0 seed to GCC 16.2.0.

The page opens on the seed itself: every byte in a grid beside the line of
commented hex0 source that produced it. The browser assembles that source
and checks it against the seed before showing the mapping. Below it the
chain is drawn as a tower, one row per stage in build order, widening on a
log scale as the bytes produced climb from 181 to 1.6 GiB, with an arc from
each stage to the stage that built it. "Who built you?" picks any file in
the final compiler's closure and draws its ancestry down the same tower to
the seed.

At the nixpkgs revision in `flake.lock`, this chain is where the standard
environment starts on `i686-linux` and `x86_64-linux`
(`pkgs/stdenv/linux/stage0.nix`). Other Linux platforms still start from a
prebuilt bootstrap-tools tarball.

## Running

```console
$ nix build                # the static site, ./result
$ nix run .#serve          # build it and serve it on http://127.0.0.1:8181/
$ nix flake check          # tests, the site assembles, data matches the pin
$ nix fmt                  # before committing
```

To iterate on the page without rebuilding, serve the checkout directly:

```console
$ FROM181_SITE=$PWD/site nix run .#serve
```

## Data

`site/data/` is generated and committed. To regenerate it, from the
repository root:

```console
$ nix run .#gen-data
```

It evaluates `pkgs.minimal-bootstrap` at the locked nixpkgs for both
systems, dumps the derivation graph under the last stage with
`nix derivation show -r`, and asks cache.nixos.org for every output's NAR
info and file listing. Nothing in the chain is built. Set `GEN_DATA_WORK` to
a directory to keep what it downloads, so `tools/build-data.mjs` can be rerun
offline. Bumping nixpkgs means `nix flake update` and then `nix run
.#gen-data`; `checks.data-pin` fails until both are done. See
[docs/data.md](docs/data.md) for why the data is committed and what each
number means, and [docs/design.md](docs/design.md) for the page.

## Layout

`site/` is the static site: vanilla ES modules, no bundler and no runtime
dependencies. `site/js/floors.js` is the hand-written description of each
stage; everything measured is in `site/data/`. `tools/` turns what
gen-data collected into that data. `nix/` holds the flake's pieces:
`site.nix` assembles the deployable tree, `gen-data.nix` is the generator,
`chain.nix` and `seed.nix` are what it evaluates, `serve.nix` is the local
server and `formatter.nix` is `nix fmt`. `tests/` is the node suite.

## Credits

- [stage0-posix](https://github.com/oriansj/stage0-posix) and
  [bootstrap-seeds](https://github.com/oriansj/bootstrap-seeds), by Jeremiah
  Orians and contributors.
- [GNU Mes](https://www.gnu.org/software/mes/) and the
  [bootstrappable TinyCC](https://gitlab.com/janneke/tinycc), by Jan
  Nieuwenhuizen and contributors.
- [live-bootstrap](https://github.com/fosslinux/live-bootstrap), which many of
  nixpkgs' build steps cite.
- [bootstrappable.org](https://bootstrappable.org/).
- nixpkgs' minimal-bootstrap, started by Emily Trau in
  [#227914](https://github.com/NixOS/nixpkgs/pull/227914) and hooked into the
  standard environment by Aleksi Hannula in
  [#479322](https://github.com/NixOS/nixpkgs/pull/479322).

## License

MIT, please see [LICENSE](LICENSE). The files under `site/data/seeds/` come
from stage0-posix and bootstrap-seeds and are GPL-3.0-or-later.
