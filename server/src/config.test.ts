import { describe, it, expect, vi, afterEach } from "vitest";
import { DEV_SESSION_SECRET, assertSecureConfig, warnInsecureConfig, config } from "./config.js";

type Config = typeof config;

// A realistic secret: 44 base64 chars, the shape of `openssl rand -base64 33`.
const REAL_SECRET = "Zt7Qw1cVb9xK4pR2sN6hJ8mL0dF3gY5aU7eO1iC2kP4";

const withConfig = (overrides: Partial<Config>): Config => ({
  ...config,
  ...overrides,
});

describe("assertSecureConfig", () => {
  it("allows the development default while auth is off", () => {
    expect(() =>
      assertSecureConfig(
        withConfig({ authEnabled: false, sessionSecret: DEV_SESSION_SECRET, authPasswordHash: "" }),
      ),
    ).not.toThrow();
  });

  it("refuses to start with auth on and the committed development secret", () => {
    expect(() =>
      assertSecureConfig(
        withConfig({
          authEnabled: true,
          sessionSecret: DEV_SESSION_SECRET,
          authPasswordHash: "$2a$10$hash",
        }),
      ),
    ).toThrow(/SESSION_SECRET/);
  });

  it("explains why the default secret is unsafe rather than just naming it", () => {
    expect(() =>
      assertSecureConfig(
        withConfig({
          authEnabled: true,
          sessionSecret: DEV_SESSION_SECRET,
          authPasswordHash: "$2a$10$hash",
        }),
      ),
    ).toThrow(/forge a logged-in session/);
  });

  it("refuses to start with auth on and the docker-compose placeholder secret", () => {
    expect(() =>
      assertSecureConfig(
        withConfig({
          authEnabled: true,
          sessionSecret: "change-me-in-production",
          authPasswordHash: "$2a$10$hash",
        }),
      ),
    ).toThrow(/SESSION_SECRET/);
  });

  it("refuses to start with auth on and a too-short secret", () => {
    expect(() =>
      assertSecureConfig(
        withConfig({
          authEnabled: true,
          sessionSecret: "short-but-not-a-placeholder",
          authPasswordHash: "$2a$10$hash",
        }),
      ),
    ).toThrow(/32/);
  });

  it("accepts auth on with a real secret and a password hash", () => {
    expect(() =>
      assertSecureConfig(
        withConfig({
          authEnabled: true,
          sessionSecret: REAL_SECRET,
          authPasswordHash: "$2a$10$hash",
        }),
      ),
    ).not.toThrow();
  });

  it("refuses to start with auth on and no password hash", () => {
    expect(() =>
      assertSecureConfig(
        withConfig({
          authEnabled: true,
          sessionSecret: REAL_SECRET,
          authPasswordHash: "",
        }),
      ),
    ).toThrow(/AUTH_PASSWORD_HASH/);
  });

  it("ignores a missing password hash while auth is off", () => {
    expect(() =>
      assertSecureConfig(
        withConfig({
          authEnabled: false,
          sessionSecret: REAL_SECRET,
          authPasswordHash: "",
        }),
      ),
    ).not.toThrow();
  });
});

describe("warnInsecureConfig", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns when auth is on but the proxy is not trusted", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnInsecureConfig(
      withConfig({ authEnabled: true, trustProxy: false, cookieSecure: undefined }),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/TRUST_PROXY/));
  });

  it("warns when auth is on but Secure cookies are forced off", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnInsecureConfig(withConfig({ authEnabled: true, trustProxy: 1, cookieSecure: false }));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/COOKIE_SECURE/));
  });

  it("stays silent for a sound proxy configuration", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnInsecureConfig(withConfig({ authEnabled: true, trustProxy: 1, cookieSecure: undefined }));
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent while auth is off", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnInsecureConfig(withConfig({ authEnabled: false, trustProxy: false, cookieSecure: false }));
    expect(warn).not.toHaveBeenCalled();
  });
});
