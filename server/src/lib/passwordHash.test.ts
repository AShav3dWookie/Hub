import { describe, it, expect, afterEach } from "vitest";
import { hashPassword, verifyPassword, readStdin } from "./passwordHash.js";

const realStdin = process.stdin;

/** Stand in for `process.stdin`: the pieces `readStdin` actually touches. */
function stubStdin(chunks: string[], isTTY = false) {
  Object.defineProperty(process, "stdin", {
    configurable: true,
    value: {
      isTTY,
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield Buffer.from(chunk, "utf8");
      },
    },
  });
}

afterEach(() => {
  Object.defineProperty(process, "stdin", { configurable: true, value: realStdin });
});

describe("hashPassword / verifyPassword", () => {
  it("accepts the password it hashed and rejects any other", async () => {
    const hash = await hashPassword("correct-horse-battery");

    expect(hash).not.toBe("correct-horse-battery");
    expect(await verifyPassword("correct-horse-battery", hash)).toBe(true);
    expect(await verifyPassword("correct-horse-batterz", hash)).toBe(false);
  });

  it("produces a different hash each time, so equal passwords are not comparable by hash", async () => {
    const [a, b] = await Promise.all([hashPassword("same-password"), hashPassword("same-password")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });
});

describe("readStdin", () => {
  it("reads a piped password, joining chunks", async () => {
    stubStdin(["piped-", "pass", "word"]);
    expect(await readStdin()).toBe("piped-password");
  });

  it("strips the single trailing newline a shell adds", async () => {
    stubStdin(["piped-password\n"]);
    expect(await readStdin()).toBe("piped-password");
  });

  it("keeps interior whitespace, so a password may contain spaces", async () => {
    stubStdin(["two words here\n"]);
    expect(await readStdin()).toBe("two words here");
  });

  it("reads nothing when stdin is a terminal, so the script falls back to its argument", async () => {
    stubStdin(["never-read"], true);
    expect(await readStdin()).toBe("");
  });
});
