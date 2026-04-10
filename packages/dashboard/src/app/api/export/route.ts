import { NextResponse } from "next/server";
import { getAllMemoriesForExport } from "@/lib/db";
import { getUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getUserId();
  const isHosted = !!process.env.TURSO_DATABASE_URL;
  if (isHosted && !userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const memories = await getAllMemoriesForExport(userId);
  const data = JSON.stringify(
    { exportedAt: new Date().toISOString(), count: memories.length, memories },
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
