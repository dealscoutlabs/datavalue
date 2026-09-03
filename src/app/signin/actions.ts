"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn } from "@/lib/auth";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

export type SigninState = { error?: string };

export async function signinAction(
  _prev: SigninState,
  formData: FormData
): Promise<SigninState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  // Deliberately generic: never reveal whether the account exists.
  if (!parsed.success) return { error: "Enter your email address and password." };

  try {
    await signIn("credentials", { ...parsed.data, redirect: false });
  } catch (err) {
    if (err instanceof AuthError) return { error: "Those details did not match an account." };
    throw err;
  }

  redirect("/dashboard");
}
