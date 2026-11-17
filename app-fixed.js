import { FFmpeg } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js';
import { toBlobURL } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js';

const $ = (id) => document.getElementById(id);
const ffmpeg = new FFmpeg();
let selectedBlob = null;
let selectedName = '';
let selectedDuration = 0;
let outputUrl = null;
let previewUrl = null;
let loaded = false;
let loadPromise = null;
let lyricLines = [];

$('year').textContent = new Date().getFullYear();

function sizeText(bytes) {
  return bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB';
}
function durationText(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
}
function progress(percent) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  $('progressBar').style.width = value + '%';
  $('progressPercent').textContent = value + '%';
}

function setFile(blob, name) {
  selectedBlob = blob;
  selectedName = name || 'media';
  selectedDuration = 0;
  $('fileName').textContent = selectedName;
  $('fileSize').textContent = sizeText(blob.size) + ' · Loading preview…';
  $('selectedFile').classList.remove('hidden');
  $('convertBtn').disabled = false;
  $('convertBtn').textContent = '✦ Convert media';
  $('result').classList.add('hidden');

  if (outputUrl) {
    URL.revokeObjectURL(outputUrl);
    outputUrl = null;
  }
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);

  const box = $('mediaPreview');
  box.replaceChildren();
  const media = document.createElement(blob.type.startsWith('audio/') ? 'audio' : 'video');
  media.controls = true;
  media.preload = 'metadata';
  media.src = previewUrl;
  if (media.tagName === 'VIDEO') {
    media.playsInline = true;
    media.className = 'media-preview-video';
  } else {
    media.className = 'media-preview-audio';
  }
  box.append(media);
  box.classList.remove('hidden');

  media.addEventListener('loadedmetadata', () => {
    selectedDuration = Number.isFinite(media.duration) ? media.duration : 0;
    $('fileSize').textContent = sizeText(blob.size) + (selectedDuration ? ' · ' + durationText(selectedDuration) : '');
  }, { once: true });
  media.addEventListener('error', () => {
    $('fileSize').textContent = sizeText(blob.size) + ' · Preview unavailable; conversion can still be tried';
  }, { once: true });
}

document.querySelectorAll('.tab').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab === button));
    $('filePanel').classList.toggle('hidden', button.dataset.tab !== 'file');
    $('urlPanel').classList.toggle('hidden', button.dataset.tab !== 'url');
  });
});

$('fileInput').addEventListener('change', (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) setFile(file, file.name);
});

$('removeFile').addEventListener('click', () => {
  selectedBlob = null;
  selectedDuration = 0;
  $('selectedFile').classList.add('hidden');
  $('mediaPreview').classList.add('hidden');
  $('mediaPreview').replaceChildren();
  $('convertBtn').disabled = true;
  $('fileInput').value = '';
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
});

const dropzone = $('dropzone');
['dragenter', 'dragover'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.style.borderColor = '#0da879';
  });
});
['dragleave', 'drop'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.style.borderColor = '';
  });
});
dropzone.addEventListener('drop', (event) => {
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) setFile(file, file.name);
});

function platformName(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, '');
    if (host.includes('youtube') || host === 'youtu.be') return 'YouTube';
    if (host.includes('facebook') || host === 'fb.watch') return 'Facebook';
    if (host.includes('instagram')) return 'Instagram';
    if (host.includes('tiktok')) return 'TikTok';
    if (host.includes('twitter') || host.includes('x.com')) return 'X';
    if (host.includes('vimeo')) return 'Vimeo';
  } catch (error) {
    return '';
  }
  return '';
}

$('mediaUrl').addEventListener('input', () => {
  const platform = platformName($('mediaUrl').value.trim());
  $('platformNote').textContent = platform
    ? platform + ' page links are not direct media files. Use the platform official export/download feature, then upload the authorized file here.'
    : '';
  $('platformNote').classList.toggle('hidden', !platform);
});

