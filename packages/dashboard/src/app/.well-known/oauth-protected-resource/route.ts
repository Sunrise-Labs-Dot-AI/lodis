import { NextResponse } from "next/server";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.getengrams.com";

export function GET() {
  return NextResponse.json({
    resource: `${BASE_URL}/api/mcp`,
    authorization_servers: [BASE_URL],
    scopes_supported: ["mcp:full"],
    bearer_methods_supported: ["header"],
  });
}
