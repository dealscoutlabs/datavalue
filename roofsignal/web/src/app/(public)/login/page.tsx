import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · RoofSignal", robots: { index: false, follow: false } };

export default function LoginPage() {
  return (
    <main className="mx-auto mt-24 max-w-sm px-4">
      <h1 className="mb-6 text-lg font-semibold">RoofSignal staff sign-in</h1>
      <LoginForm />
    </main>
  );
}
