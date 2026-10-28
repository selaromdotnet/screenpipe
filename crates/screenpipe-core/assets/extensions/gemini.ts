// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createGeminiFetch, GEMINI_OPENAI_API } from "./lib/gemini-transport";

// Replaced with the managed runtime package.json path when installed by Rust.
const runtimePackageJson = __SCREENPIPE_PI_PACKAGE_JSON__;

export default async function (pi: ExtensionAPI) {
  // Same managed-install resolution as tinfoil.ts: Pi's API module is ESM-only
  // and must never resolve from the user's chat project.
  const { streamSimple } = await import(pathToFileURL(join(dirname(runtimePackageJson),
    "node_modules", "@earendil-works", "pi-ai", "dist", "api", "openai-completions.js",
  )).href);
  // Rust assigns this API only to custom-provider models on Gemini's
  // OpenAI-compatible endpoint; every other custom model keeps Pi's transport.
  pi.registerProvider("custom", {
    api: GEMINI_OPENAI_API,
    streamSimple(model, context, options) {
      const baseFetch = (options as { fetch?: typeof fetch } | undefined)?.fetch ?? fetch;
      return streamSimple({ ...model, api: "openai-completions" }, context, {
        ...options,
        fetch: createGeminiFetch(baseFetch),
      });
    },
  });
}
