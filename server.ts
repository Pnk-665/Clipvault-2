import express from 'express';
import http from 'http';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';
import multer from 'multer';
import { Innertube, UniversalCache } from 'youtubei.js';
import type { Readable } from 'stream';
import { buildAndroidApkProjectZip } from './server-android-apk.ts';

interface YtdlFormat {
  hasVideo?: boolean;
  height?: number;
  bitrate?: number;
  fps?: number;
  contentLength?: string;
}

interface YtdlVideoInfo {
  videoDetails: {
    title: string;
    lengthSeconds: string;
    author?: { name?: string };
    thumbnails: Array<{ url: string }>;
    viewCount?: string;
    uploadDate?: string;
  };
  formats: YtdlFormat[];
}

interface YtdlModule {
  (url: string, options?: { quality?: string; filter?: string }): Readable;
  getInfo: (url: string) => Promise<YtdlVideoInfo>;
}

const require = createRequire(import.meta.url);
const ytdl = require('@distube/ytdl-core') as YtdlModule;

const execFileAsync = promisify(execFile);
const PORT = 3000;
const TEMP_DIR = path.join(os.tmpdir(), 'clipvault-media');
fs.mkdirSync(TEMP_DIR, { recursive: true });

const upload = multer({
  dest: TEMP_DIR,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit for local/offline video trimming
  },
});

interface FormatOption {
  id: string;
  label: string;
  resolution: string;
  height?: number;
  container: string;
  bitrate?: string;
  fps?: number;
  estimatedBytes?: number;
  type: 'video' | 'audio';
  codec?: string;
}

interface VideoInfoResponse {
  videoId: string;
  url: string;
  title: string;
  author: string;
  durationSeconds: number;
  thumbnail: string;
  viewCount?: number;
  uploadDate?: string;
  videoFormats: FormatOption[];
  audioFormats: FormatOption[];
  sourceEngine: string;
  streamDirectAvailable: boolean;
}

function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const host = parsed.hostname.replace(/^www\./, '').replace(/^m\./, '');
    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
      const v = parsed.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (['shorts', 'embed', 'live', 'v'].includes(parts[0]) && parts[1] && /^[a-zA-Z0-9_-]{11}$/.test(parts[1])) {
        return parts[1];
      }
    }
  } catch {
    return null;
  }
  return null;
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || 'clipvault-media';
}

function buildDefaultVideoFormats(durationSec: number, maxHeight = 2160): FormatOption[] {
  const presets = [
    { height: 2160, fps: 60, label: '2160p 4K · 60 fps', bitrateKbps: 22000 },
    { height: 1440, fps: 60, label: '1440p QHD · 60 fps', bitrateKbps: 13000 },
    { height: 1080, fps: 60, label: '1080p Full HD · 60 fps', bitrateKbps: 7200 },
    { height: 1080, fps: 30, label: '1080p Full HD', bitrateKbps: 4800 },
    { height: 720, fps: 60, label: '720p HD · 60 fps', bitrateKbps: 4000 },
    { height: 720, fps: 30, label: '720p HD', bitrateKbps: 2500 },
    { height: 480, fps: 30, label: '480p SD', bitrateKbps: 1100 },
    { height: 360, fps: 30, label: '360p Compact', bitrateKbps: 650 },
  ];
  return presets
    .filter((p) => p.height <= maxHeight)
    .map((p) => ({
      id: `v-${p.height}-${p.fps}`,
      label: p.label,
      resolution: `${p.height}p`,
      height: p.height,
      container: 'mp4',
      bitrate: `${Math.round(p.bitrateKbps / 100) / 10} Mbps`,
      fps: p.fps,
      estimatedBytes: Math.round(((p.bitrateKbps * 1000) / 8) * Math.max(durationSec, 15)),
      type: 'video',
      codec: 'H.264 + AAC',
    }));
}

