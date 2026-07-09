import { NextResponse } from "next/server";

type DebugEventBody = {
  sessionId?: unknown;
  source?: unknown;
  event?: unknown;
};

function summarizeEvent(event: unknown): Record<string, unknown> {
  if (!event || typeof event !== "object") {
    return { raw: event };
  }

  const e = event as Record<string, unknown>;
  const summary: Record<string, unknown> = {
    type: e.type ?? "unknown",
  };

  if (typeof e.delta === "string") {
    summary.delta = e.delta;
    summary.deltaLength = e.delta.length;
  }

  if (e.error !== undefined) {
    summary.error = e.error;
  }

  // Include a few common non-sensitive fields when present.
  for (const key of [
    "event_id",
    "item_id",
    "response_id",
    "audio_start_ms",
    "audio_end_ms",
  ]) {
    if (e[key] !== undefined) summary[key] = e[key];
  }

  // For non-delta events, log a compact JSON snapshot (truncated).
  if (typeof e.delta !== "string") {
    const json = JSON.stringify(e);
    summary.payload =
      json.length > 800 ? `${json.slice(0, 800)}…` : JSON.parse(json);
  }

  return summary;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { sessionId, source, event } = (body ?? {}) as DebugEventBody;
  const id = typeof sessionId === "string" ? sessionId : "unknown";
  const src = typeof source === "string" ? source : "client";
  const summary = summarizeEvent(event);

  console.log(
    `[realtime][${id}][${src}]`,
    summary.type,
    summary,
  );

  return NextResponse.json({ ok: true });
}
