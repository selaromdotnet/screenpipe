// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
import posthog from "posthog-js";
import type { WorkflowsAppProps, WorkflowsPlatform, WorkflowAnalysisJob } from "@screenpipe/workflows-ui";

type Handoff = "screenpipe" | "claude" | "codex" | "cursor";
type Usage =
  | { event: "workflow_opened" | "workflow_detail_viewed" }
  | { event: "workflow_analysis_requested" | "workflow_analysis_completed" | "workflow_analysis_failed" | "workflow_analysis_incomplete" }
  | { event: "workflow_output_saved"; output: "sop" | "skill" }
  | { event: "workflow_agent_handoff_requested"; runner: Handoff }
  | { event: "workflow_agent_handoff_result"; runner: Handoff; outcome: "prefilled" | "copied" | "failed" };

/** Only enumerated fields leave the device. Existing PostHog consent/identity applies. */
export function captureWorkflowUsage(usage: Usage) {
  if (process.env.NEXT_PUBLIC_SCREENPIPE_WEB_DEV) return;
  const properties: Record<string, string | number> = {
    schema_version: 1, surface: "desktop_workflows", workflow_source: "device",
    // The SDK otherwise attaches the current URL, which can carry document IDs.
    $current_url: "screenpipe://workflows", $pathname: "/workflows", $referrer: "",
  };
  if (usage.event.startsWith("workflow_analysis_")) properties.operation = "analysis";
  if ("output" in usage) properties.output = usage.output;
  if ("runner" in usage) properties.runner = usage.runner;
  if ("outcome" in usage) properties.outcome = usage.outcome;
  try { posthog.capture(usage.event, properties); } catch { /* Never block product actions. */ }
}

export const captureWorkflowView: NonNullable<WorkflowsAppProps["onUsageEvent"]> = event => captureWorkflowUsage({ event });

/** Track only jobs requested through this UI, not historic/scheduled jobs seen by polling. */
export function withWorkflowUsage(platform: WorkflowsPlatform): WorkflowsPlatform {
  const pending = new Set<string>();
  function observe(job: WorkflowAnalysisJob | null) {
    if (!job) return;
    const key = job.cycleId ?? job.id;
    if (!pending.has(key)) return;
    if (job.status === "queued" || job.status === "processing") return;
    // A status-only poll is not evidence that a completed result was loaded.
    if (job.status === "complete" && !job.result) return;
    pending.delete(key);
    captureWorkflowUsage({ event: job.status === "complete" ? "workflow_analysis_completed" : job.status === "incomplete" ? "workflow_analysis_incomplete" : "workflow_analysis_failed" });
  }
  return {
    ...platform,
    ...(platform.startAnalysisJob ? { startAnalysisJob: async (...args: Parameters<NonNullable<WorkflowsPlatform["startAnalysisJob"]>>) => {
      captureWorkflowUsage({ event: "workflow_analysis_requested" });
      try {
        const job = await platform.startAnalysisJob!(...args);
        // Bound local correlation state; job identifiers never enter telemetry.
        if (pending.size >= 100) pending.delete(pending.values().next().value!);
        pending.add(job.cycleId ?? job.id);
        observe(job);
        return job;
      } catch (error) { captureWorkflowUsage({ event: "workflow_analysis_failed" }); throw error; }
    } } : {}),
    ...(platform.getAnalysisJob ? { getAnalysisJob: async (id: string) => {
      const job = await platform.getAnalysisJob!(id); observe(job); return job;
    } } : {}),
    ...(platform.getLatestAnalysisJob ? { getLatestAnalysisJob: async () => {
      const job = await platform.getLatestAnalysisJob!(); observe(job); return job;
    } } : {}),
    ...(platform.guides ? { guides: { ...platform.guides, save: async (guide: Parameters<NonNullable<WorkflowsPlatform["guides"]>["save"]>[0]) => {
      await platform.guides!.save(guide);
      captureWorkflowUsage({ event: "workflow_output_saved", output: "sop" });
    } } } : {}),
    ...(platform.saveWorkflowSkill ? { saveWorkflowSkill: async (draft: Parameters<NonNullable<WorkflowsPlatform["saveWorkflowSkill"]>>[0]) => {
      const saved = await platform.saveWorkflowSkill!(draft);
      captureWorkflowUsage({ event: "workflow_output_saved", output: "skill" });
      return saved;
    } } : {}),
  };
}
