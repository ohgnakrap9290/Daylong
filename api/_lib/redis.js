import { createClient } from "redis";

let redisClient;

export async function getRedis() {
  const url = process.env.REDIS_URL;

  if (!url) {
    throw new Error("REDIS_URL is required for push subscription storage.");
  }

  if (!redisClient) {
    redisClient = createClient({ url });
    redisClient.on("error", (error) => {
      console.error("Redis client error", error);
    });
  }

  if (!redisClient.isOpen) {
    await redisClient.connect();
  }

  return redisClient;
}

export async function getSubscriptionRecords(ids) {
  if (!ids.length) return [];

  const redis = await getRedis();
  const values = await redis.mGet(ids.map((id) => `push:subscription:${id}`));
  return values.filter(Boolean).map((value) => JSON.parse(value));
}
