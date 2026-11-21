import React, { useEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { formatTimecode, parseTimecode } from '../lib/formatters';

interface DualRangeTimelineProps {
  duration: number;
  startTime: number;
  endTime: number;
  currentTime?: number;
  peaks?: number[];
  onChangeRange: (start: number, end: number) => void;
  onSeek?: (time: number) => void;
  disabled?: boolean;
}

export const DualRangeTimeline: React.FC<DualRangeTimelineProps> = ({
  duration,
  startTime,
  endTime,
  currentTime,
  peaks = [],
  onChangeRange,
  onSeek,
  disabled = false,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | 'playhead' | null>(null);
  const [startInput, setStartInput] = useState(formatTimecode(startTime, true));
  const [endInput, setEndInput] = useState(formatTimecode(endTime, true));

  const safeDuration = Math.max(duration, 1);
  const minGap = Math.min(0.5, safeDuration * 0.05);

  useEffect(() => {
    setStartInput(formatTimecode(startTime, true));
  }, [startTime]);

  useEffect(() => {
    setEndInput(formatTimecode(endTime, true));
  }, [endTime]);

  const clientXToTime = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * safeDuration;
  };

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: PointerEvent) => {
      const t = clientXToTime(e.clientX);
      if (dragging === 'start') {
        const nextStart = Math.max(0, Math.min(t, endTime - minGap));
        onChangeRange(Number(nextStart.toFixed(2)), endTime);
      } else if (dragging === 'end') {
        const nextEnd = Math.min(safeDuration, Math.max(t, startTime + minGap));
        onChangeRange(startTime, Number(nextEnd.toFixed(2)));
      } else if (dragging === 'playhead' && onSeek) {
        onSeek(Math.max(0, Math.min(safeDuration, t)));
      }
    };

    const handleUp = () => setDragging(null);

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [dragging, endTime, minGap, onChangeRange, onSeek, safeDuration, startTime]);

  const startPct = (Math.max(0, Math.min(startTime, safeDuration)) / safeDuration) * 100;
  const endPct = (Math.max(0, Math.min(endTime, safeDuration)) / safeDuration) * 100;
  const playheadPct =
    typeof currentTime === 'number'
      ? (Math.max(0, Math.min(currentTime, safeDuration)) / safeDuration) * 100
      : null;

  const displayBars =
    peaks.length > 0
      ? peaks
      : Array.from({ length: 72 }, (_, idx) => {
          const v = Math.sin(idx * 0.34) * 0.25 + Math.cos(idx * 0.14) * 0.2 + 0.52;
          return Math.max(0.15, Math.min(0.95, v));
        });

  const nudgeStart = (delta: number) => {
    const next = Math.max(0, Math.min(startTime + delta, endTime - minGap));
    onChangeRange(Number(next.toFixed(2)), endTime);
    if (onSeek) onSeek(next);
  };

  const nudgeEnd = (delta: number) => {
    const next = Math.min(safeDuration, Math.max(endTime + delta, startTime + minGap));
    onChangeRange(startTime, Number(next.toFixed(2)));
  };

  const commitStartInput = () => {
    const parsed = parseTimecode(startInput);
    if (parsed === null) {
      setStartInput(formatTimecode(startTime, true));
      return;
    }
    const clamped = Math.max(0, Math.min(parsed, endTime - minGap));
    onChangeRange(Number(clamped.toFixed(2)), endTime);
  };

  const commitEndInput = () => {
    const parsed = parseTimecode(endInput);
    if (parsed === null) {
      setEndInput(formatTimecode(endTime, true));
      return;
    }
    const clamped = Math.min(safeDuration, Math.max(parsed, startTime + minGap));
    onChangeRange(startTime, Number(clamped.toFixed(2)));
  };

  const selectedDuration = Math.max(0, endTime - startTime);

  return (
    <div className={`space-y-4 ${disabled ? 'opacity-60 pointer-events-none' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <div className="flex items-center gap-2 font-mono tabular-nums">
          <span className="text-[#141517] dark:text-[#F3F4F6] font-medium">
            Selected: {formatTimecode(selectedDuration, true)}
          </span>
          <span aria-hidden="true">·</span>
          <span>Total: {formatTimecode(safeDuration, true)}</span>
        </div>
        <button
          type="button"
          onClick={() => onChangeRange(0, safeDuration)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:text-[#E03E2D] dark:hover:text-[#E03E2D] transition-colors min-h-[36px] px-2 whitespace-nowrap shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Full</span>
        </button>
      </div>

      {/* Interactive Waveform Track */}
      <div
        ref={trackRef}
        onPointerDown={(e) => {
          if (disabled) return;
          const target = e.target as HTMLElement;
          if (target.dataset.handle === 'start' || target.dataset.handle === 'end') return;
          const clickedTime = clientXToTime(e.clientX);
          if (onSeek) {
            onSeek(clickedTime);
            setDragging('playhead');
          }
        }}
        className="relative h-24 sm:h-28 rounded-2xl bg-[#EFEFED] dark:bg-[#1C1F24] border border-black/8 dark:border-white/10 select-none touch-none overflow-hidden cursor-pointer"
      >
        {/* Waveform Bars */}
        <div className="absolute inset-0 flex items-center gap-[2px] px-2 py-4 pointer-events-none">
          {displayBars.map((amp, i) => {
            const barPct = ((i + 0.5) / displayBars.length) * 100;
            const inRange = barPct >= startPct && barPct <= endPct;
            return (
              <div
                key={i}
                className={`flex-1 rounded-full transition-colors duration-100 ${
                  inRange
                    ? 'bg-[#141517] dark:bg-[#F3F4F6]'
                    : 'bg-neutral-400/45 dark:bg-neutral-600/50'
                }`}
                style={{ height: `${Math.round(amp * 100)}%` }}
              />
            );
          })}
        </div>

        {/* Out-of-range subtle shade masks */}
        <div
          className="absolute inset-y-0 left-0 bg-black/12 dark:bg-black/45 pointer-events-none"
          style={{ width: `${startPct}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-black/12 dark:bg-black/45 pointer-events-none"
          style={{ width: `${Math.max(0, 100 - endPct)}%` }}
        />

        {/* Selected Segment Top & Bottom Frame */}
        <div
          className="absolute inset-y-0 border-y-[3px] border-[#E03E2D] pointer-events-none"
          style={{
            left: `${startPct}%`,
            width: `${Math.max(0, endPct - startPct)}%`,
          }}
        />

        {/* Live Playhead */}
        {playheadPct !== null && (
          <div
            className="absolute inset-y-0 w-0.5 bg-[#E03E2D] pointer-events-none z-10"
            style={{ left: `${playheadPct}%` }}
          >
            <div className="w-2.5 h-2.5 rounded-full bg-[#E03E2D] -ml-[4px] -mt-0.5 shadow-sm" />
          </div>
        )}

        {/* Start (In) Drag Handle with 44px touch hitbox */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Trim start time"
          aria-valuemin={0}
          aria-valuemax={Math.round(endTime)}
          aria-valuenow={Math.round(startTime)}
          data-handle="start"
          onPointerDown={(e) => {
            e.stopPropagation();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            setDragging('start');
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') nudgeStart(-0.5);
            if (e.key === 'ArrowRight') nudgeStart(0.5);
          }}
          className="absolute inset-y-0 z-20 flex items-center justify-center w-11 -ml-5 cursor-ew-resize focus-visible:outline-none group"
          style={{ left: `${startPct}%` }}
        >
          <div className="w-3.5 h-full bg-[#E03E2D] rounded-l-md flex flex-col items-center justify-center gap-1 shadow-md group-hover:bg-[#C93222] transition-colors">
            <span className="w-0.5 h-5 bg-white/90 rounded-full" />
          </div>
        </div>

        {/* End (Out) Drag Handle with 44px touch hitbox */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Trim end time"
          aria-valuemin={Math.round(startTime)}
          aria-valuemax={Math.round(safeDuration)}
          aria-valuenow={Math.round(endTime)}
          data-handle="end"
          onPointerDown={(e) => {
            e.stopPropagation();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            setDragging('end');
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') nudgeEnd(-0.5);
            if (e.key === 'ArrowRight') nudgeEnd(0.5);
          }}
          className="absolute inset-y-0 z-20 flex items-center justify-center w-11 -ml-6 cursor-ew-resize focus-visible:outline-none group"
          style={{ left: `${endPct}%` }}
        >
          <div className="w-3.5 h-full bg-[#E03E2D] rounded-r-md flex flex-col items-center justify-center gap-1 shadow-md group-hover:bg-[#C93222] transition-colors">
            <span className="w-0.5 h-5 bg-white/90 rounded-full" />
          </div>
        </div>
      </div>

      {/* Precision Timecode Inputs & Fine Nudge Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#F7F7F5] dark:bg-[#1C1F24] border border-black/8 dark:border-white/10">
          <div className="min-w-0">
            <label className="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
              Start Point (In)
            </label>
            <input
              type="text"
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
              onBlur={commitStartInput}
              onKeyDown={(e) => e.key === 'Enter' && commitStartInput()}
              aria-label="Start timecode"
              className="w-24 bg-transparent font-mono text-sm font-semibold tabular-nums text-[#141517] dark:text-[#F3F4F6] focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => nudgeStart(-0.5)}
              aria-label="Decrease start time by 0.5 seconds"
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 text-[#141517] dark:text-[#F3F4F6] hover:border-[#E03E2D] transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => nudgeStart(0.5)}
              aria-label="Increase start time by 0.5 seconds"
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 text-[#141517] dark:text-[#F3F4F6] hover:border-[#E03E2D] transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#F7F7F5] dark:bg-[#1C1F24] border border-black/8 dark:border-white/10">
          <div className="min-w-0">
            <label className="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
              End Point (Out)
            </label>
            <input
              type="text"
              value={endInput}
              onChange={(e) => setEndInput(e.target.value)}
              onBlur={commitEndInput}
              onKeyDown={(e) => e.key === 'Enter' && commitEndInput()}
              aria-label="End timecode"
              className="w-24 bg-transparent font-mono text-sm font-semibold tabular-nums text-[#141517] dark:text-[#F3F4F6] focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => nudgeEnd(-0.5)}
              aria-label="Decrease end time by 0.5 seconds"
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 text-[#141517] dark:text-[#F3F4F6] hover:border-[#E03E2D] transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => nudgeEnd(0.5)}
              aria-label="Increase end time by 0.5 seconds"
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg bg-white dark:bg-[#16181C] border border-black/8 dark:border-white/10 text-[#141517] dark:text-[#F3F4F6] hover:border-[#E03E2D] transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
