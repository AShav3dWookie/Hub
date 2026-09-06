import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StarRating } from "./StarRating.js";

const stars = () => screen.getAllByRole("radio");

describe("StarRating", () => {
  it("offers five stars", () => {
    render(<StarRating value={null} />);
    expect(stars()).toHaveLength(5);
  });

  it("marks the stars up to the current value as selected", () => {
    render(<StarRating value={3} />);
    expect(stars().map((s) => s.getAttribute("aria-checked"))).toEqual([
      "true",
      "true",
      "true",
      "false",
      "false",
    ]);
  });

  it("selects nothing when there is no rating", () => {
    render(<StarRating value={null} />);
    expect(stars().every((s) => s.getAttribute("aria-checked") === "false")).toBe(true);
  });

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

  it("reports the star that was clicked", async () => {
    const onChange = vi.fn();
    render(<StarRating value={null} onChange={onChange} />);

    await userEvent.click(stars()[3]);
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("ignores clicks when read-only", async () => {
    const onChange = vi.fn();
    render(<StarRating value={2} onChange={onChange} readOnly />);

    await userEvent.click(stars()[4]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("steps up with the right and up arrows", async () => {
    const onChange = vi.fn();
    render(<StarRating value={2} onChange={onChange} />);

    stars()[1].focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(3);

    await userEvent.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith(3);
  });

  it("steps down with the left and down arrows", async () => {
    const onChange = vi.fn();
    render(<StarRating value={3} onChange={onChange} />);

    stars()[2].focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it("stops at five going up", async () => {
    const onChange = vi.fn();
    render(<StarRating value={5} onChange={onChange} />);

    stars()[4].focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(5);
  });

  it("stops at one going down", async () => {
    const onChange = vi.fn();
    render(<StarRating value={1} onChange={onChange} />);

    stars()[0].focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("ignores the keyboard when read-only", async () => {
    const onChange = vi.fn();
    render(<StarRating value={3} onChange={onChange} readOnly />);

    stars()[2].focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is labelled as a rating group", () => {
    render(<StarRating value={null} />);
    expect(screen.getByRole("radiogroup", { name: /rating/i })).toBeInTheDocument();
  });
});
