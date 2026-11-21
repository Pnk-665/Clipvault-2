import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleAction = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setShowGuide(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleAction}
        className={`inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors whitespace-nowrap shrink-0 min-h-[40px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E03E2D] ${
          compact
            ? 'px-3 py-2 text-xs bg-[#141517] text-white hover:bg-[#2A2C30] dark:bg-[#F3F4F6] dark:text-[#141517] dark:hover:bg-white'
            : 'px-4 py-2.5 text-sm bg-[#141517] text-white hover:bg-[#2A2C30] dark:bg-[#F3F4F6] dark:text-[#141517] dark:hover:bg-white'
        }`}
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>{isInstallable ? 'Install App' : 'Install on Android'}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-guide-title"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 bg-neutral-300 dark:bg-neutral-700 rounded-full mx-auto mb-4 sm:hidden" />
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-[#141517] flex items-center justify-center overflow-hidden shrink-0">
                  <img
                    src="/pwa-192x192.png"
                    alt="ClipVault icon"
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div>
                  <h3 id="install-guide-title" className="text-lg font-semibold text-[#141517] dark:text-[#F3F4F6]">
                    Install ClipVault
                  </h3>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    Standalone Android &amp; Offline App
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close installation guide"
                className="min-w-[44px] min-h-[44px] -mr-2 -mt-2 flex items-center justify-center rounded-xl text-neutral-500 hover:text-[#141517] dark:hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isIOS ? (
              <ol className="mt-5 space-y-3 text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
                <li className="flex gap-3">
                  <span className="font-mono text-xs font-semibold text-[#E03E2D] pt-0.5">01</span>
                  <span>Tap the <strong>Share</strong> button in your Safari toolbar.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-xs font-semibold text-[#E03E2D] pt-0.5">02</span>
                  <span>Scroll down and select <strong>Add to Home Screen</strong>.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-xs font-semibold text-[#E03E2D] pt-0.5">03</span>
                  <span>Tap <strong>Add</strong> to launch ClipVault full-screen with offline access.</span>
                </li>
              </ol>
            ) : (
              <ol className="mt-5 space-y-3 text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
                <li className="flex gap-3">
                  <span className="font-mono text-xs font-semibold text-[#E03E2D] pt-0.5">01</span>
                  <span>Open ClipVault in <strong>Chrome for Android</strong> (or tap the browser menu <strong className="font-mono">⋮</strong>).</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-xs font-semibold text-[#E03E2D] pt-0.5">02</span>
                  <span>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-xs font-semibold text-[#E03E2D] pt-0.5">03</span>
                  <span>Launch from your Android app drawer for full-screen, ad-free offline playback and trimming.</span>
                </li>
              </ol>
            )}

            <div className="mt-6 flex flex-col gap-2.5 pt-4 border-t border-black/8 dark:border-white/10">
              {!isIOS && (
                <a
                  href="/api/android/apk-project"
                  download="ClipVault-Android-APK-Project.zip"
                  className="w-full min-h-[44px] px-4 rounded-xl bg-[#E03E2D] hover:bg-[#C93222] text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                >
                  <Download className="w-4 h-4 shrink-0" />
                  <span>Download Android APK Project (.zip)</span>
                </a>
              )}
              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                  <Smartphone className="w-4 h-4 shrink-0" />
                  <span>Works offline once installed</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  className="px-4 py-2 min-h-[40px] rounded-xl text-sm font-medium bg-[#141517] text-white dark:bg-[#F3F4F6] dark:text-[#141517] whitespace-nowrap shrink-0"
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 lg:bottom-5 left-4 z-40 flex items-center gap-2.5 rounded-xl bg-[#141517] dark:bg-[#F3F4F6] text-white dark:text-[#141517] px-3.5 py-2.5 text-xs font-medium shadow-lg border border-black/10"
    >
      <WifiOff className="w-4 h-4 text-[#E03E2D] shrink-0" />
      <span>Offline Mode · Saved library &amp; local audio trimming available</span>
    </div>
  );
};
