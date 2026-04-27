import Redis from "ioredis";

let redis: Redis | null = null;

function getRedisUrl() {
  return process.env.REDIS_URL || "redis://127.0.0.1:6379";
}

export function getRedis() {
  if (!redis) {
    redis = new Redis(getRedisUrl(), {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableReadyCheck: true,
    });

    redis.on("error", (error) => {
      console.error("[Redis] 连接异常:", error);
    });
  }

  return redis;
}

async function ensureConnected() {
  const client = getRedis();

  if (client.status === "wait") {
    await client.connect();
  }

  return client;
}

export async function setCache<T>(key: string, value: T, ttlSeconds?: number) {
  const client = await ensureConnected();
  const payload = JSON.stringify(value);

  if (ttlSeconds && ttlSeconds > 0) {
    await client.set(key, payload, "EX", ttlSeconds);
    return;
  }

  await client.set(key, payload);
}

export async function getCache<T>(key: string): Promise<T | null> {
  const client = await ensureConnected();
  const payload = await client.get(key);

  if (!payload) {
    return null;
  }

  return JSON.parse(payload) as T;
}

export async function deleteCache(key: string) {
  const client = await ensureConnected();
  return client.del(key);
}

export async function pingRedis() {
  const client = await ensureConnected();
  return client.ping();
}
