import { useEffect, useState } from 'react';
import { Download, FolderDown, Moon, Scissors, Settings, Sun } from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  type ActiveTab,
  type OfflineMediaItem,
  type UserSettings,
} from './types/media';
import { clearOfflineLibrary, deleteOfflineMedia, listOfflineMedia } from './lib/offlineDb';
import { useTheme } from './hooks/useTheme';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { DownloadWorkspace } from './components/DownloadWorkspace';
import { TrimStudio } from './components/TrimStudio';
import { OfflineLibrary } from './components/OfflineLibrary';
import { SettingsView } from './components/SettingsView';

const SETTINGS_STORAGE_KEY = 'clipvault-settings-v1';

const NAV_ITEMS: Array<{ id: ActiveTab; label: string; mobileLabel: string; icon: typeof Download }> = [
  { id: 'download', label: 'Download', mobileLabel: 'Download', icon: Download },
  { id: 'trim', label: 'Trim Studio', mobileLabel: 'Trim', icon: Scissors },
  { id: 'library', label: 'Offline Library', mobileLabel: 'Library', icon: FolderDown },
  { id: 'settings', label: 'Settings', mobileLabel: 'Settings', icon: Settings },
];

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<ActiveTab>('download');
  const [libraryItems, setLibraryItems] = useState<OfflineMediaItem[]>([]);
  const [trimItem, setTrimItem] = useState<OfflineMediaItem | null>(null);

  const [settings, setSettings] = useState<UserSettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS;
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) return DEFAULT_SETTINGS;
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  useEffect(() => {
    listOfflineMedia()
      .then(setLibraryItems)
      .catch(() => {});
  }, []);

  const updateSettings = (patch: Partial<UserSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage quota issues
      }
      return next;
    });
  };

  const handleMediaSaved = (item: OfflineMediaItem) => {
    setLibraryItems((prev) => [item, ...prev.filter((x) => x.id !== item.id)]);
  };

  const handleDeleteItem = async (id: string) => {
    await deleteOfflineMedia(id);
    setLibraryItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearLibrary = async () => {
    await clearOfflineLibrary();
    setLibraryItems([]);
  };

  const handleOpenTrimWithItem = (item: OfflineMediaItem) => {
    setTrimItem(item);
    setActiveTab('trim');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F7F5] dark:bg-[#0E0F11] text-[#141517] dark:text-[#F3F4F6] transition-colors">
      {/* Top Bar — 3-Zone Contract on Desktop, Compact 52px App Bar on Mobile */}
      <header className="sticky top-0 z-30 h-[56px] lg:h-[64px] bg-[#F7F7F5]/90 dark:bg-[#0E0F11]/90 backdrop-blur-md border-b border-black/8 dark:border-white/8 pt-safe">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('download')}
            className="font-display text-xl font-bold tracking-tight text-[#141517] dark:text-[#F3F4F6] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#E03E2D] rounded"
          >
            ClipVault
          </button>

          {/* Zone 2: Desktop Navigation Links */}
          <nav
            aria-label="Primary navigation"
            className="hidden lg:flex items-center gap-7 text-sm font-medium"
          >
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-1.5 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                    isActive
                      ? 'text-[#141517] dark:text-white border-[#E03E2D]'
                      : 'text-neutral-600 dark:text-neutral-400 border-transparent hover:text-[#141517] dark:hover:text-white'
                  }`}
                >
                  {item.label}
                  {item.id === 'library' && libraryItems.length > 0 ? ` (${libraryItems.length})` : ''}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Primary Action */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-neutral-600 dark:text-neutral-300 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <PWAInstallButton compact />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8 pb-24 lg:pb-12">
        {activeTab === 'download' && (
          <DownloadWorkspace
            settings={settings}
            onMediaSaved={handleMediaSaved}
            onOpenTrimWithItem={handleOpenTrimWithItem}
            onSwitchToTrimTab={() => setActiveTab('trim')}
          />
        )}

        {activeTab === 'trim' && (
          <TrimStudio
            initialItem={trimItem}
            libraryItems={libraryItems}
            settings={settings}
            onTrimSaved={handleMediaSaved}
          />
        )}

        {activeTab === 'library' && (
          <OfflineLibrary
            items={libraryItems}
            onDeleteItem={handleDeleteItem}
            onTrimItem={handleOpenTrimWithItem}
            onGoToDownload={() => setActiveTab('download')}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            settings={settings}
            onUpdateSettings={updateSettings}
            theme={theme}
            onToggleTheme={toggleTheme}
            libraryCount={libraryItems.length}
            onClearLibrary={handleClearLibrary}
          />
        )}
      </main>

      {/* Android-Style Fixed Bottom Navigation Bar (Mobile & Tablet) */}
      <nav
        aria-label="Bottom navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/92 dark:bg-[#16181C]/92 backdrop-blur-md border-t border-black/8 dark:border-white/10 pb-safe"
      >
        <div className="grid grid-cols-4 items-center h-[60px]">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`h-full min-h-[48px] flex flex-col items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'text-[#E03E2D]'
                    : 'text-neutral-500 dark:text-neutral-400 hover:text-[#141517] dark:hover:text-white'
                }`}
              >
                <Icon className="w-[21px] h-[21px]" strokeWidth={isActive ? 2.25 : 1.75} />
                <span className="text-[11px] font-medium tracking-tight">
                  {item.mobileLabel}
                  {item.id === 'library' && libraryItems.length > 0 ? ` · ${libraryItems.length}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <OfflineIndicator />
    </div>
  );
}
