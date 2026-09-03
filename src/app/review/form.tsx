"use client";

import { useActionState } from "react";
import { submitReviewRequestAction, type ReviewState } from "./actions";
import { EMPLOYEE_RANGES, INDUSTRIES } from "@/config/business";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { FieldError, Hint, Input, Label, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Notice } from "@/components/ui/notice";

const initial: ReviewState = {};

export function ReviewForm({
  defaults,
}: {
  defaults: {
    contactName?: string;
    businessEmail?: string;
    companyName?: string;
    website?: string;
    industry?: string;
    employeeRange?: string;
  };
}) {
  const [state, action] = useActionState(submitReviewRequestAction, initial);
  const err = (k: string) => state.fieldErrors?.[k];

  return (
    <form action={action} className="mt-6 space-y-5" noValidate>
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <div>
            <Label htmlFor="contactName">Your name</Label>
            <Input id="contactName" name="contactName" defaultValue={defaults.contactName} required className="mt-1.5" />
            <FieldError>{err("contactName")}</FieldError>
          </div>
          <div>
            <Label htmlFor="contactRole">Your role</Label>
            <Input id="contactRole" name="contactRole" required className="mt-1.5" placeholder="Operations Director" />
            <FieldError>{err("contactRole")}</FieldError>
          </div>
          <div>
            <Label htmlFor="businessEmail">Business email</Label>
            <Input id="businessEmail" name="businessEmail" type="email" defaultValue={defaults.businessEmail} required className="mt-1.5" />
            <FieldError>{err("businessEmail")}</FieldError>
          </div>
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" type="tel" className="mt-1.5" />
            <Hint>Optional.</Hint>
          </div>
          <div>
            <Label htmlFor="companyName">Company name</Label>
            <Input id="companyName" name="companyName" defaultValue={defaults.companyName} required className="mt-1.5" />
            <FieldError>{err("companyName")}</FieldError>
          </div>
          <div>
            <Label htmlFor="website">Website</Label>
            <Input id="website" name="website" defaultValue={defaults.website} className="mt-1.5" />
            <Hint>Optional.</Hint>
          </div>
          <div>
            <Label htmlFor="industry">Industry</Label>
            <Select id="industry" name="industry" defaultValue={defaults.industry ?? ""} className="mt-1.5">
              <option value="" disabled>Select an industry</option>
              {INDUSTRIES.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </Select>
            <FieldError>{err("industry")}</FieldError>
          </div>
          <div>
            <Label htmlFor="employeeRange">Employees</Label>
            <Select id="employeeRange" name="employeeRange" defaultValue={defaults.employeeRange ?? ""} className="mt-1.5">
              <option value="" disabled>Select a range</option>
              {EMPLOYEE_RANGES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </Select>
            <FieldError>{err("employeeRange")}</FieldError>
          </div>
        </CardContent>

        <CardContent className="border-t border-line pt-5">
          <div className="space-y-3">
            <label className="flex items-start gap-3 text-sm leading-relaxed text-ink">
              <input type="checkbox" name="consentToContact" className="mt-0.5 size-4 accent-[#0f766e]" />
              <span>
                I consent to being contacted about this request at the details above.
                <FieldError>{err("consentToContact")}</FieldError>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm leading-relaxed text-ink">
              <input type="checkbox" name="acknowledgedNotAnOffer" className="mt-0.5 size-4 accent-[#0f766e]" />
              <span>
                I understand this is a request for a review, not an offer, and that nothing in this
                report confirms that my business holds the rights to license this data.
                <FieldError>{err("acknowledgedNotAnOffer")}</FieldError>
              </span>
            </label>
          </div>
        </CardContent>

        <CardFooter className="justify-between gap-3">
          <p className="text-xs leading-relaxed text-ink-subtle">
            Your inventory summary, eligibility result and questionnaire answers are attached
            automatically. No file, message or customer record is attached, because none was ever read.
          </p>
          <SubmitButton pendingLabel="Submitting…">Request a review</SubmitButton>
        </CardFooter>
      </Card>

      {state.error ? <Notice tone="negative">{state.error}</Notice> : null}
    </form>
  );
}
