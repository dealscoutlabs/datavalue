"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signinAction, type SigninState } from "./actions";
import { Logo } from "@/components/marketing/chrome";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Notice } from "@/components/ui/notice";

const initial: SigninState = {};

export default function SignInPage() {
  const [state, action] = useActionState(signinAction, initial);

  return (
    <main id="main" className="flex flex-1 items-center justify-center px-5 py-16">
      <div className="w-full max-w-md">
        <Logo className="mb-8" />
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Sign in</h1>

        <Card className="mt-6">
          <CardContent className="pt-6">
            <form action={action} className="space-y-4" noValidate>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="mt-1.5"
                />
              </div>
              {state.error ? <Notice tone="negative">{state.error}</Notice> : null}
              <SubmitButton className="w-full" pendingLabel="Signing in…">
                Sign in
              </SubmitButton>
            </form>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-sm text-ink-muted">
          No account?{" "}
          <Link href="/signup" className="font-medium text-accent hover:underline">
            Create one
          </Link>{" "}
          ·{" "}
          <Link href="/demo" className="font-medium text-accent hover:underline">
            View demo
          </Link>
        </p>
      </div>
    </main>
  );
}
