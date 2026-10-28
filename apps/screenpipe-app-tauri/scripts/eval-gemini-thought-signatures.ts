// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

// Real pinned Pi running a tool call against a synthetic Gemini endpoint that
// enforces thought signatures the way Google's OpenAI-compatible API does:
// the follow-up request must echo `extra_content.google.thought_signature`,
// otherwise it gets a 400 with Gemini's array-shaped error body.
//   bun scripts/eval-gemini-thought-signatures.ts             # with the extension
//   bun scripts/eval-gemini-thought-signatures.ts --baseline  # pre-fix transport
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const baseline = process.argv.includes("--baseline");
const assets = resolve(import.meta.dir, "../../../crates/screenpipe-core/assets/extensions");
const source = await readFile(resolve(import.meta.dir, "../../../crates/screenpipe-core/src/agents/pi.rs"), "utf8");
const version = source.match(/PI_PACKAGE: &str = "@earendil-works\/pi-coding-agent@([^"]+)"/)![1];
const geminiApi = source.match(/GEMINI_OPENAI_API: &str = "([^"]+)"/)![1];
const root = await mkdtemp(join(tmpdir(), "screenpipe-gemini-signatures-"));
const config = join(root, "pi-config");
const runtime = join(root, "pi-agent");
const project = join(root, "project");
const env: NodeJS.ProcessEnv = { ...process.env, PI_CODING_AGENT_DIR: config, PI_SKIP_VERSION_CHECK: "1", CUSTOM_API_KEY: "fictional-eval-key" };
const SIGNATURE = "CpwBAb4+9vtx/eval+signature==";

async function run(args: string[], cwd: string) {
  const child = Bun.spawn(args, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timeout = setTimeout(() => child.kill(), 90_000);
  try {
    const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code: await child.exited, stdout, stderr };
  } finally {
    clearTimeout(timeout);
  }
}

const requests: any[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    assert.equal(new URL(request.url).pathname, "/v1beta/openai/chat/completions");
    const body = await request.json();
    requests.push(body);
    if ("store" in body) return geminiError('Invalid JSON payload received. Unknown name "store": Cannot find field.');
    const chunk = (delta: object, finish_reason: string | null) => `data: ${JSON.stringify({
      id: "eval", object: "chat.completion.chunk", created: 0, model: "gemini-eval",
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`;
    const toolTurn = body.messages.find((message: any) => message.role === "assistant" && message.tool_calls);
    if (!toolTurn) {
      return sse(chunk({ role: "assistant", tool_calls: [{
        index: 0, id: "function-call-1", type: "function",
        function: { name: "read", arguments: JSON.stringify({ path: "note.txt" }) },
        extra_content: { google: { thought_signature: SIGNATURE } },
      }] }, null) + chunk({}, "tool_calls"));
    }
    if (toolTurn.tool_calls[0]?.extra_content?.google?.thought_signature !== SIGNATURE) {
      return geminiError("Function call is missing a thought_signature in functionCall parts.");
    }
    return sse(chunk({ role: "assistant", content: "The note says hello." }, null) + chunk({}, "stop"));
  },
});
const sse = (text: string) => new Response(text + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
const geminiError = (message: string) => new Response(
  JSON.stringify([{ error: { code: 400, message, status: "INVALID_ARGUMENT" } }]),
  { status: 400, headers: { "content-type": "application/json" } },
);

try {
  for (const dir of [runtime, join(project, ".pi/extensions/lib")]) await mkdir(dir, { recursive: true });
  await writeFile(join(runtime, "package.json"), JSON.stringify({ type: "module", dependencies: { "@earendil-works/pi-coding-agent": version } }));
  const install = await run([process.execPath, "install", "--ignore-scripts"], runtime);
  assert.equal(install.code, 0, install.stderr);
  await writeFile(join(project, "note.txt"), "hello\n");
  // Mirrors PiExecutor::ensure_gemini_extension and apply_custom_provider_compat.
  await writeFile(join(project, ".pi/extensions/gemini.ts"), (await readFile(join(assets, "gemini.ts"), "utf8"))
    .replace("__SCREENPIPE_PI_PACKAGE_JSON__", JSON.stringify(join(runtime, "package.json"))));
  await writeFile(join(project, ".pi/extensions/lib/gemini-transport.ts"), await readFile(join(assets, "lib/gemini-transport.ts"), "utf8"));
  await mkdir(config, { recursive: true });
  await writeFile(join(config, "settings.json"), JSON.stringify({ retry: { enabled: false } }));
  await writeFile(join(config, "models.json"), JSON.stringify({ providers: { custom: {
    baseUrl: `http://127.0.0.1:${server.port}/v1beta/openai`, api: "openai-completions", apiKey: "$CUSTOM_API_KEY",
    models: [{ id: "gemini-eval", name: "gemini-eval", reasoning: false, input: ["text", "image"], maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsStore: false }, ...(baseline ? {} : { api: geminiApi }) }],
  } } }));

  const cli = join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
  const result = await run([process.execPath, cli, "--provider", "custom", "--model", "gemini-eval", "--no-session",
    "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-extensions",
    ...(baseline ? [] : ["--extension", join(project, ".pi/extensions/gemini.ts")]), "--mode", "json", "--print", "Read note.txt and tell me what it says."], project);
  assert.doesNotMatch(result.stderr, /Failed to load extension/, result.stderr);
  const events = result.stdout.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
  const final = events.filter(event => event.type === "message_end" && event.message.role === "assistant").at(-1)?.message;
  assert(requests.length >= 2, `tool call never completed\n${result.stderr}\n${result.stdout}`);

  if (baseline) {
    assert.equal(final?.stopReason, "error", `baseline unexpectedly succeeded\n${result.stdout}`);
    console.log(`BASELINE reproduced: follow-up request failed with "${final.errorMessage}"`);
  } else {
    assert.equal(final?.stopReason, "stop", `${final?.errorMessage}\n${result.stderr}\n${result.stdout}`);
    assert(final.content.some((part: { text?: string }) => part.text === "The note says hello."));
    const echoed = requests[1].messages.find((message: any) => message.tool_calls).tool_calls[0];
    assert.equal(echoed.id, "function-call-1");
    console.log(`PASS: tool ran, signature echoed on request ${requests.length}, assistant completed: "The note says hello."`);
  }
} finally {
  server.stop(true);
  await rm(root, { recursive: true, force: true });
}
