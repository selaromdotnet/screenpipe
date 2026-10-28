// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

/**
 * Gemini's OpenAI-compatible endpoint, adapted for Pi's openai-completions
 * transport.
 *
 * Gemini 3+ attaches a thought signature to every tool call
 * (`tool_calls[].extra_content.google.thought_signature`) and rejects the next
 * request with 400 when the call is echoed back without it. Pi only preserves
 * OpenRouter-style `reasoning_details`, so the signature is lost after the
 * first tool call and every agent turn fails. The hosted gateway keeps the
 * signature by carrying it inside the tool-call id; do the same here so it
 * survives Pi's session history, restarts, and compaction without extra state.
 *
 * Gemini also returns errors as a JSON array (`[{"error": {...}}]`), which the
 * OpenAI SDK cannot read and reports as "400 status code (no body)". Unwrap it
 * so the user sees Google's actual reason.
 */

export const GEMINI_OPENAI_API = "screenpipe-gemini-openai";

const SIGNATURE_MARKER = "__sp_gts_";
// Google's documented placeholder for tool calls whose signature is unknown,
// e.g. history from a different model or a stream that omitted it.
const SKIP_SIGNATURE = "skip_thought_signature_validator";

type ToolCall = { id?: string; extra_content?: { google?: { thought_signature?: string } } } & Record<string, unknown>;

export function encodeToolCallId(id: string, signature: string): string {
  return `${id}${SIGNATURE_MARKER}${Buffer.from(signature, "utf8").toString("base64url")}`;
}

export function decodeToolCallId(id: string): { id: string; signature?: string } {
  const at = id.lastIndexOf(SIGNATURE_MARKER);
  if (at < 0) return { id };
  const encoded = id.slice(at + SIGNATURE_MARKER.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return { id };
  return { id: id.slice(0, at), signature: Buffer.from(encoded, "base64url").toString("utf8") };
}

/** Move signatures from tool-call ids back into `extra_content` and restore the ids. */
export function restoreThoughtSignatures(body: any): any {
  if (!body || !Array.isArray(body.messages)) return body;
  const messages = body.messages.map((message: any) => {
    if (message?.role === "tool" && typeof message.tool_call_id === "string") {
      return { ...message, tool_call_id: decodeToolCallId(message.tool_call_id).id };
    }
    if (message?.role !== "assistant" || !Array.isArray(message.tool_calls)) return message;
    const toolCalls = message.tool_calls.map((call: ToolCall) => {
      if (typeof call?.id !== "string") return call;
      const { id, signature } = decodeToolCallId(call.id);
      return signature ? withSignature({ ...call, id }, signature) : { ...call, id };
    });
    // Gemini validates the first call of each step; parallel calls may omit it.
    if (toolCalls.length > 0 && !toolCalls[0]?.extra_content?.google?.thought_signature) {
      toolCalls[0] = withSignature(toolCalls[0], SKIP_SIGNATURE);
    }
    return { ...message, tool_calls: toolCalls };
  });
  return { ...body, messages };
}

function withSignature(call: ToolCall, signature: string): ToolCall {
  return {
    ...call,
    extra_content: { ...call.extra_content, google: { ...call.extra_content?.google, thought_signature: signature } },
  };
}

/** Rewrite one streamed chunk so each signed tool call carries its signature in its id. */
export function encodeChunkSignatures(chunk: any): boolean {
  let changed = false;
  for (const choice of Array.isArray(chunk?.choices) ? chunk.choices : []) {
    const calls = choice?.delta?.tool_calls ?? choice?.message?.tool_calls;
    if (!Array.isArray(calls)) continue;
    for (const call of calls as ToolCall[]) {
      const signature = call?.extra_content?.google?.thought_signature;
      if (typeof signature !== "string" || !signature) continue;
      const base = typeof call.id === "string" && call.id ? call.id : `call_${(call as any).index ?? 0}`;
      call.id = encodeToolCallId(base, signature);
      changed = true;
    }
  }
  return changed;
}

function encodeSseStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const rewrite = (line: string): string => {
    if (!line.startsWith("data:")) return line;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return line;
    try {
      const chunk = JSON.parse(payload);
      return encodeChunkSignatures(chunk) ? `data: ${JSON.stringify(chunk)}` : line;
    } catch {
      return line;
    }
  };
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(bytes, controller) {
      buffer += decoder.decode(bytes, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      if (lines.length) controller.enqueue(encoder.encode(lines.map(rewrite).join("\n") + "\n"));
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) controller.enqueue(encoder.encode(rewrite(buffer)));
    },
  }));
}

function rebuiltHeaders(headers: Headers): Headers {
  const copy = new Headers(headers);
  copy.delete("content-length");
  copy.delete("content-encoding");
  return copy;
}

async function unwrapErrorResponse(response: Response): Promise<Response> {
  const text = await response.text();
  let body = text;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.error) body = JSON.stringify(parsed[0]);
  } catch {}
  return new Response(body, { status: response.status, statusText: response.statusText, headers: rebuiltHeaders(response.headers) });
}

export function createGeminiFetch(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    let request = init;
    if (typeof init?.body === "string") {
      try {
        request = { ...init, body: JSON.stringify(restoreThoughtSignatures(JSON.parse(init.body))) };
      } catch {}
    }
    const response = await baseFetch(input, request);
    if (!response.ok) return unwrapErrorResponse(response);
    const type = response.headers.get("content-type") || "";
    if (response.body && type.includes("text/event-stream")) {
      return new Response(encodeSseStream(response.body), {
        status: response.status, statusText: response.statusText, headers: rebuiltHeaders(response.headers),
      });
    }
    if (type.includes("application/json")) {
      const data = await response.json();
      encodeChunkSignatures(data);
      return new Response(JSON.stringify(data), {
        status: response.status, statusText: response.statusText, headers: rebuiltHeaders(response.headers),
      });
    }
    return response;
  };
}
