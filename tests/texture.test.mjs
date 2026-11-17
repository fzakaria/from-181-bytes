// Tests tools/lib/texture.js, which turns a stage's largest output file
// into the strip its bar is drawn with: the file cut into equal slices,
// each slice's byte entropy in bits per byte, out of 8, as one hex digit:
// 0 for a run of one value and f for all 256 values equally often.
import { test } from "node:test";
import assert from "node:assert/strict";

import { entropyStrip } from "../tools/lib/texture.js";

const ALL_BYTES = 256;

// A file of one repeated byte has no entropy anywhere.
test("a run of one byte value is all zeros", () => {
  const strip = entropyStrip(new Uint8Array(4096));
  assert.match(strip.levels, /^0+$/);
});

// Slices where every byte value appears equally often are at the top of
// the scale: 8 bits per byte.
test("evenly spread bytes are at the top of the scale", () => {
  const bytes = new Uint8Array(ALL_BYTES * 128);
  bytes.forEach((_, i) => {
    bytes[i] = i % ALL_BYTES;
  });
  const strip = entropyStrip(bytes);
  assert.equal(strip.levels.length, 128);
  assert.match(strip.levels, /^f+$/);
});

// A slice of 32 distinct values, each once, has 5 bits per byte: 5/8 of
// the way up the scale, level 9.
test("the scale is absolute bits per byte, not relative to the slice", () => {
  const bytes = new Uint8Array(32 * 128);
  bytes.forEach((_, i) => {
    bytes[i] = i % 32;
  });
  assert.match(entropyStrip(bytes).levels, /^9+$/);
});

// Text sits in the middle: an English sentence uses a few dozen byte
// values, unevenly, about 4 bits per byte.
test("text lands in the middle of the scale", () => {
  const text = new TextEncoder().encode(
    "The one binary nixpkgs downloads instead of building. ".repeat(80),
  );
  const strip = entropyStrip(text);
  for (const level of strip.levels) {
    const value = parseInt(level, 16);
    assert.ok(value >= 5 && value <= 10, `level ${level}`);
  }
});

// A file never yields more than 128 slices, and slices are as equal as
// whole bytes allow, none shorter than 15: the 181 byte seed becomes 11
// slices, a megabyte 128.
test("slice count is bounded and slices are equal", () => {
  assert.equal(entropyStrip(new Uint8Array(181)).levels.length, 11);
  assert.equal(entropyStrip(new Uint8Array(1_000_000)).levels.length, 128);
  assert.equal(entropyStrip(new Uint8Array(10)).levels.length, 1);
  assert.deepEqual(entropyStrip(new Uint8Array(0)), { levels: "" });
});