function buildDefaultAudioFormats(durationSec: number): FormatOption[] {
  const presets = [
    { id: 'a-mp3-320', label: 'MP3 Studio', container: 'mp3', bitrate: '320 kbps', kbps: 320, codec: 'LAME MP3' },
    { id: 'a-m4a-256', label: 'M4A High', container: 'm4a', bitrate: '256 kbps', kbps: 256, codec: 'AAC-LC' },
    { id: 'a-mp3-192', label: 'MP3 Balanced', container: 'mp3', bitrate: '192 kbps', kbps: 192, codec: 'LAME MP3' },
    { id: 'a-ogg-160', label: 'OGG Opus/Vorbis', container: 'ogg', bitrate: '160 kbps', kbps: 160, codec: 'Vorbis' },
    { id: 'a-wav-1411', label: 'WAV Uncompressed', container: 'wav', bitrate: '1411 kbps', kbps: 1411, codec: 'PCM 16-bit' },
    { id: 'a-flac-900', label: 'FLAC Lossless', container: 'flac', bitrate: 'Lossless', kbps: 850, codec: 'FLAC' },
  ];
  return presets.map((p) => ({
    id: p.id,
    label: p.label,
    resolution: p.bitrate,
    container: p.container,
    bitrate: p.bitrate,
    estimatedBytes: Math.round(((p.kbps * 1000) / 8) * Math.max(durationSec, 15)),
    type: 'audio',
    codec: p.codec,
  }));
}

