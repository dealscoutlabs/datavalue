"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signupAction, type SignupState } from "./actions";
import { brand } from "@/config/brand";
import { Logo } from "@/components/marketing/chrome";
import { Card, CardContent } from "@/components/ui/card";
import { FieldError, Hint, Input, Label } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Notice } from "@/components/ui/notice";

const initial: SignupState = {};

export default function SignUpPage() {
  const [state, action] = useActionState(signupAction, initial);

  return (
    <main id="main" className="flex flex-1 items-center justify-center px-5 py-16">
      <div className="w-full max-w-md">
        <Logo className="mb-8" />
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Create your account</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Then connect a source and run your first metadata inventory.
        </p>

        <Card className="mt-6">
          <CardContent className="pt-6">
            <form action={action} className="space-y-4" noValidate>
              <div>
                <Label htmlFor="name">Your name</Label>
                <Input id="name" name="name" autoComplete="name" required className="mt-1.5" />
                <FieldError>{state.fieldErrors?.name}</FieldError>
              </div>
              <div>
                <Label htmlFor="email">Work email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="mt-1.5"
                />
                <FieldError>{state.fieldErrors?.email}</FieldError>
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  className="mt-1.5"
                />
                <Hint>At least 10 characters.</Hint>
                <FieldError>{state.fieldErrors?.password}</FieldError>
              </div>
              {state.error ? <Notice tone="negative">{state.error}</Notice> : null}
              <SubmitButton className="w-full" pendingLabel="Creating your account…">
                Create account
              </SubmitButton>
            </form>
          </CardContent>
        </Card>

        <Notice tone="neutral" className="mt-5">
          {brand.legal.connectionDisclosure}
        </Notice>

        <p className="mt-6 text-center text-sm text-ink-muted">
          Already have an account?{" "}
          <Link href="/signin" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
