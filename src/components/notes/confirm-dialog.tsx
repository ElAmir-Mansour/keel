"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n";

/**
 * One confirm dialog for every destructive action. `typeToConfirm` asks for
 * a word to be typed first, for the actions that cannot be undone at all.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  typeToConfirm,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  typeToConfirm?: string;
  onConfirm: () => void | Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const t = useT();
  const ready = !typeToConfirm || typed === typeToConfirm;

  async function confirm() {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
      setTyped("");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setTyped("");
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {typeToConfirm ? (
          <Input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={t("Type {word} to confirm", { word: typeToConfirm })}
            aria-label={t("Type {word} to confirm", { word: typeToConfirm })}
            onKeyDown={(e) => {
              if (e.key === "Enter") void confirm();
            }}
          />
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={() => void confirm()} disabled={!ready || busy} autoFocus={!typeToConfirm}>
            {t(confirmLabel)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