async function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}`));
    });
  });
}

async function probeDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    const parsed = parseFloat(stdout.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

async function fetchVideoInfo(videoId: string): Promise<VideoInfoResponse> {
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Strategy 1: youtubei.js (Innertube)
  try {
    const yt = await Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true,
    });
    const info = await yt.getBasicInfo(videoId);
    const basic = info.basic_info;
    const duration = Number(basic.duration || 0);
    const title = basic.title?.trim();
    const author = basic.author || basic.channel?.name || 'YouTube Creator';
    const thumbs = basic.thumbnail || [];
    const bestThumb = thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    const streaming = info.streaming_data;
    const allFormats = [
      ...(streaming?.formats || []),
      ...(streaming?.adaptive_formats || []),
    ];

    if (!title) {
      throw new Error('Innertube returned empty metadata');
    }

    const seenKeys = new Set<string>();
    const discoveredVideo: FormatOption[] = [];
    for (const fmt of allFormats) {
      if (fmt.has_video && fmt.height) {
        const h = Number(fmt.height);
        const fpsVal = fmt.fps && fmt.fps >= 48 ? 60 : 30;
        const key = `${h}-${fpsVal}`;
        if (!seenKeys.has(key) && h >= 144) {
          seenKeys.add(key);
          const kbps = fmt.bitrate ? Math.round(fmt.bitrate / 1000) : h >= 1080 ? (fpsVal === 60 ? 7200 : 4800) : 2200;
          const baseLabel = h >= 2160 ? '2160p 4K' : h >= 1440 ? '1440p QHD' : h >= 1080 ? '1080p Full HD' : h >= 720 ? '720p HD' : `${h}p`;
          discoveredVideo.push({
            id: `v-${h}-${fpsVal}`,
            label: fpsVal === 60 ? `${baseLabel} · 60 fps` : baseLabel,
            resolution: `${h}p`,
            height: h,
            container: 'mp4',
            bitrate: `${Math.round(kbps / 100) / 10} Mbps`,
            fps: fpsVal,
            estimatedBytes: fmt.content_length ? Number(fmt.content_length) : Math.round(((kbps * 1000) / 8) * Math.max(duration, 15)),
            type: 'video',
            codec: 'H.264 + AAC',
          });
        }
      }
    }

    // Ensure 60fps high-motion export option is always available for 720p/1080p+
    for (const h of [1080, 720]) {
      if (seenKeys.has(`${h}-30`) && !seenKeys.has(`${h}-60`)) {
        const baseLabel = h === 1080 ? '1080p Full HD' : '720p HD';
        const kbps = h === 1080 ? 7200 : 4000;
        discoveredVideo.push({
          id: `v-${h}-60`,
          label: `${baseLabel} · 60 fps`,
          resolution: `${h}p`,
          height: h,
          container: 'mp4',
          bitrate: `${Math.round(kbps / 100) / 10} Mbps`,
          fps: 60,
          estimatedBytes: Math.round(((kbps * 1000) / 8) * Math.max(duration, 15)),
          type: 'video',
          codec: 'H.264 + AAC',
        });
      }
    }

    discoveredVideo.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.fps || 30) - (a.fps || 30));

    return {
      videoId,
      url: canonicalUrl,
      title,
      author,
      durationSeconds: duration,
      thumbnail: bestThumb,
      viewCount: basic.view_count ? Number(basic.view_count) : undefined,
      videoFormats: discoveredVideo.length > 0 ? discoveredVideo : buildDefaultVideoFormats(duration, 2160),
      audioFormats: buildDefaultAudioFormats(duration),
      sourceEngine: 'innertube',
      streamDirectAvailable: allFormats.length > 0,
    };
  } catch (err) {
    console.warn('[youtubei.js info fallback]', (err as Error).message);
  }

  // Strategy 2: @distube/ytdl-core
  try {
    const info = await ytdl.getInfo(canonicalUrl);
    const details = info.videoDetails;
    const duration = parseInt(details.lengthSeconds, 10) || 0;
    const seenKeys = new Set<string>();
    const discoveredVideo: FormatOption[] = [];

    for (const fmt of info.formats) {
      if (fmt.hasVideo && fmt.height) {
        const fpsVal = fmt.fps && fmt.fps >= 48 ? 60 : 30;
        const key = `${fmt.height}-${fpsVal}`;
        if (!seenKeys.has(key) && fmt.height >= 144) {
          seenKeys.add(key);
          const kbps = fmt.bitrate ? Math.round(fmt.bitrate / 1000) : fmt.height >= 1080 ? (fpsVal === 60 ? 7200 : 4800) : 2200;
          const baseLabel = fmt.height >= 2160 ? '2160p 4K' : fmt.height >= 1440 ? '1440p QHD' : fmt.height >= 1080 ? '1080p Full HD' : fmt.height >= 720 ? '720p HD' : `${fmt.height}p`;
          discoveredVideo.push({
            id: `v-${fmt.height}-${fpsVal}`,
            label: fpsVal === 60 ? `${baseLabel} · 60 fps` : baseLabel,
            resolution: `${fmt.height}p`,
            height: fmt.height,
            container: 'mp4',
            bitrate: `${Math.round(kbps / 100) / 10} Mbps`,
            fps: fpsVal,
            estimatedBytes: fmt.contentLength ? parseInt(fmt.contentLength, 10) : Math.round(((kbps * 1000) / 8) * Math.max(duration, 15)),
            type: 'video',
            codec: 'H.264 + AAC',
          });
        }
      }
    }
    discoveredVideo.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.fps || 30) - (a.fps || 30));

    return {
      videoId,
      url: canonicalUrl,
      title: details.title,
      author: details.author?.name || 'YouTube Creator',
      durationSeconds: duration,
      thumbnail: details.thumbnails[details.thumbnails.length - 1]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      viewCount: details.viewCount ? parseInt(details.viewCount, 10) : undefined,
      uploadDate: details.uploadDate,
      videoFormats: discoveredVideo.length > 0 ? discoveredVideo : buildDefaultVideoFormats(duration, 1080),
      audioFormats: buildDefaultAudioFormats(duration),
      sourceEngine: 'ytdl-core',
      streamDirectAvailable: info.formats.length > 0,
    };
  } catch (err) {
    console.warn('[ytdl-core info fallback]', (err as Error).message);
  }

  // Strategy 3: YouTube oEmbed metadata fallback
  const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`);
  if (!oembedRes.ok) {
    throw new Error('Could not find this YouTube video. Verify the link is public and valid.');
  }
  const oembed = (await oembedRes.json()) as {
    title?: string;
    author_name?: string;
    thumbnail_url?: string;
  };

  // Attempt to scrape duration from watch HTML if available
  let durationSeconds = 0;
  try {
    const htmlRes = await fetch(canonicalUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36' },
    });
    const html = await htmlRes.text();
    const match = html.match(/"lengthSeconds":"(\d+)"/);
    if (match) durationSeconds = parseInt(match[1], 10);
  } catch {
    // ignore
  }

  return {
    videoId,
    url: canonicalUrl,
    title: oembed.title || 'YouTube Video',
    author: oembed.author_name || 'YouTube Creator',
    durationSeconds,
    thumbnail: oembed.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    videoFormats: buildDefaultVideoFormats(durationSeconds || 180, 2160),
    audioFormats: buildDefaultAudioFormats(durationSeconds || 180),
    sourceEngine: 'oembed',
    streamDirectAvailable: false,
  };
}

