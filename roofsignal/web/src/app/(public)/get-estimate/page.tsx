import type { Metadata } from "next";

import { EstimatePage } from "../estimate-page";

export const metadata: Metadata = { title: "Free roof estimate · RoofSignal" };

export default async function Page() {
  return <EstimatePage />;
}
