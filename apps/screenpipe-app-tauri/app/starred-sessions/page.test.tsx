// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "./page";

const mocks = vi.hoisted(() => ({
  resize: vi.fn(),
  move: vi.fn(),
  hide: vi.fn(),
  fetch: vi.fn(),
  visibility: null as null | ((e: { payload: boolean }) => void),
}));
vi.mock("@/lib/utils/tauri", () => ({
  commands: { hideStarredSessions: mocks.hide },
}));
vi.mock("@tauri-apps/api/window", () => ({
  LogicalSize: class { constructor(public width: number, public height: number) {} },
  PhysicalPosition: class { constructor(public x: number, public y: number) {} },
  currentMonitor: async () => ({ workArea: { position: { x: -1920, y: -1080 }, size: { width: 1920, height: 1040 } } }),
  getCurrentWindow: () => ({
    setSize: mocks.resize, setPosition: mocks.move,
    outerPosition: async () => ({ x: -250, y: -160 }),
    outerSize: async () => ({ width: 616, height: 600 }),
  }),
}));
vi.mock("@/lib/api", () => ({ localFetch: mocks.fetch }));
vi.mock("@/lib/hooks/use-tauri-event", () => ({
  useTauriEvent: (name: string, callback: typeof mocks.visibility) => {
    if (name === "starred-sessions-visibility") mocks.visibility = callback;
  },
}));
vi.mock("@/lib/chat-utils", () => ({ showChatWithPrefill: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.hide.mockResolvedValue({ status: "ok", data: null });
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("opens just the duration picker and dismisses with Escape", async () => {
  render(<Page />);
  expect(
    await screen.findByRole("dialog", { name: "Starred work sessions" }),
  ).toBeVisible();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "15 min" })).toBeEnabled(),
  );
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.hide).toHaveBeenCalledTimes(1);
});
it("unmounts controls while hidden and reloads on reopening", async () => {
  render(<Page />);
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
  act(() => mocks.visibility!({ payload: false }));
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => mocks.visibility!({ payload: true }));
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("button", { name: "5 min" })).toBeVisible();
});
it("keeps storage errors and retry visible inside the picker", async () => {
  mocks.fetch.mockResolvedValue({
    ok: false,
    json: async () => ({ error: "could not access starred sessions" }),
  });
  render(<Page />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not access starred sessions",
  );
  expect(screen.getByRole("button", { name: "15 min" })).toBeDisabled();
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
  fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "15 min" })).toBeEnabled(),
  );
});
it("does not dismiss when an editor consumes Escape", () => {
  render(<Page />);
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    cancelable: true,
  });
  event.preventDefault();
  window.dispatchEvent(event);
  expect(mocks.hide).not.toHaveBeenCalled();
});

it("dismisses after five idle seconds without changing the saved session", async () => {
  const session = { id: "active", start: new Date().toISOString(), end: new Date(Date.now() + 3600000).toISOString(), revision: 1, hd_requested: false, has_audio: false };
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [session] }) });
  render(<Page />);
  await screen.findByText("Session starred");
  vi.useFakeTimers();
  fireEvent.pointerMove(screen.getByRole("region", { name: "Starred work sessions" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
  expect(mocks.hide).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(mocks.hide).toHaveBeenCalledTimes(1);
  expect(mocks.fetch.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
});
it("keeps the popup open during inline time edits", async () => {
  const session = { id: "active", start: new Date().toISOString(), end: new Date(Date.now() + 3600000).toISOString(), revision: 1, hd_requested: false, has_audio: false };
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [session] }) });
  render(<Page />);
  await screen.findByText("Session starred");
  fireEvent.click(screen.getByRole("button", { name: "More", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Edit session end" }));
  vi.useFakeTimers();
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(mocks.hide).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Session end")).toBeVisible();
});
it("does not auto-dismiss a storage error", async () => {
  mocks.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: "Save unavailable" }) });
  render(<Page />);
  await screen.findByRole("alert");
  vi.useFakeTimers();
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(mocks.hide).not.toHaveBeenCalled();
});

it("shows the star before controls, keeps the default, and updates the same session", async () => {
  vi.useFakeTimers();
  let session = { id: "active", start: new Date().toISOString(), end: new Date(Date.now() + 3600000).toISOString(), revision: 1, hd_requested: false, has_audio: false };
  mocks.fetch.mockImplementation(async (_url, init) => {
    if (init?.method === "POST") {
      session = { ...JSON.parse(init.body), revision: 2 };
      return { ok: true, json: async () => session };
    }
    return { ok: true, json: async () => ({ data: [session] }) };
  });
  await act(async () => { render(<Page />); });
  expect(screen.getByRole("status", { name: "Session starred" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "15 min" })).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(screen.getByRole("button", { name: "60 min" })).toHaveAttribute("aria-pressed", "true");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "15 min" })); });
  expect(session.id).toBe("active");
  expect(Date.parse(session.end) - Date.parse(session.start)).toBe(15 * 60000);
  expect(session.hd_requested).toBe(false);
  expect(screen.getByText("15 min left")).toBeVisible();
});

it("pauses dismissal while hovered and resumes after leaving", async () => {
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "active", start: new Date().toISOString(), end: new Date(Date.now() + 3600000).toISOString(), revision: 1, hd_requested: false, has_audio: false }] }) });
  render(<Page />);
  await screen.findByText("Session starred");
  vi.useFakeTimers();
  const controls = screen.getByRole("region", { name: "Starred work sessions" });
  fireEvent.pointerEnter(controls);
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(mocks.hide).not.toHaveBeenCalled();
  fireEvent.pointerLeave(controls);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(mocks.hide).toHaveBeenCalledTimes(1);
});

it("fits expanded controls inside a negative-origin monitor work area", async () => {
  let resized!: () => void;
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resized = callback; }
    observe() {} disconnect() {}
  });
  try {
    const { container } = render(<Page />);
    Object.defineProperty(container.firstElementChild, "scrollHeight", { value: 300 });
    await act(async () => { resized(); });
    expect(mocks.resize).toHaveBeenCalledWith(expect.objectContaining({ width: 308, height: 300 }));
    expect(mocks.move).toHaveBeenCalledWith(expect.objectContaining({ x: -616, y: -640 }));
  } finally { cleanup(); vi.unstubAllGlobals(); }
});
