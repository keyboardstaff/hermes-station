/**
 * Which profile a chat run targets (the run follows the CURRENT profile,
 * no "activate the profile + restart" step).
 *
 * Precedence:
 *   1. an explicit override — the Agents room's `@mention` routes a turn to a
 *      specific profile-agent (unchanged);
 *   2. an existing session's own profile — continuing a chat MUST stay in the
 *      home it was created under, regardless of the current view-scope (else its
 *      later turns persist into a different profile's `state.db`);
 *   3. the current view-scope profile — a brand-new chat runs in whatever
 *      profile you're "in".
 *
 * Returns `undefined` for the default home (the backend omits the profile param
 * and runs on the process `HERMES_HOME`).
 */
export function resolveRunProfile(
  override: string | null | undefined,
  sessionProfile: string | null | undefined,
  currentProfile: string | null | undefined,
): string | undefined {
  const name = override || sessionProfile || currentProfile;
  return name && name !== "default" ? name : undefined;
}
