{
  description = "nixpkgs' full-source bootstrap, from a 181 byte seed to gcc 16";

  # The pin is the subject, not only the toolchain: the committed data in
  # site/data describes minimal-bootstrap at exactly this nixpkgs revision,
  # and checks.data-pin fails if the two drift apart. Bump both together
  # with `nix flake update` followed by `nix run .#gen-data`.
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        rec {
          # the static site: everything the pages workflow deploys and
          # `nix run .#serve` tests locally
          site = import ./nix/site.nix {
            inherit pkgs;
            nixpkgsRev = nixpkgs.rev;
            nixpkgsLastModified = nixpkgs.lastModifiedDate;
          };
          default = site;

          # regenerates site/data from the pinned nixpkgs and
          # cache.nixos.org (nix/gen-data.nix)
          gen-data = import ./nix/gen-data.nix {
            inherit pkgs nixpkgs;
          };
        }
      );

      apps = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          # serve the built site, exactly the tree pages deploys.
          # `nix run .#serve -- <port>` overrides the default 8181.
          # $FROM181_SITE serves a checkout's site/ directory instead, for
          # iterating without a rebuild.
          serve = {
            type = "app";
            program = "${
              import ./nix/serve.nix {
                inherit pkgs;
                site = self.packages.${system}.site;
              }
            }/bin/serve-site";
          };

          # `nix run .#gen-data` rewrites site/data in the current checkout.
          gen-data = {
            type = "app";
            program = "${self.packages.${system}.gen-data}/bin/gen-data";
          };
        }
      );

      checks = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          site = self.packages.${system}.site;
        in
        {
          # the site assembles: the entry page, the hashed module tree and
          # the data it fetches are where the build put them
          site = pkgs.runCommand "from-181-bytes-site-check" { } ''
            test -f ${site}/index.html
            test -f ${site}/js.*/app.js
            test -f ${site}/data/seeds/index.json
            test -f ${site}/data/chain.json
            touch $out
          '';

          # The node test suite, offline, over the committed data.
          tests = pkgs.runCommand "from-181-bytes-tests" { nativeBuildInputs = [ pkgs.nodejs ]; } ''
            cd ${self}
            node --test tests/*.test.mjs
            touch $out
          '';

          # The committed data was generated from the nixpkgs this flake
          # locks. Comparing the two revisions needs no network, so a pin
          # bumped without regenerating the data fails here rather than
          # deploying a site that describes a different nixpkgs.
          data-pin = pkgs.runCommand "from-181-bytes-data-pin" { nativeBuildInputs = [ pkgs.jq ]; } ''
            for data in ${self}/site/data/chain.json ${self}/site/data/seeds/index.json; do
              rev=$(jq -r .nixpkgs.rev "$data")
              if [ "$rev" != "${nixpkgs.rev}" ]; then
                echo "$data describes nixpkgs $rev, flake.lock pins ${nixpkgs.rev}" >&2
                echo "run: nix run .#gen-data" >&2
                exit 1
              fi
            done
            touch $out
          '';
        }
        # The page in headless Chromium, served from the built site:
        # hovering, pinning and unpinning a stage, and no sideways scroll
        # from a phone to a desktop (tests/browser). Linux only, where
        # nixpkgs builds Chromium.
        // pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
          browser =
            pkgs.runCommand "from-181-bytes-browser"
              {
                nativeBuildInputs = [
                  pkgs.nodejs
                  pkgs.chromium
                ];
                FONTCONFIG_FILE = pkgs.makeFontsConf { fontDirectories = [ pkgs.dejavu_fonts ]; };
                FROM181_SITE = site;
              }
              ''
                export HOME=$TMPDIR
                cd ${self}
                node --test tests/browser/*.test.mjs
                touch $out
              '';
        }
      );

      formatter = forAllSystems (
        system:
        import ./nix/formatter.nix {
          pkgs = nixpkgs.legacyPackages.${system};
        }
      );

      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs
              pkgs.jq
            ];
          };
        }
      );
    };
}