$('loadUrl').addEventListener('click', async () => {
  const value = $('mediaUrl').value.trim();
  if (!value) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP/HTTPS direct media URLs are supported');
    if (platformName(value)) throw new Error('This social URL is not a direct media file. Use an official export and upload the file.');
    $('loadUrl').disabled = true;
    $('loadUrl').textContent = 'Loading…';
    const response = await fetch(value);
    if (!response.ok) throw new Error('Source returned ' + response.status);
    const blob = await response.blob();
    if (!blob.type.startsWith('video/') && !blob.type.startsWith('audio/')) {
      throw new Error('URL did not return a recognized media file');
    }
    setFile(blob, decodeURIComponent(url.pathname.split('/').pop() || 'remote-media'));
  } catch (error) {
    $('platformNote').textContent = error.message + ' (The host may block browser CORS access.)';
    $('platformNote').classList.remove('hidden');
  } finally {
    $('loadUrl').disabled = false;
    $('loadUrl').textContent = 'Download';
  }
});

$('format').addEventListener('change', () => {
  $('qualitySetting').classList.toggle('hidden', $('format').value !== 'mp3');
});

ffmpeg.on('progress', ({ progress: value }) => progress(value * 100));

async function ensureFFmpegLoaded() {
  if (loaded) return;
  if (!loadPromise) {
    loadPromise = (async () => {
      await ffmpeg.load({
        coreURL: await toBlobURL('https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js', 'text/javascript'),
        wasmURL: await toBlobURL('https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm', 'application/wasm'),
        classWorkerURL: await toBlobURL('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/worker.js', 'text/javascript')
      });
      loaded = true;
    })().catch((error) => {
      loadPromise = null;
      throw error;
    });
  }
  return loadPromise;
}

// FFmpeg is loaded only for MP4. MP3 uses a lightweight browser encoder.

let lamePromise = null;
function loadLameEncoder() {
  if (window.lamejs) return Promise.resolve(window.lamejs);
  if (!lamePromise) {
    lamePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
      script.onload = () => window.lamejs ? resolve(window.lamejs) : reject(new Error('MP3 encoder did not initialize'));
      script.onerror = () => reject(new Error('Could not load the lightweight MP3 encoder. Check your internet connection.'));
      document.head.append(script);
    }).catch((error) => { lamePromise = null; throw error; });
  }
  return lamePromise;
}

async function convertToMp3(blob, bitrate) {
  const lame = await loadLameEncoder();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('This browser does not support audio decoding.');
  const context = new AudioContextClass();
  try {
    const audioBuffer = await context.decodeAudioData(await blob.arrayBuffer());
    const channels = Math.min(2, audioBuffer.numberOfChannels);
    const encoder = new lame.Mp3Encoder(channels, audioBuffer.sampleRate, Number.parseInt(bitrate, 10));
    const left = audioBuffer.getChannelData(0);
    const right = channels === 2 ? audioBuffer.getChannelData(1) : null;
    const blockSize = 1152;
    const chunks = [];
    for (let offset = 0; offset < audioBuffer.length; offset += blockSize) {
      const end = Math.min(offset + blockSize, audioBuffer.length);
      const l = new Int16Array(end - offset);
      const r = channels === 2 ? new Int16Array(end - offset) : null;
      for (let i = offset; i < end; i++) {
        const n = i - offset;
        l[n] = Math.max(-32768, Math.min(32767, left[i] * 32767));
        if (r) r[n] = Math.max(-32768, Math.min(32767, right[i] * 32767));
      }
      const encoded = channels === 2 ? encoder.encodeBuffer(l, r) : encoder.encodeBuffer(l);
      if (encoded.length) chunks.push(new Uint8Array(encoded));
      progress((end / audioBuffer.length) * 100);
    }
    const finalChunk = encoder.flush();
    if (finalChunk.length) chunks.push(new Uint8Array(finalChunk));
    return new Blob(chunks, { type: 'audio/mpeg' });
  } finally {
    await context.close();
  }
}

