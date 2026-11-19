// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
import { useEffect, useRef, useState } from "react";

export type WorkflowUsageEvent = "workflow_opened" | "workflow_detail_viewed";

/** Optional host telemetry; never passes document identity or content. */
export function useWorkflowUsage(active: boolean, detailKey: string | null, onUsage?: (event: WorkflowUsageEvent) => void) {
  const [visible, setVisible] = useState(() => typeof document !== "undefined" && !document.hidden);
  const last = useRef<{ open: boolean; detail: string | null }>({ open: false, detail: null });
  const callback = useRef(onUsage);
  callback.current = onUsage;
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    const open = active && visible;
    const detail = open ? detailKey : null;
    const emit = (event: WorkflowUsageEvent) => {
      try { callback.current?.(event); } catch { /* Telemetry cannot break navigation. */ }
    };
    if (open && !last.current.open) emit("workflow_opened");
    if (detail !== null && detail !== last.current.detail) emit("workflow_detail_viewed");
    last.current = { open, detail };
  }, [active, visible, detailKey]);
}
