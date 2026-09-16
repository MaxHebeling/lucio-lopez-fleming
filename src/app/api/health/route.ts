import { NextResponse } from "next/server";

/** Liveness: el proceso responde. No toca la base (para eso está /api/ready). */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    env: process.env.APP_ENV ?? process.env.NODE_ENV,
    time: new Date().toISOString(),
  });
}
