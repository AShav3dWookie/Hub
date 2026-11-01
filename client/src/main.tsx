import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "./api/queryClient.js";
import { App } from "./App.js";
import { ToastProvider } from "./components/ToastProvider.js";
import { EditModeProvider } from "./components/EditModeProvider.js";
import "./index.css";

// See api/queryClient.ts: reads and writes both run while the browser reports offline.
const queryClient = createQueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <EditModeProvider>
            <App />
          </EditModeProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
