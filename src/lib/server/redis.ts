import "server-only";

import { createClient } from "redis";
import type { ManagerProfile } from "@/lib/profile";

const PROFILE_CACHE_TTL_SECONDS = Number(
  process.env.PROFILE_CACHE_TTL_SECONDS ?? 600,
);

type RedisClient = ReturnType<typeof createClient>;

let redisClient: RedisClient | null = null;
let redisConnection: Promise<RedisClient | null> | null = null;

function profileKey(uid: string) {
  return `manager-profile:${uid}`;
}

async function getRedisClient(): Promise<RedisClient | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  if (!redisClient) {
    redisClient = createClient({ url });
    redisClient.on("error", (error) => {
      console.error("Redis error", error);
    });
  }

  if (redisClient.isOpen) return redisClient;

  if (!redisConnection) {
    redisConnection = redisClient
      .connect()
      .then(() => redisClient)
      .catch((error) => {
        console.error("Redis connection failed", error);
        redisClient = null;
        return null;
      })
      .finally(() => {
        redisConnection = null;
      });
  }

  return redisConnection;
}

export async function getCachedManagerProfile(
  uid: string,
): Promise<ManagerProfile | null> {
  try {
    const client = await getRedisClient();
    if (!client) return null;

    const cached = await client.get(profileKey(uid));
    if (!cached) return null;

    return JSON.parse(cached) as ManagerProfile;
  } catch (error) {
    console.error("Manager profile cache read failed", error);
    return null;
  }
}

export async function setCachedManagerProfile(
  uid: string,
  profile: ManagerProfile,
): Promise<void> {
  try {
    const client = await getRedisClient();
    if (!client) return;

    await client.set(profileKey(uid), JSON.stringify(profile), {
      EX: PROFILE_CACHE_TTL_SECONDS,
    });
  } catch (error) {
    console.error("Manager profile cache write failed", error);
  }
}

export async function clearCachedManagerProfile(uid: string): Promise<void> {
  try {
    const client = await getRedisClient();
    if (!client) return;

    await client.del(profileKey(uid));
  } catch (error) {
    console.error("Manager profile cache clear failed", error);
  }
}