async function downloadYouTubeSourceToDisk(
  videoId: string,
  targetPath: string,
  mode: 'video' | 'audio',
  maxHeight: number,
  clientProfile: string
): Promise<void> {
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const errors: string[] = [];

  // Attempt 1: youtubei.js with Android/TV/Web profiles
  const profiles: Array<'ANDROID' | 'IOS' | 'TV_EMBEDDED' | 'WEB'> =
    clientProfile === 'ios'
      ? ['IOS', 'ANDROID', 'TV_EMBEDDED', 'WEB']
      : clientProfile === 'tv'
        ? ['TV_EMBEDDED', 'ANDROID', 'IOS', 'WEB']
        : ['ANDROID', 'TV_EMBEDDED', 'IOS', 'WEB'];

  for (const clientType of profiles) {
    try {
      const yt = await Innertube.create({
        client_type: clientType as never,
        cache: new UniversalCache(false),
        generate_session_locally: true,
      });
      const stream = await yt.download(videoId, {
        type: mode === 'audio' ? 'audio' : 'video+audio',
        quality: mode === 'audio' ? 'best' : maxHeight <= 360 ? '360p' : maxHeight <= 480 ? '480p' : maxHeight <= 720 ? '720p' : 'best',
        format: 'mp4',
      });

      const writeStream = fs.createWriteStream(targetPath);
      const reader = stream.getReader();
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          writeStream.write(Buffer.from(value));
        }
      }
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        writeStream.end();
      });

      if (totalBytes > 4096) {
        return;
      }
      errors.push(`${clientType}: empty media response`);
    } catch (err) {
      errors.push(`${clientType}: ${(err as Error).message}`);
    }
  }

  // Attempt 2: @distube/ytdl-core
  try {
    await new Promise<void>((resolve, reject) => {
      const readStream = ytdl(canonicalUrl, {
        quality: mode === 'audio' ? 'highestaudio' : 'highest',
        filter: mode === 'audio' ? 'audioonly' : 'audioandvideo',
      });
      const writeStream = fs.createWriteStream(targetPath);
      let bytes = 0;
      readStream.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
      });
      readStream.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('finish', () => {
        if (bytes > 4096) resolve();
        else reject(new Error('Received empty stream from ytdl-core'));
      });
      readStream.pipe(writeStream);
    });
    return;
  } catch (err) {
    errors.push(`ytdl-core: ${(err as Error).message}`);
  }

  throw new Error(
    `YouTube restricted direct server streaming for this video from this cloud IP (${errors[0] || 'bot verification required'}). You can retry with another client profile or import any downloaded file into Trim Studio to cut and convert it with FFmpeg.`
  );
}

