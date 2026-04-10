"use server";

import { directUpdateMemory as _directUpdateMemory } from "./db";
import { revalidatePath } from "next/cache";

export async function directUpdateMemory(id: string, content: string, detail: string | null) {
  await _directUpdateMemory(id, content, detail);
  revalidatePath("/");
  revalidatePath(`/memory/${id}`);
}
