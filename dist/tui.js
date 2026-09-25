import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import { createMemo, createSignal } from "solid-js";
const STREAM_WINDOW_MS = 5_000;
const LIVE_STALE_MS = 1_500;
const SINGLE_SAMPLE_MS = 1_000;
function estimateTokens(delta) {
  return Math.max(1, Math.ceil(Buffer.byteLength(delta, "utf8") / 5));
}
function formatRate(value) {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  if (value >= 100) return Math.round(value).toString();
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}
function formatTtft(value) {
  if (!Number.isFinite(value) || value < 0) return undefined;
  return `${value.toFixed(1)}s`;
}
function activeDuration(samples, tailAt) {
  if (samples.length === 0) return 0;
  if (samples.length === 1) {
    const tailDuration = tailAt ? Math.max(0, tailAt - samples[0].at) : SINGLE_SAMPLE_MS;
    return Math.min(Math.max(tailDuration, 250), SINGLE_SAMPLE_MS);
  }
  let duration = 0;
  for (let i = 1; i < samples.length; i++) {
    duration += Math.max(0, samples[i].at - samples[i - 1].at);
  }
  if (tailAt) duration += Math.max(0, tailAt - samples[samples.length - 1].at);
  return Math.max(duration, SINGLE_SAMPLE_MS);
}
function Status(props) {
  const content = createMemo(() => {
    props.revision();
    const totals = props.tracker.averages[props.sessionID];
    const average = totals ? formatRate(totals.totalTokens / (totals.totalDurationMs / 1_000)) : undefined;
    const ttft = totals?.stepCount ? formatTtft(totals.totalTtftMs / totals.stepCount / 1_000) : undefined;
    let live;
    if (props.context.data.session.status(props.sessionID) === "running") {
      const now = Date.now();
      const samples = (props.tracker.samples[props.sessionID] ?? []).filter(sample => now - sample.at <= STREAM_WINDOW_MS);
      const last = samples[samples.length - 1];
      if (last && now - last.at <= LIVE_STALE_MS) {
        const tokens = samples.reduce((sum, sample) => sum + sample.tokens, 0);
        live = formatRate(tokens / (activeDuration(samples, now) / 1_000));
      }
    }
    return `TPS ${live ?? "-"} | AVG ${average ?? "-"} | TTFT ${ttft ?? "-"}`;
  });
  return (() => {
    var _el$ = _$createElement("box"),
      _el$2 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$setProp(_el$, "position", "absolute");
    _$setProp(_el$, "right", 2);
    _$setProp(_el$, "bottom", 2);
    _$setProp(_el$, "height", 1);
    _$setProp(_el$, "flexDirection", "row");
    _$setProp(_el$2, "flexShrink", 0);
    _$insert(_el$2, content);
    _$effect(_$p => _$setProp(_el$2, "fg", props.context.theme.text.muted, _$p));
    return _el$;
  })();
}
export default Plugin.define({
  id: "oc-tps",
  setup(context) {
    const tracker = {
      samples: {},
      requestStarts: {},
      timings: {},
      averages: {}
    };
    const [revision, setRevision] = createSignal(0);
    const bump = () => setRevision(value => value + 1);
    const clearLive = sessionID => {
      if (!tracker.samples[sessionID]) return;
      delete tracker.samples[sessionID];
      bump();
    };
    const appendSample = (sessionID, messageID, delta, at) => {
      tracker.samples[sessionID] = [...(tracker.samples[sessionID] ?? []).filter(sample => at - sample.at <= STREAM_WINDOW_MS), {
        at,
        tokens: estimateTokens(delta)
      }];
      const timing = tracker.timings[messageID];
      if (timing && timing.firstResponseAt === undefined) timing.firstResponseAt = at;
      bump();
    };
    const subscriptions = [context.data.on("session.execution.started", event => {
      tracker.requestStarts[event.data.sessionID] = event.created;
    }), context.data.on("session.step.started", event => {
      tracker.timings[event.data.assistantMessageID] = {
        sessionID: event.data.sessionID,
        requestStartAt: tracker.requestStarts[event.data.sessionID] ?? event.created
      };
      delete tracker.requestStarts[event.data.sessionID];
      bump();
    }), context.data.on("session.text.delta", event => {
      appendSample(event.data.sessionID, event.data.assistantMessageID, event.data.delta, event.created);
    }), context.data.on("session.reasoning.delta", event => {
      appendSample(event.data.sessionID, event.data.assistantMessageID, event.data.delta, event.created);
    }), context.data.on("session.tool.input.started", event => {
      clearLive(event.data.sessionID);
      const timing = tracker.timings[event.data.assistantMessageID];
      if (!timing) return;
      timing.firstResponseAt ??= event.created;
      bump();
    }), context.data.on("session.tool.called", event => {
      const timing = tracker.timings[event.data.assistantMessageID];
      if (!timing) return;
      timing.lastToolCallAt = event.created;
      bump();
    }), context.data.on("session.step.ended", event => {
      const timing = tracker.timings[event.data.assistantMessageID];
      if (timing?.firstResponseAt !== undefined) {
        const tokens = event.data.tokens.output + event.data.tokens.reasoning;
        const endAt = event.data.finish === "tool-calls" ? timing.lastToolCallAt ?? event.created : event.created;
        const duration = Math.max(endAt - timing.firstResponseAt, 1);
        if (tokens > 0) {
          const totals = tracker.averages[event.data.sessionID] ?? {
            totalTokens: 0,
            totalDurationMs: 0,
            totalTtftMs: 0,
            stepCount: 0
          };
          tracker.averages[event.data.sessionID] = {
            totalTokens: totals.totalTokens + tokens,
            totalDurationMs: totals.totalDurationMs + duration,
            totalTtftMs: totals.totalTtftMs + Math.max(timing.firstResponseAt - timing.requestStartAt, 0),
            stepCount: totals.stepCount + 1
          };
        }
      }
      delete tracker.timings[event.data.assistantMessageID];
      bump();
    }), context.data.on("session.step.failed", event => {
      delete tracker.timings[event.data.assistantMessageID];
      clearLive(event.data.sessionID);
      bump();
    })];
    for (const type of ["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"]) {
      subscriptions.push(context.data.on(type, event => {
        delete tracker.requestStarts[event.data.sessionID];
        clearLive(event.data.sessionID);
      }));
    }
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [sessionID, samples] of Object.entries(tracker.samples)) {
        const current = samples.filter(sample => now - sample.at <= STREAM_WINDOW_MS);
        if (current.length) tracker.samples[sessionID] = current;else delete tracker.samples[sessionID];
      }
      bump();
    }, 1_000);
    context.ui.slot({
      append: "prompt.footer",
      render: props => {
        if (!props.sessionID || props.mode !== "normal") return null;
        return _$createComponent(Status, {
          context: context,
          get sessionID() {
            return props.sessionID;
          },
          tracker: tracker,
          revision: revision
        });
      }
    });
    return () => {
      subscriptions.forEach(unsubscribe => unsubscribe());
      clearInterval(timer);
    };
  }
});