# oc-tps

OpenCode 2 TUI plugin that displays live TPS, average TPS, and average time to first token in the session prompt.

![Demo](./assets/demo.gif)

## Installation

Install from the CLI:

```bash
opencode plugin add oc-tps@latest
```

## Build

`./tui` resolves to **compiled** output (`dist/tui.js`), not to the raw `tui.tsx`.

OpenCode transforms plugin sources with its own Solid JSX transform, but that transform
skips every file under a `node_modules` path. A published raw `.tsx` therefore ends up on
a non-reactive JSX runtime: the panel renders once and then never updates (see #19).
Shipping compiled output - as the other V2 TUI plugins do - avoids that path entirely.

`npm run build` compiles `tui.tsx` with `babel-preset-solid` and
`generate: "universal"`. The universal output is required because the host runtime module
(`@opentui/solid`) exports the custom-renderer helpers (`createComponent`, `createElement`,
`insertNode`, `setProp`, ...) but **not** the DOM-only `template` / `setAttribute` helpers.

The build output is committed (`dist/tui.js`) so that the published package and
`opencode plugin add oc-tps@latest` keep working without relying on a build step in the
release pipeline. Run `npm run build` after editing `tui.tsx`.

## Runtime dependencies

`solid-js`, `@opentui/solid`, `@opentui/core` and `@opencode/plugin` are provided by
OpenCode, so they are declared as **optional** peer dependencies on purpose.

Do not move them into `dependencies`: npm would install a private copy next to the plugin
instead of letting OpenCode provide the single shared runtime. `devDependencies` still
lets `npm run typecheck` and `npm run build` resolve the types and the Babel presets
locally.
