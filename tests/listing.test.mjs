// Tests tools/lib/listing.js, which turns the `nix store ls -R --json`
// listings cache.nixos.org serves into file sizes and flat file lists.
// The single-file case is the real listing of hex1's output; the nested
// one is a small hand-made tree with a symlink, the shape gcc's output has.
import { test } from "node:test";
import assert from "node:assert/strict";

import { listingBytes, listingFiles, capFiles } from "../tools/lib/listing.js";

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

// Files come out flat and sorted by path: [path, size] for a regular
// file, [path, null, target] for a symlink, nothing for a directory. A
// store path that is itself a file is listed under the empty path.
test("files are listed flat and sorted, symlinks with their target", () => {
  assert.deepEqual(listingFiles(hex1), [["", 689]]);
  assert.deepEqual(listingFiles(tree), [
    ["bin/cc", null, "gcc"],
    ["bin/gcc", 1000],
    ["lib/libgcc.a", 250],
  ]);
});

// A store path with thousands of files would make the page's file data
// megabytes. Over the cap, headers and shared data go first; if that is
// still too many, the list goes entirely. Either way the count of files
// left out is kept, so the page can say so.
test("long file lists drop include/ and share/, then everything", () => {
  const files = [
    ["bin/gcc", 1],
    ["include/a.h", 1],
    ["include/b.h", 1],
    ["share/doc", 1],
    ["lib/x.a", 1],
  ];
  assert.deepEqual(capFiles(files, 10), { files, omitted: 0 });
  assert.deepEqual(capFiles(files, 3), {
    files: [
      ["bin/gcc", 1],
      ["lib/x.a", 1],
    ],
    omitted: 3,
  });
  assert.deepEqual(capFiles(files, 1), { files: [], omitted: 5 });
});
