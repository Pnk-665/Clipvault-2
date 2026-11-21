import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Film,
  FolderOpen,
  Loader2,
  Music,
  Pause,
  Play,
  Repeat,
  Scissors,
  SkipBack,
  Upload,
} from 'lucide-react';
import type {
  AudioFormat,
  MediaMode,
  OfflineMediaItem,
  UserSettings,
  VideoFormat,
  VideoFps,
} from '../types/media';
import {
  formatBytes,
  formatTimecode,
  sanitizeFileTitle,
  triggerBrowserDownload,
} from '../lib/formatters';
import { extractWaveformPeaks, trimAudioOfflineToWav } from '../lib/audioTrimmer';
import { saveOfflineMedia } from '../lib/offlineDb';
import { useOnlineStatus } from '../hooks/usePWAInstall';
import { DualRangeTimeline } from './DualRangeTimeline';

interface TrimStudioProps {
  initialItem: OfflineMediaItem | null;
  libraryItems: OfflineMediaItem[];
  settings: UserSettings;
  onTrimSaved: (item: OfflineMediaItem) => void;
}

interface LoadedSource {
  id: string;
  title: string;
  author: string;
  blob: Blob;
  mimeType: string;
  hasVideo: boolean;
  thumbnailBlob?: Blob;
  sourceUrl?: string;
}

