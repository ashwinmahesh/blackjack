import { hostHeaderValidationResponse, originValidationResponse } from "@modelcontextprotocol/server";
import { blackjackMcpHandler } from "../../lib/server/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function allowedHosts() {
  return [
    "ashwinblackjack.com",
    "www.ashwinblackjack.com",
    "localhost",
    "127.0.0.1",
    "[::1]",
    ...(process.env.MCP_ALLOWED_HOSTS?.split(",").map((host) => host.trim()).filter(Boolean) ?? []),
  ];
}

function handle(request: Request) {
  const hosts = allowedHosts();
  return hostHeaderValidationResponse(request, hosts) ??
    originValidationResponse(request, hosts) ??
    blackjackMcpHandler.fetch(request);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
