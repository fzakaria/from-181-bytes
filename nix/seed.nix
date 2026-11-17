# Evaluated by gen-data for i686-linux: where the hex0 seed comes from and
# which source tree holds the hex0 it must reproduce.
{ nixpkgs, system }:
let
  stage0 = (import nixpkgs { inherit system; }).minimal-bootstrap.stage0-posix;
in
{
  arch = stage0.stage0Arch;
  seed = stage0.hex0-seed.outPath;
  url = stage0.hex0-seed.url;
  hash = stage0.hex0-seed.outputHash;
  src = stage0.src.outPath;
  version = stage0.version;
  inherit system;
  seedDrv = stage0.hex0-seed.drvPath;
  srcDrv = stage0.src.drvPath;
}
