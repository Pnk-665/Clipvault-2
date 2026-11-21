/**
 * Client-side Web Audio API waveform extraction and 100% offline WAV audio trimming.
 * Allows trimming audio clips right on the Android device even with zero network connectivity.
 */

export async function extractWaveformPeaks(blob: Blob, barCount = 96): Promise<number[]> {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    return generateFallbackPeaks(barCount);
  }

  const ctx = new AudioCtx();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const channelData = audioBuffer.getChannelData(0);
    const blockSize = Math.max(1, Math.floor(channelData.length / barCount));
    const peaks: number[] = [];

    for (let i = 0; i < barCount; i++) {
      const start = i * blockSize;
      const end = Math.min(channelData.length, start + blockSize);
      let maxAmp = 0;
      const step = Math.max(1, Math.floor((end - start) / 128));
      for (let j = start; j < end; j += step) {
        const amp = Math.abs(channelData[j]);
        if (amp > maxAmp) maxAmp = amp;
      }
      peaks.push(Math.max(0.08, Math.min(1, maxAmp)));
    }

    const peakMax = Math.max(...peaks, 0.01);
    return peaks.map((p) => Math.max(0.08, p / peakMax));
  } catch {
    return generateFallbackPeaks(barCount);
  } finally {
    ctx.close().catch(() => {});
  }
}

export function generateFallbackPeaks(barCount = 96): number[] {
  const peaks: number[] = [];
  for (let i = 0; i < barCount; i++) {
    const wave = Math.sin(i * 0.28) * 0.28 + Math.cos(i * 0.11) * 0.22 + 0.5;
    peaks.push(Math.max(0.14, Math.min(0.95, wave)));
  }
  return peaks;
}

export async function trimAudioOfflineToWav(options: {
  blob: Blob;
  startTime: number;
  endTime: number;
  fadeIn?: number;
  fadeOut?: number;
  normalize?: boolean;
}): Promise<{ blob: Blob; duration: number }> {
  const { blob, startTime, endTime, fadeIn = 0, fadeOut = 0, normalize = false } = options;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('Offline audio trimming requires Web Audio API support in this browser.');
  }

  const ctx = new AudioCtx();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const sourceBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

    const sampleRate = sourceBuffer.sampleRate;
    const clampedStart = Math.max(0, Math.min(startTime, sourceBuffer.duration));
    const clampedEnd = Math.max(clampedStart + 0.1, Math.min(endTime, sourceBuffer.duration));
    const startSample = Math.floor(clampedStart * sampleRate);
    const endSample = Math.min(sourceBuffer.length, Math.floor(clampedEnd * sampleRate));
    const frameCount = Math.max(1, endSample - startSample);
    const numChannels = sourceBuffer.numberOfChannels;

    const trimmedBuffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
    const fadeInSamples = Math.min(frameCount, Math.floor(fadeIn * sampleRate));
    const fadeOutSamples = Math.min(frameCount, Math.floor(fadeOut * sampleRate));

    let globalPeak = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      const src = sourceBuffer.getChannelData(ch);
      const dst = trimmedBuffer.getChannelData(ch);
      for (let i = 0; i < frameCount; i++) {
        let sample = src[startSample + i] || 0;
        if (fadeInSamples > 0 && i < fadeInSamples) {
          sample *= i / fadeInSamples;
        }
        if (fadeOutSamples > 0 && i >= frameCount - fadeOutSamples) {
          sample *= (frameCount - i) / fadeOutSamples;
        }
        const absVal = Math.abs(sample);
        if (absVal > globalPeak) globalPeak = absVal;
        dst[i] = sample;
      }
    }

    if (normalize && globalPeak > 0.001) {
      const gain = 0.96 / globalPeak;
      for (let ch = 0; ch < numChannels; ch++) {
        const dst = trimmedBuffer.getChannelData(ch);
        for (let i = 0; i < frameCount; i++) {
          dst[i] = Math.max(-1, Math.min(1, dst[i] * gain));
        }
      }
    }

    const wavBlob = encodeAudioBufferToWav(trimmedBuffer);
    return {
      blob: wavBlob,
      duration: frameCount / sampleRate,
    };
  } finally {
    ctx.close().catch(() => {});
  }
}

function encodeAudioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = buffer.length * blockAlign;
  const totalSize = 44 + dataSize;

  const view = new DataView(new ArrayBuffer(totalSize));
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  const channels = Array.from({ length: numChannels }, (_, i) => buffer.getChannelData(i));
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([view.buffer], { type: 'audio/wav' });
}