function buildFFmpegExportArgs(options: {
  inputPath: string;
  outputPath: string;
  mode: 'video' | 'audio';
  format: string;
  resolution?: string;
  fps?: number;
  bitrate?: string;
  startTime?: number;
  endTime?: number;
  fadeIn?: number;
  fadeOut?: number;
  normalize?: boolean;
}): { args: string[]; mimeType: string; extension: string } {
  const {
    inputPath,
    outputPath,
    mode,
    format,
    resolution,
    fps,
    bitrate = '192k',
    startTime,
    endTime,
    fadeIn = 0,
    fadeOut = 0,
    normalize = false,
  } = options;

  const args: string[] = [];
  const hasStart = typeof startTime === 'number' && startTime > 0;
  const hasEnd = typeof endTime === 'number' && endTime > 0 && (!hasStart || endTime > startTime);
  const clipDuration = hasEnd ? endTime - (hasStart ? startTime : 0) : 0;

  if (hasStart) {
    args.push('-ss', startTime.toFixed(3));
  }
  args.push('-i', inputPath);
  if (hasEnd) {
    args.push('-t', clipDuration.toFixed(3));
  }

  const audioFilters: string[] = [];
  if (normalize) {
    audioFilters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  }
  if (fadeIn > 0) {
    audioFilters.push(`afade=t=in:st=0:d=${Math.min(fadeIn, 10).toFixed(2)}`);
  }
  if (fadeOut > 0 && clipDuration > fadeOut) {
    const fadeStart = Math.max(0, clipDuration - fadeOut);
    audioFilters.push(`afade=t=out:st=${fadeStart.toFixed(2)}:d=${Math.min(fadeOut, 10).toFixed(2)}`);
  }

  if (mode === 'audio') {
    args.push('-vn');
    if (audioFilters.length > 0) {
      args.push('-af', audioFilters.join(','));
    }
    const fmt = format.toLowerCase();
    if (fmt === 'wav') {
      args.push('-c:a', 'pcm_s16le', '-ar', '44100', outputPath);
      return { args, mimeType: 'audio/wav', extension: 'wav' };
    }
    if (fmt === 'flac') {
      args.push('-c:a', 'flac', outputPath);
      return { args, mimeType: 'audio/flac', extension: 'flac' };
    }
    if (fmt === 'm4a') {
      args.push('-c:a', 'aac', '-b:a', bitrate, '-movflags', '+faststart', outputPath);
      return { args, mimeType: 'audio/mp4', extension: 'm4a' };
    }
    if (fmt === 'ogg') {
      args.push('-c:a', 'libvorbis', '-b:a', bitrate, outputPath);
      return { args, mimeType: 'audio/ogg', extension: 'ogg' };
    }
    // Default MP3
    args.push('-c:a', 'libmp3lame', '-b:a', bitrate, '-ar', '44100', outputPath);
    return { args, mimeType: 'audio/mpeg', extension: 'mp3' };
  }

  // Video export
  const heightNum = resolution && resolution !== 'original' ? parseInt(resolution, 10) : 0;
  if (heightNum && [2160, 1440, 1080, 720, 480, 360].includes(heightNum)) {
    args.push('-vf', `scale=-2:'min(${heightNum},ih)'`);
  }
  if (fps && (fps === 60 || fps === 30)) {
    args.push('-r', String(fps), '-vsync', 'cfr');
  }
  if (audioFilters.length > 0) {
    args.push('-af', audioFilters.join(','));
  }

  const fmt = format.toLowerCase();
  if (fmt === 'webm') {
    args.push(
      '-c:v', 'libvpx',
      '-crf', fps === 60 ? '19' : '22',
      '-b:v', fps === 60 ? '4M' : '2M',
      '-deadline', 'realtime',
      '-cpu-used', '4',
      '-c:a', 'libvorbis',
      '-b:a', '160k',
      outputPath
    );
    return { args, mimeType: 'video/webm', extension: 'webm' };
  }

  // Default high-compatibility Android MP4 (H.264 + AAC + faststart)
  args.push(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', fps === 60 ? '18' : '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outputPath
  );
  return { args, mimeType: 'video/mp4', extension: 'mp4' };
}

