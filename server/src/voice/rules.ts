import fs from "node:fs";

/**
 * rules.md, read once. It sits beside this module in src/ and is copied beside the compiled one
 * in dist/ by the server's build script, so the same path works under tsx, vitest and node.
 */
let rules: string | undefined;

export function loadVoiceRules(): string {
  rules ??= fs.readFileSync(new URL("./rules.md", import.meta.url), "utf8").trim();
  return rules;
}
