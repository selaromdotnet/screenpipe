// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { StarredSessionPanel } from "./starred-session-panel";
import { useStarredSessions } from "./use-starred-sessions";

export function CompactSessionControls({
  onDismiss,
  onPulseChange,
}: {
  onDismiss?: () => void;
  onPulseChange?: (pulsing: boolean) => void;
}) {
  const state = useStarredSessions();
  const [more, setMore] = useState(false);
  const [pulseDone, setPulseDone] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [activity, setActivity] = useState(0);
  useEffect(() => {
    if (!state.ready || !state.active || state.error) return;
    const timer = window.setTimeout(() => setPulseDone(true), 300);
    return () => window.clearTimeout(timer);
  }, [state.ready, state.active?.id, state.error]);
  useEffect(() => {
    if (
      !onDismiss ||
      !pulseDone ||
      more ||
      hovered ||
      keyboardFocus ||
      state.busy ||
      state.error
    )
      return;
    const timer = window.setTimeout(onDismiss, 5000);
    return () => window.clearTimeout(timer);
  }, [
    onDismiss,
    pulseDone,
    more,
    hovered,
    keyboardFocus,
    state.busy,
    state.error,
    activity,
    state.active?.end,
  ]);

  const pulsing =
    !state.error && (!state.ready || (!!state.active && !pulseDone));
  useEffect(() => onPulseChange?.(pulsing), [onPulseChange, pulsing]);
  if (pulsing)
    return (
      <div
        role="status"
        aria-label={state.ready ? "Session starred" : "Loading session"}
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-black"
      >
        <Star className="h-5 w-5 fill-current motion-safe:animate-star-session-pulse" />
      </div>
    );
  if (!state.active || more)
    return (
      <>
        {more && (
          <button
            className="px-3 pt-3 text-xs text-white/70"
            onClick={() => setMore(false)}
          >
            Back
          </button>
        )}
        <StarredSessionPanel
          state={state}
          inDialog
          onDismiss={more ? undefined : onDismiss}
        />
      </>
    );
  const session = state.active;
  const minutesLeft = Math.max(
    1,
    Math.ceil((Date.parse(session.end) - state.now) / 60000),
  );
  return (
    <section
      aria-label="Starred work sessions"
      className="p-3 text-xs text-white/90"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerMove={() => setActivity((v) => v + 1)}
      onPointerDown={() => {
        setKeyboardFocus(false);
        setActivity((v) => v + 1);
      }}
      onFocusCapture={(e) =>
        setKeyboardFocus(e.target.matches(":focus-visible"))
      }
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setKeyboardFocus(false);
      }}
    >
      <div className="flex items-center gap-1.5 pr-6 font-medium">
        <Star className="h-3.5 w-3.5 fill-current" />
        Session starred{" "}
        <span className="ml-auto text-[10px] font-normal text-white/60 tabular-nums">
          {minutesLeft} min left
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-4 gap-1" aria-label="Star for">
        {[5, 15, 30, 60].map((minutes) => (
          <button
            key={minutes}
            className="rounded-md border border-white/30 py-1.5 text-[11px] hover:bg-white/10 aria-pressed:bg-white aria-pressed:text-black disabled:opacity-40 focus-visible:outline focus-visible:outline-white"
            disabled={
              state.busy ||
              Date.parse(session.start) + minutes * 60000 <= state.now
            }
            aria-pressed={
              Math.abs(
                Date.parse(session.end) -
                  Date.parse(session.start) -
                  minutes * 60000,
              ) < 1000
            }
            onClick={() =>
              void state.save({
                ...session,
                end: new Date(
                  Date.parse(session.start) + minutes * 60000,
                ).toISOString(),
              })
            }
          >
            {minutes} min
          </button>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-white/60">
        <span>
          {session.hd_requested
            ? "HD for this session"
            : "Using current capture settings"}
        </span>
        <button
          className="text-white/80 hover:text-white"
          onClick={() => setMore(true)}
        >
          More
        </button>
      </div>
      {state.error && (
        <p role="alert" className="mt-2">
          {state.error}{" "}
          <button onClick={() => void state.retry()} disabled={state.busy}>
            Retry save
          </button>
        </p>
      )}
    </section>
  );
}
