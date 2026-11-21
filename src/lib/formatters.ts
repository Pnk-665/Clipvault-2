export function formatTimecode(seconds: number, includeTenths = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return includeTenths ? '00:00.0' : '00:00';
  }
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);

  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const base = hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
  return includeTenths ? `${base}.${tenths}` : base;
}

export function parseTimecode(input: string): number | null {
  const cleaned = input.trim();
  if (!cleaned) return null;
  const parts = cleaned.split(':').map((p) => parseFloat(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function formatViews(count?: number): string {
  if (!count || !Number.isFinite(count)) return '';
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B views`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M views`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K views`;
  return `${count} views`;
}

export function formatSavedDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function sanitizeFileTitle(title: string): string {
  return title.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'clipvault-export';
}
