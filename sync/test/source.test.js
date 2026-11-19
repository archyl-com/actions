const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { load } = require("../src/source");

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archyl-sync-"));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return dir;
}

test("sends included files and the files docs and contracts name", () => {
  const dir = tree({
    "services/archyl.yaml":
      'version: "1.0"\ninclude: [api.yaml]\ndocs:\n  records:\n    - title: Guide\n      file: ./docs/guide.md\n    - title: Inline\n      file: docs/unread.md\n      content: inline wins\n',
    "services/api.yaml": "api_contracts:\n  - name: Orders\n    file: api/orders.yaml\n",
    "docs/guide.md": "# Guide\n",
    "api/orders.yaml": "openapi: 3.1.0\n",
  });

  const source = load(dir, "services/archyl.yaml");

  assert.strictEqual(source.path, "services/archyl.yaml");
  assert.deepStrictEqual(Object.keys(source.files).sort(), ["api/orders.yaml", "docs/guide.md", "services/api.yaml"]);
  assert.strictEqual(source.files["docs/guide.md"], "# Guide\n");
});

test("a file alone sends nothing else", () => {
  const dir = tree({ "archyl.yaml": 'version: "1.0"\n' });
  assert.deepStrictEqual(load(dir, "archyl.yaml").files, {});
});

test("refuses a doc whose file is missing or outside the repository", () => {
  const missing = tree({ "archyl.yaml": "docs:\n  records:\n    - title: Guide\n      file: docs/guide.md\n" });
  assert.throws(() => load(missing, "archyl.yaml"), /names the file docs\/guide.md, which does not exist/);

  const outside = tree({ "archyl.yaml": "docs:\n  records:\n    - title: Guide\n      file: ../../etc/passwd\n" });
  assert.throws(() => load(outside, "archyl.yaml"), /outside the repository/);
});

test("does not follow a symbolic link", () => {
  const dir = tree({ "archyl.yaml": "docs:\n  records:\n    - title: Guide\n      file: link.md\n", "real.md": "x" });
  fs.symlinkSync(path.join(dir, "real.md"), path.join(dir, "link.md"));
  assert.throws(() => load(dir, "archyl.yaml"), /not a regular file/);
});
