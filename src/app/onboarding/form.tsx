"use client";

import { useActionState } from "react";
import { createOrganizationAction, type OnboardingState } from "./actions";
import { EMPLOYEE_RANGES, INDUSTRIES } from "@/config/business";
import { Card, CardContent } from "@/components/ui/card";
import { FieldError, Hint, Input, Label, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

const initial: OnboardingState = {};

export function OnboardingForm() {
  const [state, action] = useActionState(createOrganizationAction, initial);

  return (
    <Card className="mt-6">
      <CardContent className="pt-6">
        <form action={action} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="name">Company name</Label>
            <Input id="name" name="name" required className="mt-1.5" autoComplete="organization" />
            <FieldError>{state.fieldErrors?.name}</FieldError>
          </div>
          <div>
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              name="website"
              className="mt-1.5"
              placeholder="example.com"
              autoComplete="url"
            />
            <Hint>Optional.</Hint>
          </div>
          <div>
            <Label htmlFor="industry">Industry</Label>
            <Select id="industry" name="industry" required className="mt-1.5" defaultValue="">
              <option value="" disabled>
                Select an industry
              </option>
              {INDUSTRIES.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </Select>
            <FieldError>{state.fieldErrors?.industry}</FieldError>
          </div>
          <div>
            <Label htmlFor="employeeRange">Employees</Label>
            <Select id="employeeRange" name="employeeRange" required className="mt-1.5" defaultValue="">
              <option value="" disabled>
                Select a range
              </option>
              {EMPLOYEE_RANGES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
            <FieldError>{state.fieldErrors?.employeeRange}</FieldError>
          </div>
          <SubmitButton className="w-full" pendingLabel="Saving…">
            Continue to sources
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
