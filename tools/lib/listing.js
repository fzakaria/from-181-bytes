// Store path listings, as `nix store ls -R --json` prints them from a
// binary cache's .ls files: nested { type, size, entries, target }.

// A store path's base name is "<hash>-<name>".
const HASH_SEPARATOR = "-";

const Type = Object.freeze({
  REGULAR: "regular",
  SYMLINK: "symlink",
  DIRECTORY: "directory",
});

// Visit every entry below `entry` with its path relative to the root.
function* walk(entry, path = "") {
  yield [path, entry];
  if (entry.type !== Type.DIRECTORY) {
    return;
  }
  for (const [name, child] of Object.entries(entry.entries ?? {})) {
    yield* walk(child, path === "" ? name : `${path}/${name}`);
  }
}

// The bytes of file content in a listing: regular files only, so a
// store path is measured by what it holds rather than its NAR size.
export function listingBytes(listing) {
  let total = 0;
  for (const [, entry] of walk(listing)) {
    if (entry.type === Type.REGULAR) {
      total += entry.size;
    }
  }
  return total;
}

// The largest regular file in a listing, { path, size }, with the path
// relative to the store path ("" when the store path is the file), or
// null when there is none. A stage's bar is textured from this file.
export function largestFile(listing) {
  let largest = null;
  for (const [path, entry] of walk(listing)) {
    if (entry.type !== Type.REGULAR) {
      continue;
    }
    if (largest && largest.size >= entry.size) {
      continue;
    }
    largest = { path, size: entry.size };
  }
  return largest;
}

// The largest regular file across several store paths, given a function
// that returns each path's listing: { path, file, size }, where path is
// the file's full store path and file names it for a reader, relative to
// its store path, or the store path's name without its hash when the
// path is the file.
export function largestAcross(storePaths, listingOf) {
  let best = null;
  for (const storePath of storePaths) {
    const found = largestFile(listingOf(storePath));
    if (!found || (best && best.size >= found.size)) {
      continue;
    }
    const base = storePath.slice(storePath.lastIndexOf("/") + 1);
    const name = base.slice(base.indexOf(HASH_SEPARATOR) + 1);
    best = {
      path: found.path === "" ? storePath : `${storePath}/${found.path}`,
      file: found.path === "" ? name : found.path,
      size: found.size,
    };
  }
  return best;
}
