"use server";

const isHosted = !!process.env.TURSO_DATABASE_URL;

/**
 * Returns the current user's ID in hosted mode (via Clerk),
 * or null in local mode (no auth required).
 */
export async function getUserId(): Promise<string | null> {
  if (!isHosted) return null;
  try {
    const { auth } = await import("@clerk/nextjs/server");
    const session = await auth();
    return session?.userId ?? null;
  } catch {
    return null;
  }
}

export async function getIsHosted(): Promise<boolean> {
  return isHosted;
}
