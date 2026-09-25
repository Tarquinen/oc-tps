// Build the TUI entry to dist/tui.js.
//
// Why precompile: opencode applies its own Solid JSX transform to plugin
// sources, but that transform skips files that live under a node_modules
// path. A published raw .tsx therefore ends up on a non-reactive JSX
// runtime and only ever renders once (see issue #19). Shipping compiled
// output - like every other V2 TUI plugin does - avoids that path.
//
// generate: "universal" is required because the host runtime module
// (@opentui/solid) exposes the custom-renderer helpers
// (createComponent/createElement/insertNode/setProp/...) but not the
// DOM-only `template`/`setAttribute` helpers.
import { transformAsync } from "@babel/core";
import presetTypeScript from "@babel/preset-typescript";
import presetSolid from "babel-preset-solid";
import { readFile, mkdir, writeFile } from "node:fs/promises";

const SRC = "tui.tsx";
const OUT = "dist/tui.js";

const code = await readFile(SRC, "utf8");
const result = await transformAsync(code, {
  filename: SRC,
  babelrc: false,
  configFile: false,
  presets: [
    [presetTypeScript, { isTSX: true, allExtensions: true }],
    [presetSolid, { moduleName: "@opentui/solid", generate: "universal" }],
  ],
});

await mkdir("dist", { recursive: true });
await writeFile(OUT, result.code);
console.log(`built ${OUT} (${result.code.length} bytes)`);
