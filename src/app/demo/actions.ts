"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEMO_USER_EMAIL, DEMO_USER_PASSWORD, demoModeEnabled } from "@/config/demo";

export async function enterDemoAction() {
  if (!demoModeEnabled()) redirect("/");

  const demoUser = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });
  if (!demoUser) redirect("/demo?error=not_seeded");

  await signIn("credentials", {
    email: DEMO_USER_EMAIL,
    password: DEMO_USER_PASSWORD,
    redirect: false,
  });
  redirect("/dashboard");
}
