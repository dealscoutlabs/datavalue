import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { simulateStateAction } from "@/app/dashboard/actions";
import type { SourceView } from "@/lib/summary";

const SCENARIOS = [
  { key: "RESCAN", label: "Re-run scan from zero" },
  { key: "SUCCESS", label: "Force success" },
  { key: "SCOPE_LIMITED", label: "Force scope limited" },
  { key: "ERROR", label: "Force provider error" },
  { key: "EXPIRED", label: "Force expired authorization" },
] as const;

/**
 * Rendered only in development, and only for a demo organisation. Lets the
 * scanning, partial, success, scope-limited, expired and error states be seen
 * without waiting for a provider to produce them.
 */
export function DevControls({ sources }: { sources: SourceView[] }) {
  if (process.env.NODE_ENV === "production") return null;
  const demoSources = sources.filter((s) => s.isDemo);
  if (demoSources.length === 0) return null;

  return (
    <Card className="mt-8 border-dashed">
      <CardContent className="pt-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          Developer controls — development builds only
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-subtle">
          Simulates connection states on demo sources. Not rendered in a production build, and the
          server action refuses to run in one.
        </p>
        <div className="mt-4 space-y-3">
          {demoSources.map((s) => (
            <div key={s.connectionId} className="flex flex-wrap items-center gap-2">
              <span className="w-36 shrink-0 text-sm font-medium text-ink">{s.label}</span>
              {SCENARIOS.map((sc) => (
                <form key={sc.key} action={simulateStateAction}>
                  <input type="hidden" name="connectionId" value={s.connectionId} />
                  <input type="hidden" name="scenario" value={sc.key} />
                  <Button type="submit" size="sm" variant="subtle">
                    {sc.label}
                  </Button>
                </form>
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
