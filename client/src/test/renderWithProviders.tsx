import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter, type InitialEntry } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "../components/ToastProvider.js";
import { EditModeProvider } from "../components/EditModeProvider.js";

export function renderWithProviders(
  ui: ReactElement,
  {
    route = "/",
    editing = false,
  }: {
    route?: InitialEntry;
    /**
     * Start in edit mode. A component test renders a route without the header that carries
     * the pencil, so there is nothing to tap — this is that tap.
     */
    editing?: boolean;
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider>
          <EditModeProvider initialEditing={editing}>{ui}</EditModeProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
