"use client";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui-bits";
import { useT } from "@/lib/i18n";

// Rendered inside the normal shell, so the sidebar and search still work.
export default function NotFound() {
  const t = useT();
  return (
    <EmptyState
      icon={<SearchX />}
      title={t("Page not found")}
      description={t("There is nothing at this address. It may have moved, or the link may be wrong.")}
      className="mt-10"
    >
      <Button asChild>
        <Link href="/">{t("Back to home")}</Link>
      </Button>
    </EmptyState>
  );
}
