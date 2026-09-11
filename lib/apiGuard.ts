import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// These routes proxy paid Google / TollGuru calls, so only serve requests
// that come from our own frontend.
function isAllowedOrigin(req: NextRequest): boolean {
  let host: string | null = null;
  try {
    const raw =
      req.headers.get("origin") ?? req.headers.get("referer") ?? "";
    if (raw) host = new URL(raw).host;
  } catch {
    return false;
  }
  if (!host) return false;

  if (host === "localhost:3000") return true;      // local dev
  if (host.endsWith(".vercel.app")) return true;   // prod + preview deploys
  const custom = process.env.ALLOWED_ORIGIN;       // your custom domain, if any
  return !!custom && host === custom;
}

// 20 requests / 60s per client IP. Skipped entirely when Upstash isn't
// configured (local dev, or before you connect it), so nothing breaks.
const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const ratelimit =
  url && token
    ? new Ratelimit({
        redis: new Redis({ url, token }),
        limiter: Ratelimit.slidingWindow(20, "60 s"),
        prefix: "district-router",
      })
    : null;

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Run first in each route. Returns a response to reject, or null to proceed. */
export async function guard(req: NextRequest): Promise<NextResponse | null> {
  if (!isAllowedOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (ratelimit) {
    try {
      const { success } = await ratelimit.limit(clientIp(req));
      if (!success) {
        return NextResponse.json(
          { error: "Too many requests. Slow down." },
          { status: 429 }
        );
      }
    } catch {
      // Rate limiter unreachable - don't take the app down over it.
    }
  }
  return null;
}
