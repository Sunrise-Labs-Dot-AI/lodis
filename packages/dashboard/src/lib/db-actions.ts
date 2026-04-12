"use server";

import { directUpdateMemory as _directUpdateMemory, type MemoryUpdateFields } from "./db";
import { revalidatePath } from "next/cache";
import { getUserId } from "@/lib/auth";

export async function directUpdateMemory(id: string, fields: MemoryUpdateFields) {
  const userId = await getUserId();
  await _directUpdateMemory(id, fields, userId);
  revalidatePath("/");
  revalidatePath(`/memory/${id}`);
}
