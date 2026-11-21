import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Film,
  HardDrive,
  Music,
  Play,
  Scissors,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { OfflineMediaItem } from '../types/media';
import {
  formatBytes,
  formatSavedDate,
  formatTimecode,
  sanitizeFileTitle,
  triggerBrowserDownload,
} from '../lib/formatters';

interface OfflineLibraryProps {
  items: OfflineMediaItem[];
  onDeleteItem: (id: string) => Promise<void>;
  onTrimItem: (item: OfflineMediaItem) => void;
  onGoToDownload: () => void;
}

type LibraryFilter = 'all' | 'video' | 'audio' | 'trimmed';

const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 2];

const LibraryRowThumb: React.FC<{ item: OfflineMediaItem }> = ({ item }) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!item.thumbnailBlob) {
      setUrl(null);
      return;
    }
    const objUrl = URL.createObjectURL(item.thumbnailBlob);
    setUrl(objUrl);
    return () => URL.revokeObjectURL(objUrl);
  }, [item.id, item.thumbnailBlob]);

  if (url) {
    return (
      <img
        src={url}
        alt={item.title}
        referrerPolicy="no-referrer"
        className="w-24 sm:w-28 aspect-video rounded-xl object-cover bg-[#141517] shrink-0"
      />
    );
  }

  return (
    <div className="w-24 sm:w-28 aspect-video rounded-xl bg-[#141517] text-white/80 flex items-center justify-center shrink-0">
      {item.mode === 'video' ? <Film className="w-5 h-5" /> : <Music className="w-5 h-5 text-[#E03E2D]" />}
    </div>
  );
};

