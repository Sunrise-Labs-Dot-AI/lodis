import { NextResponse } from "next/server";
import { getAllMemoriesForExport, getAllConnectionsForExport } from "@/lib/db";
import { getUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getUserId();
  const isHosted = !!process.env.TURSO_DATABASE_URL;
  if (isHosted && !userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const memories = await getAllMemoriesForExport(userId);
  const connections = await getAllConnectionsForExport(userId);
  const data = JSON.stringify(
    { version: "1.0", exportedAt: new Date().toISOString(), count: memories.length, memories, connections },
    null,
    2,
  );
  return new NextResponse(data, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="engrams-export.json"`,
    },
  });
}
