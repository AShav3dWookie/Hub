import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.js";

/**
 * The route table. Every screen is stubbed, so this asserts the wiring — which path resolves to
 * which screen, and that they all sit behind the auth guard and the layout — without dragging in
 * each page's own data fetching.
 */
const useSync = vi.hoisted(() => vi.fn());
const useRegisterServiceWorker = vi.hoisted(() => vi.fn());

vi.mock("./sync/useSync.js", () => ({ useSync }));
vi.mock("./sw/useRegisterServiceWorker.js", () => ({ useRegisterServiceWorker }));

vi.mock("./components/Layout.js", () => ({
  Layout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="Layout">{children}</div>
  ),
}));
vi.mock("./components/ProtectedRoute.js", () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="ProtectedRoute">{children}</div>
  ),
}));
vi.mock("./routes/Home.js", () => ({ Home: () => <div data-testid="Home" /> }));
vi.mock("./routes/Add.js", () => ({ Add: () => <div data-testid="Add" /> }));
vi.mock("./routes/AddCategory.js", () => ({ AddCategory: () => <div data-testid="AddCategory" /> }));
vi.mock("./routes/Search.js", () => ({ Search: () => <div data-testid="Search" /> }));
vi.mock("./routes/EntityDetail.js", () => ({ EntityDetail: () => <div data-testid="EntityDetail" /> }));
vi.mock("./routes/PersonProfile.js", () => ({ PersonProfile: () => <div data-testid="PersonProfile" /> }));
vi.mock("./routes/Gallery.js", () => ({ Gallery: () => <div data-testid="Gallery" /> }));
vi.mock("./routes/Albums.js", () => ({ Albums: () => <div data-testid="Albums" /> }));
vi.mock("./routes/AlbumDetail.js", () => ({ AlbumDetail: () => <div data-testid="AlbumDetail" /> }));
vi.mock("./routes/Calendar.js", () => ({ Calendar: () => <div data-testid="Calendar" /> }));
vi.mock("./routes/Login.js", () => ({ Login: () => <div data-testid="Login" /> }));
vi.mock("./routes/Settings.js", () => ({ Settings: () => <div data-testid="Settings" /> }));

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useSync.mockReset();
  useRegisterServiceWorker.mockReset();
});

describe("App routing", () => {
  it.each([
    ["/", "Home"],
    ["/add", "Add"],
    ["/add/movie", "AddCategory"],
    ["/search", "Search"],
    ["/settings", "Settings"],
    ["/gallery", "Gallery"],
    ["/calendar", "Calendar"],
    ["/albums", "Albums"],
    ["/album/1", "AlbumDetail"],
    ["/entity/1", "EntityDetail"],
    ["/person/1", "PersonProfile"],
  ])("resolves %s to the %s screen", (path, screenName) => {
    renderAt(path);
    expect(screen.getByTestId(screenName)).toBeInTheDocument();
  });

  it("puts every real route behind the auth guard and the layout", () => {
    renderAt("/");
    expect(screen.getByTestId("ProtectedRoute")).toBeInTheDocument();
    expect(screen.getByTestId("Layout")).toBeInTheDocument();
  });

  it("leaves login outside the guard, so it is reachable when signed out", () => {
    renderAt("/login");
    expect(screen.getByTestId("Login")).toBeInTheDocument();
    expect(screen.queryByTestId("ProtectedRoute")).not.toBeInTheDocument();
    expect(screen.queryByTestId("Layout")).not.toBeInTheDocument();
  });

  it("starts the sync engine and registers the service worker once mounted", () => {
    renderAt("/");
    expect(useSync).toHaveBeenCalled();
    expect(useRegisterServiceWorker).toHaveBeenCalled();
  });

  it("renders the shell for an unknown path rather than crashing", () => {
    renderAt("/no-such-page");
    expect(screen.getByTestId("Layout")).toBeInTheDocument();
  });
});
