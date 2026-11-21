export type ActiveTab = 'download' | 'trim' | 'library' | 'settings';

export type MediaMode = 'video' | 'audio';

export type VideoFormat = 'mp4' | 'webm';
export type AudioFormat = 'mp3' | 'm4a' | 'wav' | 'ogg' | 'flac';
export type ExportFormat = VideoFormat | AudioFormat;

export interface FormatOption {
  id: string;
  label: string;
  resolution: string;
  height?: number;
  container: string;
  bitrate?: string;
  fps?: number;
  estimatedBytes?: number;
  type: MediaMode;
  codec?: string;
}

export interface VideoInfo {
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

export interface OfflineMediaItem {
  id: string;
  title: string;
  author: string;
  mode: MediaMode;
  format: string;
  resolution: string;
  bitrate?: string;
  durationSeconds: number;
  sizeBytes: number;
  createdAt: number;
  sourceUrl?: string;
  videoId?: string;
  isTrimmed: boolean;
  trimRange?: {
    start: number;
    end: number;
  };
  mimeType: string;
  blob: Blob;
  thumbnailBlob?: Blob;
}

export type VideoFps = 'auto' | '60' | '30';

export interface UserSettings {
  defaultMode: MediaMode;
  defaultVideoFormat: VideoFormat;
  defaultVideoResolution: string;
  defaultVideoFps: VideoFps;
  defaultAudioFormat: AudioFormat;
  defaultAudioBitrate: string;
  autoSaveToOfflineLibrary: boolean;
  autoTriggerDeviceDownload: boolean;
  clientProfile: 'android' | 'ios' | 'tv';
}

export const DEFAULT_SETTINGS: UserSettings = {
  defaultMode: 'video',
  defaultVideoFormat: 'mp4',
  defaultVideoResolution: '1080',
  defaultVideoFps: '60',
  defaultAudioFormat: 'mp3',
  defaultAudioBitrate: '320k',
  autoSaveToOfflineLibrary: true,
  autoTriggerDeviceDownload: true,
  clientProfile: 'android',
};
