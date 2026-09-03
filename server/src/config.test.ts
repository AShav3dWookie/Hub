import { describe, it, expect } from "vitest";
import { DEV_SESSION_SECRET, assertSecureConfig, config } from "./config.js";

type Config = typeof config;

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

  it("accepts auth on with a real secret and a password hash", () => {
    expect(() =>
      assertSecureConfig(
        withConfig({
          authEnabled: true,
          sessionSecret: "a-long-random-string",
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
          sessionSecret: "a-long-random-string",
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
          sessionSecret: "a-long-random-string",
          authPasswordHash: "",
        }),
      ),
    ).not.toThrow();
  });
});
