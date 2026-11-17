# Evaluated by gen-data for i686-linux: the derivation and output
# paths of every stage in site/js/stages.js, at the pinned nixpkgs. The
# last stage is the root `nix derivation show -r` starts from.
{
  nixpkgs,
  system,
  # site/js/stages.js's attribute paths, as a JSON list
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
in
{
  stage0Arch = minimal-bootstrap.stage0-posix.stage0Arch;
  stages = lib.genAttrs (builtins.fromJSON attrs) describe;
}
