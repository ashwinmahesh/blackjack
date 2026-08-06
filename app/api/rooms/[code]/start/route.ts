import { NextRequest, NextResponse } from "next/server";
import { RoomError, startRoom } from "../../../../../lib/server/rooms";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const body = (await request.json()) as { playerId?: string };
    return NextResponse.json({ room: startRoom(code, body.playerId ?? "") });
  } catch (error) {
    const status = error instanceof RoomError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Could not start table";
    return NextResponse.json({ error: message }, { status });
  }
}
