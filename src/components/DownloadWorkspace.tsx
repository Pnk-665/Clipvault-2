import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardPaste,
  Download,
  Film,
  Loader2,
  Music,
  Scissors,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type {
  AudioFormat,
  MediaMode,
  OfflineMediaItem,
  UserSettings,
  VideoFormat,
  VideoFps,
  VideoInfo,
} from '../types/media';
import {
  formatBytes,
  formatTimecode,
  formatViews,
  sanitizeFileTitle,
  triggerBrowserDownload,
} from '../lib/formatters';
import { saveOfflineMedia } from '../lib/offlineDb';
import { DualRangeTimeline } from './DualRangeTimeline';

interface DownloadWorkspaceProps {
  settings: UserSettings;
  onMediaSaved: (item: OfflineMediaItem) => void;
  onOpenTrimWithItem: (item: OfflineMediaItem) => void;
  onSwitchToTrimTab: () => void;
}

const VIDEO_CONTAINERS: VideoFormat[] = ['mp4', 'webm'];
const AUDIO_CONTAINERS: AudioFormat[] = ['mp3', 'm4a', 'wav', 'ogg', 'flac'];
const AUDIO_BITRATES = ['320k', '256k', '192k', '128k'];

export const DownloadWorkspace: React.FC<DownloadWorkspaceProps> = ({
  settings,
  onMediaSaved,
  onOpenTrimWithItem,
  onSwitchToTrimTab,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [thumbFailed, setThumbFailed] = useState(false);

  // Export selections
  const [mode, setMode] = useState<MediaMode>(settings.defaultMode);
  const [selectedFormatId, setSelectedFormatId] = useState<string>(`v-${settings.defaultVideoResolution}-${settings.defaultVideoFps === '30' ? 30 : 60}`);
  const [selectedResolution, setSelectedResolution] = useState(settings.defaultVideoResolution);
  const [selectedFps, setSelectedFps] = useState<VideoFps>(settings.defaultVideoFps || '60');
  const [videoFormat, setVideoFormat] = useState<VideoFormat>(settings.defaultVideoFormat);
  const [audioFormat, setAudioFormat] = useState<AudioFormat>(settings.defaultAudioFormat);
  const [audioBitrate, setAudioBitrate] = useState(settings.defaultAudioBitrate);

  // Optional pre-download segment trimming
  const [enableTrim, setEnableTrim] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(60);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [normalizeAudio, setNormalizeAudio] = useState(false);
  const [showAdvancedAudio, setShowAdvancedAudio] = useState(false);

  // Download state
  const [downloading, setDownloading] = useState(false);
  const [downloadPhase, setDownloadPhase] = useState<string>('');
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadError, setDownloadError] = useState<{ message: string; restricted?: boolean } | null>(null);
  const [lastSavedItem, setLastSavedItem] = useState<OfflineMediaItem | null>(null);
  const [clientProfile, setClientProfile] = useState<'android' | 'ios' | 'tv'>(settings.clientProfile);

  useEffect(() => {
    setClientProfile(settings.clientProfile);
  }, [settings.clientProfile]);

  // Auto-inspect shared YouTube link when launched via Android Share (?url= or ?text=)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = (params.get('url') || params.get('text') || '').trim();
    if (!raw) return;
    const ytMatch = raw.match(/https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/[^\s]+|youtu\.be\/[^\s]+)/i);
    const candidate = ytMatch ? ytMatch[0] : raw;
    if (candidate) {
      setUrlInput(candidate);
      fetchInfo(candidate);
    }
  }, []);

  const fetchInfo = async (targetUrl?: string) => {
    const query = (targetUrl ?? urlInput).trim();
    if (!query) {
      setInfoError('Paste a YouTube video, Shorts, or Music URL to inspect formats.');
      return;
    }

    setLoadingInfo(true);
    setInfoError(null);
    setDownloadError(null);
    setLastSavedItem(null);
    setThumbFailed(false);

    try {
      const res = await fetch('/api/youtube/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: query }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not load video details.');
      }

      const info = data as VideoInfo;
      setVideoInfo(info);

      // Pick best matching default resolution + fps
      const preferredFpsNum = settings.defaultVideoFps === '30' ? 30 : 60;
      const exactMatch = info.videoFormats.find(
        (f) => String(f.height || '') === settings.defaultVideoResolution && (f.fps || 30) === preferredFpsNum
      );
      const heightMatch = info.videoFormats.find(
        (f) => String(f.height || '') === settings.defaultVideoResolution
      );
      const chosen = exactMatch || heightMatch || info.videoFormats[0];
      if (chosen) {
        setSelectedFormatId(chosen.id);
        setSelectedResolution(String(chosen.height || chosen.resolution.replace('p', '')));
        setSelectedFps(chosen.fps === 60 ? '60' : settings.defaultVideoFps === 'auto' ? 'auto' : '30');
      }

      const dur = info.durationSeconds > 0 ? info.durationSeconds : 180;
      setTrimStart(0);
      setTrimEnd(dur);
      setEnableTrim(false);
    } catch (err) {
      setInfoError((err as Error).message || 'Failed to inspect YouTube link.');
      setVideoInfo(null);
    } finally {
      setLoadingInfo(false);
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrlInput(text.trim());
        setInfoError(null);
        if (/youtu\.?be/.test(text)) {
          fetchInfo(text.trim());
        }
      }
    } catch {
      setInfoError('Clipboard access was blocked by the browser. Long-press the input field to paste.');
    }
  };

  const handleDownload = async (profileOverride?: 'android' | 'ios' | 'tv') => {
    if (!videoInfo) return;

    const activeProfile = profileOverride || clientProfile;
    setDownloading(true);
    setDownloadError(null);
    setLastSavedItem(null);
    setDownloadProgress(15);
    setDownloadPhase(enableTrim ? 'Fetching stream & cutting segment with FFmpeg...' : 'Fetching stream & encoding high-quality export...');

    const activeFormat = mode === 'video' ? videoFormat : audioFormat;
    const isTrimmedSegment =
      enableTrim && (trimStart > 0.05 || (videoInfo.durationSeconds > 0 && trimEnd < videoInfo.durationSeconds - 0.1));

    try {
      const res = await fetch('/api/youtube/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: videoInfo.url,
          title: videoInfo.title,
          mode,
          format: activeFormat,
          resolution: selectedResolution,
          fps: selectedFps,
          bitrate: audioBitrate,
          startTime: enableTrim ? trimStart : undefined,
          endTime: enableTrim ? trimEnd : undefined,
          fadeIn: showAdvancedAudio ? fadeIn : 0,
          fadeOut: showAdvancedAudio ? fadeOut : 0,
          normalize: showAdvancedAudio ? normalizeAudio : false,
          clientProfile: activeProfile,
        }),
      });

      if (!res.ok) {
        let errBody: { error?: string; code?: string } = {};
        try {
          errBody = await res.json();
        } catch {
          // ignore
        }
        throw Object.assign(new Error(errBody.error || 'Download failed.'), {
          restricted: errBody.code === 'YOUTUBE_STREAM_RESTRICTED',
        });
      }

      setDownloadPhase('Saving file to device & offline vault...');
      const totalLength = Number(res.headers.get('content-length') || 0);
      const headerDuration = parseFloat(res.headers.get('x-clipvault-duration') || '0');
      const mimeType = res.headers.get('content-type') || (mode === 'audio' ? 'audio/mpeg' : 'video/mp4');

      let blob: Blob;
      if (res.body && totalLength > 0) {
        const reader = res.body.getReader();
        const chunks: BlobPart[] = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.byteLength;
            setDownloadProgress(Math.min(95, 20 + Math.round((received / totalLength) * 75)));
          }
        }
        blob = new Blob(chunks, { type: mimeType });
      } else {
        setDownloadProgress(75);
        blob = await res.blob();
      }

      // Fetch thumbnail blob for 100% offline display
      let thumbnailBlob: Blob | undefined;
      try {
        const thumbRes = await fetch(`/api/thumbnail?url=${encodeURIComponent(videoInfo.thumbnail)}`);
        if (thumbRes.ok) {
          thumbnailBlob = await thumbRes.blob();
        }
      } catch {
        // optional
      }

      const finalDuration =
        headerDuration > 0
          ? headerDuration
          : enableTrim
            ? Math.max(0.5, trimEnd - trimStart)
            : videoInfo.durationSeconds;

      const safeTitle = sanitizeFileTitle(videoInfo.title);
      const filename = `${safeTitle}${isTrimmedSegment ? ' [cut]' : ''}.${activeFormat}`;

      const item: OfflineMediaItem = {
        id: crypto.randomUUID(),
        title: isTrimmedSegment ? `${videoInfo.title} (Cut)` : videoInfo.title,
        author: videoInfo.author,
        mode,
        format: activeFormat.toUpperCase(),
        resolution:
          mode === 'video'
            ? `${selectedResolution}p${selectedFps === '60' ? ' 60fps' : selectedFps === '30' ? ' 30fps' : ''}`
            : audioBitrate.replace('k', ' kbps'),
        bitrate: mode === 'audio' ? audioBitrate : undefined,
        durationSeconds: finalDuration,
        sizeBytes: blob.size,
        createdAt: Date.now(),
        sourceUrl: videoInfo.url,
        videoId: videoInfo.videoId,
        isTrimmed: isTrimmedSegment,
        trimRange: isTrimmedSegment ? { start: trimStart, end: trimEnd } : undefined,
        mimeType,
        blob,
        thumbnailBlob,
      };

      if (settings.autoSaveToOfflineLibrary) {
        await saveOfflineMedia(item);
        onMediaSaved(item);
      }

      if (settings.autoTriggerDeviceDownload) {
        triggerBrowserDownload(blob, filename);
      }

      setDownloadProgress(100);
      setLastSavedItem(item);
    } catch (err) {
      const e = err as Error & { restricted?: boolean };
      setDownloadError({
        message: e.message || 'Download could not be completed.',
        restricted: e.restricted,
      });
    } finally {
      setDownloading(false);
    }
  };

  const activeDuration = videoInfo?.durationSeconds || 180;
  const trimRatio = enableTrim && activeDuration > 0 ? Math.max(0.05, (trimEnd - trimStart) / activeDuration) : 1;

  return (
    <div className="space-y-6">
      {/* Link Input Bar */}
      <section className="rounded-3xl bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 p-5 sm:p-7">
        <div className="max-w-3xl">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#141517] dark:text-[#F3F4F6]">
            Download YouTube videos &amp; audio offline
          </h1>
          <p className="mt-1.5 text-sm sm:text-base text-neutral-600 dark:text-neutral-400">
            Paste any YouTube link to save full HD video, extract crisp audio, or cut an exact segment directly—ad-free.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetchInfo();
          }}
          className="mt-5 flex flex-col sm:flex-row gap-3"
        >
          <div className="relative flex-1 flex items-center">
            <input
              type="url"
              inputMode="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=... or youtu.be/..."
              aria-label="YouTube video link"
              className="w-full min-h-[52px] pl-4 pr-24 rounded-2xl bg-[#F7F7F5] dark:bg-[#0E0F11] border border-black/10 dark:border-white/12 text-sm sm:text-base text-[#141517] dark:text-[#F3F4F6] placeholder:text-neutral-400 focus:outline-none focus:border-[#E03E2D] transition-colors"
            />
            <div className="absolute right-2 flex items-center gap-1">
              {urlInput && (
                <button
                  type="button"
                  onClick={() => {
                    setUrlInput('');
                    setInfoError(null);
                  }}
                  aria-label="Clear link"
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl text-neutral-400 hover:text-[#141517] dark:hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={handlePasteClipboard}
                className="inline-flex items-center gap-1.5 px-3 min-h-[36px] rounded-xl text-xs font-medium bg-white dark:bg-[#1C1F24] border border-black/8 dark:border-white/10 text-[#141517] dark:text-[#F3F4F6] hover:border-[#E03E2D] transition-colors whitespace-nowrap shrink-0"
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                <span>Paste</span>
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loadingInfo}
            className="min-h-[52px] px-6 rounded-2xl bg-[#E03E2D] hover:bg-[#C93222] disabled:opacity-60 text-white font-medium text-sm sm:text-base flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 active:scale-[0.99]"
          >
            {loadingInfo ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Inspecting...</span>
              </>
            ) : (
              <span>Inspect Link</span>
            )}
          </button>
        </form>

        {infoError && (
          <div className="mt-4 flex items-start gap-2.5 text-sm text-[#C93222] dark:text-[#FF7A6B]" role="alert">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{infoError}</span>
          </div>
        )}
      </section>

      {/* Inspected Video & Format Matrix */}
      {videoInfo ? (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Video Metadata + Inline Segment Cutter */}
          <div className="lg:col-span-7 space-y-6">
            <div className="rounded-3xl bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 overflow-hidden">
              <div className="relative aspect-video bg-[#141517] overflow-hidden">
                {!thumbFailed ? (
                  <img
                    src={`/api/thumbnail?url=${encodeURIComponent(videoInfo.thumbnail)}`}
                    alt={videoInfo.title}
                    referrerPolicy="no-referrer"
                    onError={() => setThumbFailed(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-neutral-400">
                    <Film className="w-10 h-10" />
                    <span className="text-xs">{videoInfo.title}</span>
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-5 pt-14">
                  <h2 className="text-lg sm:text-xl font-semibold text-white leading-snug line-clamp-2">
                    {videoInfo.title}
                  </h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-white/80 font-mono tabular-nums">
                    <span className="font-sans font-medium text-white">{videoInfo.author}</span>
                    {videoInfo.durationSeconds > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{formatTimecode(videoInfo.durationSeconds)}</span>
                      </>
                    )}
                    {videoInfo.viewCount ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-sans">{formatViews(videoInfo.viewCount)}</span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Pre-Download Segment Cut Toggle & Timeline */}
              <div className="p-5 sm:p-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-semibold text-[#141517] dark:text-[#F3F4F6]">
                      Cut segment before download
                    </h3>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                      Save only the clip range you need instead of the full video.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enableTrim}
                    onClick={() => setEnableTrim((v) => !v)}
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E03E2D] ${
                      enableTrim ? 'bg-[#E03E2D]' : 'bg-neutral-300 dark:bg-neutral-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                        enableTrim ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {enableTrim && (
                  <div className="mt-5 pt-5 border-t border-black/8 dark:border-white/10">
                    <DualRangeTimeline
                      duration={activeDuration}
                      startTime={trimStart}
                      endTime={trimEnd}
                      onChangeRange={(s, e) => {
                        setTrimStart(s);
                        setTrimEnd(e);
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Format, Resolution & Export Action */}
          <div className="lg:col-span-5 rounded-3xl bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 p-5 sm:p-6 space-y-5">
            {/* Mode Segmented Control */}
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-[#F2F2EF] dark:bg-[#0E0F11]">
              <button
                type="button"
                onClick={() => setMode('video')}
                className={`min-h-[44px] flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'video'
                    ? 'bg-white dark:bg-[#1C1F24] text-[#141517] dark:text-white shadow-sm'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-[#141517] dark:hover:text-white'
                }`}
              >
                <Film className="w-4 h-4" />
                <span>Video + Audio</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('audio')}
                className={`min-h-[44px] flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'audio'
                    ? 'bg-white dark:bg-[#1C1F24] text-[#141517] dark:text-white shadow-sm'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-[#141517] dark:hover:text-white'
                }`}
              >
                <Music className="w-4 h-4" />
                <span>Audio Only</span>
              </button>
            </div>

            {/* Container Selector */}
            <div>
              <span className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">
                Output format
              </span>
              <div className="flex flex-wrap gap-2">
                {(mode === 'video' ? VIDEO_CONTAINERS : AUDIO_CONTAINERS).map((fmt) => {
                  const isActive = (mode === 'video' ? videoFormat : audioFormat) === fmt;
                  return (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() =>
                        mode === 'video'
                          ? setVideoFormat(fmt as VideoFormat)
                          : setAudioFormat(fmt as AudioFormat)
                      }
                      className={`min-h-[40px] px-4 rounded-xl text-xs font-mono font-semibold uppercase transition-colors whitespace-nowrap shrink-0 border ${
                        isActive
                          ? 'bg-[#141517] text-white border-[#141517] dark:bg-[#F3F4F6] dark:text-[#141517] dark:border-[#F3F4F6]'
                          : 'bg-transparent text-neutral-700 dark:text-neutral-300 border-black/10 dark:border-white/12 hover:border-[#141517] dark:hover:border-white/40'
                      }`}
                    >
                      {fmt}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quality / Resolution Matrix */}
            {mode === 'video' ? (
              <div className="space-y-4">
                <div>
                  <span className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">
                    Frame rate
                  </span>
                  <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-[#F2F2EF] dark:bg-[#0E0F11]">
                    {(
                      [
                        { value: '60', label: '60 fps' },
                        { value: '30', label: '30 fps' },
                        { value: 'auto', label: 'Auto' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setSelectedFps(opt.value)}
                        className={`min-h-[38px] rounded-lg text-xs font-mono font-semibold transition-colors whitespace-nowrap shrink-0 ${
                          selectedFps === opt.value
                            ? 'bg-white dark:bg-[#1C1F24] text-[#141517] dark:text-white shadow-sm'
                            : 'text-neutral-600 dark:text-neutral-400 hover:text-[#141517] dark:hover:text-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">
                    Resolution &amp; frame rate presets
                  </span>
                  <div className="divide-y divide-black/6 dark:divide-white/8 rounded-2xl border border-black/8 dark:border-white/10 overflow-hidden max-h-[320px] overflow-y-auto">
                    {videoInfo.videoFormats.map((fmt) => {
                      const heightKey = String(fmt.height || fmt.resolution.replace('p', ''));
                      const active = selectedFormatId === fmt.id;
                      const estBytes = fmt.estimatedBytes ? Math.round(fmt.estimatedBytes * trimRatio) : 0;
                      return (
                        <button
                          key={fmt.id}
                          type="button"
                          onClick={() => {
                            setSelectedFormatId(fmt.id);
                            setSelectedResolution(heightKey);
                            setSelectedFps(fmt.fps === 60 ? '60' : '30');
                          }}
                          className={`w-full min-h-[52px] px-4 py-2.5 flex items-center justify-between gap-3 text-left transition-colors ${
                            active
                              ? 'bg-[#E03E2D]/8 dark:bg-[#E03E2D]/15'
                              : 'hover:bg-[#F7F7F5] dark:hover:bg-[#1C1F24]'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-[#141517] dark:text-[#F3F4F6]">
                              {fmt.label}
                            </div>
                            <div className="text-xs text-neutral-500 dark:text-neutral-400 font-mono tabular-nums">
                              {videoFormat.toUpperCase()} · {fmt.fps || 30} fps · {fmt.codec || 'H.264'}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            {estBytes > 0 && (
                              <span className="text-xs font-mono tabular-nums text-neutral-500 dark:text-neutral-400">
                                ~{formatBytes(estBytes)}
                              </span>
                            )}
                            <span
                              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                active ? 'border-[#E03E2D]' : 'border-neutral-300 dark:border-neutral-600'
                              }`}
                            >
                              {active && <span className="w-2.5 h-2.5 rounded-full bg-[#E03E2D]" />}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <span className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">
                  Audio bitrate
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {AUDIO_BITRATES.map((br) => {
                    const active = audioBitrate === br;
                    const kbps = parseInt(br, 10);
                    const estBytes = Math.round(((kbps * 1000) / 8) * activeDuration * trimRatio);
                    return (
                      <button
                        key={br}
                        type="button"
                        onClick={() => setAudioBitrate(br)}
                        disabled={audioFormat === 'wav' || audioFormat === 'flac'}
                        className={`min-h-[54px] px-3.5 py-2.5 rounded-xl border text-left transition-colors disabled:opacity-50 ${
                          active
                            ? 'border-[#E03E2D] bg-[#E03E2D]/8 dark:bg-[#E03E2D]/15'
                            : 'border-black/10 dark:border-white/10 hover:border-black/25 dark:hover:border-white/25'
                        }`}
                      >
                        <div className="text-sm font-mono font-semibold tabular-nums text-[#141517] dark:text-[#F3F4F6]">
                          {br.replace('k', ' kbps')}
                        </div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-400 font-mono tabular-nums">
                          {audioFormat === 'wav' || audioFormat === 'flac' ? 'Lossless PCM/FLAC' : `~${formatBytes(estBytes)}`}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Audio Fade & Normalize Accordion */}
            <div className="border-t border-black/8 dark:border-white/10 pt-4">
              <button
                type="button"
                onClick={() => setShowAdvancedAudio((v) => !v)}
                className="w-full min-h-[40px] flex items-center justify-between text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:text-[#141517] dark:hover:text-white"
              >
                <span className="inline-flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4" />
                  <span>Audio mastering (fades &amp; volume normalize)</span>
                </span>
                <span>{showAdvancedAudio ? 'Hide' : 'Configure'}</span>
              </button>

              {showAdvancedAudio && (
                <div className="mt-3 space-y-3 pt-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex justify-between text-xs text-neutral-500 dark:text-neutral-400 mb-1">
                        <span>Fade In</span>
                        <span className="font-mono tabular-nums">{fadeIn.toFixed(1)}s</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={5}
                        step={0.5}
                        value={fadeIn}
                        onChange={(e) => setFadeIn(parseFloat(e.target.value))}
                        className="w-full cv-slider bg-neutral-200 dark:bg-neutral-700 h-1 rounded-full"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-xs text-neutral-500 dark:text-neutral-400 mb-1">
                        <span>Fade Out</span>
                        <span className="font-mono tabular-nums">{fadeOut.toFixed(1)}s</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={5}
                        step={0.5}
                        value={fadeOut}
                        onChange={(e) => setFadeOut(parseFloat(e.target.value))}
                        className="w-full cv-slider bg-neutral-200 dark:bg-neutral-700 h-1 rounded-full"
                      />
                    </div>
                  </div>
                  <label className="flex items-center justify-between gap-3 cursor-pointer min-h-[40px]">
                    <span className="text-xs text-neutral-700 dark:text-neutral-300">
                      Loudness normalization (-16 LUFS)
                    </span>
                    <input
                      type="checkbox"
                      checked={normalizeAudio}
                      onChange={(e) => setNormalizeAudio(e.target.checked)}
                      className="w-4 h-4 accent-[#E03E2D]"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Primary Download CTA */}
            <div className="pt-2 space-y-3">
              <button
                type="button"
                disabled={downloading}
                onClick={() => handleDownload()}
                className="w-full min-h-[52px] px-5 rounded-2xl bg-[#E03E2D] hover:bg-[#C93222] disabled:opacity-60 text-white font-semibold text-sm sm:text-base flex items-center justify-center gap-2.5 transition-colors active:scale-[0.99]"
              >
                {downloading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>{downloadProgress}% · Processing</span>
                  </>
                ) : (
                  <>
                    <Download className="w-5 h-5" />
                    <span>
                      {enableTrim
                        ? `Download Cut (${formatTimecode(Math.max(0, trimEnd - trimStart))})`
                        : `Download ${
                            mode === 'video'
                              ? `${selectedResolution}p${selectedFps === '60' ? ' 60fps' : ''} ${videoFormat.toUpperCase()}`
                              : audioFormat.toUpperCase()
                          }`}
                    </span>
                  </>
                )}
              </button>

              {downloading && (
                <div className="space-y-1.5">
                  <div className="h-1.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                    <div
                      className="h-full bg-[#E03E2D] transition-all duration-200"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">{downloadPhase}</p>
                </div>
              )}

              {downloadError && (
                <div className="p-4 rounded-2xl bg-[#E03E2D]/8 border border-[#E03E2D]/25 space-y-3" role="alert">
                  <div className="flex items-start gap-2.5 text-xs text-[#B5291B] dark:text-[#FF8A7D] leading-relaxed">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{downloadError.message}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const next = clientProfile === 'android' ? 'tv' : clientProfile === 'tv' ? 'ios' : 'android';
                        setClientProfile(next);
                        handleDownload(next);
                      }}
                      className="px-3 py-2 min-h-[38px] rounded-xl text-xs font-medium bg-white dark:bg-[#1C1F24] text-[#141517] dark:text-[#F3F4F6] border border-black/10 dark:border-white/10 hover:border-[#E03E2D] whitespace-nowrap shrink-0"
                    >
                      Retry with alternate client
                    </button>
                    <button
                      type="button"
                      onClick={onSwitchToTrimTab}
                      className="px-3 py-2 min-h-[38px] rounded-xl text-xs font-medium bg-[#141517] dark:bg-[#F3F4F6] text-white dark:text-[#141517] whitespace-nowrap shrink-0"
                    >
                      Trim local file instead
                    </button>
                  </div>
                </div>
              )}

              {lastSavedItem && (
                <div className="p-4 rounded-2xl bg-emerald-600/10 border border-emerald-600/25 space-y-3">
                  <div className="flex items-start gap-2.5 text-xs text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold">Saved offline &amp; ready for playback</p>
                      <p className="mt-0.5 font-mono tabular-nums opacity-85">
                        {lastSavedItem.format} · {lastSavedItem.resolution} · {formatBytes(lastSavedItem.sizeBytes)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenTrimWithItem(lastSavedItem)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] rounded-xl text-xs font-medium bg-white dark:bg-[#1C1F24] text-[#141517] dark:text-[#F3F4F6] border border-black/10 dark:border-white/10 hover:border-[#E03E2D] whitespace-nowrap shrink-0"
                    >
                      <Scissors className="w-3.5 h-3.5" />
                      <span>Open in Trim Studio</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        triggerBrowserDownload(
                          lastSavedItem.blob,
                          `${sanitizeFileTitle(lastSavedItem.title)}.${lastSavedItem.format.toLowerCase()}`
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] rounded-xl text-xs font-medium bg-[#141517] dark:bg-[#F3F4F6] text-white dark:text-[#141517] whitespace-nowrap shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Save Copy</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      ) : (
        /* Clean, purposeful empty state with quick workflows */
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-3xl bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 p-6">
            <p className="text-xs font-mono text-neutral-500 dark:text-neutral-400">01. Multi-Resolution</p>
            <h2 className="mt-2 text-lg font-semibold text-[#141517] dark:text-[#F3F4F6]">
              360p up to 4K &amp; Lossless Audio
            </h2>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
              Save Android-ready MP4 or WebM videos, or extract MP3, M4A, WAV, OGG, and FLAC audio tracks up to 320 kbps.
            </p>
          </div>
          <div className="rounded-3xl bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 p-6">
            <p className="text-xs font-mono text-neutral-500 dark:text-neutral-400">02. Frame-Accurate Cuts</p>
            <h2 className="mt-2 text-lg font-semibold text-[#141517] dark:text-[#F3F4F6]">
              Trim Segments Before or After
            </h2>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
              Set exact In and Out markers directly on the waveform timeline to download only the exact clip or ringtone you want.
            </p>
          </div>
          <div className="rounded-3xl bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 p-6 flex flex-col justify-between gap-4">
            <div>
              <p className="text-xs font-mono text-neutral-500 dark:text-neutral-400">03. Local Media Studio</p>
              <h2 className="mt-2 text-lg font-semibold text-[#141517] dark:text-[#F3F4F6]">
                Already Have a Video or Audio?
              </h2>
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                Open Trim Studio to cut, extract audio, add fades, and convert any file already on your device.
              </p>
            </div>
            <button
              type="button"
              onClick={onSwitchToTrimTab}
              className="self-start inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-medium bg-[#141517] text-white dark:bg-[#F3F4F6] dark:text-[#141517] hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
            >
              <Scissors className="w-4 h-4" />
              <span>Open Trim Studio</span>
            </button>
          </div>
        </section>
      )}
    </div>
  );
};
