import type { Metadata } from "next";

import { EstimatePage } from "../../estimate-page";

export const metadata: Metadata = { title: "Free roof estimate · RoofSignal", robots: { index: false, follow: false } };

export default async function Page(props: PageProps<"/r/[code]">) {
  const { code } = await props.params;
  return <EstimatePage code={code} />;
}
