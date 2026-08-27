import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { Login } from "./Login.js";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function renderLogin() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<div>home</div>} />
    </Routes>,
    { route: "/login" },
  );
}

describe("Login", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("posts the password and navigates home on success", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ authRequired: true, authenticated: true }));

    renderLogin();
    await userEvent.type(screen.getByPlaceholderText("Password"), "hunter2");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ password: "hunter2" }) }),
    );
    expect(await screen.findByText("home")).toBeInTheDocument();
  });

  it("shows an error on a failed login and stays on the page", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ error: "Invalid password" }, 401),
    );

    renderLogin();
    await userEvent.type(screen.getByPlaceholderText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Incorrect password")).toBeInTheDocument();
    expect(screen.queryByText("home")).not.toBeInTheDocument();
  });
});
