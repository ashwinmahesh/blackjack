import { NextRequest, NextResponse } from "next/server";
import { createRoom, RoomError } from "../../../lib/server/rooms";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      name?: string;
      passcode?: string;
      startingBankroll?: number;
    };
    const result = createRoom({
      name: body.name ?? "",
      passcode: body.passcode ?? "",
      startingBankroll: body.startingBankroll,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const status = error instanceof RoomError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Could not create room";
    return NextResponse.json({ error: message }, { status });
  }
}
