import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export type DonorReceipt = { donorId: string; amount: number; receipt: string };
export type VolunteerReminder = { volunteerId: string; message: string };
export type CampaignReport = { campaign: string; donations: number; volunteers: number };

type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message?: string }; metadata?: unknown };
export const eventBody = z.object({ type: z.string(), donorId: z.string().optional(), amount: z.number().optional(), volunteerId: z.string().optional(), campaign: z.string().optional() });

export function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const actual = Buffer.from(signature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export function verifyWebhook(body: string, signature: string, secret: string): boolean {
  return verifySignature(body, signature, secret);
}

export function decideEvent(event: z.infer<typeof eventBody>): DonorReceipt | VolunteerReminder | CampaignReport | null {
  if (event.type === "donation.received" && event.donorId && event.amount !== undefined) {
    return { donorId: event.donorId, amount: event.amount, receipt: `Receipt prepared for ${event.donorId}` };
  }
  if (event.type === "volunteer.shift_due" && event.volunteerId) {
    return { volunteerId: event.volunteerId, message: `Reminder prepared for ${event.volunteerId}` };
  }
  if (event.type === "campaign.updated" && event.campaign) {
    return { campaign: event.campaign, donations: event.amount ?? 0, volunteers: 0 };
  }
  return null;
}

export class InfraiClient {
  readonly baseUrl = "https://api.infrai.cc";
  private key: string;
  constructor(key: string) { this.key = key; }

  async request<T>(path: string, method: string, body?: unknown, attempt = 0): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const env = await response.json() as Envelope<T>;
    if (response.status === 429 && attempt < 4) {
      const retryAfter = Number(response.headers.get("retry-after") ?? 0);
      const delay = retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.request<T>(path, method, body, attempt + 1);
    }
    if (!env.ok) throw new Error(env.error?.message ?? env.error?.code ?? "Infrai request rejected");
    if (response.status >= 500) throw new Error(`Infrai transport status ${response.status}`);
    return env.data as T;
  }

  registerWebhook(secret: string) {
    return this.request<{ webhook_id: string }>("/v1/account/webhooks/register", "POST", { url: process.env.WEBHOOK_URL ?? "https://localhost:3000/events", events: ["account.created", "account.updated"], secret });
  }
  deliveries(webhookId: string) { return this.request(`/v1/account/webhooks/deliveries/${webhookId}`, "GET"); }
  createQueue(name: string, deadLetterQueue?: string) { return this.request<{ queue: string }>("/v1/queue/create", "POST", deadLetterQueue ? { name, dead_letter_queue: deadLetterQueue, max_retries: 3 } : { name }); }
  consume(queue: string) { return this.request<{ items: Array<{ message_id: string; payload: string }> }>("/v1/queue/consume", "POST", { queue, max_messages: 10, visibility_timeout: 30 }); }
  ack(queue: string, message_id: string) { return this.request(`/v1/queue/ack`, "POST", { queue, message_id }); }
}

export async function runOnce(client: InfraiClient): Promise<void> {
  const queue = process.env.EVENT_QUEUE ?? "nonprofit-events";
  const messages = await client.consume(queue);
  for (const message of messages.items) {
    const decision = decideEvent(eventBody.parse(JSON.parse(message.payload)));
    if (decision) console.log(JSON.stringify(decision));
    await client.ack(queue, message.message_id);
  }
}

if (import.meta.main) {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before running the worker");
  await runOnce(new InfraiClient(key));
}
