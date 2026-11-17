// Tests site/js/format.js, the byte formatting on the gauges: small sizes
// stay exact so the seed reads as 181 B, large ones get binary units.
import { test } from "node:test";
import assert from "node:assert/strict";

import { humanBytes, count } from "../site/js/format.js";

test("bytes below a KiB are exact, larger ones use binary units", () => {
  assert.equal(humanBytes(181), "181 B");
  assert.equal(humanBytes(1023), "1023 B");
  assert.equal(humanBytes(1536), "1.5 KiB");
  assert.equal(humanBytes(28 * 1024 * 1024), "28 MiB");
});

test("counts get thousands separators", () => {
  assert.equal(count(1234567), "1,234,567");
});
