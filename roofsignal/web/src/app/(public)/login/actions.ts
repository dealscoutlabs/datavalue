"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ApiError, SESSION_COOKIE, apiFetch, apiPost } from "@/lib/api";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  let res: { token: string; user: { role: string } };
  try {
    res = await apiPost("/auth/login", { email, password }, { auth: false, client: true });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return { error: "Email or password is incorrect." };
    return { error: "Sign-in is unavailable right now." };
  }
  (await cookies()).set(SESSION_COOKIE, res.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  redirect(res.user.role === "agent" ? "/agent" : "/admin");
}

export async function logout() {
  try {
    await apiFetch("/auth/logout", { method: "POST" });
  } catch {
    // already signed out on the API side
  }
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
