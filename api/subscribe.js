import { createHash } from "node:crypto";
import { getRedis } from "./_lib/redis.js";

export default async function handler(request, response) {
  if (request.method !== "POST" && request.method !== "DELETE") {
    response.setHeader("Allow", "POST, DELETE");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const redis = await getRedis();
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    const subscription = body?.subscription;
    if (!subscription?.endpoint) {
      response.status(400).json({ error: "Missing push subscription." });
      return;
    }

    const id = createHash("sha256").update(subscription.endpoint).digest("hex");

    if (request.method === "DELETE") {
      await redis
        .multi()
        .sRem("push:subscriptions", id)
        .del(`push:subscription:${id}`)
        .exec();
      response.status(200).json({ ok: true });
      return;
    }

    const existingRaw = await redis.get(`push:subscription:${id}`);
    const existing = existingRaw ? JSON.parse(existingRaw) : {};
    const record = {
      ...existing,
      id,
      endpoint: subscription.endpoint,
      subscription,
      timezone: body.timezone || "Asia/Seoul",
      routineReminderTime: body.routineReminderTime || existing.routineReminderTime || "20:00",
      routines: body.routines || existing.routines || {},
      updatedAt: new Date().toISOString(),
      createdAt: existing.createdAt || new Date().toISOString(),
    };

    await redis
      .multi()
      .sAdd("push:subscriptions", id)
      .set(`push:subscription:${id}`, JSON.stringify(record))
      .exec();

    response.status(200).json({ ok: true, id });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
}
