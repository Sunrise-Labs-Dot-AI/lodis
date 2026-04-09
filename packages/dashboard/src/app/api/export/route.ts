import { NextResponse } from "next/server";
import { getAllMemoriesForExport } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const memories = await getAllMemoriesForExport();
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
