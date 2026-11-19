// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SopDocument } from "@screenpipe/workflows-ui/sop-document";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const path = `/api/sops/images/${"a".repeat(64)}/${"b".repeat(64)}`;
it("renders a hosted screenshot and persists removal with undo", () => {
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, "createRange").mockImplementation(() => {
    const range = createRange();
    range.getClientRects = () => [] as unknown as DOMRectList;
    range.getBoundingClientRect = () => new DOMRect();
    return range;
  });
  const save = vi.fn();
  render(<SopDocument title="Review" content={`Check the form.\n\n![Form](<${path}>)`} onContentChange={save} imageUrl={src => src} />);
  expect(screen.getByRole("img", { name: "Form" })).toHaveAttribute("src", path);
  fireEvent.click(screen.getByRole("button", { name: "Remove image: Form" }));
  expect(save.mock.lastCall![0]).not.toContain(path);
  expect(screen.queryByRole("img")).toBeNull();
  const editor = screen.getByRole("textbox", { name: "SOP text" });
  act(() => {
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor.querySelector("p")!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  fireEvent(document, new Event("selectionchange"));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByRole("img", { name: "Form" })).toBeVisible();
  expect(save.mock.lastCall![0]).toContain(path);
});
it("leaves ordinary evidence images as references without an explicit resolver", () => {
  render(<SopDocument title="Review" content="![Private](http://localhost:3030/frames/1)" />);
  expect(document.querySelector("img[src]")).toBeNull();
});

it("shows the imported title once above the same editable document", () => {
  render(<SopDocument title="Review" content="# Review\n\nFollow the steps." onContentChange={vi.fn()} />);
  expect(screen.getAllByRole("heading", { name: "Review" })).toHaveLength(1);
  expect(screen.getByRole("textbox", { name: "SOP text" })).toHaveTextContent("Follow the steps.");
});
