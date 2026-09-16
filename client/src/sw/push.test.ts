import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  base64UrlToBytes,
  disablePush,
  enablePush,
  pushStatus,
  refreshPushSubscription,
  sendTestPush,
} from "./push.js";

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126 Mobile";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";

/** "BAEC" base64url → bytes 4, 1, 2: a stand-in for the server's 65-byte VAPID public key. */
const SERVER_KEY = "BAEC";

interface FakeSubscription {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  toJSON: () => object;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function fakeSubscription(endpoint: string, keyBytes: number[] = [4, 1, 2]): FakeSubscription {
  return {
    endpoint,
    options: { applicationServerKey: new Uint8Array(keyBytes).buffer },
    toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

interface Device {
  secure?: boolean;
  userAgent?: string;
  standalone?: boolean;
  permission?: NotificationPermission;
  subscription?: FakeSubscription | null;
  pushSupported?: boolean;
}

function stubDevice({
  secure = true,
  userAgent = ANDROID_UA,
  standalone = false,
  permission = "granted",
  subscription = null,
  pushSupported = true,
}: Device = {}) {
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(subscription),
    subscribe: vi.fn(async () => fakeSubscription("https://push.example/new")),
  };
  const registration = { pushManager };

  vi.stubGlobal("isSecureContext", secure);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: standalone && query.includes("standalone") }));
  vi.stubGlobal("navigator", {
    ...navigator,
    userAgent,
    maxTouchPoints: 0,
    onLine: true,
    serviceWorker: {
      ready: Promise.resolve(registration),
      getRegistration: () => Promise.resolve(registration),
    },
  });
  if (pushSupported) {
    vi.stubGlobal("PushManager", function PushManager() {});
    vi.stubGlobal("Notification", { permission });
  } else {
    // stubGlobal can't remove a property; these tests run in jsdom, which has neither.
    delete (window as { PushManager?: unknown }).PushManager;
  }

  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    status: url.endsWith("vapid-public-key") ? 200 : 204,
    statusText: "OK",
    json: async (): Promise<unknown> => ({ publicKey: SERVER_KEY }),
  }));
  vi.stubGlobal("fetch", fetchMock);

  return { pushManager, fetchMock };
}

function requestsTo(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url,
    method: (init as RequestInit).method,
    body: (init as RequestInit).body ? JSON.parse((init as RequestInit).body as string) : undefined,
  }));
}

