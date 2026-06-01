// Slash-command type only; the list comes from /api/discover/slash-commands
// via store/discovery's useDiscoverSlashCommands.

export interface SlashCommand {
  /** Command name without leading slash (e.g. "handoff"). */
  name: string;
  /** Fallback when i18n has no slash.<name>.description entry. */
  description: string;
  /** Optional usage hint (e.g. "<profile>"). */
  args?: string;
}
