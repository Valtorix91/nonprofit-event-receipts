import test from "node:test";
import assert from "node:assert/strict";
import { decideEvent, verifySignature } from "./nonprofit_webhook.ts";
import { createHmac } from "node:crypto";

test("a donation event produces the receipt decision used by the learning-center workflow", () => {
  const result = decideEvent({ type: "donation.received", donorId: "donor-7", amount: 125 });
  assert.deepEqual(result, { donorId: "donor-7", amount: 125, receipt: "Receipt prepared for donor-7" });
});

test("the webhook boundary accepts the provider signature", () => {
  const body = JSON.stringify({ type: "donation.received" });
  const signature = createHmac("sha256", "course-secret").update(body).digest("hex");
  assert.equal(verifySignature(body, signature, "course-secret"), true);
});
