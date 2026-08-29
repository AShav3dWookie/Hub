import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Lightbox } from "./Lightbox.js";

const touchPoint = (x: number, y = 0) => ({
  touches: [{ clientX: x, clientY: y }],
  changedTouches: [{ clientX: x, clientY: y }],
});

describe("Lightbox", () => {
  it("renders the image and children", () => {
    render(
      <Lightbox src="/api/photos/full.jpg" alt="beach.jpg" onClose={() => {}}>
        <span>a caption</span>
      </Lightbox>,
    );
    expect(screen.getByRole("img", { name: "beach.jpg" })).toHaveAttribute(
      "src",
      "/api/photos/full.jpg",
    );
    expect(screen.getByText("a caption")).toBeInTheDocument();
  });

  it("closes on the X button, backdrop click, and Escape", async () => {
    const onClose = vi.fn();
    render(<Lightbox src="/x.jpg" alt="x" onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(2);

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("does not close when the image itself is clicked", async () => {
    const onClose = vi.fn();
    render(<Lightbox src="/x.jpg" alt="x" onClose={onClose} />);
    await userEvent.click(screen.getByRole("img", { name: "x" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows arrows only for the directions that have a handler", () => {
    const { rerender } = render(<Lightbox src="/x.jpg" alt="x" onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "Previous photo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next photo" })).not.toBeInTheDocument();

    rerender(
      <Lightbox src="/x.jpg" alt="x" onClose={() => {}} onPrev={() => {}} onNext={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Previous photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next photo" })).toBeInTheDocument();
  });

  it("calls the navigation handler (not onClose) when an arrow button is clicked", async () => {
    const onClose = vi.fn();
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(
      <Lightbox src="/x.jpg" alt="x" onClose={onClose} onPrev={onPrev} onNext={onNext} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Previous photo" }));
    await userEvent.click(screen.getByRole("button", { name: "Next photo" }));

    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("navigates with the arrow keys, and is inert when no handlers are given", async () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const { rerender } = render(
      <Lightbox src="/x.jpg" alt="x" onClose={() => {}} onPrev={onPrev} onNext={onNext} />,
    );

    await userEvent.keyboard("{ArrowLeft}");
    await userEvent.keyboard("{ArrowRight}");
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);

    const onClose = vi.fn();
    rerender(<Lightbox src="/x.jpg" alt="x" onClose={onClose} />);
    await userEvent.keyboard("{ArrowLeft}");
    await userEvent.keyboard("{ArrowRight}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("treats a horizontal swipe as prev/next and ignores short or vertical drags", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const { rerender } = render(
      <Lightbox src="/x.jpg" alt="x" onClose={() => {}} onPrev={onPrev} onNext={onNext} />,
    );
    const dialog = screen.getByRole("dialog");

    fireEvent.touchStart(dialog, touchPoint(200));
    fireEvent.touchEnd(dialog, touchPoint(280));
    expect(onPrev).toHaveBeenCalledTimes(1);

    fireEvent.touchStart(dialog, touchPoint(200));
    fireEvent.touchEnd(dialog, touchPoint(120));
    expect(onNext).toHaveBeenCalledTimes(1);

    onPrev.mockClear();
    onNext.mockClear();
    rerender(
      <Lightbox src="/x.jpg" alt="x" onClose={() => {}} onPrev={onPrev} onNext={onNext} />,
    );

    fireEvent.touchStart(dialog, touchPoint(200));
    fireEvent.touchEnd(dialog, touchPoint(170)); // dx 30 < threshold
    fireEvent.touchStart(dialog, touchPoint(200, 0));
    fireEvent.touchEnd(dialog, touchPoint(140, 200)); // mostly vertical
    expect(onPrev).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("swallows the click that trails a swipe so the overlay stays open", () => {
    const onClose = vi.fn();
    render(<Lightbox src="/x.jpg" alt="x" onClose={onClose} onNext={() => {}} />);
    const dialog = screen.getByRole("dialog");

    fireEvent.touchStart(dialog, touchPoint(200));
    fireEvent.touchEnd(dialog, touchPoint(120));
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
