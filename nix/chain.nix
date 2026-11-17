# Evaluated by gen-data for i686-linux: the derivation and output
# paths of every stage in site/js/stages.js, and of the wrapper the
# standard environment receives, at the pinned nixpkgs. The last stage is
# the root `nix derivation show -r` starts from.
{
  nixpkgs,
  system,
  # tools/stage-attrs.mjs's output: { stages, handoff } attribute paths
  attrs,
}:
let
  pkgs = import nixpkgs { inherit system; };
  inherit (pkgs) lib minimal-bootstrap;

  lookup =
    path:
    lib.attrByPath (lib.splitString "." path) (throw "no attribute minimal-bootstrap.${path}")
      minimal-bootstrap;

  describe =
    path:
    let
      drv = lookup path;
    in
    {
      inherit (drv) drvPath name;
      outputs = lib.genAttrs (drv.outputs or [ "out" ]) (output: drv.${output}.outPath);
    };
  wanted = builtins.fromJSON attrs;
in
{
  stage0Arch = minimal-bootstrap.stage0-posix.stage0Arch;
  stages = lib.genAttrs wanted.stages describe;
  handoff = describe wanted.handoff;
}
