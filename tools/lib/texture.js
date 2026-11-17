// A stage's texture: its largest output file cut into equal slices, each
// slice's byte entropy in bits per byte on a 16-step scale from 0 to 8.
// Zero padding is flat, text is in the middle, machine code sits higher
// and compressed data at the top, so the strip shows what a file is made
// of without drawing every byte. A slice of 16 bytes holds at most 4 bits
// per byte, so a tiny file reads lighter than a large one: that is what
// so few bytes can carry.

// At most this many slices per file, and as many slices of at least this
// many bytes as fit, so a tiny file gets a few honest slices rather than
// 128 slices of one byte each.
const MAX_SLICES = 128;
const MIN_SLICE = 16;

// The scale: one hex digit per slice.
const LEVELS = 16;
const HEX_RADIX = 16;
const BYTE_VALUES = 256;
const BITS_PER_BYTE = 8;

// Shannon entropy of `bytes`, in bits per byte, as a share of the 8 bits
// a byte can carry.
function entropyShare(bytes) {
  const counts = new Uint32Array(BYTE_VALUES);
  for (const value of bytes) {
    counts[value] += 1;
  }
  let bits = 0;
  for (const count of counts) {
    if (count === 0) {
      continue;
    }
    const p = count / bytes.length;
    bits -= p * Math.log2(p);
  }
  return bits / BITS_PER_BYTE;
}

// The strip for a file's bytes: { levels }, one hex digit per slice.
// The file is cut into as many slices as MIN_SLICE allows, at most
// MAX_SLICES, of lengths that differ by at most one byte.
export function entropyStrip(bytes) {
  if (bytes.length === 0) {
    return { levels: "" };
  }
  const slices = Math.max(
    1,
    Math.min(MAX_SLICES, Math.floor(bytes.length / MIN_SLICE)),
  );
  let levels = "";
  for (let i = 0; i < slices; i += 1) {
    const start = Math.floor((i * bytes.length) / slices);
    const end = Math.floor(((i + 1) * bytes.length) / slices);
    const share = entropyShare(bytes.subarray(start, end));
    levels += Math.round(share * (LEVELS - 1)).toString(HEX_RADIX);
  }
  return { levels };
}
