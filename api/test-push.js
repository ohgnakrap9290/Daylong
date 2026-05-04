import { createHash } from "node:crypto";
import webpush from "web-push";
import { getRedis } from "./_lib/redis.js";

const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY || "BN1P6SbaSmQTqJdXpTJEAjHw3MSlgex3iMrdfibjPM4wUZYS_nBQJdOgQFTh7e0bkpsSTQvsCPN209DBbiZIfD8";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!process.env.VAPID_PRIVATE_KEY) {
    response.status(500).json({ error: "VAPID_PRIVATE_KEY is required." });
    return;
  }

  try {
    const body = parseBody(request.body);
    const subscription = body?.subscription;
    if (!subscription?.endpoint) {
      response.status(400).json({ error: "Missing push subscription." });
      return;
    }

    await delay(30 * 1000);
    webpush.setVapidDetails("mailto:daylong@example.com", VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: "DayLong 테스트 알림",
        body: "30초 테스트 알림입니다. 앱을 닫아도 보이면 서버 push가 정상입니다.",
        tag: `daylong-test-${Date.now()}`,
        url: "/",
      }),
    );

    response.status(200).json({ ok: true });
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410) {
      await deleteInvalidSubscription(request.body).catch(() => {});
      response.status(410).json({ error: "Push subscription expired." });
      return;
    }

    response.status(500).json({ error: error.message });
  }
}

function parseBody(body) {
  if (typeof body === "string") return JSON.parse(body);
  if (Buffer.isBuffer(body)) return JSON.parse(body.toString("utf8"));
  return body;
}

async function deleteInvalidSubscription(rawBody) {
  const body = parseBody(rawBody);
  const endpoint = body?.subscription?.endpoint;
  if (!endpoint) return;

  const id = createHash("sha256").update(endpoint).digest("hex");
  const redis = await getRedis();
  await redis
    .multi()
    .sRem("push:subscriptions", id)
    .del(`push:subscription:${id}`)
    .exec();
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
