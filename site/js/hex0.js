// The hex0 format, as the stage0-posix hex0 seed reads it.
//
// The seed is a loop over input characters. A newline ends any comment.
// Inside a comment every character is skipped. '#' and ';' start a
// comment. A hex digit (either case) is a nibble, and every second nibble
// writes one byte. Every other character is skipped. Nothing else exists:
// no labels, no addresses, no escapes. The nibble count is not reset by a
// newline, so a byte's two digits may sit on different lines.
//
// See hex0_x86.hex0 in https://github.com/oriansj/stage0-posix-x86, which
// is the source of the 181 byte x86 seed and documents this loop
// instruction by instruction.

const NEWLINE = "\n";
const COMMENT_MARKERS = new Set(["#", ";"]);
const NIBBLE_BITS = 4;

// The value of a hex digit, or -1 for any other character.
function nibble(ch) {
  const code = ch.charCodeAt(0);
  if (ch >= "0" && ch <= "9") {
    return code - 48;
  }
  if (ch >= "A" && ch <= "F") {
    return code - 55;
  }
  if (ch >= "a" && ch <= "f") {
    return code - 87;
  }
  return -1;
}

// Assemble hex0 source text. Returns the bytes and, for each byte, the
// 0-based index of the source line holding the digit that completed it.
export function assemble(source) {
  const bytes = [];
  const lines = [];
  let line = 0;
  let inComment = false;
  let high = -1;

  for (const ch of source) {
    // A newline ends a comment and moves to the next line; it does not
    // touch a half-built byte.
    if (ch === NEWLINE) {
      inComment = false;
      line += 1;
      continue;
    }
    if (inComment) {
      continue;
    }
    if (COMMENT_MARKERS.has(ch)) {
      inComment = true;
      continue;
    }

    const value = nibble(ch);
    if (value < 0) {
      continue;
    }

    // The first digit of a pair waits for the second.
    if (high < 0) {
      high = value;
      continue;
    }
    bytes.push((high << NIBBLE_BITS) | value);
    lines.push(line);
    high = -1;
  }

  return { bytes: Uint8Array.from(bytes), lines };
}

// Split one stage0 source line into the hex it holds, the mnemonic after
// ';' and the explanation after '#'. stage0 writes instruction lines as
// `<hex> ; <mnemonic> # <comment>` and data lines as `<hex> # <comment>`.
// Lines with no hex come back with an empty hex field.
export function describeLine(text) {
  const firstMarker = text.search(/[#;]/);
  const code = firstMarker < 0 ? text : text.slice(0, firstMarker);
  const rest = firstMarker < 0 ? "" : text.slice(firstMarker);

  // The mnemonic is whatever sits between a leading ';' and the first '#'.
  let mnemonic = "";
  let comment = "";
  if (rest.startsWith(";")) {
    const hash = rest.indexOf("#");
    mnemonic = (hash < 0 ? rest.slice(1) : rest.slice(1, hash)).trim();
    comment = hash < 0 ? "" : rest.slice(hash + 1).trim();
  } else if (rest.startsWith("#")) {
    comment = rest.slice(1).trim();
  }

  return { hex: code.trim(), mnemonic, comment };
}

// The heading a line sits under: the nearest earlier `## Title` or
// `#:label` line, which is how stage0 marks sections and jump targets.
// Returns one entry per line, an empty string before the first heading.
export function headings(sourceLines) {
  const out = [];
  let current = "";
  for (const text of sourceLines) {
    const trimmed = text.trim();
    const title = trimmed.match(/^##\s+(.*)$/);
    const label = trimmed.match(/^#:(\S+)/);
    if (title) {
      current = title[1];
    } else if (label) {
      current = `:${label[1]}`;
    }
    out.push(current);
  }
  return out;
}

// The listing wraps long lines instead of scrolling sideways. To keep
// wrapped lines readable, each line hangs its continuation rows from one
// of its own columns, measured in characters after tabs are expanded.

const TAB_WIDTH = 8;
const TAB = "\t";
const MNEMONIC_MARKER = ";";
const COMMENT_MARKER = "#";

// Replace each tab with spaces up to the next TAB_WIDTH column.
export function expandTabs(text) {
  let out = "";
  for (const ch of text) {
    if (ch !== TAB) {
      out += ch;
      continue;
    }
    out += " ".repeat(TAB_WIDTH - (out.length % TAB_WIDTH));
  }
  return out;
}

// The columns a wrapped line may hang from, in increasing order: where its
// first non-space character sits, the ';' of a mnemonic, the '#' of the
// comment, and the comment's first word. `text` has no tabs.
export function lineStops(text) {
  const stops = new Set();
  const indent = text.search(/\S/);
  if (indent < 0) {
    return [];
  }
  stops.add(indent);

  // A mnemonic marker counts only before the comment starts.
  const hash = text.indexOf(COMMENT_MARKER);
  const semicolon = text.indexOf(MNEMONIC_MARKER);
  if (semicolon >= 0 && (hash < 0 || semicolon < hash)) {
    stops.add(semicolon);
  }

  // The comment: its run of '#' and the word after it.
  if (hash >= 0) {
    stops.add(hash);
    const word = text.slice(hash).search(/[^#\s]/);
    if (word >= 0) {
      stops.add(hash + word);
    }
  }
  return [...stops].sort((a, b) => a - b);
}

// Split a line into the segments that may move to a row of their own
// when it wraps: the hex, the mnemonic from ';' and the comment from '#'.
// Each is { start, text }, text keeping the spaces that follow it, so the
// segments join back into the line. `text` has no tabs.
export function lineSegments(text) {
  if (text === "") {
    return [];
  }
  const hash = text.indexOf(COMMENT_MARKER);
  const semicolon = text.indexOf(MNEMONIC_MARKER);

  // Where each segment after the first starts.
  const cuts = [];
  if (semicolon > 0 && (hash < 0 || semicolon < hash)) {
    cuts.push(semicolon);
  }
  if (hash > 0) {
    cuts.push(hash);
  }

  const starts = [0, ...cuts];
  return starts.map((start, i) => ({
    start,
    text: text.slice(start, starts[i + 1] ?? text.length),
  }));
}

// The rightmost stop that leaves at least `room` columns of a
// `columns`-wide pane for the text hung from it, or 0 when none does.
export function hangColumn(stops, columns, room) {
  let hang = 0;
  for (const stop of stops) {
    if (columns - stop < room) {
      break;
    }
    hang = stop;
  }
  return hang;
}
