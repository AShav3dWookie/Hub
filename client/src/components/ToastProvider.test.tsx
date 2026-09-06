import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ToastProvider, useToast } from "./ToastProvider.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

function Harness({ messages }: { messages: string[] }) {
  const { showToast } = useToast();
  return (
    <div>
      {messages.map((m) => (
        <button key={m} type="button" onClick={() => showToast(m)}>
          show {m}
        </button>
      ))}
    </div>
  );
}

function renderToasts(messages: string[]) {
  return render(
    <ToastProvider>
      <Harness messages={messages} />
    </ToastProvider>,
  );
}

const click = (label: string) => act(() => screen.getByText(`show ${label}`).click());

describe("ToastProvider", () => {
  it("shows nothing until something is announced", () => {
    renderToasts(["saved"]);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a message when asked", () => {
    renderToasts(["saved"]);
    click("saved");
    expect(screen.getByRole("status")).toHaveTextContent("saved");
  });

  it("keeps the message up for three seconds", () => {
    renderToasts(["saved"]);
    click("saved");

    advance(2999);
    expect(screen.getByRole("status")).toBeInTheDocument();

    advance(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("replaces the visible message when a second one arrives", () => {
    renderToasts(["saved", "deleted"]);
    click("saved");
    click("deleted");

    expect(screen.getByRole("status")).toHaveTextContent("deleted");
  });

  it("does not let the first message's timer dismiss the second", () => {
    renderToasts(["saved", "deleted"]);
    click("saved");
    advance(2000);
    click("deleted");

    // The first toast's 3s timer fires here; it must leave the newer toast alone.
    advance(1000);
    expect(screen.getByRole("status")).toHaveTextContent("deleted");

    // The second toast then dismisses on its own schedule.
    advance(2000);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("announces politely, so a screen reader is not interrupted", () => {
    renderToasts(["saved"]);
    click("saved");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("can show a message again after the first was dismissed", () => {
    renderToasts(["saved"]);
    click("saved");
    advance(3000);
    click("saved");
    expect(screen.getByRole("status")).toHaveTextContent("saved");
  });
});
