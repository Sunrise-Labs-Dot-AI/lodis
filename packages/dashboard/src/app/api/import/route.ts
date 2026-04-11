import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { importMemories } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const userId = await getUserId();
  const isHosted = !!process.env.TURSO_DATABASE_URL;
  if (isHosted && !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    if (!body.memories || !Array.isArray(body.memories)) {
      return NextResponse.json(
        { error: "Invalid format: expected { memories: [...] }" },
        { status: 400 },
      );
    }

    const result = await importMemories(body, userId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 },
    );
  }
}
