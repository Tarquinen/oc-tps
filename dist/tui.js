import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import { createMemo, createSignal } from "solid-js";

// The two streams a step can generate. They are calibrated separately because
// a character is not a token, and the density differs per stream: reasoning is
// mostly ASCII prose, while the visible output of a CJK session is mostly CJK.

// Overridable from cli.json:
//   { "plugins": [{ "package": "oc-tps@latest", "options": { "windowMs": 2000 } }] }

const DEFAULTS = {
  windowMs: 1_000,
  liveStaleMs: 1_500,
  minSamples: 2,
  minWindowMs: 250,
  calibrationAlpha: 0.3,
  liveSmoothing: 0.4,
  tickMs: 250,
  tokensPerChar: {
    reasoning: 0.3,
    text: 0.5
  },
  showCalibration: false,
  showStreams: false
};

// A character is not a token, and the two streams are not alike: measured
// against the provider-reported counts a reasoning step runs at roughly 0.28
// tokens per character while a CJK text step runs at roughly 0.57, so the
// ratio is learned per model *and* per stream from `session.step.ended`,
// starting from the rounded seeds above.
const MIN_TOKENS_PER_CHAR = 0.15;
const MAX_TOKENS_PER_CHAR = 1.5;
const MIN_CALIBRATION_CHARS = 20;
const UNKNOWN_MODEL = "unknown";
// A stream that only produced a delta or two is too short to be called a rate,
// so such a step contributes to neither the numerator nor its denominator.
const MIN_STREAM_SPAN_MS = 250;
function emptyChars() {
  return {
    reasoning: 0,
    text: 0
  };
}
function spanMs(span) {
  if (!span) return 0;
  return Math.max(span.last - span.first, 0);
}
function boundedNumber(value, fallback, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}
function readTokensPerChar(value) {
  const ratio = (candidate, fallback) => boundedNumber(candidate, fallback, MIN_TOKENS_PER_CHAR, MAX_TOKENS_PER_CHAR);

  // `initialTokensPerChar: 0.5` still works and applies to both streams.
  if (typeof value === "number") {
    const both = ratio(value, DEFAULTS.tokensPerChar.reasoning);
    return {
      reasoning: both,
      text: both
    };
  }
  const source = value ?? {};
  return {
    reasoning: ratio(source.reasoning, DEFAULTS.tokensPerChar.reasoning),
    text: ratio(source.text, DEFAULTS.tokensPerChar.text)
  };
}
function readOptions(raw) {
  const source = raw ?? {};
  const windowMs = boundedNumber(source.windowMs, DEFAULTS.windowMs, 100, 30_000);
  // A minimum span larger than the window can never be reached, and a
  // non-positive one would divide by a zero span, so it is clamped into the
  // window and kept above zero.
  const minWindowMs = Math.max(1, Math.min(boundedNumber(source.minWindowMs, DEFAULTS.minWindowMs, 1, 30_000), windowMs));
  return {
    windowMs,
    liveStaleMs: boundedNumber(source.liveStaleMs, DEFAULTS.liveStaleMs, 100, 30_000),
    minSamples: Math.round(boundedNumber(source.minSamples, DEFAULTS.minSamples, 1, 1_000)),
    minWindowMs,
    calibrationAlpha: boundedNumber(source.calibrationAlpha, DEFAULTS.calibrationAlpha, 0.01, 1),
    liveSmoothing: boundedNumber(source.liveSmoothing, DEFAULTS.liveSmoothing, 0, 1),
    tickMs: boundedNumber(source.tickMs, DEFAULTS.tickMs, 50, 10_000),
    tokensPerChar: readTokensPerChar(source.initialTokensPerChar),
    showCalibration: source.showCalibration === true,
    showStreams: source.showStreams === true
  };
}
function formatRate(value) {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  if (value >= 100) return Math.round(value).toString();
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}
function formatComponent(value) {
  if (value === undefined) return "-";
  return formatRate(value) ?? "-";
}
function formatTtft(value) {
  if (!Number.isFinite(value) || value < 0) return undefined;
  return `${value.toFixed(1)}s`;
}
function formatRatio(value) {
  return Number(value.toFixed(2)).toString();
}
function ratioOf(tracker, options, model, kind) {
  return (model ? tracker.calibration[model]?.[kind]?.ratio : undefined) ?? options.tokensPerChar[kind];
}
function Status(props) {
  const content = createMemo(() => {
    props.revision();
    const totals = props.tracker.averages[props.sessionID];
    const perSecond = totals ? totals.totalDurationMs / 1_000 : 0;
    const average = totals ? formatRate(totals.totalTokens / perSecond) : undefined;
    // Each component is measured over its own streaming span instead of the
    // shared generation time, so these are the speeds of the two streams rather
    // than their shares of the total, and they do not add up to the average in
    // front of them. Order is reasoning first, then text.
    const reasoningRate = totals?.totalReasoningMs ? totals.totalReasoningTokens / (totals.totalReasoningMs / 1_000) : undefined;
    const textRate = totals?.totalTextMs ? totals.totalOutputTokens / (totals.totalTextMs / 1_000) : undefined;
    const streams = props.options.showStreams && totals ? ` (${formatComponent(reasoningRate)}/${formatComponent(textRate)})` : "";
    const ttft = totals?.stepCount ? formatTtft(totals.totalTtftMs / totals.stepCount / 1_000) : undefined;
    const live = props.tracker.live[props.sessionID];
    const fresh = live?.rate !== undefined && Date.now() - live.at <= props.options.liveStaleMs;
    const rate = fresh && live?.rate !== undefined ? formatRate(live.rate) : undefined;
    // The ratios the live estimate is currently using. Not measurements: they
    // are printed so the estimate can be audited, and the order is reasoning
    // first, then text, matching the AVG split below.
    const model = props.tracker.modelBySession[props.sessionID];
    const calibration = props.options.showCalibration ? ` (${formatRatio(ratioOf(props.tracker, props.options, model, "reasoning"))}/${formatRatio(ratioOf(props.tracker, props.options, model, "text"))})` : "";
    return `TPS ${rate ?? "-"}${calibration} | AVG ${average ?? "-"}${streams} | TTFT ${ttft ?? "-"}`;
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
    const options = readOptions(context.options);
    const tracker = {
      samples: {},
      requestStarts: {},
      timings: {},
      averages: {},
      chars: {},
      pendingChars: {},
      modelBySession: {},
      calibration: {},
      live: {},
      streams: {}
    };
    const [revision, setRevision] = createSignal(0);
    const bump = () => setRevision(value => value + 1);
    const ratioFor = (model, kind) => ratioOf(tracker, options, model, kind);
    const learn = (model, kind, tokens, chars) => {
      if (chars < MIN_CALIBRATION_CHARS || tokens <= 0) return;
      // Out-of-band samples are dropped, not clamped. A tool call puts its
      // arguments into `tokens.output` without ever streaming them as text, so
      // one such step can read as several tokens per character (3.1 measured).
      // Clamping that into the EMA would drag the ratio up for the rest of the
      // session instead of leaving it alone.
      const observed = tokens / chars;
      if (observed < MIN_TOKENS_PER_CHAR || observed > MAX_TOKENS_PER_CHAR) return;
      const bucket = tracker.calibration[model] ?? {};
      const current = bucket[kind];
      bucket[kind] = current ? {
        ratio: current.ratio + (observed - current.ratio) * options.calibrationAlpha,
        observed
      } : {
        ratio: observed,
        observed
      };
      tracker.calibration[model] = bucket;
    };
    const windowSamples = (sessionID, now) => (tracker.samples[sessionID] ?? []).filter(sample => now - sample.at <= options.windowMs);
    const refreshLive = (sessionID, now) => {
      const samples = windowSamples(sessionID, now);
      tracker.samples[sessionID] = samples;
      const last = samples[samples.length - 1];
      if (!last || now - last.at > options.liveStaleMs || samples.length < options.minSamples) {
        // No fresh stream: show "-" and restart the smoothing on the next burst.
        tracker.live[sessionID] = {
          at: now
        };
        return;
      }
      const span = now - samples[0].at;
      if (span < options.minWindowMs) return;
      const raw = samples.reduce((sum, sample) => sum + sample.tokens, 0) / (span / 1_000);
      const previous = tracker.live[sessionID]?.rate;
      const rate = previous === undefined ? raw : previous + (raw - previous) * options.liveSmoothing;
      tracker.live[sessionID] = {
        rate,
        at: now
      };
    };

    // An execution can end without a matching step boundary - an interrupted
    // turn never sends step.ended - and the per-message entries are keyed by
    // message id rather than by session, so they have to be swept by hand or
    // they outlive the turn that created them.
    const dropMessage = messageID => {
      delete tracker.timings[messageID];
      delete tracker.chars[messageID];
      delete tracker.streams[messageID];
    };

    // Deltas occasionally arrive under a different message id than the one the
    // step boundary reports, so a step can leave entries behind that no
    // boundary will ever claim. Each step sweeps its session, and so does the
    // end of the execution.
    const dropSessionMessages = (sessionID, keep) => {
      for (const [messageID, timing] of Object.entries(tracker.timings)) {
        if (timing.sessionID !== sessionID || messageID === keep) continue;
        dropMessage(messageID);
      }
    };
    const clearSession = sessionID => {
      dropSessionMessages(sessionID);
      delete tracker.samples[sessionID];
      delete tracker.live[sessionID];
      delete tracker.pendingChars[sessionID];
    };
    const appendSample = (sessionID, messageID, kind, delta, at) => {
      const chars = delta.length;
      const pending = tracker.pendingChars[sessionID] ?? emptyChars();
      pending[kind] += chars;
      tracker.pendingChars[sessionID] = pending;
      const messageChars = tracker.chars[messageID] ?? emptyChars();
      messageChars[kind] += chars;
      tracker.chars[messageID] = messageChars;
      const kindSpans = tracker.streams[messageID] ?? {};
      const span = kindSpans[kind] ?? {
        first: at,
        last: at
      };
      span.last = at;
      kindSpans[kind] = span;
      tracker.streams[messageID] = kindSpans;
      const timing = tracker.timings[messageID];
      if (timing && timing.firstResponseAt === undefined) timing.firstResponseAt = at;
      const ratio = ratioFor(timing?.model ?? tracker.modelBySession[sessionID], kind);
      const samples = tracker.samples[sessionID] ?? [];
      samples.push({
        at,
        tokens: chars * ratio
      });
      tracker.samples[sessionID] = samples;
      refreshLive(sessionID, at);
      bump();
    };
    const subscriptions = [context.data.on("session.execution.started", event => {
      tracker.requestStarts[event.data.sessionID] = event.created;
    }), context.data.on("session.step.started", event => {
      const sessionID = event.data.sessionID;
      // Token counts and tokenization differ per provider, so the calibration
      // is keyed by both rather than by the model id alone.
      const providerID = event.data.model?.providerID;
      const modelID = event.data.model?.id;
      const model = providerID && modelID ? `${providerID}/${modelID}` : modelID ?? providerID ?? UNKNOWN_MODEL;
      tracker.modelBySession[sessionID] = model;
      tracker.timings[event.data.assistantMessageID] = {
        sessionID,
        model,
        requestStartAt: tracker.requestStarts[sessionID] ?? event.created
      };
      delete tracker.requestStarts[sessionID];
      bump();
    }), context.data.on("session.text.delta", event => {
      appendSample(event.data.sessionID, event.data.assistantMessageID, "text", event.data.delta, event.created);
    }), context.data.on("session.reasoning.delta", event => {
      appendSample(event.data.sessionID, event.data.assistantMessageID, "reasoning", event.data.delta, event.created);
    }), context.data.on("session.tool.input.started", event => {
      // A tool-only step never sees a delta, so its first response is the
      // moment the tool input starts arriving. Deliberately does not clear
      // the live window: an expired window shows "-" on its own, and a tool
      // boundary should not throw away the numbers of a running stream.
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
      const sessionID = event.data.sessionID;
      const messageID = event.data.assistantMessageID;
      const timing = tracker.timings[messageID];
      const reasoningTokens = event.data.tokens.reasoning;
      const outputTokens = event.data.tokens.output;
      const tokens = outputTokens + reasoningTokens;
      // Deltas occasionally arrive with a message id that never gets a
      // matching step boundary, so fall back to the session-wide accumulator
      // instead of calibrating against zero.
      const chars = tracker.chars[messageID] ?? tracker.pendingChars[sessionID] ?? emptyChars();
      const model = timing?.model ?? tracker.modelBySession[sessionID] ?? UNKNOWN_MODEL;
      // A tool call reports its arguments as output tokens but never streams
      // them as text, so its step is kept out of the text stream entirely.
      const toolCall = event.data.finish === "tool-calls";
      if (timing?.firstResponseAt !== undefined) {
        const endAt = toolCall ? timing.lastToolCallAt ?? event.created : event.created;
        const duration = Math.max(endAt - timing.firstResponseAt, 1);
        if (tokens > 0) {
          const spans = tracker.streams[messageID] ?? {};
          const reasoningSpan = spanMs(spans.reasoning);
          const textSpan = spanMs(spans.text);
          const reasoningMs = reasoningSpan >= MIN_STREAM_SPAN_MS ? reasoningSpan : 0;
          const textMs = !toolCall && textSpan >= MIN_STREAM_SPAN_MS ? textSpan : 0;
          const totals = tracker.averages[sessionID] ?? {
            totalTokens: 0,
            totalReasoningTokens: 0,
            totalOutputTokens: 0,
            totalDurationMs: 0,
            totalReasoningMs: 0,
            totalTextMs: 0,
            totalTtftMs: 0,
            stepCount: 0
          };
          tracker.averages[sessionID] = {
            totalTokens: totals.totalTokens + tokens,
            totalReasoningTokens: totals.totalReasoningTokens + (reasoningMs > 0 ? reasoningTokens : 0),
            totalOutputTokens: totals.totalOutputTokens + (textMs > 0 ? outputTokens : 0),
            totalDurationMs: totals.totalDurationMs + duration,
            totalReasoningMs: totals.totalReasoningMs + reasoningMs,
            totalTextMs: totals.totalTextMs + textMs,
            totalTtftMs: totals.totalTtftMs + Math.max(timing.firstResponseAt - timing.requestStartAt, 0),
            stepCount: totals.stepCount + 1
          };
        }
      }

      // Each stream only learns from the tokens it produced itself, so a step
      // that is pure reasoning cannot drag the text ratio around.
      learn(model, "reasoning", reasoningTokens, chars.reasoning);
      // Same reasoning as above: a tool call would add its arguments to the
      // numerator without adding a single text character.
      if (!toolCall) learn(model, "text", outputTokens, chars.text);
      dropMessage(messageID);
      dropSessionMessages(sessionID);
      delete tracker.pendingChars[sessionID];
      bump();
    }), context.data.on("session.step.failed", event => {
      dropMessage(event.data.assistantMessageID);
      clearSession(event.data.sessionID);
      bump();
    })];
    for (const type of ["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"]) {
      subscriptions.push(context.data.on(type, event => {
        delete tracker.requestStarts[event.data.sessionID];
        clearSession(event.data.sessionID);
      }));
    }
    const timer = setInterval(() => {
      const now = Date.now();
      const sessions = new Set([...Object.keys(tracker.samples), ...Object.keys(tracker.live)]);
      for (const sessionID of sessions) refreshLive(sessionID, now);
      bump();
    }, options.tickMs);
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
          options: options,
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