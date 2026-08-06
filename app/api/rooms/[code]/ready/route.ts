import { NextRequest, NextResponse } from "next/server";
import { RoomError, updateReady } from "../../../../../lib/server/rooms";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const body = (await request.json()) as { playerId?: string; ready?: boolean };
    const room = updateReady(code, body.playerId ?? "", Boolean(body.ready));
    return NextResponse.json({ room });
  } catch (error) {
    const status = error instanceof RoomError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Could not update seat";
    return NextResponse.json({ error: message }, { status });
  }
}
