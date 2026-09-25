# oc-tps

OpenCode 2 TUI plugin that displays live TPS, average TPS, and average time to first token in the session prompt.

![Demo](./assets/demo.gif)

## Installation

Install from the CLI:

```bash
opencode plugin add oc-tps@latest
```

## Live TPS accuracy

The live number is the only estimated one. Deltas are counted in UTF-16 code units (`String.length`, the same unit opencode uses for its own fallback estimate) and multiplied by a tokens-per-character ratio. A character is not a token, and the two streams do not even share a ratio: reasoning is mostly ASCII prose, while the visible output of a CJK session is mostly CJK. So `reasoning` and `text` are calibrated - and used - separately. Each ratio starts from a rounded seed (`0.3` for reasoning, `0.5` for text; measured against real traffic a reasoning step runs at ~0.25-0.31 tokens per character while a text step runs at ~0.48-0.61 depending on the language) and is re-learned from the provider-reported counts in `session.step.ended` with an exponential moving average. A stream only learns from the tokens it produced itself, so a step that is pure reasoning cannot drag the text ratio around, and observations outside `0.15-1.5` tokens per character are dropped rather than clamped as a second line of defence. Steps that end with a tool call are left out of the text stream and its calibration altogether (`finish === "tool-calls"`): a tool call puts its arguments into the output token count without ever streaming them as text, which reads as several tokens per character (3.1 was measured) and would otherwise drag the text ratio up for the rest of the session.

`AVG` and `TTFT` never estimate - they use the provider token counts and the event timestamps. `AVG` is session-cumulative: it spans every step of the session, it never resets, and its duration excludes tool execution time. That is why it deliberately disagrees with the per-message `tok/s` opencode prints at the end of each assistant message.

Set `showCalibration` to append the ratios the live estimate is currently using, again reasoning first: `TPS 74.2 (0.28/0.56)`. They are not measurements, they are the numbers behind the estimate, and they are printed for exactly that reason - so the estimate can be audited. Set `showStreams` to print the speed of each stream next to the average: `AVG 61.8 (74.2/238.1)`. Each component is measured over its own streaming span - the first to the last delta of that stream - so these are the speeds of reasoning and of output rather than their shares of the total, and they deliberately do not add up to the average in front of them. Reasoning is usually the slower one, because it arrives in bursts with pauses in between. A step only contributes to a stream's number when that stream actually streamed for at least 250ms, and steps that end with a tool call are left out of the output number entirely, because their arguments are reported as output tokens but never arrive as text deltas.

### Options

Pass them through the plugin entry in `cli.json`:

```json
{ "plugins": [{ "package": "oc-tps@latest", "options": { "windowMs": 2000 } }] }
```

| option | default | meaning |
| --- | --- | --- |
| `windowMs` | `1000` | rolling window used for the live rate |
| `liveStaleMs` | `1500` | show `-` when no delta arrived for this long |
| `minSamples` | `2` | minimum deltas in the window before a rate is shown |
| `minWindowMs` | `250` | minimum window span before a rate is shown (clamped to `windowMs`) |
| `calibrationAlpha` | `0.3` | EMA weight of a new tokens-per-character observation |
| `liveSmoothing` | `0.4` | EMA weight applied to the live rate itself |
| `tickMs` | `250` | how often the window is re-evaluated while idle |
| `initialTokensPerChar.reasoning` | `0.3` | starting reasoning ratio until the model has been seen |
| `initialTokensPerChar.text` | `0.5` | starting text ratio until the model has been seen |
| `showCalibration` | `false` | print the live tokens-per-character ratios after TPS as `(reasoning/text)` |
| `showStreams` | `false` | print the speed of each stream next to the average as `total (reasoning/output)` |

`initialTokensPerChar` also accepts a single number, which is applied to both streams.

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