$('convertBtn').addEventListener('click', async () => {
  if (!selectedBlob) return;
  const button = $('convertBtn');
  const format = $('format').value;
  const quality = $('quality').value;
  button.disabled = true;
  $('result').classList.add('hidden');
  $('progressWrap').classList.remove('hidden');
  $('progressText').textContent = format === 'mp3' ? 'Preparing MP3 encoder…' : 'Loading MP4 converter…';
  progress(0);

  const extension = (selectedName.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const inputName = 'input.' + extension;
  const outputName = format === 'mp3' ? 'media-studio-audio.mp3' : 'media-studio-video.mp4';

  try {
    let blob;
    if (format === 'mp3') {
      $('progressText').textContent = 'Preparing lightweight MP3 encoder…';
      blob = await convertToMp3(selectedBlob, quality);
    } else {
      $('progressText').textContent = 'Loading MP4 converter…';
      await ensureFFmpegLoaded();
      $('progressText').textContent = 'Converting video…';
      await ffmpeg.writeFile(inputName, new Uint8Array(await selectedBlob.arrayBuffer()));
      await ffmpeg.exec(['-i', inputName, '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', '-c:a', 'aac', '-movflags', '+faststart', outputName]);
      const data = await ffmpeg.readFile(outputName);
      blob = new Blob([data.buffer], { type: 'video/mp4' });
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
    }
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.className = 'download-link';
    link.href = outputUrl;
    link.download = outputName;
    link.textContent = '↓ Download ' + outputName;
    $('result').replaceChildren();
    const heading = document.createElement('b');
    heading.textContent = 'Your file is ready';
    const details = document.createElement('p');
    details.textContent = outputName + ' · ' + sizeText(blob.size);
    $('result').append(heading, details, link);
    $('result').classList.remove('hidden');
    $('progressText').textContent = 'Conversion complete';
    progress(100);
  } catch (error) {
    $('progressText').textContent = 'Conversion failed';
    $('result').textContent = 'Could not convert this file: ' + error.message;
    $('result').classList.remove('hidden');
  } finally {
    button.disabled = false;
  }
});

function srtTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const wholeSeconds = Math.floor(seconds % 60);
  const milliseconds = Math.round((seconds - Math.floor(seconds)) * 1000);
  return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' +
    String(wholeSeconds).padStart(2, '0') + ',' + String(milliseconds).padStart(3, '0');
}

function saveText(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildSrt() {
  if (!lyricLines.length) return '';
  const choice = $('lineSeconds').value;
  const useMediaDuration = choice === 'match' && selectedDuration > 0;
  const secondsPerLine = choice === 'match' ? 3 : Number(choice);
  const totalDuration = useMediaDuration ? selectedDuration : lyricLines.length * secondsPerLine;
  const interval = totalDuration / lyricLines.length;
  return lyricLines.map((line, index) => {
    return (index + 1) + '\\n' + srtTime(index * interval) + ' --> ' +
      srtTime((index + 1) * interval) + '\\n' + line;
  }).join('\\n\\n');
}

$('previewLyrics').addEventListener('click', () => {
  lyricLines = $('lyricsText').value.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);
  $('lyricsPreview').textContent = lyricLines.length
    ? lyricLines.join('\\n')
    : 'Paste lyrics first.';
  $('copyLyrics').disabled = !lyricLines.length;
  $('copySrt').disabled = !lyricLines.length;
  $('copyStatus').textContent = '';
});

async function copyToClipboard(value, label) {
  if (!value) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
    } else {
      const temporary = document.createElement('textarea');
      temporary.value = value;
      temporary.style.position = 'fixed';
      temporary.style.opacity = '0';
      document.body.append(temporary);
      temporary.select();
      const copied = document.execCommand('copy');
      temporary.remove();
      if (!copied) throw new Error('Copy not available');
    }
    $('copyStatus').textContent = label + ' copied. Paste it anywhere.';
  } catch (error) {
    $('copyStatus').textContent = 'Could not copy automatically. Please select and copy the text.';
  }
}

$('copyLyrics').addEventListener('click', () => copyToClipboard(lyricLines.join('\\n'), 'Lyrics'));
$('copySrt').addEventListener('click', () => copyToClipboard(buildSrt(), 'SRT subtitles'));