describe("push", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  describe("pushStatus", () => {
    it("is on when permission is granted and the device is subscribed", async () => {
      stubDevice({ subscription: fakeSubscription("https://push.example/1") });
      expect(await pushStatus()).toBe("on");
    });

    it("is off when permission is granted but there is no subscription", async () => {
      stubDevice();
      expect(await pushStatus()).toBe("off");
    });

    it("is off before the user has been asked", async () => {
      stubDevice({ permission: "default", subscription: fakeSubscription("https://push.example/1") });
      expect(await pushStatus()).toBe("off");
    });

    it("is denied when notifications are blocked", async () => {
      stubDevice({ permission: "denied" });
      expect(await pushStatus()).toBe("denied");
    });

    it("needs a secure context — the app opened by its LAN IP can't subscribe", async () => {
      stubDevice({ secure: false });
      expect(await pushStatus()).toBe("insecure");
    });

    it("needs the installed app on an iPhone", async () => {
      stubDevice({ userAgent: IPHONE_UA, pushSupported: false });
      expect(await pushStatus()).toBe("needs-install");
    });

    it("works in the installed app on an iPhone", async () => {
      stubDevice({ userAgent: IPHONE_UA, standalone: true });
      expect(await pushStatus()).toBe("off");
    });

    it("is unsupported where the Push API is missing", async () => {
      stubDevice({ pushSupported: false });
      expect(await pushStatus()).toBe("unsupported");
    });
  });

  it("decodes a base64url key into bytes", () => {
    expect([...base64UrlToBytes("BAEC")]).toEqual([4, 1, 2]);
    expect([...base64UrlToBytes("_-8")]).toEqual([255, 239]);
  });

  describe("enablePush", () => {
    it("subscribes with the server's key and registers the subscription with the server", async () => {
      const { pushManager, fetchMock } = stubDevice();

      await enablePush();

      const [{ applicationServerKey, userVisibleOnly }] = pushManager.subscribe.mock.calls[0] as unknown as [
        { applicationServerKey: Uint8Array; userVisibleOnly: boolean },
      ];
      expect(userVisibleOnly).toBe(true);
      expect([...applicationServerKey]).toEqual([4, 1, 2]);
      expect(requestsTo(fetchMock)).toEqual([
        { url: "/api/notifications/vapid-public-key", method: "GET", body: undefined },
        {
          url: "/api/notifications/subscriptions",
          method: "POST",
          body: { endpoint: "https://push.example/new", keys: { p256dh: "p", auth: "a" } },
        },
      ]);
    });

    it("reuses a subscription made against the same key", async () => {
      const existing = fakeSubscription("https://push.example/existing");
      const { pushManager, fetchMock } = stubDevice({ subscription: existing });

      await enablePush();

      expect(pushManager.subscribe).not.toHaveBeenCalled();
      expect(requestsTo(fetchMock)[1].body.endpoint).toBe("https://push.example/existing");
    });

    it("replaces a subscription made against a key the server no longer has", async () => {
      const stale = fakeSubscription("https://push.example/stale", [9, 9, 9]);
      const { pushManager, fetchMock } = stubDevice({ subscription: stale });

      await enablePush();

      expect(stale.unsubscribe).toHaveBeenCalledOnce();
      expect(pushManager.subscribe).toHaveBeenCalledOnce();
      expect(requestsTo(fetchMock)[1].body.endpoint).toBe("https://push.example/new");
    });
  });

  describe("disablePush", () => {
    it("tells the server and unsubscribes", async () => {
      const existing = fakeSubscription("https://push.example/1");
      const { fetchMock } = stubDevice({ subscription: existing });

      await disablePush();

      expect(requestsTo(fetchMock)).toEqual([
        {
          url: "/api/notifications/subscriptions",
          method: "DELETE",
          body: { endpoint: "https://push.example/1" },
        },
      ]);
      expect(existing.unsubscribe).toHaveBeenCalledOnce();
    });

    it("still unsubscribes the browser when the server can't be reached", async () => {
      const existing = fakeSubscription("https://push.example/1");
      const { fetchMock } = stubDevice({ subscription: existing });
      fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      await expect(disablePush()).rejects.toThrow();
      expect(existing.unsubscribe).toHaveBeenCalledOnce();
    });
  });

  describe("sendTestPush", () => {
    it("asks the server to notify this device", async () => {
      const { fetchMock } = stubDevice({ subscription: fakeSubscription("https://push.example/1") });

      await sendTestPush();

      expect(requestsTo(fetchMock)).toEqual([
        { url: "/api/notifications/test", method: "POST", body: { endpoint: "https://push.example/1" } },
      ]);
    });

    it("drops a subscription the server says has expired, so it can be turned on afresh", async () => {
      const existing = fakeSubscription("https://push.example/1");
      const { fetchMock } = stubDevice({ subscription: existing });
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ error: "This device's subscription has expired — turn notifications on again" }),
      });

      await expect(sendTestPush()).rejects.toThrow(/expired/);
      expect(existing.unsubscribe).toHaveBeenCalledOnce();
    });

    it("keeps the subscription when the push service only refused this once", async () => {
      const existing = fakeSubscription("https://push.example/1");
      const { fetchMock } = stubDevice({ subscription: existing });
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        json: async () => ({ error: "try again in a moment" }),
      });

      await expect(sendTestPush()).rejects.toThrow();
      expect(existing.unsubscribe).not.toHaveBeenCalled();
    });
  });

  describe("refreshPushSubscription", () => {
    it("re-sends an existing subscription", async () => {
      const { fetchMock, pushManager } = stubDevice({
        subscription: fakeSubscription("https://push.example/1"),
      });

      await refreshPushSubscription();

      expect(pushManager.subscribe).not.toHaveBeenCalled();
      expect(requestsTo(fetchMock)[1]).toEqual(
        expect.objectContaining({
          url: "/api/notifications/subscriptions",
          method: "POST",
          body: expect.objectContaining({ endpoint: "https://push.example/1" }),
        }),
      );
    });

    it("re-subscribes without asking when the server's key changed (a recreated database)", async () => {
      const stale = fakeSubscription("https://push.example/stale", [9, 9, 9]);
      const { fetchMock } = stubDevice({ subscription: stale });

      await refreshPushSubscription();

      expect(stale.unsubscribe).toHaveBeenCalledOnce();
      expect(requestsTo(fetchMock)[1].body.endpoint).toBe("https://push.example/new");
    });

    it("does nothing for a device that isn't subscribed", async () => {
      const { fetchMock } = stubDevice();
      await refreshPushSubscription();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("swallows a failure — the next launch tries again", async () => {
      const { fetchMock } = stubDevice({ subscription: fakeSubscription("https://push.example/1") });
      fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await expect(refreshPushSubscription()).resolves.toBeUndefined();
    });
  });
});
