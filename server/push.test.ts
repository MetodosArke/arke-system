import { describe, expect, it } from "vitest";
import { getVapidPublicKey, pushConfigured, sendPushToUser } from "./push";

describe("push (sem VAPID configurado no ambiente de teste)", () => {
  it("reports as not configured", () => {
    expect(pushConfigured()).toBe(false);
  });

  it("returns a null public key", () => {
    expect(getVapidPublicKey()).toBeNull();
  });

  it("no-ops instead of throwing when sending without VAPID keys", async () => {
    await expect(sendPushToUser("00000000-0000-4000-8000-0000000000a1", { title: "Título", body: "Corpo" })).resolves.toEqual({ sent: 0 });
  });
});