export const OfflineLibrary: React.FC<OfflineLibraryProps> = ({
  items,
  onDeleteItem,
  onTrimItem,
  onGoToDownload,
}) => {
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [query, setQuery] = useState('');
  const [playingItem, setPlayingItem] = useState<OfflineMediaItem | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const playerRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!playingItem) {
      setPlayingUrl(null);
      return;
    }
    const url = URL.createObjectURL(playingItem.blob);
    setPlayingUrl(url);
    setPlaybackSpeed(1);
    return () => URL.revokeObjectURL(url);
  }, [playingItem?.id]);

  useEffect(() => {
    if (playerRef.current) {
      playerRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, playingUrl]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === 'video' && item.mode !== 'video') return false;
      if (filter === 'audio' && item.mode !== 'audio') return false;
      if (filter === 'trimmed' && !item.isTrimmed) return false;
      if (q && !item.title.toLowerCase().includes(q) && !item.author.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [filter, items, query]);

  const totalBytes = useMemo(() => items.reduce((sum, i) => sum + i.sizeBytes, 0), [items]);

  return (
    <div className="space-y-6">
      {/* Header & Filter Bar */}
      <section className="rounded-3xl bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#141517] dark:text-[#F3F4F6]">
              Offline Library
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 font-mono tabular-nums">
              <span className="font-sans">{items.length} saved {items.length === 1 ? 'item' : 'items'}</span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(totalBytes)} stored locally</span>
            </div>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search saved media..."
              aria-label="Search saved media"
              className="w-full min-h-[44px] pl-10 pr-3.5 rounded-xl bg-[#F7F7F5] dark:bg-[#0E0F11] border border-black/8 dark:border-white/10 text-sm text-[#141517] dark:text-[#F3F4F6] focus:outline-none focus:border-[#E03E2D]"
            />
          </div>
        </div>

        {/* Interactive Filter Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-[#F2F2EF] dark:bg-[#0E0F11] w-full sm:w-fit overflow-x-auto">
          {(
            [
              { id: 'all', label: 'All Saved' },
              { id: 'video', label: 'Videos' },
              { id: 'audio', label: 'Audio' },
              { id: 'trimmed', label: 'Trimmed Cuts' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`min-h-[40px] px-4 rounded-xl text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                filter === tab.id
                  ? 'bg-white dark:bg-[#1C1F24] text-[#141517] dark:text-white shadow-sm'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-[#141517] dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {/* Media List */}
      {filteredItems.length > 0 ? (
        <section className="rounded-3xl bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 divide-y divide-black/6 dark:divide-white/8 overflow-hidden">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-[#FAF9F7] dark:hover:bg-[#1C1F24]/70 transition-colors"
            >
              <button
                type="button"
                onClick={() => setPlayingItem(item)}
                className="flex items-center gap-4 text-left min-w-0 flex-1 group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E03E2D] rounded-xl"
              >
                <div className="relative shrink-0">
                  <LibraryRowThumb item={item} />
                  <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 group-hover:bg-black/35 transition-colors">
                    <Play className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm sm:text-base font-semibold text-[#141517] dark:text-[#F3F4F6] truncate group-hover:text-[#E03E2D] transition-colors">
                    {item.title}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-500 dark:text-neutral-400 font-mono tabular-nums">
                    <span className="font-sans text-neutral-600 dark:text-neutral-300">{item.author}</span>
                    <span aria-hidden="true">·</span>
                    <span>{item.resolution}</span>
                    <span aria-hidden="true">·</span>
                    <span>{item.format}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatTimecode(item.durationSeconds)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatBytes(item.sizeBytes)}</span>
                    {item.isTrimmed && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-sans text-[#E03E2D] font-medium">Trimmed</span>
                      </>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">
                    Saved {formatSavedDate(item.createdAt)}
                  </p>
                </div>
              </button>

              <div className="flex items-center gap-1.5 sm:shrink-0 self-end sm:self-center">
                <button
                  type="button"
                  onClick={() => setPlayingItem(item)}
                  aria-label={`Play ${item.title}`}
                  className="min-h-[44px] px-3.5 rounded-xl bg-[#141517] dark:bg-[#F3F4F6] text-white dark:text-[#141517] text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Play</span>
                </button>
                <button
                  type="button"
                  onClick={() => onTrimItem(item)}
                  aria-label={`Trim ${item.title}`}
                  className="min-w-[44px] min-h-[44px] px-3 rounded-xl bg-[#F7F7F5] dark:bg-[#0E0F11] border border-black/8 dark:border-white/10 text-[#141517] dark:text-[#F3F4F6] hover:border-[#E03E2D] text-xs font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Scissors className="w-4 h-4" />
                  <span className="hidden md:inline">Trim</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    triggerBrowserDownload(
                      item.blob,
                      `${sanitizeFileTitle(item.title)}.${item.format.toLowerCase()}`
                    )
                  }
                  aria-label={`Download ${item.title} to device`}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-[#F7F7F5] dark:bg-[#0E0F11] border border-black/8 dark:border-white/10 text-[#141517] dark:text-[#F3F4F6] hover:border-[#E03E2D] transition-colors"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (playingItem?.id === item.id) setPlayingItem(null);
                    onDeleteItem(item.id);
                  }}
                  aria-label={`Delete ${item.title}`}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-[#F7F7F5] dark:bg-[#0E0F11] border border-black/8 dark:border-white/10 text-neutral-500 hover:text-[#E03E2D] hover:border-[#E03E2D] transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : (
        <section className="rounded-3xl bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 p-10 sm:p-14 text-center flex flex-col items-center">
          <div className="w-14 h-14 rounded-2xl bg-[#F2F2EF] dark:bg-[#1C1F24] flex items-center justify-center text-[#141517] dark:text-[#F3F4F6]">
            <HardDrive className="w-7 h-7" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-[#141517] dark:text-[#F3F4F6]">
            {items.length === 0 ? 'Your offline library is empty' : 'No matching saved items'}
          </h2>
          <p className="mt-1.5 max-w-md text-sm text-neutral-500 dark:text-neutral-400">
            {items.length === 0
              ? 'Videos, audio tracks, and trimmed clips you save appear here for 100% ad-free offline playback on Android.'
              : 'Try clearing your search or switching the category filter above.'}
          </p>
          {items.length === 0 && (
            <button
              type="button"
              onClick={onGoToDownload}
              className="mt-6 min-h-[48px] px-5 rounded-2xl bg-[#E03E2D] hover:bg-[#C93222] text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              Download First Video
            </button>
          )}
        </section>
      )}

      {/* Offline Media Player Modal */}
      {playingItem && playingUrl && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Playing ${playingItem.title}`}
          onClick={() => setPlayingItem(null)}
        >
          <div
            className="w-full sm:max-w-3xl rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#16181C] border border-black/10 dark:border-white/12 overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-black/8 dark:border-white/10">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-[#141517] dark:text-[#F3F4F6] truncate">
                  {playingItem.title}
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 font-mono tabular-nums">
                  {playingItem.resolution} · {playingItem.format} · {formatBytes(playingItem.sizeBytes)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlayingItem(null)}
                aria-label="Close player"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-neutral-500 hover:text-[#141517] dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-[#0E0F11]">
              {playingItem.mode === 'video' ? (
                <video
                  ref={playerRef as React.RefObject<HTMLVideoElement>}
                  src={playingUrl}
                  controls
                  autoPlay
                  playsInline
                  className="w-full max-h-[60vh] aspect-video"
                />
              ) : (
                <div className="p-8 sm:p-10 flex flex-col items-center gap-5">
                  <div className="w-20 h-20 rounded-3xl bg-[#E03E2D]/15 text-[#E03E2D] flex items-center justify-center">
                    <Music className="w-10 h-10" />
                  </div>
                  <audio
                    ref={playerRef as React.RefObject<HTMLAudioElement>}
                    src={playingUrl}
                    controls
                    autoPlay
                    className="w-full max-w-lg"
                  />
                </div>
              )}
            </div>

            <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#16181C]">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-neutral-500 dark:text-neutral-400 mr-1">Speed</span>
                {PLAYBACK_SPEEDS.map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => setPlaybackSpeed(spd)}
                    className={`min-h-[36px] px-2.5 rounded-lg text-xs font-mono font-medium transition-colors whitespace-nowrap shrink-0 ${
                      playbackSpeed === spd
                        ? 'bg-[#141517] text-white dark:bg-[#F3F4F6] dark:text-[#141517]'
                        : 'text-neutral-600 dark:text-neutral-400 hover:bg-black/5 dark:hover:bg-white/10'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const target = playingItem;
                    setPlayingItem(null);
                    onTrimItem(target);
                  }}
                  className="min-h-[42px] px-3.5 rounded-xl border border-black/10 dark:border-white/12 text-xs font-medium text-[#141517] dark:text-[#F3F4F6] hover:border-[#E03E2D] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Scissors className="w-3.5 h-3.5" />
                  <span>Trim Segment</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    triggerBrowserDownload(
                      playingItem.blob,
                      `${sanitizeFileTitle(playingItem.title)}.${playingItem.format.toLowerCase()}`
                    )
                  }
                  className="min-h-[42px] px-3.5 rounded-xl bg-[#E03E2D] hover:bg-[#C93222] text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Save to Device</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
