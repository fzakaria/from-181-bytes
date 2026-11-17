// Number formatting shared across views, the same rules as seenix.

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB"];
const BYTE_BASE = 1024;

// Exact below a KiB, so the seed reads as "181 B". Above that, one
// decimal below 10 and whole numbers from 10: "1.5 KiB", "28 MiB".
export function humanBytes(n) {
  let value = n;
  let unit = 0;
  while (value >= BYTE_BASE && unit < BYTE_UNITS.length - 1) {
    value /= BYTE_BASE;
    unit += 1;
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

// A count with thousands separators.
export const count = (n) => n.toLocaleString("en-US");
