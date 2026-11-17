// Fails the build when the main entry point imports any package.
// The main entry must stay small for browsers; Effect belongs to `./schema` only.
import { readFileSync } from "node:fs";

const entry = new URL("../dist/index.mjs", import.meta.url);

// Finds the module name in `from "x"`, `import "x"` and `import("x")`, so that an import loaded
// on demand counts too. It reads the file as plain text, so import-like text inside a string or
// a comment is reported as well. That errs on the safe side: the check can fail wrongly, but it
// cannot pass wrongly, and reading the code properly would need a parser package.
const IMPORT_PATTERN = /(?:\bfrom|\bimport\s*\(?)\s*["']([^"']+)["']/g;

const visited = new Set();
const packageImports = [];

// Reads one built file, then every local file it imports. A bundler may move shared code into
// separate files (chunks), and those may import further chunks.
function inspect(fileUrl) {
  if (visited.has(fileUrl.href)) return;
  visited.add(fileUrl.href);

  const code = readFileSync(fileUrl, "utf8");
  for (const [, name] of code.matchAll(IMPORT_PATTERN)) {
    if (name.startsWith(".")) {
      inspect(new URL(name, fileUrl));
    } else {
      packageImports.push(`${name} (in ${fileUrl.pathname.split("/").pop()})`);
    }
  }
}

inspect(entry);

if (packageImports.length > 0) {
  console.error(
    `dist/index.mjs must import no packages, but loads: ${packageImports.join(", ")}`,
  );
  process.exit(1);
}
console.log(
  `dist/index.mjs imports no packages (${visited.size} file(s) checked).`,
);
