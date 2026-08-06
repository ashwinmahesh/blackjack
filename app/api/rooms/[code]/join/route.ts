import { NextRequest, NextResponse } from "next/server";
import { joinRoom, RoomError } from "../../../../../lib/server/rooms";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const body = (await request.json()) as { name?: string; passcode?: string };
    const result = joinRoom({
      code,
      name: body.name ?? "",
      passcode: body.passcode ?? "",
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof RoomError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Could not join room";
    return NextResponse.json({ error: message }, { status });
  }
}
