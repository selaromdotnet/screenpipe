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
import { SessionHistory } from "./session-history";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), emit: vi.fn() }));
vi.mock("@/lib/api", () => ({ localFetch: mocks.fetch }));
vi.mock("@tauri-apps/api/event", () => ({ emit: mocks.emit }));
const rows = Array.from({ length: 20 }, (_, i) => ({
  id: String(i),
  start: new Date(Date.UTC(2026, 9, 9, 10, i)).toISOString(),
  end: new Date(Date.UTC(2026, 9, 9, 10, i + 15)).toISOString(),
  revision: 1,
  hd_requested: false,
  has_audio: false,
}));
const response = (data: unknown[]) => ({
  ok: true,
  json: async () => ({ data }),
});
const params = (index: number) =>
  new URL(mocks.fetch.mock.calls[index][0], "http://localhost").searchParams;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockResolvedValue(response([]));
});
afterEach(cleanup);
function open() {
  render(<SessionHistory />);
  fireEvent.click(screen.getByRole("button", { name: "View all" }));
}
it("loads history only when opened and pages without duplicates", async () => {
  mocks.fetch
    .mockResolvedValueOnce(response(rows))
    .mockResolvedValueOnce(
      response([
        rows[19],
        { ...rows[0], id: "older", start: "2026-10-08T12:00:00.000Z" },
      ]),
    );
  render(<SessionHistory />);
  expect(mocks.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "View all" }));
  fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
  await waitFor(() => expect(screen.getAllByText("15 min")).toHaveLength(20));
  expect(params(0).get("limit")).toBe("20");
  expect(params(1).get("offset")).toBe("20");
  expect(params(1).get("end_time")).toBe(params(0).get("end_time"));
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
});
it("ignores an older response when the date filter changes", async () => {
  let resolve!: (value: ReturnType<typeof response>) => void;
  mocks.fetch
    .mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    )
    .mockResolvedValueOnce(response([]));
  open();
  fireEvent.change(screen.getByLabelText("Filter sessions by date"), {
    target: { value: "2026-10-08" },
  });
  await screen.findByText("No starred sessions on this date.");
  await act(async () => {
    resolve(response(rows));
  });
  expect(screen.queryByText("15 min")).toBeNull();
  expect(params(1).get("offset")).toBe("0");
  expect(params(1).get("start_time")).toBe(
    new Date("2026-10-08T00:00:00").toISOString(),
  );
  expect(params(1).get("end_time")).toBe(
    new Date("2026-10-09T00:00:00").toISOString(),
  );
});
it("retries a failed page at the same offset and navigates to a saved session", async () => {
  mocks.fetch
    .mockResolvedValueOnce(response(rows))
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce(
      response([
        { ...rows[0], id: "older", start: "2026-10-08T12:00:00.000Z" },
      ]),
    );
  open();
  fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(params(2).get("offset")).toBe("20");
  fireEvent.click(screen.getAllByText("15 min")[0].closest("button")!);
  expect(mocks.emit).toHaveBeenCalledWith(
    "navigate-to-timestamp",
    rows[0].start,
  );
  expect(screen.queryByText("Starred sessions")).toBeNull();
});
