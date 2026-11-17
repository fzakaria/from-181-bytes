# Evaluated by gen-data, once per system: the derivation and output
# paths of every floor in site/js/floors.js, at the pinned nixpkgs. The
# last floor is the root `nix derivation show -r` starts from.
{
  nixpkgs,
  system,
  # site/js/floors.js's attribute paths, as a JSON list
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
  floors = lib.genAttrs (builtins.fromJSON attrs) describe;
}
