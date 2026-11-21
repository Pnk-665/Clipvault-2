import React, { useEffect, useState } from 'react';
import { Check, Copy, HardDrive, Moon, Package, Smartphone, Sun, Trash2 } from 'lucide-react';
import type { AudioFormat, UserSettings, VideoFormat, VideoFps } from '../types/media';
import type { ThemeMode } from '../hooks/useTheme';
import { estimateStorageUsage } from '../lib/offlineDb';
import { formatBytes } from '../lib/formatters';
import { PWAInstallButton } from './PWAInstallButton';

interface SettingsViewProps {
  settings: UserSettings;
  onUpdateSettings: (patch: Partial<UserSettings>) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  libraryCount: number;
  onClearLibrary: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onUpdateSettings,
  theme,
  onToggleTheme,
  libraryCount,
  onClearLibrary,
}) => {
  const [storage, setStorage] = useState<{ usedBytes: number; quotaBytes: number }>({
    usedBytes: 0,
    quotaBytes: 0,
  });
  const [confirmClear, setConfirmClear] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [downloadingApkZip, setDownloadingApkZip] = useState(false);

  const liveAppUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const isPrivatePreviewUrl =
    liveAppUrl.includes('ais-dev-') || liveAppUrl.includes('ais-pre-');
  const [apkTargetUrl, setApkTargetUrl] = useState(liveAppUrl);

  useEffect(() => {
    estimateStorageUsage().then(setStorage);
  }, [libraryCount]);

  const handleCopyUrl = async () => {
    const target = (apkTargetUrl || liveAppUrl).trim();
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2500);
    } catch {
      // ignore
    }
  };

  const handleDownloadApkProject = async () => {
    setDownloadingApkZip(true);
    try {
      const query = apkTargetUrl.trim()
        ? `?appUrl=${encodeURIComponent(apkTargetUrl.trim())}`
        : '';
      const res = await fetch(`/api/android/apk-project${query}`);
      if (!res.ok) throw new Error('Failed to generate Android APK project');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ClipVault-Android-APK-Project.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setDownloadingApkZip(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <section className="rounded-3xl bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 p-5 sm:p-6">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#141517] dark:text-[#F3F4F6]">
          Settings &amp; Android APK
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Configure default 60 fps export quality, install on Android or package an .apk, and manage offline storage.
        </p>
      </section>

      {/* Android App & APK Packaging Hub */}
      <section className="rounded-3xl bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-[#141517] flex items-center justify-center shrink-0">
              <Smartphone className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#141517] dark:text-[#F3F4F6]">
                Install on Android (Instant WebAPK &amp; Standalone .apk)
              </h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5 leading-relaxed">
                Install immediately via Chrome on Android (generates a native Android WebAPK automatically), or download the pre-configured Android Studio / GitHub Actions project bundle to compile a signed <code className="font-mono text-xs">.apk</code> with YouTube Share menu support.
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <PWAInstallButton />
          </div>
        </div>

        <div className="pt-4 border-t border-black/8 dark:border-white/10 space-y-3">
          <div>
            <label
              htmlFor="apk-public-url"
              className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5"
            >
              Public Deployed App URL (embedded inside the Android APK)
            </label>
            <input
              id="apk-public-url"
              type="url"
              value={apkTargetUrl}
              onChange={(e) => setApkTargetUrl(e.target.value)}
              placeholder="https://your-public-clipvault-url.run.app"
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#F7F7F5] dark:bg-[#0E0F11] border border-black/10 dark:border-white/12 text-xs sm:text-sm font-mono text-[#141517] dark:text-[#F3F4F6] focus:outline-none focus:border-[#E03E2D]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={downloadingApkZip}
              onClick={handleDownloadApkProject}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-[#E03E2D] hover:bg-[#C93222] disabled:opacity-60 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0"
            >
              <Package className="w-4 h-4 shrink-0" />
              <span>{downloadingApkZip ? 'Packaging Project...' : 'Download Android APK Project (.zip)'}</span>
            </button>

            <button
              type="button"
              onClick={handleCopyUrl}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-[#F7F7F5] dark:bg-[#0E0F11] border border-black/10 dark:border-white/12 text-xs sm:text-sm font-medium text-[#141517] dark:text-[#F3F4F6] hover:border-[#E03E2D] transition-colors whitespace-nowrap shrink-0"
            >
              {copiedUrl ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              <span>{copiedUrl ? 'Copied URL' : 'Copy URL'}</span>
            </button>
          </div>

          {isPrivatePreviewUrl && (
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
              <strong>Avoiding authentication errors:</strong> Private preview links (<code className="font-mono">ais-dev-*</code> / <code className="font-mono">ais-pre-*</code>) require Google sign-in and cannot be opened in an external browser, APK WebView, or PWABuilder without authentication. Click <strong>Deploy</strong> in Google AI Studio to publish a public Cloud Run URL, paste that public URL into the field above, and then open it on Android or download the APK project.
            </div>
          )}

          <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
            The ZIP bundle includes Kotlin <code className="font-mono">MainActivity.kt</code> (with native Android Downloads &amp; YouTube Share menu support), Gradle build scripts, <code className="font-mono">twa-manifest.json</code> for Bubblewrap, and a ready-to-run <strong>GitHub Actions</strong> workflow (<code className="font-mono">.github/workflows/build-apk.yml</code>) that compiles and outputs a downloadable <code className="font-mono">ClipVault.apk</code> in the cloud.
          </p>
        </div>
      </section>

      {/* Export Defaults */}
      <section className="rounded-3xl bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 p-5 sm:p-6 space-y-5">
        <h2 className="text-lg font-semibold text-[#141517] dark:text-[#F3F4F6]">
          Default Export Preferences
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">
              Default Video Resolution
            </label>
            <select
              value={settings.defaultVideoResolution}
              onChange={(e) => onUpdateSettings({ defaultVideoResolution: e.target.value })}
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#F7F7F5] dark:bg-[#0E0F11] border border-black/10 dark:border-white/12 text-sm text-[#141517] dark:text-[#F3F4F6]"
            >
              <option value="2160">2160p (4K)</option>
              <option value="1440">1440p (QHD)</option>
              <option value="1080">1080p (Full HD)</option>
              <option value="720">720p (HD)</option>
              <option value="480">480p (SD)</option>
              <option value="360">360p (Compact)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">
              Default Video Frame Rate
            </label>
            <select
              value={settings.defaultVideoFps || '60'}
              onChange={(e) => onUpdateSettings({ defaultVideoFps: e.target.value as VideoFps })}
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#F7F7F5] dark:bg-[#0E0F11] border border-black/10 dark:border-white/12 text-sm text-[#141517] dark:text-[#F3F4F6]"
            >
              <option value="60">60 fps (High Motion Smooth)</option>
              <option value="30">30 fps (Standard)</option>
              <option value="auto">Auto (Match Source)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">
              Default Video Container
            </label>
            <select
              value={settings.defaultVideoFormat}
              onChange={(e) => onUpdateSettings({ defaultVideoFormat: e.target.value as VideoFormat })}
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#F7F7F5] dark:bg-[#0E0F11] border border-black/10 dark:border-white/12 text-sm text-[#141517] dark:text-[#F3F4F6]"
            >
              <option value="mp4">MP4 (H.264 + AAC — Best Android compatibility)</option>
              <option value="webm">WebM (VP8/VP9 + Vorbis)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">
              Default Audio Format
            </label>
            <select
              value={settings.defaultAudioFormat}
              onChange={(e) => onUpdateSettings({ defaultAudioFormat: e.target.value as AudioFormat })}
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#F7F7F5] dark:bg-[#0E0F11] border border-black/10 dark:border-white/12 text-sm text-[#141517] dark:text-[#F3F4F6]"
            >
              <option value="mp3">MP3 (Universal)</option>
              <option value="m4a">M4A (AAC High Efficiency)</option>
              <option value="wav">WAV (Uncompressed PCM)</option>
              <option value="ogg">OGG (Vorbis)</option>
              <option value="flac">FLAC (Lossless)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">
              Default Audio Bitrate
            </label>
            <select
              value={settings.defaultAudioBitrate}
              onChange={(e) => onUpdateSettings({ defaultAudioBitrate: e.target.value })}
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#F7F7F5] dark:bg-[#0E0F11] border border-black/10 dark:border-white/12 text-sm text-[#141517] dark:text-[#F3F4F6]"
            >
              <option value="320k">320 kbps (Studio)</option>
              <option value="256k">256 kbps (High)</option>
              <option value="192k">192 kbps (Balanced)</option>
              <option value="128k">128 kbps (Compact)</option>
            </select>
          </div>
        </div>

        <div className="pt-4 border-t border-black/8 dark:border-white/10 divide-y divide-black/6 dark:divide-white/8">
          <label className="py-3 flex items-center justify-between gap-4 cursor-pointer min-h-[48px]">
            <div>
              <div className="text-sm font-medium text-[#141517] dark:text-[#F3F4F6]">
                Save downloads into Offline Library
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                Keep a copy inside ClipVault for offline playback and future trimming.
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.autoSaveToOfflineLibrary}
              onChange={(e) => onUpdateSettings({ autoSaveToOfflineLibrary: e.target.checked })}
              className="w-5 h-5 accent-[#E03E2D]"
            />
          </label>

          <label className="py-3 flex items-center justify-between gap-4 cursor-pointer min-h-[48px]">
            <div>
              <div className="text-sm font-medium text-[#141517] dark:text-[#F3F4F6]">
                Auto-download file to Android Downloads folder
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                Immediately save exported videos and cut clips to device storage.
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.autoTriggerDeviceDownload}
              onChange={(e) => onUpdateSettings({ autoTriggerDeviceDownload: e.target.checked })}
              className="w-5 h-5 accent-[#E03E2D]"
            />
          </label>

          <div className="py-3 flex items-center justify-between gap-4 min-h-[48px]">
            <div>
              <div className="text-sm font-medium text-[#141517] dark:text-[#F3F4F6]">
                Appearance
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                Switch between daylight alabaster and obsidian dark theme.
              </div>
            </div>
            <button
              type="button"
              onClick={onToggleTheme}
              className="inline-flex items-center gap-2 px-3.5 py-2 min-h-[42px] rounded-xl bg-[#F7F7F5] dark:bg-[#0E0F11] border border-black/10 dark:border-white/12 text-xs font-medium text-[#141517] dark:text-[#F3F4F6] whitespace-nowrap shrink-0"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              <span>{theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Offline Storage Vault */}
      <section className="rounded-3xl bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#F2F2EF] dark:bg-[#1C1F24] flex items-center justify-center text-[#141517] dark:text-[#F3F4F6]">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#141517] dark:text-[#F3F4F6]">
                Local Offline Storage
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 font-mono tabular-nums">
                {formatBytes(storage.usedBytes)} used
                {storage.quotaBytes > 0 ? ` of ${formatBytes(storage.quotaBytes)} available` : ''}
                {' · '}
                {libraryCount} {libraryCount === 1 ? 'file' : 'files'}
              </p>
            </div>
          </div>

          {libraryCount > 0 && !confirmClear && (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="min-h-[42px] px-3.5 rounded-xl border border-black/10 dark:border-white/12 text-xs font-medium text-[#C93222] dark:text-[#FF8A7D] hover:bg-[#E03E2D]/10 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear Library</span>
            </button>
          )}
        </div>

        {confirmClear && (
          <div className="p-4 rounded-2xl bg-[#E03E2D]/8 border border-[#E03E2D]/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-xs text-[#B5291B] dark:text-[#FF8A7D]">
              Remove all {libraryCount} saved videos and trimmed clips from offline storage?
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="min-h-[38px] px-3 rounded-xl bg-white dark:bg-[#1C1F24] text-xs font-medium text-[#141517] dark:text-[#F3F4F6] border border-black/10 dark:border-white/10 whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onClearLibrary();
                  setConfirmClear(false);
                }}
                className="min-h-[38px] px-3 rounded-xl bg-[#E03E2D] text-white text-xs font-medium whitespace-nowrap shrink-0"
              >
                Confirm Delete All
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
