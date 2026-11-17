# `nix build .#site`: the whole deployable tree, so the pages workflow
# only uploads what nix built.
#
#   index.html, style.css, js.<hash>/   the site
#   data/                               the seed, its hex0 source and the
#                                       chain (committed; docs/data.md)
{
  pkgs,
  nixpkgsRev,
  # the flake input's lastModifiedDate, YYYYMMDDhhmmss
  nixpkgsLastModified,
}:
let
  inherit (builtins) substring;
  # The footer's date for the nixpkgs revision, YYYY-MM-DD.
  nixpkgsDate = "${substring 0 4 nixpkgsLastModified}-${substring 4 2 nixpkgsLastModified}-${
    substring 6 2 nixpkgsLastModified
  }";
in
pkgs.runCommand "from-181-bytes-site" { } ''
  mkdir -p $out
  # The site directory alone, so a change to a test or a doc does not
  # rebuild the site.
  cp -r ${../site}/. $out/
  chmod -R u+w $out

  # The footer names the store path serving the page and the date of the
  # nixpkgs revision, and the links into nixpkgs name that revision.
  substituteInPlace $out/index.html \
    --replace-fail "__STORE_PATH__" "$out" \
    --replace-fail "__NIXPKGS_DATE__" "${nixpkgsDate}" \
    --replace-quiet "__NIXPKGS_REV__" "${nixpkgsRev}"

  # Hash the module tree and rename it js.<hash>, so the served HTML and
  # the modules it imports can never be a mismatched pair across deploys.
  hash=$(find $out/js -type f | LC_ALL=C sort |
    xargs sha256sum | sha256sum | cut -c1-12)
  mv $out/js "$out/js.$hash"
  substituteInPlace $out/index.html --replace-fail "js/app.js" "js.$hash/app.js"

  # The stylesheet is fetched by a fixed name, so its content hash rides
  # as a query string instead.
  css=$(sha256sum $out/style.css | cut -c1-12)
  substituteInPlace $out/index.html --replace-fail '"style.css"' "\"style.css?v=$css\""
''
