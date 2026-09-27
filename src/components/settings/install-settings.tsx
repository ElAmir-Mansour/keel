"use client";
import { Download, MonitorSmartphone, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { applyUpdate, promptInstall, usePwaStatus } from "@/lib/pwa";
import { useT } from "@/lib/i18n";

export function InstallSettings() {
  const s = usePwaStatus();
  const t = useT();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t("Keel installs like a native app: its own window, an icon in your dock or home screen, and it opens offline. Your data is already on this device; installing only changes how you launch it.")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {s.installed ? (
          <Badge variant="secondary">
            <MonitorSmartphone className="me-1 size-3.5" /> {t("Installed")}
          </Badge>
        ) : s.canInstall ? (
          <Button size="sm" onClick={() => void promptInstall()}>
            <Download /> {t("Install Keel")}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">{t("Use your browser's “Install app” or “Add to Home Screen” option; Chrome and Edge show a button here once the page qualifies.")}</span>
        )}
        {s.offlineReady ? (
          <Badge variant="outline">
            <WifiOff className="me-1 size-3.5" /> {t("Works offline")}
          </Badge>
        ) : null}
        {s.updateReady ? (
          <Button size="sm" variant="outline" onClick={applyUpdate}>
            <RefreshCw /> {t("Update available — reload")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
