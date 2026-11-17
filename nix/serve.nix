# `nix run .#serve [port]`: the built site on a local port.
#
# Not a bare `python -m http.server`: store paths carry a 1970 mtime, so a
# conditional request would 304 a previous build's files. Caching is off.
# $FROM181_SITE serves another tree, such as a checkout's site/ directory.
{ pkgs, site }:
pkgs.writeShellApplication {
  name = "serve-site";
  runtimeInputs = [ pkgs.python3 ];
  text = ''
    export FROM181_SITE="''${FROM181_SITE:-${site}}"
    exec python3 - "''${1:-8181}" <<'EOF'
    import http.server, os, sys

    SITE = os.environ["FROM181_SITE"]

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=SITE, **kwargs)

        def send_head(self):
            del self.headers["If-Modified-Since"]
            del self.headers["If-None-Match"]
            return super().send_head()

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

    Handler.extensions_map[".js"] = "text/javascript"
    port = int(sys.argv[1])
    print(f"serving {SITE} on http://127.0.0.1:{port}/", flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
    EOF
  '';
}
