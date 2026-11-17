// A browser for the page tests: site/ served over HTTP from this process,
// and headless Chromium driven over the DevTools protocol. No test
// framework beyond node:test, so the check runs offline in the Nix
// sandbox with only nodejs and chromium.
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

// The site to serve: $FROM181_SITE (the flake check points it at the
// built site), or the checkout's site/ directory.
const SITE = `${normalize(
  process.env.FROM181_SITE ??
    fileURLToPath(new URL("../../site/", import.meta.url)),
)}/`.replace(/\/+$/, "/");
const CHROMIUM = process.env.CHROMIUM ?? "chromium";

const CONTENT_TYPES = Object.freeze({
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".hex0": "text/plain",
  ".bin": "application/octet-stream",
});
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

// How long to wait for Chromium's DevTools endpoint, and for the page's
// data and first draw after a navigation.
const DEVTOOLS_POLL_MS = 100;
const DEVTOOLS_ATTEMPTS = 100;
const SETTLE_MS = 1500;

// Serve site/ on a free port. Resolves to { url, close }.
async function serve() {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    const file = normalize(
      join(SITE, path.endsWith("/") ? `${path}index.html` : path),
    );
    if (!file.startsWith(SITE)) {
      response.writeHead(HTTP_NOT_FOUND).end();
      return;
    }
    try {
      const body = await readFile(file);
      response
        .writeHead(HTTP_OK, {
          "content-type":
            CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
          "cache-control": "no-store",
        })
        .end(body);
    } catch {
      response.writeHead(HTTP_NOT_FOUND).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// Start Chromium and the server. Returns a browser with open(path,
// width, height) for a page, and close().
export async function launch() {
  const site = await serve();
  const profile = await mkdtemp(join(tmpdir(), "from-181-bytes-"));
  const chrome = spawn(
    CHROMIUM,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  // Chromium prints the DevTools URL on stderr once it listens.
  const endpoint = await new Promise((resolve, reject) => {
    let seen = "";
    chrome.stderr.on("data", (chunk) => {
      seen += chunk;
      const match = seen.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        resolve(match[1]);
      }
    });
    chrome.on("exit", (code) =>
      reject(new Error(`chromium exited ${code}: ${seen}`)),
    );
  });
  const httpBase = endpoint.replace(/^ws:\/\/([^/]+)\/.*$/, "http://$1");

  async function open(path, width, height) {
    // A fresh tab per page, so state never leaks between tests.
    let target = null;
    for (let i = 0; i < DEVTOOLS_ATTEMPTS && !target; i += 1) {
      try {
        target = await (
          await fetch(`${httpBase}/json/new?about:blank`, { method: "PUT" })
        ).json();
      } catch {
        await sleep(DEVTOOLS_POLL_MS);
      }
    }
    const page = await connect(target.webSocketDebuggerUrl);
    await page.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.send("Page.navigate", { url: new URL(path, site.url).href });
    await sleep(SETTLE_MS);
    return page;
  }

  return {
    open,
    async close() {
      // Wait for Chromium to exit before removing its profile, which it
      // writes to until it is gone.
      const exited = new Promise((resolve) => chrome.once("exit", resolve));
      chrome.kill();
      await exited;
      await site.close();
      await rm(profile, { recursive: true, force: true });
    },
  };
}

// One tab over the DevTools protocol: send(method, params), plus the
// helpers the tests use.
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve) => {
    socket.onopen = resolve;
  });
  let next = 0;
  const pending = new Map();
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      next += 1;
      pending.set(next, resolve);
      socket.send(JSON.stringify({ id: next, method, params }));
    });

  // Evaluate an expression in the page and return its value.
  async function evaluate(expression) {
    const reply = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (reply.result.exceptionDetails) {
      throw new Error(reply.result.exceptionDetails.exception.description);
    }
    return reply.result.result.value;
  }

  const mouse = (type, x, y, extra = {}) =>
    send("Input.dispatchMouseEvent", { type, x, y, ...extra });

  return {
    send,
    evaluate,
    // Move the pointer to (x, y), firing enter and leave events on the way.
    move: (x, y) => mouse("mouseMoved", x, y),
    // A left click at (x, y).
    async click(x, y) {
      await mouse("mouseMoved", x, y);
      await mouse("mousePressed", x, y, { button: "left", clickCount: 1 });
      await mouse("mouseReleased", x, y, { button: "left", clickCount: 1 });
    },
    // Press and release a key, e.g. "Escape".
    async key(key) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key });
    },
    close: () => socket.close(),
  };
}
