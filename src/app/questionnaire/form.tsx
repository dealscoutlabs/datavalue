"use client";

import { useActionState } from "react";
import { submitQuestionnaireAction, type QuestionnaireState } from "./actions";
import { DATA_AGE_RANGES, INDUSTRIES } from "@/config/business";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Fieldset, RadioRow, TRI_OPTIONS } from "@/components/ui/choice";
import { Label, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Notice } from "@/components/ui/notice";

const initial: QuestionnaireState = {};

export type Defaults = Partial<Record<string, string>>;

/**
 * Every question defaults to UNSELECTED, and an unanswered question is treated
 * as the most conservative answer by the engine. Nothing here is pre-filled with
 * a favourable answer.
 */
export function QuestionnaireForm({ defaults }: { defaults: Defaults }) {
  const [state, action] = useActionState(submitQuestionnaireAction, initial);
  const err = (k: string) => state.fieldErrors?.[k];

  return (
    <form action={action} className="mt-6 space-y-5" noValidate>
      <Card>
        <CardContent className="space-y-5 pt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-subtle">
            About the data
          </h2>

          <Fieldset legend="Which industry does this data come from?" error={err("industry")}>
            <Label htmlFor="industry" className="sr-only">
              Industry
            </Label>
            <Select id="industry" name="industry" defaultValue={defaults.industry ?? ""}>
              <option value="" disabled>
                Select an industry
              </option>
              {INDUSTRIES.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </Select>
          </Fieldset>

          <Fieldset
            legend="Roughly how far back does this data go?"
            error={err("dataAgeRange")}
          >
            <Label htmlFor="dataAgeRange" className="sr-only">
              Data age range
            </Label>
            <Select id="dataAgeRange" name="dataAgeRange" defaultValue={defaults.dataAgeRange ?? ""}>
              <option value="" disabled>
                Select a range
              </option>
              {DATA_AGE_RANGES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Fieldset>

          <Fieldset
            legend="Did your business create this data, or does it lawfully control it under contract?"
            hint="Answer yes only if you either produced the material yourself or hold a contractual right to control it."
            error={err("originCreatedOrControlled")}
          >
            <RadioRow
              name="originCreatedOrControlled"
              options={TRI_OPTIONS}
              defaultValue={defaults.originCreatedOrControlled}
            />
          </Fieldset>

          <Fieldset
            legend="Is this data unique or proprietary, or is it commonly available elsewhere?"
            error={err("uniqueness")}
          >
            <RadioRow
              name="uniqueness"
              defaultValue={defaults.uniqueness}
              options={[
                { value: "UNIQUE_PROPRIETARY", label: "Unique or proprietary" },
                { value: "SOMEWHAT", label: "Partly distinctive" },
                { value: "COMMONLY_AVAILABLE", label: "Commonly available" },
              ]}
            />
          </Fieldset>

          <Fieldset
            legend="Is this data already licensed to anyone else?"
            error={err("alreadyLicensed")}
          >
            <RadioRow name="alreadyLicensed" options={TRI_OPTIONS} defaultValue={defaults.alreadyLicensed} />
          </Fieldset>

          <Fieldset
            legend="Could you offer exclusivity?"
            error={err("exclusivityPossible")}
          >
            <RadioRow
              name="exclusivityPossible"
              options={TRI_OPTIONS}
              defaultValue={defaults.exclusivityPossible}
            />
          </Fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-5 pt-6">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-subtle">
              Third-party material
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-subtle">
              A yes or a not-sure on any of these means the source needs a rights review, and no
              rate will be shown for it. That is the intended behaviour, not a penalty.
            </p>
          </div>

          <Fieldset
            legend="Is third-party or customer personal information present?"
            error={err("thirdPartyPii")}
          >
            <RadioRow name="thirdPartyPii" options={TRI_OPTIONS} defaultValue={defaults.thirdPartyPii} />
          </Fieldset>

          <Fieldset
            legend="Is counterparty material subject to an NDA or confidentiality obligation present?"
            error={err("ndaBoundMaterial")}
          >
            <RadioRow
              name="ndaBoundMaterial"
              options={TRI_OPTIONS}
              defaultValue={defaults.ndaBoundMaterial}
            />
          </Fieldset>

          <Fieldset
            legend="Is employee personal data present?"
            error={err("employeePersonalData")}
          >
            <RadioRow
              name="employeePersonalData"
              options={TRI_OPTIONS}
              defaultValue={defaults.employeePersonalData}
            />
          </Fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-5 pt-6">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-subtle">
              Sensitive categories
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-subtle">
              May any of the following be present, even in a small part of the corpus?
            </p>
          </div>

          {[
            ["personalData", "Personal information about identifiable individuals"],
            ["healthData", "Health or medical information"],
            ["financialData", "Financial account or payment information"],
            ["childrensData", "Information about children"],
            ["biometricData", "Biometric identifiers"],
            ["legalPrivilegeData", "Legally privileged material"],
            ["credentialData", "Credentials, API keys or other secrets"],
            ["exportControlledData", "Export-controlled technical data"],
          ].map(([name, legend]) => (
            <Fieldset key={name} legend={legend} error={err(name)}>
              <RadioRow name={name} options={TRI_OPTIONS} defaultValue={defaults[name]} />
            </Fieldset>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-5 pt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-subtle">
            Next steps
          </h2>

          <Fieldset
            legend="Would you be willing to anonymise or redact before any licensing discussion?"
            error={err("willingToAnonymize")}
          >
            <RadioRow
              name="willingToAnonymize"
              options={TRI_OPTIONS}
              defaultValue={defaults.willingToAnonymize}
            />
          </Fieldset>

          <Fieldset legend="How would you prefer to be contacted?" error={err("contactMethod")}>
            <RadioRow
              name="contactMethod"
              defaultValue={defaults.contactMethod ?? "EMAIL"}
              options={[
                { value: "EMAIL", label: "Email" },
                { value: "PHONE", label: "Phone" },
                { value: "EITHER", label: "Either" },
              ]}
            />
          </Fieldset>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <p className="text-xs leading-relaxed text-ink-subtle">
            Your answers can only restrict the assessment. Nothing you disclose here will raise an
            indicative rate.
          </p>
          <SubmitButton pendingLabel="Assessing…">Get my eligibility assessment</SubmitButton>
        </CardFooter>
      </Card>

      {state.error ? <Notice tone="negative">{state.error}</Notice> : null}
    </form>
  );
}