function safeUnlink(filePath: string) {
  fs.promises.unlink(filePath).catch(() => {});
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Allow PWA manifest, SW, and icons to load cleanly with or without credentials
  app.use((req, res, next) => {
    if (
      req.path === '/manifest.webmanifest' ||
      req.path === '/sw.js' ||
      req.path.startsWith('/pwa-') ||
      req.path === '/icon.svg' ||
      req.path === '/apple-touch-icon.png'
    ) {
      const reqOrigin = req.headers.origin;
      if (reqOrigin) {
        res.setHeader('Access-Control-Allow-Origin', reqOrigin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
      } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
    }
    next();
  });

  // In dev mode, ensure /sw.js returns a valid JS service worker instead of SPA HTML fallback
  if (process.env.NODE_ENV !== 'production') {
    app.get('/sw.js', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Service-Worker-Allowed', '/');
      res.send(`self.addEventListener('install', () => self.skipWaiting());\nself.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));\nself.addEventListener('fetch', () => {});\n`);
    });
  }

  // Health check
  app.get('/api/health', async (_req, res) => {
    let ffmpegVersion = 'unavailable';
    try {
      const { stdout } = await execFileAsync('ffmpeg', ['-version']);
      ffmpegVersion = stdout.split('\n')[0] || 'installed';
    } catch {
      ffmpegVersion = 'unavailable';
    }
    res.json({ ok: true, ffmpeg: ffmpegVersion });
  });

  // Proxy YouTube thumbnail cleanly for offline IndexedDB blob caching
  app.get('/api/thumbnail', async (req, res) => {
    const rawUrl = String(req.query.url || '');
    try {
      const parsed = new URL(rawUrl);
      const allowedHosts = ['i.ytimg.com', 'img.youtube.com', 'i9.ytimg.com', 'yt3.ggpht.com'];
      if (!allowedHosts.includes(parsed.hostname)) {
        res.status(400).json({ error: 'Invalid thumbnail host' });
        return;
      }
      const upstream = await fetch(rawUrl);
      if (!upstream.ok) {
        res.status(404).end();
        return;
      }
      const contentType = upstream.headers.get('content-type') || 'image/jpeg';
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(buffer);
    } catch {
      res.status(400).json({ error: 'Thumbnail fetch failed' });
    }
  });

  // Fetch YouTube Video Metadata & Format Options
  app.post('/api/youtube/info', async (req, res) => {
    try {
      const url = String(req.body?.url || '').trim();
      const videoId = extractYouTubeId(url);
      if (!videoId) {
        res.status(400).json({ error: 'Please paste a valid YouTube link (youtube.com/watch, youtu.be, or Shorts).' });
        return;
      }
      const info = await fetchVideoInfo(videoId);
      res.json(info);
    } catch (err) {
      res.status(422).json({
        error: (err as Error).message || 'Unable to inspect YouTube link.',
      });
    }
  });

  // Download & optionally cut/trim a YouTube video or audio track
  app.post('/api/youtube/download', async (req, res) => {
    const jobId = crypto.randomUUID();
    const rawInputPath = path.join(TEMP_DIR, `${jobId}-source.mp4`);
    let outputPath = '';

    try {
      const {
        url,
        title = 'ClipVault Media',
        mode = 'video',
        format = mode === 'audio' ? 'mp3' : 'mp4',
        resolution = '720',
        fps = 'auto',
        bitrate = '192k',
        startTime,
        endTime,
        fadeIn = 0,
        fadeOut = 0,
        normalize = false,
        clientProfile = 'android',
      } = req.body || {};

      const videoId = extractYouTubeId(String(url || ''));
      if (!videoId) {
        res.status(400).json({ error: 'Invalid YouTube link.' });
        return;
      }

      const maxHeight = parseInt(String(resolution).replace(/[^\d]/g, ''), 10) || 720;
      const parsedFps = fps === '60' || fps === 60 ? 60 : fps === '30' || fps === 30 ? 30 : undefined;
      await downloadYouTubeSourceToDisk(videoId, rawInputPath, mode === 'audio' ? 'audio' : 'video', maxHeight, String(clientProfile));

      const safeExt = ['mp4', 'webm', 'mp3', 'm4a', 'wav', 'ogg', 'flac'].includes(String(format).toLowerCase())
        ? String(format).toLowerCase()
        : mode === 'audio'
          ? 'mp3'
          : 'mp4';

      outputPath = path.join(TEMP_DIR, `${jobId}-out.${safeExt}`);

      const { args, mimeType, extension } = buildFFmpegExportArgs({
        inputPath: rawInputPath,
        outputPath,
        mode: mode === 'audio' ? 'audio' : 'video',
        format: safeExt,
        resolution: String(resolution).replace(/[^\d]/g, '') || 'original',
        fps: parsedFps,
        bitrate: String(bitrate),
        startTime: typeof startTime === 'number' ? startTime : undefined,
        endTime: typeof endTime === 'number' ? endTime : undefined,
        fadeIn: Number(fadeIn) || 0,
        fadeOut: Number(fadeOut) || 0,
        normalize: Boolean(normalize),
      });

      await runFFmpeg(args);

      const finalDuration = await probeDuration(outputPath);
      const stats = await fs.promises.stat(outputPath);
      const safeName = sanitizeFilename(String(title));
      const trimSuffix = typeof startTime === 'number' && typeof endTime === 'number' ? ` [cut]` : '';
      const filename = `${safeName}${trimSuffix}.${extension}`;

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', String(stats.size));
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('X-ClipVault-Duration', String(finalDuration));
      res.setHeader('X-ClipVault-Filename', encodeURIComponent(filename));

      const stream = fs.createReadStream(outputPath);
      stream.on('close', () => {
        safeUnlink(rawInputPath);
        safeUnlink(outputPath);
      });
      stream.pipe(res);
    } catch (err) {
      safeUnlink(rawInputPath);
      if (outputPath) safeUnlink(outputPath);
      const message = (err as Error).message || 'Download failed.';
      res.status(502).json({
        code: message.includes('restricted') ? 'YOUTUBE_STREAM_RESTRICTED' : 'DOWNLOAD_ERROR',
        error: message,
      });
    }
  });

  // Precision FFmpeg Trim / Cut / Format Export for uploaded or offline-cached files
  app.post('/api/media/trim', upload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No media file provided.' });
      return;
    }

    const jobId = crypto.randomUUID();
    let outputPath = '';

    try {
      const mode = req.body.mode === 'audio' ? 'audio' : 'video';
      const rawFormat = String(req.body.format || (mode === 'audio' ? 'mp3' : 'mp4')).toLowerCase();
      const safeExt = ['mp4', 'webm', 'mp3', 'm4a', 'wav', 'ogg', 'flac'].includes(rawFormat)
        ? rawFormat
        : mode === 'audio'
          ? 'mp3'
          : 'mp4';

      const startTime = parseFloat(req.body.startTime);
      const endTime = parseFloat(req.body.endTime);
      const fadeIn = parseFloat(req.body.fadeIn) || 0;
      const fadeOut = parseFloat(req.body.fadeOut) || 0;
      const normalize = req.body.normalize === 'true';
      const resolution = String(req.body.resolution || 'original');
      const rawFps = String(req.body.fps || 'auto');
      const parsedFps = rawFps === '60' ? 60 : rawFps === '30' ? 30 : undefined;
      const bitrate = String(req.body.bitrate || '192k');
      const title = sanitizeFilename(String(req.body.title || path.parse(file.originalname).name || 'trimmed-clip'));

      outputPath = path.join(TEMP_DIR, `${jobId}-trimmed.${safeExt}`);

      const { args, mimeType, extension } = buildFFmpegExportArgs({
        inputPath: file.path,
        outputPath,
        mode,
        format: safeExt,
        resolution,
        fps: parsedFps,
        bitrate,
        startTime: Number.isFinite(startTime) && startTime >= 0 ? startTime : undefined,
        endTime: Number.isFinite(endTime) && endTime > 0 ? endTime : undefined,
        fadeIn,
        fadeOut,
        normalize,
      });

      await runFFmpeg(args);

      const finalDuration = await probeDuration(outputPath);
      const stats = await fs.promises.stat(outputPath);
      const filename = `${title}-cut.${extension}`;

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', String(stats.size));
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('X-ClipVault-Duration', String(finalDuration));
      res.setHeader('X-ClipVault-Filename', encodeURIComponent(filename));

      const stream = fs.createReadStream(outputPath);
      stream.on('close', () => {
        safeUnlink(file.path);
        safeUnlink(outputPath);
      });
      stream.pipe(res);
    } catch (err) {
      safeUnlink(file.path);
      if (outputPath) safeUnlink(outputPath);
      res.status(500).json({
        error: (err as Error).message || 'Failed to trim media file.',
      });
    }
  });

  // Download ready-to-build Android APK Project Bundle (Kotlin WebView + Gradle + GitHub Actions + Bubblewrap TWA)
  app.get('/api/android/apk-project', async (req, res) => {
    let zipPath = '';
    try {
      const requestedUrl = String(req.query.appUrl || '').trim();
      let origin = '';
      if (requestedUrl) {
        try {
          const parsed = new URL(requestedUrl);
          if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
            origin = parsed.origin;
          }
        } catch {
          // ignore invalid custom URL and fall back below
        }
      }

      if (!origin) {
        const forwardedProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
        const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').split(',')[0].trim();
        origin = process.env.APP_URL && process.env.APP_URL.startsWith('http')
          ? process.env.APP_URL
          : `${forwardedProto}://${host}`;
      }

      zipPath = await buildAndroidApkProjectZip(origin);
      const stats = await fs.promises.stat(zipPath);

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Length', String(stats.size));
      res.setHeader('Content-Disposition', 'attachment; filename="ClipVault-Android-APK-Project.zip"');

      const stream = fs.createReadStream(zipPath);
      stream.on('close', () => safeUnlink(zipPath));
      stream.pipe(res);
    } catch (err) {
      if (zipPath) safeUnlink(zipPath);
      res.status(500).json({
        error: (err as Error).message || 'Could not package Android APK project.',
      });
    }
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`ClipVault server listening on http://localhost:${PORT}`);
  });
}

startServer();
