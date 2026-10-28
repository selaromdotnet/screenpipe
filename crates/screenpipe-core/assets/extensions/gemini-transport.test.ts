// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

import { expect, test } from "bun:test";
import {
  createGeminiFetch,
  decodeToolCallId,
  encodeToolCallId,
  restoreThoughtSignatures,
} from "./lib/gemini-transport";

const SIGNATURE = "CpwBAb4+9vtx/abc+def==";

function sse(...chunks: unknown[]): Response {
  const text = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
  // Split mid-line to prove the stream rewrite buffers partial SSE lines.
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 37));
      controller.enqueue(bytes.slice(37));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("tool-call ids round-trip the thought signature", () => {
  const encoded = encodeToolCallId("function-call-1", SIGNATURE);
  expect(encoded).not.toContain("+");
  expect(decodeToolCallId(encoded)).toEqual({ id: "function-call-1", signature: SIGNATURE });
  expect(decodeToolCallId("call_plain")).toEqual({ id: "call_plain" });
});

test("streamed signatures survive into the next request", async () => {
  const requests: any[] = [];
  const fake: typeof fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return sse(
      { choices: [{ index: 0, delta: { role: "assistant", content: "" } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{
        index: 0, id: "function-call-1", type: "function",
        function: { name: "bash", arguments: "{\"command\":\"ls\"}" },
        extra_content: { google: { thought_signature: SIGNATURE } },
      }] } }] },
    );
  };
  const geminiFetch = createGeminiFetch(fake);

  const first = await geminiFetch("https://example.test/chat/completions", { method: "POST", body: JSON.stringify({ messages: [] }) });
  const streamed = await first.text();
  const idLine = streamed.split("\n").find((line) => line.includes("tool_calls"))!;
  const piToolCallId = JSON.parse(idLine.slice(5)).choices[0].delta.tool_calls[0].id;
  expect(piToolCallId).toBe(encodeToolCallId("function-call-1", SIGNATURE));
  expect(streamed.trimEnd().endsWith("data: [DONE]")).toBe(true);

  // Pi echoes the id it stored, without extra_content, on the follow-up turn.
  await geminiFetch("https://example.test/chat/completions", { method: "POST", body: JSON.stringify({ messages: [
    { role: "user", content: "list files" },
    { role: "assistant", content: null, tool_calls: [{ id: piToolCallId, type: "function", function: { name: "bash", arguments: "{}" } }] },
    { role: "tool", tool_call_id: piToolCallId, content: "a.txt" },
  ] }) });
  const [, assistant, tool] = requests[1].messages;
  expect(assistant.tool_calls[0].id).toBe("function-call-1");
  expect(assistant.tool_calls[0].extra_content.google.thought_signature).toBe(SIGNATURE);
  expect(tool.tool_call_id).toBe("function-call-1");
});

test("unsigned tool-call history gets Google's documented placeholder on the first call only", () => {
  const body = restoreThoughtSignatures({ messages: [
    { role: "assistant", tool_calls: [{ id: "a", function: { name: "x" } }, { id: "b", function: { name: "y" } }] },
  ] });
  const [first, second] = body.messages[0].tool_calls;
  expect(first.extra_content.google.thought_signature).toBe("skip_thought_signature_validator");
  expect(second.extra_content).toBeUndefined();
});

test("array-shaped Gemini errors are unwrapped for the OpenAI SDK", async () => {
  const geminiFetch = createGeminiFetch(async () => new Response(
    JSON.stringify([{ error: { code: 400, message: "Function call is missing a thought_signature", status: "INVALID_ARGUMENT" } }]),
    { status: 400, headers: { "content-type": "application/json", "content-length": "999" } },
  ));
  const response = await geminiFetch("https://example.test/chat/completions", { method: "POST", body: "{}" });
  expect(response.status).toBe(400);
  expect(response.headers.get("content-length")).toBeNull();
  expect((await response.json()).error.message).toBe("Function call is missing a thought_signature");
});
