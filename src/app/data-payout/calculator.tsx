"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  calculateDataPayout,
  formatPayout,
  REGION_LABELS,
  type Region,
} from "@/lib/calculator/data-payout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";

/**
 * Marketing estimator. Mirrors the three inputs micro1.ai exposes; the
 * calculator supports three more (data sources, English share, sensitive data)
 * which are not surfaced here, matching the original.
 */
export function DataPayoutCalculator() {
  const [employees, setEmployees] = useState(50);
  const [years, setYears] = useState(10);
  const [region, setRegion] = useState<Region>("US");

  const result = useMemo(
    () => calculateDataPayout({ employees, years, region }),
    [employees, years, region]
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
      <Card>
        <CardContent className="space-y-5 pt-6">
          <div>
            <Label htmlFor="employees">Number of employees</Label>
            <Input
              id="employees"
              type="number"
              min={0}
              max={1000000}
              value={employees}
              onChange={(e) => setEmployees(Number(e.target.value))}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="years">Years of company data</Label>
            <Input
              id="years"
              type="number"
              min={0}
              max={200}
              value={years}
              onChange={(e) => setYears(Number(e.target.value))}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="region">Where is your company based?</Label>
            <Select
              id="region"
              value={region}
              onChange={(e) => setRegion(e.target.value as Region)}
              className="mt-1.5"
            >
              {(Object.keys(REGION_LABELS) as Region[]).map((r) => (
                <option key={r} value={r}>
                  {REGION_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            Estimated annual data payout
          </p>
          <p
            className="mt-3 text-4xl font-semibold tracking-tight text-ink tabular-nums sm:text-5xl"
            aria-live="polite"
          >
            {formatPayout(result.low)}
            <span className="mx-2 font-normal text-ink-subtle">–</span>
            {formatPayout(result.high)}
          </p>

          {/*
            Retained deliberately. The GB term in this formula is assumed from
            headcount, not measured, and without this line the figure above reads
            as a measurement of the visitor's actual data. One sentence; delete it
            and the page is a literal clone.
          */}
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-muted">
            Estimate only. Data volume is assumed from company size and age rather than measured,
            so this is not a valuation, a quote, or an offer.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/signup">Run my data inventory</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/demo">View demo</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
