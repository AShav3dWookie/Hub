import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Lightbox } from "./Lightbox.js";

const at = (x: number, y = 0) => ({
  touches: [{ clientX: x, clientY: y }],
  changedTouches: [{ clientX: x, clientY: y }],
});

const track = () => screen.getByTestId("lightbox-track");
const endTransition = () =>
  fireEvent.transitionEnd(track(), { propertyName: "transform" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Lightbox", () => {
  it("renders the current image, the caption, and neighbour frames when given", () => {
    render(
      <Lightbox
        src="/api/photos/full.jpg"
        alt="beach.jpg"
        prevSrc="/api/photos/prev.jpg"
        nextSrc="/api/photos/next.jpg"
        onClose={() => {}}
      >
        <span>a caption</span>
      </Lightbox>,
    );
    expect(screen.getByRole("img", { name: "beach.jpg" })).toHaveAttribute(
      "src",
      "/api/photos/full.jpg",
    );
    expect(screen.getByText("a caption")).toBeInTheDocument();
    const srcs = [...track().querySelectorAll("img")].map((n) => n.getAttribute("src"));
    expect(srcs).toEqual([
      "/api/photos/prev.jpg",
      "/api/photos/full.jpg",
      "/api/photos/next.jpg",
    ]);
  });

  it("only mounts the current image when no neighbours are supplied", () => {
    render(<Lightbox src="/x.jpg" alt="x" onClose={() => {}} />);
    expect(track().querySelectorAll("img")).toHaveLength(1);
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

  it("slides on an arrow button and only navigates once the slide finishes", async () => {
    const onClose = vi.fn();
    const onNext = vi.fn();
    render(
      <Lightbox
        src="/x.jpg"
        alt="x"
        nextSrc="/n.jpg"
        onClose={onClose}
        onNext={onNext}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(track().style.transform).toBe("translateX(-200%)");
    expect(onNext).not.toHaveBeenCalled();

    endTransition();
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("slides with the arrow keys, and is inert when no handlers are given", async () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const { rerender } = render(
      <Lightbox src="/x.jpg" alt="x" onClose={() => {}} onPrev={onPrev} onNext={onNext} />,
    );

    await userEvent.keyboard("{ArrowRight}");
    expect(track().style.transform).toBe("translateX(-200%)");
    endTransition();
    expect(onNext).toHaveBeenCalledTimes(1);

    await userEvent.keyboard("{ArrowLeft}");
    expect(track().style.transform).toBe("translateX(0%)");
    endTransition();
    expect(onPrev).toHaveBeenCalledTimes(1);

    const onClose = vi.fn();
    rerender(<Lightbox src="/x.jpg" alt="x" onClose={onClose} />);
    await userEvent.keyboard("{ArrowLeft}");
    await userEvent.keyboard("{ArrowRight}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("navigates instantly (no slide) when the user prefers reduced motion", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    const onNext = vi.fn();
    render(<Lightbox src="/x.jpg" alt="x" nextSrc="/n.jpg" onClose={() => {}} onNext={onNext} />);

    await userEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("tracks the finger, then completes the slide past the threshold", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(
      <Lightbox
        src="/x.jpg"
        alt="x"
        prevSrc="/p.jpg"
        nextSrc="/n.jpg"
        onClose={() => {}}
        onPrev={onPrev}
        onNext={onNext}
      />,
    );
    const dialog = screen.getByRole("dialog");

    fireEvent.touchStart(dialog, at(200));
    fireEvent.touchMove(dialog, at(120)); // dx -80, horizontal
    expect(track().style.transform).toContain("-80px");
    fireEvent.touchEnd(dialog, at(120));
    expect(track().style.transform).toBe("translateX(-200%)");
    endTransition();
    expect(onNext).toHaveBeenCalledTimes(1);

    fireEvent.touchStart(dialog, at(200));
    fireEvent.touchMove(dialog, at(285)); // dx +85
    fireEvent.touchEnd(dialog, at(285));
    endTransition();
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("snaps back on a short drag or a mostly-vertical drag without navigating", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(
      <Lightbox
        src="/x.jpg"
        alt="x"
        prevSrc="/p.jpg"
        nextSrc="/n.jpg"
        onClose={() => {}}
        onPrev={onPrev}
        onNext={onNext}
      />,
    );
    const dialog = screen.getByRole("dialog");

    fireEvent.touchStart(dialog, at(200));
    fireEvent.touchMove(dialog, at(230)); // dx 30 < threshold
    fireEvent.touchEnd(dialog, at(230));
    expect(track().style.transform).toBe("translateX(-100%)");
    endTransition();

    fireEvent.touchStart(dialog, at(200, 0));
    fireEvent.touchMove(dialog, at(150, 90)); // mostly vertical
    fireEvent.touchEnd(dialog, at(150, 90));
    endTransition();

    expect(onPrev).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("rubber-bands with resistance when dragging past the last photo", () => {
    const onNext = vi.fn();
    render(<Lightbox src="/x.jpg" alt="x" onClose={() => {}} onNext={onNext} />);
    const dialog = screen.getByRole("dialog");

    fireEvent.touchStart(dialog, at(200));
    fireEvent.touchMove(dialog, at(320)); // dx +120 toward a missing prev -> /3
    expect(track().style.transform).toContain("40px");
    fireEvent.touchEnd(dialog, at(320));
    expect(track().style.transform).toBe("translateX(-100%)");
  });

  it("swallows the click that trails a swipe so the overlay stays open", () => {
    const onClose = vi.fn();
    render(<Lightbox src="/x.jpg" alt="x" nextSrc="/n.jpg" onClose={onClose} onNext={() => {}} />);
    const dialog = screen.getByRole("dialog");

    fireEvent.touchStart(dialog, at(200));
    fireEvent.touchMove(dialog, at(120));
    fireEvent.touchEnd(dialog, at(120));
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an offline placeholder when the full image fails to load", () => {
    render(<Lightbox src="/api/photos/full.jpg" alt="beach.jpg" onClose={() => {}} />);

    fireEvent.error(screen.getByRole("img", { name: "beach.jpg" }));

    expect(screen.getByText(/unavailable offline/i)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "beach.jpg" })).not.toBeInTheDocument();
  });

  it("recovers the image view when src changes to a working photo", () => {
    const { rerender } = render(
      <Lightbox src="/api/photos/bad.jpg" alt="bad.jpg" onClose={() => {}} />,
    );
    fireEvent.error(screen.getByRole("img", { name: "bad.jpg" }));
    expect(screen.getByText(/unavailable offline/i)).toBeInTheDocument();

    rerender(<Lightbox src="/api/photos/good.jpg" alt="good.jpg" onClose={() => {}} />);
    expect(screen.getByRole("img", { name: "good.jpg" })).toBeInTheDocument();
  });
});
