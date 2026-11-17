# `nix build .#site`: the whole deployable tree, so the pages workflow
# only uploads what nix built.
#
#   index.html, style.css, js.<hash>/   the site
#   data/                               the seed, its hex0 source and the
#                                       chain (committed; docs/data.md),
#                                       each named name.<hash>.ext
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
pkgs.runCommand "from-181-bytes-site" { nativeBuildInputs = [ pkgs.jq ]; } ''
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

  # GitHub Pages lets browsers cache every file for ten minutes, so a file
  # fetched by a fixed name can come from the previous deploy while the
  # page comes from this one. Each data file is renamed name.<hash>.ext,
  # leaves first: the seed and its source, then the index that names
  # them, then the chain; app.js is pointed at the new names before the
  # module tree is hashed. checks.site fails if any name is left plain.
  hashed() {
    local file=$1 base ext sum
    base=$(basename "$file")
    ext=''${base##*.}
    sum=$(sha256sum "$file" | cut -c1-12)
    mv "$file" "$(dirname "$file")/''${base%.*}.$sum.$ext"
    echo "''${base%.*}.$sum.$ext"
  }
  seeds=$out/data/seeds
  binary=$(jq -r .seed.files.binary "$seeds/index.json")
  source=$(jq -r .seed.files.source "$seeds/index.json")
  binary_hashed=$(hashed "$seeds/$binary")
  source_hashed=$(hashed "$seeds/$source")
  jq --arg binary "$binary_hashed" --arg source "$source_hashed" \
    '.seed.files = { binary: $binary, source: $source }' \
    "$seeds/index.json" > index.json.new
  mv index.json.new "$seeds/index.json"
  index_hashed=$(hashed "$seeds/index.json")
  chain_hashed=$(hashed "$out/data/chain.json")
  substituteInPlace $out/js/app.js \
    --replace-fail '"seeds/index.json"' "\"seeds/$index_hashed\"" \
    --replace-fail '"chain.json"' "\"$chain_hashed\""

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
