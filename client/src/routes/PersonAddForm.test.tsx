import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { PersonAddForm } from "./PersonAddForm.js";

describe("PersonAddForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("shows a validation error and does not call the API when name is empty", async () => {
    renderWithProviders(<PersonAddForm />);

    await userEvent.click(screen.getByRole("button", { name: /create person/i }));

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("submits the trimmed name to the API on valid input", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 1, category: "person", title: "Sarah" }),
    });

    renderWithProviders(<PersonAddForm />);
    await userEvent.type(screen.getByLabelText("Name"), "  Sarah  ");
    await userEvent.click(screen.getByRole("button", { name: /create person/i }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/entities",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ category: "person", title: "Sarah" }),
      }),
    );
  });
});
