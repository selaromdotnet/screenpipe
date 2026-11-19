// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
import React, { StrictMode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkflowsApp } from "@screenpipe/workflows-ui";
import { createFixtureWorkflowsPlatform, fixtureWorkflowAnalysis } from "@screenpipe/workflows-ui/fixture";

function fixturePlatform() {
  return { ...createFixtureWorkflowsPlatform(), loadCapturedWork: async () => structuredClone(fixtureWorkflowAnalysis) };
}
afterEach(() => vi.restoreAllMocks());
it("records real view transitions through the masked shared UI, not rerenders or hidden tabs", async () => {
  const platform = fixturePlatform(); const usage = vi.fn();
  const tree = (active: boolean) => <StrictMode><WorkflowsApp active={active} platform={platform} storageKey={null} onUsageEvent={usage} /></StrictMode>;
  const app = render(tree(false));
  expect(usage).not.toHaveBeenCalled();
  app.rerender(tree(true));
  const card = (await screen.findByRole("heading", { name: "Research synthesis" })).closest("article")!;
  expect(app.container.querySelector(".ph-no-capture.ph-mask")).not.toBeNull();
  expect(usage.mock.calls).toEqual([["workflow_opened"]]);
  fireEvent.click(within(card).getByRole("button"));
  expect(usage.mock.calls).toEqual([["workflow_opened"], ["workflow_detail_viewed"]]);
  app.rerender(tree(true)); expect(usage).toHaveBeenCalledTimes(2);
  app.rerender(tree(false)); expect(usage).toHaveBeenCalledTimes(2);
  app.rerender(tree(true)); expect(usage.mock.calls.slice(2)).toEqual([["workflow_opened"], ["workflow_detail_viewed"]]);
  await act(async () => {});
});
it("does not count the document while hidden and records its return without leaking its key", async () => {
  let hidden = true; vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const usage = vi.fn();
  render(<StrictMode><WorkflowsApp platform={fixturePlatform()} storageKey={null} onUsageEvent={usage} /></StrictMode>); expect(usage).not.toHaveBeenCalled();
  act(() => { hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
  expect(usage.mock.calls).toEqual([["workflow_opened"]]);
  act(() => document.dispatchEvent(new Event("visibilitychange"))); expect(usage).toHaveBeenCalledTimes(1);
  await screen.findByRole("heading", { name: "Research synthesis" });
  await act(async () => {});
});
