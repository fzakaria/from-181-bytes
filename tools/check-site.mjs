// Checks a built site (nix/site.nix's output) for the stale-cache bug:
// GitHub Pages lets browsers cache every file for ten minutes, so a file
// fetched by a fixed name can come from the previous deploy while the
// page comes from this one. Every data file must therefore carry its
// content hash in its name, and every reference to one must use that
// name.
//
//   node tools/check-site.mjs <site>
//
// Exits non-zero, naming each problem, when the site fetches a data file
// by a name without a hash or names one that is not there.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

// A content hash in a file name: twelve hex digits between dots, as
// nix/site.nix writes them (name.<hash>.ext).
const HASHED = /\.[0-9a-f]{12}(\.[a-z0-9]+)$/;
// A quoted path in a module that names a hashed data file.
const HASHED_REFERENCE = /["'`]([\w./-]+\.[0-9a-f]{12}\.[a-z0-9]+)["'`]/g;
const DATA = "data";
const SEEDS = "seeds";

const [site] = process.argv.slice(2);
const problems = [];

// Every file under data/, relative to it.
function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* files(path);
      continue;
    }
    yield relative(join(site, DATA), path);
  }
}

// A hashed reference is good when the file is there.
function checkReference(where, name) {
  if (!HASHED.test(name)) {
    problems.push(`${where} names ${name}, which has no content hash`);
    return;
  }
  if (!existsSync(join(site, DATA, name))) {
    problems.push(`${where} names ${name}, which is not in ${DATA}/`);
  }
}

// The data files themselves, and the names they had before hashing.
const plainNames = [];
for (const file of files(join(site, DATA))) {
  if (!HASHED.test(file)) {
    problems.push(`${DATA}/${file} has no content hash in its name`);
  }
  plainNames.push(file.replace(HASHED, "$1"));
}

// The modules and the page: no quoted plain data file name, and every
// hashed one present.
const jsDir = readdirSync(site).find((name) => name.startsWith("js."));
const sources = [
  ["index.html", readFileSync(join(site, "index.html"), "utf8")],
  ...readdirSync(join(site, jsDir)).map((module) => [
    `${jsDir}/${module}`,
    readFileSync(join(site, jsDir, module), "utf8"),
  ]),
];
const references = [];
for (const [where, text] of sources) {
  for (const plain of plainNames) {
    if (new RegExp(`["'\`/]${plain.replaceAll(".", "\\.")}["'\`]`).test(text)) {
      problems.push(`${where} names ${plain}, which has no content hash`);
    }
  }
  for (const [, name] of text.matchAll(HASHED_REFERENCE)) {
    references.push(name);
    checkReference(where, name);
  }
}

// The seed index's references to the seed and its source.
const index = references.find((name) => name.startsWith(`${SEEDS}/index`));
if (!index) {
  problems.push("no module names a hashed seed index");
} else if (existsSync(join(site, DATA, index))) {
  const { seed } = JSON.parse(readFileSync(join(site, DATA, index), "utf8"));
  if (!seed.files) {
    problems.push(`${index} has no files entry naming the seed and source`);
  }
  for (const name of Object.values(seed.files ?? {})) {
    references.push(`${SEEDS}/${name}`);
    checkReference(index, `${SEEDS}/${name}`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${references.length} data references, all content-hashed`);
