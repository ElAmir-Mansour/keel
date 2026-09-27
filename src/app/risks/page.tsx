import { Suspense } from "react";
import { RisksPage } from "@/components/risks/risks-page";

export const metadata = { title: "Risks" };

export default function Page() {
  return (
    <Suspense>
      <RisksPage />
    </Suspense>
  );
}
