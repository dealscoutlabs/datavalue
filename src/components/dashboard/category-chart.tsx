"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatBytes, formatCount } from "@/lib/utils";

/**
 * Category mix by measured volume.
 *
 * Form: one measure (bytes) across a handful of named categories, so this is a
 * ranked horizontal bar chart, not a pie or donut. A donut of eight slices sitting
 * beside a labelled list would restate the same numbers in a form that is harder
 * to read, which is why there is one chart here rather than two views of it.
 *
 * Colour: a single hue, because there is one series. Bars are ranked by magnitude,
 * and colour must never encode rank. The data hue is a step up in chroma from the
 * UI accent so it does not read as grey when used as a fill; it clears the light
 * surface at better than 3:1.
 *
 * Identity is never colour-alone: every bar is named on the axis and carries its
 * value as a direct label, and the same numbers are available in a table below
 * for screen readers.
 */
const DATA_HUE = "#0d9488";
const ZERO_HUE = "#cbd5e1";

export type CategoryDatum = { key: string; label: string; bytes: number; count: number };

/**
 * Narrow viewports get a shorter category axis and a smaller label gutter, so the
 * bars keep enough width to be comparable rather than collapsing to stubs.
 */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return narrow;
}

export function CategoryChart({ data }: { data: CategoryDatum[] }) {
  const narrow = useIsNarrow();
  const rows = data.filter((d) => d.bytes > 0 || d.count > 0).slice(0, 10);
  if (rows.length < 2) return null;

  // Byte-less categories (structured records) would otherwise vanish from a
  // magnitude chart; they keep a hairline so the axis label is not left orphaned.
  const max = Math.max(...rows.map((r) => r.bytes));
  const plotted = rows.map((r) => ({ ...r, plot: r.bytes > 0 ? r.bytes : max * 0.004 }));

  return (
    <figure className="m-0">
      <div style={{ height: rows.length * 34 + 16 }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={plotted}
            layout="vertical"
            margin={{ top: 0, right: narrow ? 76 : 84, bottom: 0, left: 0 }}
            barCategoryGap={8}
          >
            <XAxis type="number" hide domain={[0, max]} />
            <YAxis
              type="category"
              dataKey="label"
              width={narrow ? 92 : 132}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#4b5563", fontSize: narrow ? 11 : 13 }}
            />
            <Tooltip
              cursor={{ fill: "rgba(17,24,39,0.04)" }}
              formatter={(_v, _n, item) => {
                const row = item?.payload as CategoryDatum | undefined;
                if (!row) return ["", ""];
                return [
                  `${row.bytes > 0 ? formatBytes(row.bytes) : "no reported size"} · ${formatCount(row.count)} items`,
                  row.label,
                ];
              }}
              // Kept inside the plot so it cannot spill off a narrow screen.
              allowEscapeViewBox={{ x: false, y: false }}
              wrapperStyle={{ maxWidth: 240, zIndex: 1 }}
              contentStyle={{
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                fontSize: 12,
                maxWidth: 240,
                whiteSpace: "normal",
                boxShadow: "0 1px 2px rgba(16,24,40,0.06)",
              }}
              labelFormatter={() => ""}
            />
            <Bar dataKey="plot" radius={[0, 4, 4, 0]} barSize={14} isAnimationActive={false}>
              {plotted.map((row) => (
                <Cell key={row.key} fill={row.bytes > 0 ? DATA_HUE : ZERO_HUE} />
              ))}
              {/* Recharts wraps a LabelList's text at the bar's own width, which
                  breaks the widest value onto two lines. Rendering the <text>
                  directly keeps each value on one line. */}
              <LabelList
                dataKey="bytes"
                content={(props) => {
                  const { x, y, width, height, value } = props;
                  const left = Number(x ?? 0);
                  const top = Number(y ?? 0);
                  const w = Number(width ?? 0);
                  const h = Number(height ?? 0);
                  const bytes = Number(value ?? 0);
                  return (
                    <text
                      x={left + w + 8}
                      y={top + h / 2}
                      dominantBaseline="central"
                      style={{
                        fill: "#111827",
                        fontSize: narrow ? 11 : 12,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {bytes > 0 ? formatBytes(bytes) : "—"}
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* The same figures, available to assistive technology and to anyone who
          cannot rely on the plot. */}
      <table className="sr-only">
        <caption>Category mix by measured volume</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Measured volume</th>
            <th scope="col">Items</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              <td>{r.bytes > 0 ? formatBytes(r.bytes) : "No reported size"}</td>
              <td>{formatCount(r.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
