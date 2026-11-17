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

window.addEventListener('load', () => {
  const warmUp = () => ensureFFmpegLoaded().catch((error) => console.warn('Converter preload failed:', error));
  if ('requestIdleCallback' in window) {
    requestIdleCallback(warmUp, { timeout: 2500 });
  } else {
    setTimeout(warmUp, 1200);
  }
});

$('convertBtn').addEventListener('click', async () => {
  if (!selectedBlob) return;
  const button = $('convertBtn');
  const format = $('format').value;
  const quality = $('quality').value;
  button.disabled = true;
  $('result').classList.add('hidden');
  $('progressWrap').classList.remove('hidden');
  $('progressText').textContent = 'Loading browser converter…';
  progress(0);

  const extension = (selectedName.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const inputName = 'input.' + extension;
  const outputName = format === 'mp3' ? 'media-studio-audio.mp3' : 'media-studio-video.mp4';

  try {
    await ensureFFmpegLoaded();
    $('progressText').textContent = 'Converting media…';
    await ffmpeg.writeFile(inputName, new Uint8Array(await selectedBlob.arrayBuffer()));
    const args = format === 'mp3'
      ? ['-i', inputName, '-vn', '-codec:a', 'libmp3lame', '-b:a', quality, outputName]
      : ['-i', inputName, '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-movflags', '+faststart', outputName];
    await ffmpeg.exec(args);
    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([data.buffer], { type: format === 'mp3' ? 'audio/mpeg' : 'video/mp4' });
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
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);
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

$('previewLyrics').addEventListener('click', () => {
  lyricLines = $('lyricsText').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  $('lyricsPreview').textContent = lyricLines.length
    ? lyricLines.slice(0, 3).join('\n') + (lyricLines.length > 3 ? '\n…' : '')
    : 'Paste lyrics first.';
  $('downloadSrt').disabled = !lyricLines.length;
  $('downloadTxt').disabled = !lyricLines.length;
});

$('downloadSrt').addEventListener('click', () => {
  if (!lyricLines.length) return;
  const choice = $('lineSeconds').value;
  const useMediaDuration = choice === 'match' && selectedDuration > 0;
  const secondsPerLine = choice === 'match' ? 3 : Number(choice);
  const totalDuration = useMediaDuration ? selectedDuration : lyricLines.length * secondsPerLine;
  const interval = totalDuration / lyricLines.length;
  const content = lyricLines.map((line, index) => {
    return (index + 1) + '\n' + srtTime(index * interval) + ' --> ' +
      srtTime((index + 1) * interval) + '\n' + line;
  }).join('\n\n');
  saveText('media-studio-lyrics.srt', content, 'application/x-subrip;charset=utf-8');
});

$('downloadTxt').addEventListener('click', () => {
  saveText('media-studio-lyrics.txt', lyricLines.join('\n'), 'text/plain;charset=utf-8');
});
