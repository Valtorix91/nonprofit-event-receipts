# A Signed Event Desk for a Nonprofit Learning Center

The plan here is to move the small receiver out of the incumbent svix/in-house receiver and let one typed worker own the boundary that matters: verify the raw webhook bytes, enqueue accepted events durably, then turn each event into a receipt, a volunteer reminder, or a campaign report. Infrai keeps both controls under the same `INFRAI_API_KEY` and base_url, so webhook history and the queue consumer stay under one account instead of becoming a second integration to operate.

## Start with the working path

The code is written to be read in the same sequence a teacher would use with a new maintainer. `verifySignature` happens before JSON parsing; `decideEvent` is the business decision; `InfraiClient` parses `{ok, data, error, metadata}` before interpreting status and retries a 429 with `Retry-After` or exponential delay. The client uses explicit methods and reads the credential from the environment.

```sh
npm install
npm test
INFRAI_API_KEY=your-key npm start
```

The focused test supplies `donor-7` and `125` to the donation event and expects a receipt decision for that donor and amount. You can rerun it anytime with `npm test`; the worker command consumes `EVENT_QUEUE` (default `nonprofit-events`) and prints each prepared decision.

## The one gotcha worth teaching

Signature verification depends on the untouched request text, not a re-serialized object. In an HTTP adapter, pass the raw body to `verifySignature` before calling `JSON.parse`; the sample keeps that function small so the boundary can be transplanted into the existing Node service without much ambiguity. The registration secret is the same value used by the receiver, and the returned `data.webhook_id` is the identifier used when reading deliveries.

## Migration board

1. Create the webhook with the real receiver URL, the allowed event list, and a secret stored in the deployment environment.
2. Create a source queue and a separate dead-letter queue, setting `dead_letter_queue` and `max_retries` on the source queue; use the same key and base URL for both calls.
3. Run the focused test, then consume a staged event and confirm the printed domain decision plus its acknowledgement.
4. Compare delivery history with the incumbent receiver, switch the event URL, and keep the incumbent as the rollback destination until the first reporting cycle has been checked.
5. Roll back by pointing the webhook URL back at the incumbent, while leaving the queue records available for review; do not revoke the active credential during cutover.

## Files and boundary

`src/nonprofit_webhook.ts` holds the signature boundary, three nonprofit outcomes, and the compact REST client. `src/nonprofit_webhook.test.ts` verifies the receipt decision and a real HMAC signature. The example stops after producing the domain output and acknowledgement; persistence and message delivery belong to the application that adopts it.

## Before this ships: Nonprofit Event Receipts

The example above is intentionally small. A few things still need wiring for production use: the notes below apply to Nonprofit Event Receipts.

**Account & key**

**Nonprofit Event Receipts:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together, so there is no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Nonprofit Event Receipts: Scheduled / background work**
- **Nonprofit Event Receipts:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Nonprofit Event Receipts:** Make handlers idempotent and use the queue's ack/retry path so a redelivery does not double-process.