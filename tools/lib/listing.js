// Store path listings, as `nix store ls -R --json` prints them from a
// binary cache's .ls files: nested { type, size, entries, target }.

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

// Every file in a listing, sorted by path: [path, size] for a regular
// file and [path, null, target] for a symlink.
export function listingFiles(listing) {
  const files = [];
  for (const [path, entry] of walk(listing)) {
    if (entry.type === Type.REGULAR) {
      files.push([path, entry.size]);
    } else if (entry.type === Type.SYMLINK) {
      files.push([path, null, entry.target]);
    }
  }
  return files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

// Directories whose files go first when a list is over the cap: headers
// and shared data, which nobody needs to trace one file at a time.
const BULK_PREFIXES = ["include/", "share/"];

// Keep a file list under `cap` entries. Over the cap, drop BULK_PREFIXES;
// still over, drop the whole list. Returns the files kept and how many
// were left out.
export function capFiles(files, cap) {
  if (files.length <= cap) {
    return { files, omitted: 0 };
  }
  const kept = files.filter(
    ([path]) => !BULK_PREFIXES.some((prefix) => path.startsWith(prefix)),
  );
  if (kept.length <= cap) {
    return { files: kept, omitted: files.length - kept.length };
  }
  return { files: [], omitted: files.length };
}
