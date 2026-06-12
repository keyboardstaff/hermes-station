import { useI18n } from "@/i18n";

type ML = NonNullable<ReturnType<typeof useI18n>["t"]["modelsPanel"]>;

/** KeyRow label set — shared by the API Keys section and the provider cards. */
export function buildKeyRowLabels(m: ML | undefined) {
  return {
    reveal: m?.reveal ?? "Reveal",
    hide: m?.hide ?? "Hide",
    notSet: m?.notSet ?? "(not set)",
    rateLimited: m?.rateLimited ?? "Rate limited",
    edit: m?.edit ?? "Edit",
    delete: m?.delete ?? "Delete",
    confirmDelete: m?.confirmDelete ?? "Remove key",
    editTitle: m?.editTitle ?? "Edit key",
    editValueLabel: m?.editValueLabel ?? "Value",
    editValuePlaceholder: m?.editValuePlaceholder ?? "Paste key value...",
    editSave: m?.editSave ?? "Save",
    editSaving: m?.editSaving ?? "Saving...",
    editCancel: m?.editCancel ?? "Cancel",
    editGetKeyAt: m?.editGetKeyAt ?? "Get a key",
    editClose: m?.close ?? "Close",
  };
}
