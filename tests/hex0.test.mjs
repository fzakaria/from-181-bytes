// Tests the hex0 assembler in site/js/hex0.js, which the seed explorer uses
// to tie every seed byte to the line of source that produced it. The small
// cases pin the format's rules on hand-written input; the seed case runs the
// real x86 hex0 source in site/data/seeds and requires the output to equal
// the seed nixpkgs fetches, byte for byte. The listing helpers split, hang
// and colour source lines for the page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  assemble,
  describeLine,
  headings,
  expandTabs,
  lineStops,
  lineSegments,
  hangColumn,
  tokenizeSegment,
  Token,
} from "../site/js/hex0.js";

const seedsDir = fileURLToPath(new URL("../site/data/seeds/", import.meta.url));

// Hex pairs become bytes, and each byte remembers its 0-based source line.
test("pairs of hex digits become bytes tagged with their line", () => {
  const { bytes, lines } = assemble("7F 45\n4C 46\n");
  assert.deepEqual([...bytes], [0x7f, 0x45, 0x4c, 0x46]);
  assert.deepEqual(lines, [0, 0, 1, 1]);
});

// '#' and ';' both start a comment that runs to the end of the line, and
// hex digits inside a comment are not assembled.
test("comments run to the end of the line", () => {
  const { bytes, lines } = assemble("01 # 02 03\n; 04\n05 ; AB # CD\n");
  assert.deepEqual([...bytes], [0x01, 0x05]);
  assert.deepEqual(lines, [0, 2]);
});

// Lower-case digits are accepted, and anything that is neither a digit nor
// a comment marker is skipped.
test("lower case digits count and other characters are skipped", () => {
  const { bytes } = assemble("ab\tc-d xyz 0f\n");
  assert.deepEqual([...bytes], [0xab, 0xcd, 0x0f]);
});

// The two digits of a byte need not share a line: the assembler only
// counts digits, and a newline does not reset the half-built byte. The
// byte is attributed to the line holding its second digit, the digit that
// makes the assembler write it.
test("a byte split across lines belongs to the line of its second digit", () => {
  const { bytes, lines } = assemble("4\n1\n");
  assert.deepEqual([...bytes], [0x41]);
  assert.deepEqual(lines, [1]);
});

// describeLine splits a stage0 source line into the hex it holds, the
// mnemonic after ';' and the explanation after '#', which is what the
// byte tooltip shows.
test("a source line splits into hex, mnemonic and comment", () => {
  const parts = describeLine(
    "\t6A 05                       ; push !5                     # prepare to set eax to 5",
  );
  assert.deepEqual(parts, {
    hex: "6A 05",
    mnemonic: "push !5",
    comment: "prepare to set eax to 5",
  });
  assert.deepEqual(describeLine("01 00   # e_phnum number of entries"), {
    hex: "01 00",
    mnemonic: "",
    comment: "e_phnum number of entries",
  });
});

// headings gives each line the section it sits under: the last `## Title`
// or `#:label` above it, which the explorer uses to group bytes.
test("each line sits under the nearest heading or label above it", () => {
  const lines = [
    "# intro",
    "## ELF Header",
    "7F",
    "#:_start ; (0x804804C)",
    "58 ; pop_eax",
  ];
  assert.deepEqual(headings(lines), [
    "",
    "ELF Header",
    "ELF Header",
    ":_start",
    ":_start",
  ]);
});

// Tabs become spaces up to the next multiple of eight columns, so the
// listing can be measured in character columns.
test("tabs expand to the next eight-column stop", () => {
  assert.equal(expandTabs("\t58"), "        58");
  assert.equal(expandTabs("ab\tc"), "ab      c");
  assert.equal(expandTabs("12345678\tx"), "12345678        x");
  assert.equal(expandTabs("no tabs"), "no tabs");
});

// The columns a wrapped line may hang from, left to right: where the hex
// starts, the ';' of a mnemonic, the '#' of a comment and the comment's
// first word. A line with no hex hangs from its comment alone.
test("a line's hang stops are its indent, ';', '#' and comment text", () => {
  assert.deepEqual(
    lineStops("    58      ; pop_eax   # Get the count"),
    [4, 12, 24, 26],
  );
  assert.deepEqual(lineStops("7F 45 4C 46   ## e_ident"), [0, 14, 17]);
  assert.deepEqual(lineStops("# SPDX-License-Identifier: GPL"), [0, 2]);
  assert.deepEqual(lineStops("#:ELF_base"), [0, 1]);
  assert.deepEqual(lineStops("01 00"), [0]);
  assert.deepEqual(lineStops(""), []);
});

