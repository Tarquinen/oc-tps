import { afterEach, expect, test } from "bun:test"
import { Plugin } from "@opencode/plugin/tui"
import { RGBA } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { render, type JSX } from "@opentui/solid"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"
import { createSignal } from "solid-js"

const entrypoint = process.env.OPENCODE_TPS_TEST_ENTRYPOINT
if (entrypoint) ensureRuntimePluginSupport({ additional: { "@opencode/plugin/tui": { Plugin } } })
const { default: plugin }: typeof import("../tui") = await import(entrypoint ?? "../tui")

let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); dispose = undefined })

type Event = { created: number; data: { sessionID: string; assistantMessageID: string; [key: string]: unknown } }

async function mount() {
  const screen = await createTestRenderer({ width: 90, height: 8 })
  const listeners = new Map<string, (event: Event) => void>()
  const [sessionID, setSessionID] = createSignal("one")
  const [status, setStatus] = createSignal("running")
  let footer: (props: { sessionID: string; mode: string }) => JSX.Element = () => null
  let cleanup: (() => void) | undefined
  const context = {
    data: {
      on(type: string, callback: (event: Event) => void) {
        listeners.set(type, callback)
        return () => listeners.delete(type)
      },
      session: { status },
    },
    theme: { text: { muted: RGBA.fromHex("#dddddd") } },
    ui: { slot(input: { render: typeof footer }) { footer = input.render } },
  }
  dispose = () => { cleanup?.(); screen.renderer.destroy() }
  await render(() => {
    cleanup = plugin.setup(context as never) as () => void
    return footer({ get sessionID() { return sessionID() }, mode: "normal" })
  }, screen.renderer)
  await screen.renderOnce()
  return {
    ...screen, listeners, setSessionID, setStatus,
    unload() { cleanup?.(); cleanup = undefined },
    emit(type: string, created: number, data: Record<string, unknown> = {}) {
      listeners.get(type)?.({ created, data: { sessionID: sessionID(), assistantMessageID: "message", ...data } })
    },
  }
}

test("stream events update live TPS, averages, and TTFT without remounting", async () => {
  const f = await mount()
  expect(f.captureCharFrame()).toContain("TPS - | AVG - | TTFT -")
  const now = Date.now()
  f.emit("session.execution.started", now - 1500)
  f.emit("session.step.started", now - 1500)
  f.emit("session.text.delta", now - 1000, { delta: "x".repeat(50) })
  await f.renderOnce()
  expect(f.captureCharFrame()).toContain("TPS 10.0")
  f.emit("session.step.ended", now, { tokens: { output: 20, reasoning: 0 }, finish: "stop" })
  await f.renderOnce()
  expect(f.captureCharFrame()).toContain("AVG 20.0 | TTFT 0.5s")
  // Host-owned signals must also invalidate the plugin's computations.
  f.setStatus("idle")
  await f.renderOnce()
  expect(f.captureCharFrame()).toContain("TPS - | AVG 20.0 | TTFT 0.5s")
})

test("switching sessions displays the correct accumulated metrics", async () => {
  const f = await mount()
  const now = Date.now()
  for (const [sessionID, tokens] of [["one", 20], ["two", 60]] as const) {
    f.setSessionID(sessionID)
    await f.renderOnce()
    expect(f.captureCharFrame()).toContain("TPS - | AVG - | TTFT -")
    f.emit("session.execution.started", now - 1500)
    f.emit("session.step.started", now - 1500)
    f.emit("session.reasoning.delta", now - 1000, { delta: "thinking" })
    f.emit("session.step.ended", now, { tokens: { output: tokens, reasoning: 0 }, finish: "stop" })
    await f.renderOnce()
    expect(f.captureCharFrame()).toContain(`AVG ${tokens}.0 | TTFT 0.5s`)
  }
  f.setSessionID("one")
  await f.renderOnce()
  expect(f.captureCharFrame()).toContain("AVG 20.0 | TTFT 0.5s")
})

test("unloading unsubscribes from session events", async () => {
  const f = await mount()
  expect(f.listeners.size).toBeGreaterThan(0)
  f.unload()
  expect(f.listeners.size).toBe(0)
})
