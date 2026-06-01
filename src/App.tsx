import { useThemeStore, useSkinStore, useFontSizeStore } from "@/store/app";
import SetupGuard from "@/components/layout/SetupGuard";
import AppShell from "@/components/layout/AppShell";
import { useDiscoveryWatcher } from "@/store/discovery";
import "@/styles/mobile.css";

// Side-effect mount — skin + font-size stores apply data-* on init.
// Reference them so tree-shaking doesn't drop the module.
void useSkinStore;
void useFontSizeStore;

export default function App() {
  useThemeStore();
  useDiscoveryWatcher();
  return (
    <SetupGuard>
      <AppShell />
    </SetupGuard>
  );
}
