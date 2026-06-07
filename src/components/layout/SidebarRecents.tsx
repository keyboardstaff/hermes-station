import { useI18n } from "@/i18n";
import SessionRecents from "@/components/chat/SessionRecents";
import { usePinnedSessions } from "@/hooks/usePinnedSessions";

/**
 * Recents region inside the Sidebar.
 *
 * Delegates to SessionRecents so the row behaviour is 1:1 with the chat
 * page: hover ⋯ menu (rename / export json / export markdown / clear
 * local view / archive / delete), Shift+Click instant-delete, active
 * highlight, running-spinner indicator.
 *
 * SessionRecents already manages its own header + scrollable list; we
 * customise three pieces via props:
 *   • headerTitle  = "Recents"
 *   • showNewButton = false  (Sidebar header already exposes "New chat")
 *   • viewAllHref  = "/sessions"  (renders "View all →")
 *
 * SessionRecents uses the same react-query cache (``sessions-table-all``)
 * as the legacy /chat SidePanel, so mutations stay in sync across both
 * mounts.
 */
export default function SidebarRecents({ limit = 50 }: { limit?: number }) {
  const { t } = useI18n();
  const { pinnedIds, toggle } = usePinnedSessions();
  return (
    <SessionRecents
      headerTitle={t.sidebar.recents}
      showNewButton={false}
      viewAllHref="/sessions"
      navigateOnPick="/chat"
      collapsible
      hoverRevealsActions
      borderless
      limit={limit}
      pinnedTitle={t.sidebar.pinned}
      pinnedIds={pinnedIds}
      onTogglePin={toggle}
      showScopeSelector
    />
  );
}
