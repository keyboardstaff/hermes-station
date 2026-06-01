/** Strip ANSI escape codes from a log line before rendering. */
export function sanitizeLogLine(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}
