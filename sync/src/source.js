// Reads an archyl.yaml with the files its include directives reach and the
// files its docs and API contracts take their body from, the way the archyl
// CLI does. The server stores the text it is sent: it cannot read the checkout.
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");

const MAX_FILES = 499;
const MAX_FILE_BYTES = 5 << 20;
const MAX_TOTAL_BYTES = 50 << 20;

function parse(content) {
  try {
    const doc = YAML.parse(content);
    return doc && typeof doc === "object" ? doc : {};
  } catch {
    // The server reports a file that does not parse.
    return {};
  }
}

function strings(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

function records(value) {
  return Array.isArray(value) ? value.filter((v) => v && typeof v === "object") : [];
}

// includes lists a file's include directives.
function includes(content) {
  return strings(parse(content).include);
}

// references lists the files the docs and API contracts of a file name. A
// record with inline content needs none: the content wins.
function references(content) {
  const doc = parse(content);
  const all = records(doc.docs && doc.docs.records).concat(records(doc.api_contracts));
  return all
    .filter((r) => typeof r.file === "string" && r.file.trim() !== "" && !r.content)
    .map((r) => r.file);
}

// resolve joins a path to the directory of the file declaring it. It returns
// null for an absolute path or one that climbs out of the base.
function resolve(from, target) {
  const cleaned = String(target).trim().replace(/\\/g, "/");
  if (cleaned === "" || cleaned.startsWith("/") || cleaned.includes(":")) {
    return null;
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), cleaned));
  if (resolved === "." || resolved === ".." || resolved.startsWith("../")) {
    return null;
  }
  return resolved;
}

// readRegular reads a regular file. A symbolic link could point outside the
// repository (a key, a .env file), and the content is sent to the server.
function readRegular(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile()) {
    throw new Error("not a regular file: symbolic links and special files are not sent");
  }
  if (info.size > MAX_FILE_BYTES) {
    throw new Error(`larger than ${MAX_FILE_BYTES >> 20} MiB`);
  }
  return fs.readFileSync(file, "utf8");
}

// load returns { content, path, files } for the file at `file`, a path
// relative to `base` (the repository root).
function load(base, file) {
  const root = path.relative(base, path.resolve(base, file)).split(path.sep).join("/");
  if (root === "" || root.startsWith("../") || path.isAbsolute(root)) {
    throw new Error(`${file} is outside the repository`);
  }
  const content = readRegular(path.join(base, root));
  if (!content.trim()) {
    throw new Error(`${file} is empty`);
  }

  const files = {};
  const contents = { [root]: content };
  let total = Buffer.byteLength(content);
  const add = (from, resolved, verb) => {
    if (Object.keys(files).length >= MAX_FILES) {
      throw new Error(`more than ${MAX_FILES} included and referenced files`);
    }
    let body;
    try {
      body = readRegular(path.join(base, resolved));
    } catch (err) {
      if (err.code === "ENOENT") {
        throw new Error(`${from} ${verb} ${resolved}, which does not exist`);
      }
      throw new Error(`${from} ${verb} ${resolved}: ${err.message}`);
    }
    total += Buffer.byteLength(body);
    if (total > MAX_TOTAL_BYTES) {
      throw new Error(`the files are larger than ${MAX_TOTAL_BYTES >> 20} MiB together`);
    }
    files[resolved] = body;
    return body;
  };

  const queue = [root];
  while (queue.length > 0) {
    const from = queue.shift();
    for (const include of includes(contents[from])) {
      const resolved = resolve(from, include);
      if (resolved === null) {
        throw new Error(`${from} includes "${include}", which is outside the repository`);
      }
      if (resolved in contents) {
        continue;
      }
      contents[resolved] = add(from, resolved, "includes");
      queue.push(resolved);
    }
  }

  // A referenced file is named from the repository root, whichever file
  // declares the record.
  for (const from of Object.keys(contents).sort()) {
    for (const ref of references(contents[from])) {
      const resolved = resolve(".", ref);
      if (resolved === null) {
        throw new Error(`${from} names the file "${ref}", which is outside the repository`);
      }
      if (resolved in files || resolved === root) {
        continue;
      }
      add(from, resolved, "names the file");
    }
  }

  return { content, path: root, files };
}

module.exports = { load, includes, references, resolve };
