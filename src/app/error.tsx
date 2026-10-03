"use client";
import Link from "next/link";
import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui-bits";
import { useT } from "@/lib/i18n";

// Catches a render error below the root layout. The shell around it keeps
// working, and nothing here touches the database or the assistant, so a fault
// in either cannot take this page down with it.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EmptyState
      icon={<TriangleAlert />}
      title={t("Something went wrong")}
      description={t("Keel hit an error while showing this page. Your data is stored in this browser and was not touched.")}
      className="mt-10"
    >
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset}>{t("Try again")}</Button>
        <Button asChild variant="outline">
          <Link href="/">{t("Back to home")}</Link>
        </Button>
      </div>
      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground" dir="ltr">
          {t("Error reference")}: {error.digest}
        </p>
      ) : null}
    </EmptyState>
  );
}
