import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Lightbox } from "./Lightbox.js";

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
});
