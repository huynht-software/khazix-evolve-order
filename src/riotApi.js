/** Rate-limited, disk-cached client for the Riot Games API. */

import fs from "node:fs/promises";
import path from "node:path";

import { sleep } from "./util.js";

/** Platform host -> regional routing host used by account-v1 and match-v5. */
export const PLATFORM_ROUTING = {
  br1: "americas",
  la1: "americas",
  la2: "americas",
  na1: "americas",
  eun1: "europe",
  euw1: "europe",
  me1: "europe",
  ru: "europe",
  tr1: "europe",
  jp1: "asia",
  kr: "asia",
  oc1: "sea",
  ph2: "sea",
  sg2: "sea",
  th2: "sea",
  tw2: "sea",
  vn2: "sea",
};

export const RANKED_SOLO_QUEUE = 420;

export class RiotApiError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} for ${url}: ${String(body).slice(0, 300)}`);
    this.name = "RiotApiError";
    this.status = status;
    this.url = url;
  }
}

/** Sliding-window limiter enforcing several {count, windowMs} budgets at once. */
class RateLimiter {
  constructor(limits) {
    this.limits = limits.map((limit) => ({ ...limit, hits: [] }));
  }

  async acquire() {
    for (;;) {
      const now = Date.now();
      let wait = 0;

      for (const limit of this.limits) {
        while (limit.hits.length && now - limit.hits[0] >= limit.windowMs) limit.hits.shift();
        if (limit.hits.length >= limit.count) {
          wait = Math.max(wait, limit.windowMs - (now - limit.hits[0]) + 50);
        }
      }

      if (wait <= 0) {
        const stamp = Date.now();
        for (const limit of this.limits) limit.hits.push(stamp);
        return;
      }
      await sleep(wait);
    }
  }
}

/**
 * Development keys allow 20 requests/second and 100 requests/2 minutes, which is the
 * default budget here. Personal/production keys are far higher.
 */
const DEV_KEY_LIMITS = [
  { count: 20, windowMs: 1000 },
  { count: 100, windowMs: 120_000 },
];

export class RiotClient {
  constructor({ apiKey, platform = "euw1", cacheDir = "cache", limits = DEV_KEY_LIMITS } = {}) {
    this.apiKey = apiKey || process.env.RIOT_API_KEY || "";
    if (!this.apiKey) {
      throw new Error(
        "No Riot API key. Put RIOT_API_KEY=... in a .env file or set the environment " +
          "variable. Keys come from https://developer.riotgames.com",
      );
    }
    if (!PLATFORM_ROUTING[platform]) {
      throw new Error(
        `Unknown platform "${platform}". Known: ${Object.keys(PLATFORM_ROUTING).sort().join(", ")}`,
      );
    }

    this.platform = platform;
    this.region = PLATFORM_ROUTING[platform];
    this.cacheDir = cacheDir;
    this.limiter = new RateLimiter(limits);
    this.requestsMade = 0;
    this.cacheHits = 0;
  }

  async #get(host, urlPath, params) {
    const url = new URL(`https://${host}.api.riotgames.com${urlPath}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await this.limiter.acquire();
      this.requestsMade += 1;

      const response = await fetch(url, {
        headers: { "X-Riot-Token": this.apiKey },
        signal: AbortSignal.timeout(20_000),
      });

      if (response.ok) return response.json();

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("Retry-After") ?? 5);
        await sleep((Number.isFinite(retryAfter) ? retryAfter : 5) * 1000 + 500);
        continue;
      }
      if (response.status >= 500) {
        await sleep(2 ** attempt * 1000);
        continue;
      }
      throw new RiotApiError(response.status, url.toString(), await response.text());
    }

    throw new RiotApiError(429, url.toString(), "Exhausted retries against rate limit.");
  }

  async #cached(cacheKey, host, urlPath, params) {
    const file = path.join(this.cacheDir, cacheKey);
    try {
      const cached = await fs.readFile(file, "utf8");
      this.cacheHits += 1;
      return JSON.parse(cached);
    } catch {
      // Cache miss; fall through to the network.
    }

    const payload = await this.#get(host, urlPath, params);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(payload), "utf8");
    return payload;
  }

  accountByRiotId(gameName, tagLine) {
    const safe = `${gameName}-${tagLine}`.replace(/[^\w.-]+/g, "_");
    return this.#cached(
      path.join("account", `${this.region}_${safe}.json`),
      this.region,
      `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    );
  }

  /** Newest-first match IDs, paginated in blocks of 100 (the API maximum). */
  async matchIds(puuid, { count = 200, queue = RANKED_SOLO_QUEUE, startTime } = {}) {
    const collected = [];
    while (collected.length < count) {
      const batchSize = Math.min(100, count - collected.length);
      // Deliberately uncached: caching these pages would hide newly played games.
      const batch = await this.#get(this.region, `/lol/match/v5/matches/by-puuid/${puuid}/ids`, {
        start: collected.length,
        count: batchSize,
        queue,
        startTime,
      });
      collected.push(...batch);
      if (batch.length < batchSize) break;
    }
    return collected;
  }

  match(matchId) {
    return this.#cached(
      path.join("match", `${matchId}.json`),
      this.region,
      `/lol/match/v5/matches/${matchId}`,
    );
  }

  timeline(matchId) {
    return this.#cached(
      path.join("timeline", `${matchId}.json`),
      this.region,
      `/lol/match/v5/matches/${matchId}/timeline`,
    );
  }
}
