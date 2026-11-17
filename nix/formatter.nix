# `nix fmt`. The tree wrapper, matching seenix and nixpkgs-multiverse: one
# formatting step covers every language in the tree. prettier for the
# site's JS and CSS, and for markdown at the width the docs are written
# to.
{ pkgs }:
pkgs.nixfmt-tree.override {
  runtimeInputs = [
    pkgs.prettier
  ];
  settings = {
    # The generated data and the stage0 sources copied beside it are not
    # ours to format: the data is rewritten by `nix run .#gen-data`, and
    # the hex0 sources have to stay byte for byte what upstream ships.
    global.excludes = [
      "site/data/*"
      "tests/fixtures/*"
    ];
    formatter.prettier = {
      command = "prettier";
      options = [ "--write" ];
      includes = [
        "*.js"
        "*.mjs"
        "*.css"
        "*.html"
      ];
    };
    # proseWrap stays at its default of preserving the author's line
    # breaks: these files are hand-wrapped prose, and reflowing would make
    # every future diff a whole-file diff.
    formatter.prettier-markdown = {
      command = "prettier";
      options = [
        "--write"
        "--print-width"
        "80"
      ];
      includes = [ "*.md" ];
    };
  };
}
