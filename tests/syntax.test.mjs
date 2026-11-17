// Tests that every module the page loads parses. Most of them touch the
// DOM and cannot be imported under node, so a syntax error would show up
// only as a blank page. Each file goes to `node --check`, which parses
// without running.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const siteJs = fileURLToPath(new URL("../site/js/", import.meta.url));

for (const name of readdirSync(siteJs).filter((file) => file.endsWith(".js"))) {
  test(`${name} parses`, () => {
    assert.doesNotThrow(() =>
      execFileSync(process.execPath, ["--check", `${siteJs}${name}`], {
        stdio: "pipe",
      }),
    );
  });
}
