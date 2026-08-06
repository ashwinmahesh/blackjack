import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "dealers-edge",
    time: new Date().toISOString(),
  });
}
