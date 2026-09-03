import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/org";
import { OnboardingForm } from "./form";
import { Logo } from "@/components/marketing/chrome";

export const metadata = { title: "Tell us about your business" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const existing = await prisma.organizationMember.findFirst({ where: { userId: user.id } });
  if (existing) redirect("/dashboard");

  return (
    <main id="main" className="flex flex-1 items-center justify-center px-5 py-16">
      <div className="w-full max-w-lg">
        <Logo className="mb-8" />
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Tell us about your business
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          This is used to label your inventory report and to frame the rights questions later. It is
          not shared with anyone.
        </p>
        <OnboardingForm />
      </div>
    </main>
  );
}