// A line splits into the hex, the mnemonic from ';' and the comment
// from '#', each with its starting column; the pieces join back into the
// line. A ';' inside the comment does not start a mnemonic.
test("a line splits into hex, mnemonic and comment segments", () => {
  const line = "    58      ; pop_eax   # Get; the count";
  const segments = lineSegments(line);
  assert.deepEqual(segments, [
    { start: 0, text: "    58      " },
    { start: 12, text: "; pop_eax   " },
    { start: 24, text: "# Get; the count" },
  ]);
  assert.equal(segments.map(({ text }) => text).join(""), line);
  assert.deepEqual(lineSegments("# only a comment"), [
    { start: 0, text: "# only a comment" },
  ]);
  assert.deepEqual(lineSegments("01 00"), [{ start: 0, text: "01 00" }]);
  assert.deepEqual(lineSegments(""), []);
});

// Syntax highlighting works segment by segment, as lineSegments cuts
// them. In the hex, digit runs are bytes and the rest is plain. After ';'
// the words are a mnemonic, except label references (!loop, @next_byte,
// $output, ^~Read_byte). After '#' everything is comment, except a label
// definition (#:ELF_base, # :_start). Adjacent tokens of one kind merge,
// and the tokens join back into the segment.
test("segments tokenize into hex, mnemonics, references, comments, labels", () => {
  const T = Token;
  assert.deepEqual(tokenizeSegment("    7F 45 4C 46"), [
    { kind: T.PLAIN, text: "    " },
    { kind: T.HEX, text: "7F" },
    { kind: T.PLAIN, text: " " },
    { kind: T.HEX, text: "45" },
    { kind: T.PLAIN, text: " " },
    { kind: T.HEX, text: "4C" },
    { kind: T.PLAIN, text: " " },
    { kind: T.HEX, text: "46" },
  ]);
  assert.deepEqual(tokenizeSegment("; jne !cont"), [
    { kind: T.MNEMONIC, text: "; jne " },
    { kind: T.REF, text: "!cont" },
  ]);
  assert.deepEqual(tokenizeSegment("; ^~Read_byte CALL"), [
    { kind: T.MNEMONIC, text: "; " },
    { kind: T.REF, text: "^~Read_byte" },
    { kind: T.MNEMONIC, text: " CALL" },
  ]);
  assert.deepEqual(tokenizeSegment("; $output DATA_OFFSET 40 00"), [
    { kind: T.MNEMONIC, text: "; " },
    { kind: T.REF, text: "$output" },
    { kind: T.MNEMONIC, text: " DATA_OFFSET 40 00" },
  ]);
  assert.deepEqual(tokenizeSegment("#:ELF_base"), [
    { kind: T.COMMENT, text: "#" },
    { kind: T.LABEL, text: ":ELF_base" },
  ]);
  assert.deepEqual(tokenizeSegment("# :_start ; (0x804804C)"), [
    { kind: T.COMMENT, text: "# " },
    { kind: T.LABEL, text: ":_start" },
    { kind: T.COMMENT, text: " ; (0x804804C)" },
  ]);
  // A colon inside a word or before a space is not a label, and an '@'
  // in a comment is not a reference.
  assert.deepEqual(
    tokenizeSegment("# SPDX-FileCopyrightText: 2023 <andrius@stikonas.eu>"),
    [
      {
        kind: T.COMMENT,
        text: "# SPDX-FileCopyrightText: 2023 <andrius@stikonas.eu>",
      },
    ],
  );
  assert.deepEqual(tokenizeSegment(""), []);

  for (const line of ["\t58   ; pop_eax   # Get the number", "#:loop"]) {
    for (const segment of lineSegments(expandTabs(line))) {
      const tokens = tokenizeSegment(segment.text);
      assert.equal(tokens.map(({ text }) => text).join(""), segment.text);
    }
  }
});

// A wrapped line hangs from the rightmost stop that still leaves room for
// the rest to read; with no such stop it hangs from column 0.
test("the hang is the rightmost stop that leaves room", () => {
  const stops = [4, 12, 24, 26];
  assert.equal(hangColumn(stops, 80, 20), 26);
  assert.equal(hangColumn(stops, 45, 20), 24);
  assert.equal(hangColumn(stops, 40, 20), 12);
  assert.equal(hangColumn(stops, 30, 20), 4);
  assert.equal(hangColumn(stops, 20, 20), 0);
  assert.equal(hangColumn([], 80, 20), 0);
});

// The real thing: assembling the stage0 hex0 source reproduces the x86
// seed nixpkgs fetches exactly, and every seed byte maps to a line that
// is not a comment.
const { seed: entry } = JSON.parse(
  readFileSync(`${seedsDir}index.json`, "utf8"),
);
test(`${entry.source} reproduces the ${entry.size} byte ${entry.arch} seed`, () => {
  const seed = readFileSync(`${seedsDir}${entry.arch}.bin`);
  const source = readFileSync(`${seedsDir}${entry.source}`, "utf8");
  const { bytes, lines } = assemble(source);

  assert.equal(seed.length, entry.size);
  assert.equal(bytes.length, seed.length);
  assert.deepEqual(Buffer.from(bytes), seed);

  const text = source.split("\n");
  for (const line of lines) {
    assert.match(describeLine(text[line]).hex, /^[0-9A-Fa-f]/);
  }
});
