import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { apiJson, type User } from "@/lib/api";

/** The signed-in staff user (verified with the API on every request). */
export const getUser = cache(async (): Promise<User> => apiJson<User>("/auth/me"));

export async function requireRole(...roles: User["role"][]): Promise<User> {
  const user = await getUser();
  if (!roles.includes(user.role)) redirect(user.role === "agent" ? "/agent" : "/admin");
  return user;
}
