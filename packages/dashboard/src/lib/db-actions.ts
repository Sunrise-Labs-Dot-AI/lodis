"use server";

import { directUpdateMemory as _directUpdateMemory } from "./db";
import { revalidatePath } from "next/cache";
import { getUserId } from "@/lib/auth";

export async function directUpdateMemory(id: string, content: string, detail: string | null) {
  const userId = await getUserId();
  await _directUpdateMemory(id, content, detail, userId);
  revalidatePath("/");
  revalidatePath(`/memory/${id}`);
}
