// Tests tools/lib/listing.js, which turns the `nix store ls -R --json`
// listings cache.nixos.org serves into file sizes, and picks the file a
// stage's texture is drawn from.
// The single-file case is the real listing of hex1's output; the nested
// one is a small hand-made tree with a symlink, the shape gcc's output has.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  listingBytes,
  largestFile,
  largestAcross,
} from "../tools/lib/listing.js";

// hex1's output, as `nix store ls --store https://cache.nixos.org -R
// --json` printed it: a store path that is one executable file.
const hex1 = { executable: true, narOffset: 128, size: 689, type: "regular" };

const tree = {
  type: "directory",
  entries: {
    bin: {
      type: "directory",
      entries: {
        gcc: { type: "regular", size: 1000, executable: true },
        cc: { type: "symlink", target: "gcc" },
      },
    },
    lib: {
      type: "directory",
      entries: {
        "libgcc.a": { type: "regular", size: 250 },
        empty: { type: "directory", entries: {} },
      },
    },
  },
};

// A store path's size is the sum of its regular files' contents, with
// no NAR framing: hex1 is 689 bytes, not its NAR size.
test("bytes are the sum of regular file sizes", () => {
  assert.equal(listingBytes(hex1), 689);
  assert.equal(listingBytes(tree), 1250);
});

// A stage's bar is textured from its largest regular file. Symlinks and
// directories never win; a store path that is one file is that file, at
// the empty relative path.
test("the largest regular file is picked, a lone file at the empty path", () => {
  assert.deepEqual(largestFile(hex1), { path: "", size: 689 });
  assert.deepEqual(largestFile(tree), { path: "bin/gcc", size: 1000 });
  assert.equal(largestFile({ type: "directory", entries: {} }), null);
});

// A stage with several outputs is textured from the largest file in any
// of them, kept with its full store path. A store path that is the file
// is named by its store path's name without the hash.
test("the largest file across outputs carries its full path", () => {
  const listings = {
    "/nix/store/aaa-hex1": hex1,
    "/nix/store/bbb-gcc": tree,
  };
  assert.deepEqual(
    largestAcross(Object.keys(listings), (path) => listings[path]),
    { path: "/nix/store/bbb-gcc/bin/gcc", file: "bin/gcc", size: 1000 },
  );
  assert.deepEqual(
    largestAcross(["/nix/store/aaa-hex1"], (path) => listings[path]),
    { path: "/nix/store/aaa-hex1", file: "hex1", size: 689 },
  );
});
