import { describe, expect, it } from "vitest";
import { assertRateLimit } from "./_core/rateLimit";

describe("assertRateLimit", () => {
  it("allows attempts up to the limit and blocks the next one", () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(() => assertRateLimit(key, 3, 60_000)).not.toThrow();
    expect(() => assertRateLimit(key, 3, 60_000)).toThrow(/Muitas tentativas/);
  });

  it("keeps buckets independent by key", () => {
    const keyA = `test:${Math.random()}`;
    const keyB = `test:${Math.random()}`;
    assertRateLimit(keyA, 1, 60_000);
    expect(() => assertRateLimit(keyB, 1, 60_000)).not.toThrow();
    expect(() => assertRateLimit(keyA, 1, 60_000)).toThrow();
  });

  it("resets the count after the window expires", async () => {
    const key = `test:${Math.random()}`;
    assertRateLimit(key, 1, 10);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(() => assertRateLimit(key, 1, 10)).not.toThrow();
  });
});
