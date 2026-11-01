import { describe, it, expect, afterEach } from "vitest";
import { MutationObserver, onlineManager } from "@tanstack/react-query";
import { createQueryClient } from "./queryClient.js";

describe("createQueryClient", () => {
  afterEach(() => onlineManager.setOnline(true));

  it("still runs a write after the browser has gone offline", async () => {
    // What a phone does walking into a shop with no signal, with the app already open.
    onlineManager.setOnline(false);
    let wrote = false;
    const write = new MutationObserver(createQueryClient(), {
      mutationFn: async () => {
        wrote = true;
        return "queued";
      },
    });

    await expect(write.mutate()).resolves.toBe("queued");
    expect(wrote).toBe(true);
  });
});
