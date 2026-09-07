import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { Layout } from "./Layout.js";

const useAuthStatus = vi.hoisted(() => vi.fn());
const logoutMutate = vi.hoisted(() => vi.fn());
const useLogout = vi.hoisted(() => vi.fn(() => ({ mutate: logoutMutate })));

vi.mock("../api/auth.js", () => ({ useAuthStatus, useLogout }));
vi.mock("./BottomNav.js", () => ({ BottomNav: () => <nav data-testid="bottom-nav" /> }));

beforeEach(() => {
  useAuthStatus.mockReturnValue({ data: { authRequired: false, authenticated: true } });
  logoutMutate.mockReset();
});

function Where() {
  return <div data-testid="path">{useLocation().pathname}</div>;
}

/**
 * Back needs a real history stack, which renderWithProviders' single `route` cannot build.
 */
function renderAt(initialEntries: string[], initialIndex = initialEntries.length - 1) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
        <Layout>
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </Layout>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Layout", () => {
  it("renders the page content", () => {
    renderWithProviders(
      <Layout>
        <p>the page</p>
      </Layout>,
    );
    expect(screen.getByText("the page")).toBeInTheDocument();
  });

  it("links the app name home", () => {
    renderWithProviders(<Layout>x</Layout>);
    expect(screen.getByRole("link", { name: "Logger" })).toHaveAttribute("href", "/");
  });

  it("always shows the bottom navigation", () => {
    renderWithProviders(<Layout>x</Layout>);
    expect(screen.getByTestId("bottom-nav")).toBeInTheDocument();
  });

  it("hides log out when auth is switched off, the usual LAN setup", () => {
    useAuthStatus.mockReturnValue({ data: { authRequired: false, authenticated: true } });
    renderWithProviders(<Layout>x</Layout>);
    expect(screen.queryByRole("button", { name: /log out/i })).not.toBeInTheDocument();
  });

  it("hides log out when auth is on but nobody is signed in", () => {
    useAuthStatus.mockReturnValue({ data: { authRequired: true, authenticated: false } });
    renderWithProviders(<Layout>x</Layout>);
    expect(screen.queryByRole("button", { name: /log out/i })).not.toBeInTheDocument();
  });

  it("offers log out to a signed-in user", () => {
    useAuthStatus.mockReturnValue({ data: { authRequired: true, authenticated: true } });
    renderWithProviders(<Layout>x</Layout>);
    expect(screen.getByRole("button", { name: /log out/i })).toBeInTheDocument();
  });

  it("logs out when the button is pressed", async () => {
    useAuthStatus.mockReturnValue({ data: { authRequired: true, authenticated: true } });
    renderWithProviders(<Layout>x</Layout>);

    await userEvent.click(screen.getByRole("button", { name: /log out/i }));
    expect(logoutMutate).toHaveBeenCalledTimes(1);
  });

  it("copes with the auth status not having loaded yet", () => {
    useAuthStatus.mockReturnValue({ data: undefined });
    renderWithProviders(<Layout>x</Layout>);
    expect(screen.queryByRole("button", { name: /log out/i })).not.toBeInTheDocument();
  });

  it("reaches settings from the header", () => {
    renderWithProviders(<Layout>x</Layout>);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("offers no back arrow at a tab root, where there is nothing to go back to", () => {
    renderAt(["/calendar"]);
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("offers a back arrow on a screen the tab bar does not own", () => {
    renderAt(["/entity/5"]);
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("Back pops history when there is in-app history", async () => {
    renderAt(["/", "/entity/5"], 1);
    expect(screen.getByTestId("path")).toHaveTextContent("/entity/5");

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/");
  });

  it("Back falls back to / on a fresh deep link (no history)", async () => {
    renderAt(["/entity/5"]);
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/");
  });
});