const VIDEO_FORMATS: VideoFormat[] = ['mp4', 'webm'];
const AUDIO_FORMATS: AudioFormat[] = ['mp3', 'm4a', 'wav', 'ogg', 'flac'];
const VIDEO_RESOLUTIONS = [
  { value: 'original', label: 'Original' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
];
const AUDIO_BITRATES = ['320k', '256k', '192k', '128k'];

export const TrimStudio: React.FC<TrimStudioProps> = ({
  initialItem,
  libraryItems,
  settings,
  onTrimSaved,
}) => {
  const isOnline = useOnlineStatus();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  const [source, setSource] = useState<LoadedSource | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loopSelection, setLoopSelection] = useState(true);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [loadingPeaks, setLoadingPeaks] = useState(false);

  // Trim bounds & export configuration
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [clipTitle, setClipTitle] = useState('');
  const [outputMode, setOutputMode] = useState<MediaMode>('video');
  const [videoFormat, setVideoFormat] = useState<VideoFormat>(settings.defaultVideoFormat);
  const [audioFormat, setAudioFormat] = useState<AudioFormat>(settings.defaultAudioFormat);
  const [resolution, setResolution] = useState('original');
  const [fps, setFps] = useState<VideoFps>('auto');
  const [bitrate, setBitrate] = useState(settings.defaultAudioBitrate);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [normalize, setNormalize] = useState(false);

  // Export status
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportedItem, setExportedItem] = useState<OfflineMediaItem | null>(null);

  // Load initial item from Library / Download tab
  useEffect(() => {
    if (initialItem) {
      loadFromOfflineItem(initialItem);
    }
  }, [initialItem?.id]);

  // Manage Blob object URL cleanly
  useEffect(() => {
    if (!source) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(source.blob);
    setObjectUrl(url);
    setExportedItem(null);
    setExportError(null);
    setIsPlaying(false);
    setCurrentTime(0);

    let cancelled = false;
    setLoadingPeaks(true);
    extractWaveformPeaks(source.blob, 88)
      .then((extracted) => {
        if (!cancelled) setPeaks(extracted);
      })
      .finally(() => {
        if (!cancelled) setLoadingPeaks(false);
      });

    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [source?.id]);

  const loadFromOfflineItem = (item: OfflineMediaItem) => {
    const isVideo = item.mode === 'video' || item.mimeType.startsWith('video/');
    setSource({
      id: `${item.id}-${Date.now()}`,
      title: item.title,
      author: item.author,
      blob: item.blob,
      mimeType: item.mimeType,
      hasVideo: isVideo,
      thumbnailBlob: item.thumbnailBlob,
      sourceUrl: item.sourceUrl,
    });
    setClipTitle(`${item.title} Cut`);
    setOutputMode(isVideo ? 'video' : 'audio');
    if (item.durationSeconds > 0) {
      setDuration(item.durationSeconds);
      setStartTime(0);
      setEndTime(item.durationSeconds);
    }
  };

  const handleFileUpload = (file: File) => {
    const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mkv|mov)$/i.test(file.name);
    const cleanTitle = file.name.replace(/\.[^/.]+$/, '');
    setSource({
      id: `local-${Date.now()}`,
      title: cleanTitle,
      author: 'Device Storage',
      blob: file,
      mimeType: file.type || (isVideo ? 'video/mp4' : 'audio/mpeg'),
      hasVideo: isVideo,
    });
    setClipTitle(`${cleanTitle} Cut`);
    setOutputMode(isVideo ? 'video' : 'audio');
    setDuration(0);
    setStartTime(0);
    setEndTime(0);
  };

  const handleLoadedMetadata = () => {
    const el = mediaRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    setDuration(el.duration);
    setStartTime(0);
    setEndTime(Number(el.duration.toFixed(2)));
  };

  const handleTimeUpdate = () => {
    const el = mediaRef.current;
    if (!el) return;
    const t = el.currentTime;
    setCurrentTime(t);
    if (loopSelection && endTime > startTime && t >= endTime) {
      el.currentTime = startTime;
      if (!el.paused) {
        el.play().catch(() => {});
      }
    }
  };

  const togglePlayback = () => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) {
      if (el.currentTime < startTime || el.currentTime >= endTime - 0.05) {
        el.currentTime = startTime;
      }
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  };

  const seekTo = (time: number) => {
    const el = mediaRef.current;
    setCurrentTime(time);
    if (el) {
      el.currentTime = time;
    }
  };

  const handleMarkIn = () => {
    const nextStart = Math.max(0, Math.min(currentTime, endTime - 0.5));
    setStartTime(Number(nextStart.toFixed(2)));
  };

  const handleMarkOut = () => {
    const nextEnd = Math.min(duration, Math.max(currentTime, startTime + 0.5));
    setEndTime(Number(nextEnd.toFixed(2)));
  };

  const handleExportCut = async () => {
    if (!source || duration <= 0) return;
    if (endTime <= startTime + 0.1) {
      setExportError('Select a segment at least 0.1 seconds long.');
      return;
    }

    setExporting(true);
    setExportError(null);
    setExportedItem(null);

    const activeFormat = outputMode === 'video' ? videoFormat : audioFormat;
    const cleanName = sanitizeFileTitle(clipTitle || `${source.title} Cut`);

    try {
      let resultBlob: Blob;
      let resultMime: string;
      let resultFormat = activeFormat;
      let resultDuration = Math.max(0.1, endTime - startTime);

      if (!isOnline) {
        if (outputMode === 'video') {
          throw new Error(
            'You are currently offline. Switch Output Type to "Audio Only" to trim audio offline right on your device, or reconnect for FFmpeg video re-encoding.'
          );
        }
        // 100% Offline Web Audio API WAV Trimmer
        const trimmed = await trimAudioOfflineToWav({
          blob: source.blob,
          startTime,
          endTime,
          fadeIn,
          fadeOut,
          normalize,
        });
        resultBlob = trimmed.blob;
        resultMime = 'audio/wav';
        resultFormat = 'wav';
        resultDuration = trimmed.duration;
      } else {
        // High-quality server-side FFmpeg segment cutting & audio trimming
        const formData = new FormData();
        formData.append('file', source.blob, `${cleanName}.media`);
        formData.append('title', cleanName);
        formData.append('mode', outputMode);
        formData.append('format', activeFormat);
        formData.append('startTime', String(startTime));
        formData.append('endTime', String(endTime));
        formData.append('resolution', resolution);
        formData.append('fps', fps);
        formData.append('bitrate', bitrate);
        formData.append('fadeIn', String(fadeIn));
        formData.append('fadeOut', String(fadeOut));
        formData.append('normalize', String(normalize));

        const res = await fetch('/api/media/trim', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          let errJson: { error?: string } = {};
          try {
            errJson = await res.json();
          } catch {
            // ignore
          }
          throw new Error(errJson.error || 'FFmpeg trim failed.');
        }

        const headerDuration = parseFloat(res.headers.get('x-clipvault-duration') || '0');
        if (headerDuration > 0) resultDuration = headerDuration;
        resultMime = res.headers.get('content-type') || (outputMode === 'audio' ? 'audio/mpeg' : 'video/mp4');
        resultBlob = await res.blob();
      }

      const savedItem: OfflineMediaItem = {
        id: crypto.randomUUID(),
        title: clipTitle.trim() || `${source.title} (Cut)`,
        author: source.author,
        mode: outputMode,
        format: resultFormat.toUpperCase(),
        resolution:
          outputMode === 'video'
            ? `${resolution === 'original' ? 'Original' : `${resolution}p`}${fps === '60' ? ' 60fps' : fps === '30' ? ' 30fps' : ''}`
            : resultFormat === 'wav' || resultFormat === 'flac'
              ? 'Lossless'
              : bitrate.replace('k', ' kbps'),
        bitrate: outputMode === 'audio' ? bitrate : undefined,
        durationSeconds: resultDuration,
        sizeBytes: resultBlob.size,
        createdAt: Date.now(),
        sourceUrl: source.sourceUrl,
        isTrimmed: true,
        trimRange: { start: startTime, end: endTime },
        mimeType: resultMime,
        blob: resultBlob,
        thumbnailBlob: source.thumbnailBlob,
      };

      if (settings.autoSaveToOfflineLibrary) {
        await saveOfflineMedia(savedItem);
        onTrimSaved(savedItem);
      }
      if (settings.autoTriggerDeviceDownload) {
        triggerBrowserDownload(resultBlob, `${cleanName}.${resultFormat}`);
      }

      setExportedItem(savedItem);
    } catch (err) {
      setExportError((err as Error).message || 'Could not export trimmed segment.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFileUpload(f);
          e.target.value = '';
        }}
      />

      {/* Source Picker Header */}
      <section className="rounded-3xl bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#141517] dark:text-[#F3F4F6]">
              Precision Trim Studio
            </h1>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              Cut video segments, trim audio clips, apply fades, and export directly to your device or offline vault.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-[#141517] text-white dark:bg-[#F3F4F6] dark:text-[#141517] text-sm font-medium hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
          >
            <Upload className="w-4 h-4" />
            <span>Import Device File</span>
          </button>
        </div>

        {/* Quick pick from Offline Library */}
        {libraryItems.length > 0 && (
          <div className="mt-5 pt-4 border-t border-black/8 dark:border-white/10">
            <span className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2.5">
              Load from your Offline Library
            </span>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {libraryItems.slice(0, 8).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => loadFromOfflineItem(item)}
                  className="inline-flex items-center gap-2 px-3.5 py-2 min-h-[40px] rounded-xl bg-[#F7F7F5] dark:bg-[#0E0F11] border border-black/8 dark:border-white/10 hover:border-[#E03E2D] text-xs font-medium text-[#141517] dark:text-[#F3F4F6] transition-colors whitespace-nowrap shrink-0 max-w-[240px]"
                >
                  {item.mode === 'video' ? (
                    <Film className="w-3.5 h-3.5 text-[#E03E2D] shrink-0" />
                  ) : (
                    <Music className="w-3.5 h-3.5 text-[#E03E2D] shrink-0" />
                  )}
                  <span className="truncate">{item.title}</span>
                  <span className="font-mono text-neutral-500 tabular-nums shrink-0">
                    {formatTimecode(item.durationSeconds)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {source && objectUrl ? (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Media Preview + Interactive Waveform Timeline */}
          <div className="lg:col-span-7 rounded-3xl bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 p-5 sm:p-6 space-y-5">
            {/* Media Viewport */}
            <div className="rounded-2xl overflow-hidden bg-[#141517] relative">
              {source.hasVideo ? (
                <video
                  ref={mediaRef as React.RefObject<HTMLVideoElement>}
                  src={objectUrl}
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={handleLoadedMetadata}
                  onTimeUpdate={handleTimeUpdate}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onClick={togglePlayback}
                  className="w-full max-h-[380px] aspect-video object-contain cursor-pointer"
                />
              ) : (
                <div className="py-12 px-6 flex flex-col items-center justify-center text-center gap-3">
                  <div className="w-16 h-16 rounded-2xl bg-[#E03E2D]/15 text-[#E03E2D] flex items-center justify-center">
                    <Music className="w-8 h-8" />
                  </div>
                  <div className="max-w-md">
                    <p className="text-base font-semibold text-white truncate">{source.title}</p>
                    <p className="text-xs text-neutral-400 font-mono tabular-nums mt-1">
                      {formatTimecode(currentTime, true)} / {formatTimecode(duration, true)}
                    </p>
                  </div>
                  <audio
                    ref={mediaRef as React.RefObject<HTMLAudioElement>}
                    src={objectUrl}
                    preload="metadata"
                    onLoadedMetadata={handleLoadedMetadata}
                    onTimeUpdate={handleTimeUpdate}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                  />
                </div>
              )}
            </div>

            {/* Transport Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={togglePlayback}
                  aria-label={isPlaying ? 'Pause preview' : 'Play selected segment'}
                  className="min-w-[48px] min-h-[48px] px-4 rounded-xl bg-[#E03E2D] hover:bg-[#C93222] text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  <span>{isPlaying ? 'Pause' : 'Preview Cut'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => seekTo(startTime)}
                  aria-label="Jump to start point"
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-[#F7F7F5] dark:bg-[#1C1F24] border border-black/8 dark:border-white/10 text-[#141517] dark:text-[#F3F4F6] hover:border-[#E03E2D] transition-colors"
                >
                  <SkipBack className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setLoopSelection((v) => !v)}
                  aria-pressed={loopSelection}
                  className={`min-h-[44px] px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                    loopSelection
                      ? 'bg-[#141517] text-white border-[#141517] dark:bg-[#F3F4F6] dark:text-[#141517] dark:border-[#F3F4F6]'
                      : 'bg-transparent text-neutral-600 dark:text-neutral-400 border-black/10 dark:border-white/10'
                  }`}
                >
                  <Repeat className="w-3.5 h-3.5" />
                  <span>Loop Cut</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleMarkIn}
                  className="min-h-[40px] px-3 rounded-xl bg-[#F7F7F5] dark:bg-[#1C1F24] border border-black/8 dark:border-white/10 text-xs font-medium text-[#141517] dark:text-[#F3F4F6] hover:border-[#E03E2D] whitespace-nowrap shrink-0"
                >
                  Set In Here
                </button>
                <button
                  type="button"
                  onClick={handleMarkOut}
                  className="min-h-[40px] px-3 rounded-xl bg-[#F7F7F5] dark:bg-[#1C1F24] border border-black/8 dark:border-white/10 text-xs font-medium text-[#141517] dark:text-[#F3F4F6] hover:border-[#E03E2D] whitespace-nowrap shrink-0"
                >
                  Set Out Here
                </button>
              </div>
            </div>

            {/* Dual-Handle Waveform Timeline */}
            <div className="pt-2 border-t border-black/8 dark:border-white/10">
              {loadingPeaks && (
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
                  Analyzing audio waveform...
                </p>
              )}
              <DualRangeTimeline
                duration={duration}
                startTime={startTime}
                endTime={endTime}
                currentTime={currentTime}
                peaks={peaks}
                onChangeRange={(s, e) => {
                  setStartTime(s);
                  setEndTime(e);
                }}
                onSeek={seekTo}
              />
            </div>
          </div>

          {/* Right: Export & Mastering Settings */}
          <div className="lg:col-span-5 rounded-3xl bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 p-5 sm:p-6 space-y-5">
            <div>
              <label
                htmlFor="trim-clip-title"
                className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5"
              >
                Export filename
              </label>
              <input
                id="trim-clip-title"
                type="text"
                value={clipTitle}
                onChange={(e) => setClipTitle(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#F7F7F5] dark:bg-[#0E0F11] border border-black/10 dark:border-white/12 text-sm text-[#141517] dark:text-[#F3F4F6] focus:outline-none focus:border-[#E03E2D]"
              />
            </div>

            {/* Output Type Toggle */}
            {source.hasVideo && (
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-[#F2F2EF] dark:bg-[#0E0F11]">
                <button
                  type="button"
                  onClick={() => setOutputMode('video')}
                  className={`min-h-[44px] flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    outputMode === 'video'
                      ? 'bg-white dark:bg-[#1C1F24] text-[#141517] dark:text-white shadow-sm'
                      : 'text-neutral-600 dark:text-neutral-400'
                  }`}
                >
                  <Film className="w-4 h-4" />
                  <span>Keep Video</span>
                </button>
                <button
                  type="button"
                  onClick={() => setOutputMode('audio')}
                  className={`min-h-[44px] flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    outputMode === 'audio'
                      ? 'bg-white dark:bg-[#1C1F24] text-[#141517] dark:text-white shadow-sm'
                      : 'text-neutral-600 dark:text-neutral-400'
                  }`}
                >
                  <Music className="w-4 h-4" />
                  <span>Extract Audio</span>
                </button>
              </div>
            )}

            {/* Format */}
            <div>
              <span className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">
                Format
              </span>
              <div className="flex flex-wrap gap-2">
                {(outputMode === 'video' ? VIDEO_FORMATS : AUDIO_FORMATS).map((fmt) => {
                  const active = (outputMode === 'video' ? videoFormat : audioFormat) === fmt;
                  return (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() =>
                        outputMode === 'video'
                          ? setVideoFormat(fmt as VideoFormat)
                          : setAudioFormat(fmt as AudioFormat)
                      }
                      className={`min-h-[40px] px-4 rounded-xl text-xs font-mono font-semibold uppercase border transition-colors whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-[#141517] text-white border-[#141517] dark:bg-[#F3F4F6] dark:text-[#141517] dark:border-[#F3F4F6]'
                          : 'bg-transparent text-neutral-700 dark:text-neutral-300 border-black/10 dark:border-white/12 hover:border-[#141517]'
                      }`}
                    >
                      {fmt}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quality Preset */}
            {outputMode === 'video' ? (
              <div className="space-y-4">
                <div>
                  <span className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">
                    Output resolution
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {VIDEO_RESOLUTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setResolution(opt.value)}
                        className={`min-h-[40px] px-3.5 rounded-xl text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                          resolution === opt.value
                            ? 'border-[#E03E2D] bg-[#E03E2D]/10 text-[#C93222] dark:text-[#FF8A7D]'
                            : 'border-black/10 dark:border-white/12 text-neutral-700 dark:text-neutral-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">
                    Frame rate
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        { value: 'auto', label: 'Original' },
                        { value: '60', label: '60 fps' },
                        { value: '30', label: '30 fps' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setFps(opt.value)}
                        className={`min-h-[40px] px-3.5 rounded-xl text-xs font-mono font-medium border transition-colors whitespace-nowrap shrink-0 ${
                          fps === opt.value
                            ? 'border-[#E03E2D] bg-[#E03E2D]/10 text-[#C93222] dark:text-[#FF8A7D]'
                            : 'border-black/10 dark:border-white/12 text-neutral-700 dark:text-neutral-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <span className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">
                  Audio bitrate
                </span>
                <div className="flex flex-wrap gap-2">
                  {AUDIO_BITRATES.map((br) => (
                    <button
                      key={br}
                      type="button"
                      disabled={audioFormat === 'wav' || audioFormat === 'flac'}
                      onClick={() => setBitrate(br)}
                      className={`min-h-[40px] px-3.5 rounded-xl text-xs font-mono font-medium border transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 ${
                        bitrate === br
                          ? 'border-[#E03E2D] bg-[#E03E2D]/10 text-[#C93222] dark:text-[#FF8A7D]'
                          : 'border-black/10 dark:border-white/12 text-neutral-700 dark:text-neutral-300'
                      }`}
                    >
                      {br.replace('k', ' kbps')}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Fades & Loudness */}
            <div className="pt-4 border-t border-black/8 dark:border-white/10 space-y-3">
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
                  Normalize audio loudness
                </span>
                <input
                  type="checkbox"
                  checked={normalize}
                  onChange={(e) => setNormalize(e.target.checked)}
                  className="w-4 h-4 accent-[#E03E2D]"
                />
              </label>
            </div>

            {/* Export Button */}
            <div className="pt-2 space-y-3">
              <button
                type="button"
                disabled={exporting || duration <= 0}
                onClick={handleExportCut}
                className="w-full min-h-[52px] px-5 rounded-2xl bg-[#E03E2D] hover:bg-[#C93222] disabled:opacity-60 text-white font-semibold text-sm sm:text-base flex items-center justify-center gap-2.5 transition-colors active:scale-[0.99]"
              >
                {exporting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Cutting &amp; Exporting...</span>
                  </>
                ) : (
                  <>
                    <Scissors className="w-5 h-5" />
                    <span>
                      Export Cut ({formatTimecode(Math.max(0, endTime - startTime))})
                    </span>
                  </>
                )}
              </button>

              {!isOnline && outputMode === 'audio' && (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Offline mode active: audio cuts export directly on-device as uncompressed WAV.
                </p>
              )}

              {exportError && (
                <div className="p-3.5 rounded-2xl bg-[#E03E2D]/8 border border-[#E03E2D]/25 flex items-start gap-2.5 text-xs text-[#B5291B] dark:text-[#FF8A7D]" role="alert">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{exportError}</span>
                </div>
              )}

              {exportedItem && (
                <div className="p-4 rounded-2xl bg-emerald-600/10 border border-emerald-600/25 flex items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5 text-xs text-emerald-800 dark:text-emerald-300 min-w-0">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-semibold truncate">Cut exported &amp; saved offline</p>
                      <p className="font-mono tabular-nums mt-0.5 opacity-85">
                        {exportedItem.format} · {formatTimecode(exportedItem.durationSeconds)} · {formatBytes(exportedItem.sizeBytes)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      triggerBrowserDownload(
                        exportedItem.blob,
                        `${sanitizeFileTitle(exportedItem.title)}.${exportedItem.format.toLowerCase()}`
                      )
                    }
                    className="min-h-[40px] px-3 rounded-xl bg-[#141517] dark:bg-[#F3F4F6] text-white dark:text-[#141517] text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Save Again</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-3xl bg-white dark:bg-[#16181C] border border-dashed border-black/15 dark:border-white/15 p-10 sm:p-14 text-center flex flex-col items-center justify-center">
          <div className="w-14 h-14 rounded-2xl bg-[#F2F2EF] dark:bg-[#1C1F24] flex items-center justify-center text-[#141517] dark:text-[#F3F4F6]">
            <FolderOpen className="w-7 h-7" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-[#141517] dark:text-[#F3F4F6]">
            Load a video or audio file to start cutting
          </h2>
          <p className="mt-1.5 max-w-md text-sm text-neutral-500 dark:text-neutral-400">
            Select any video or audio track from your Android device, or pick a saved download from your Offline Library above.
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-6 inline-flex items-center gap-2 px-5 py-3 min-h-[48px] rounded-2xl bg-[#E03E2D] hover:bg-[#C93222] text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-4 h-4" />
            <span>Choose Video or Audio</span>
          </button>
        </section>
      )}
    </div>
  );
};
