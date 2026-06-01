export function formatSessionTitle(title: string | null | undefined, fallback = "Untitled session"): string {
  const trimmed = title?.trim();
  return trimmed ? trimmed : fallback;
}
