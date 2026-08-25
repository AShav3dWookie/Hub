import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StarRating } from "./StarRating.js";

describe("StarRating", () => {
  it("calls onChange with the clicked star value", async () => {
    const onChange = vi.fn();
    render(<StarRating value={null} onChange={onChange} />);
    await userEvent.click(screen.getByLabelText("3 stars"));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("clears the rating when clicking the already-selected star", async () => {
    const onChange = vi.fn();
    render(<StarRating value={3} onChange={onChange} />);
    await userEvent.click(screen.getByLabelText("3 stars"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("does not call onChange when readOnly", async () => {
    const onChange = vi.fn();
    render(<StarRating value={3} onChange={onChange} readOnly />);
    await userEvent.click(screen.getByLabelText("4 stars"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
