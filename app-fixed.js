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
let detectedLanguage = '';

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
  $('aiLyricsStatus').textContent = 'Media ready. Tap Generate Lyrics Automatically to transcribe this file.';
  $('lyricsText').value = '';
  $('translatedLyrics').value = '';
  $('detectedLanguage').textContent = 'Detected song language: Waiting for audio…';
  $('translateStatus').textContent = 'Original lyrics stay unchanged. Choose a language below to translate.';

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
    const host = new URL(value).hostname.replace(/^www[.]/, '').toLowerCase();
    if (host === 'youtu.be' || host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) return 'YouTube';
    if (host === 'fb.watch' || host.endsWith('facebook.com') || host.endsWith('m.facebook.com')) return 'Facebook';
    if (host.endsWith('instagram.com')) return 'Instagram';
    if (host.endsWith('tiktok.com') || host === 'vm.tiktok.com' || host === 'vt.tiktok.com') return 'TikTok';
    if (host.endsWith('twitter.com') || host.endsWith('x.com')) return 'X';
    if (host.endsWith('vimeo.com')) return 'Vimeo';
  } catch (error) {
    return '';
  }
  return '';
}

function socialVideoEmbed(value) {
  const url = new URL(value);
  const host = url.hostname.replace(/^www[.]/, '').toLowerCase();
  let platform = platformName(value);
  let embedUrl = '';
  if (platform === 'YouTube') {
    let id = '';
    if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || '';
    else if (url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/live/') || url.pathname.startsWith('/embed/')) id = url.pathname.split('/')[2] || '';
    else id = url.searchParams.get('v') || '';
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) throw new Error('YouTube video link पहचान नहीं पाया। पूरा video URL डालें।');
    embedUrl = 'https://www.youtube-nocookie.com/embed/' + id;
  } else if (platform === 'TikTok') {
    const match = url.pathname.match(/\\/video\\/(\\d+)/);
    if (!match) throw new Error('TikTok share link resolve नहीं हुआ। Browser में video खोलकर उसका पूरा URL copy करें।');
    embedUrl = 'https://www.tiktok.com/player/v1/' + match[1] + '?music_info=1&description=1';
  } else if (platform === 'Instagram') {
    const match = url.pathname.match(/^\\/(p|reel|tv)\\/([A-Za-z0-9_-]+)/);
    if (!match) throw new Error('Instagram post या reel का पूरा public link डालें।');
    embedUrl = 'https://www.instagram.com/' + match[1] + '/' + match[2] + '/embed';
  } else if (platform === 'Facebook') {
    if (!/(videos|watch|reel|posts|permalink|video\\.php)/i.test(url.pathname)) throw new Error('Facebook का पूरा public video/post link डालें।');
    embedUrl = 'https://www.facebook.com/plugins/video.php?href=' + encodeURIComponent(url.toString()) + '&show_text=false&width=560';
  } else {
    return null;
  }
  return { platform, embedUrl, originalUrl: url.toString() };
}

function showSocialPreview(info) {
  const box = $('platformPreview');
  box.replaceChildren();
  const heading = document.createElement('div');
  heading.className = 'platform-preview-heading';
  const title = document.createElement('strong');
  title.textContent = info.platform + ' video preview';
  const note = document.createElement('span');
  note.textContent = 'Official embedded player';
  heading.append(title, note);
  const frameWrap = document.createElement('div');
  frameWrap.className = 'platform-frame-wrap';
  const frame = document.createElement('iframe');
  frame.src = info.embedUrl;
  frame.title = info.platform + ' video player';
  frame.loading = 'lazy';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen';
  frame.allowFullscreen = true;
  frameWrap.append(frame);
  const actions = document.createElement('div');
  actions.className = 'platform-preview-actions';
  const open = document.createElement('a');
  open.className = 'button primary';
  open.href = info.originalUrl;
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.textContent = 'Open Original Video ↗';
  actions.append(open);
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'अगर preview न खुले, तो वीडियो private, removed, region-restricted या platform login के पीछे हो सकता है। Original video खोलकर देखें।';
  box.append(heading, frameWrap, actions, hint);
  box.classList.remove('hidden');
}

$('mediaUrl').addEventListener('input', () => {
  const platform = platformName($('mediaUrl').value.trim());
  $('platformNote').textContent = platform
    ? platform + ' link detected. Paste the full public video link, then press Preview Video.'
    : '';
  $('platformNote').classList.toggle('hidden', !platform);
  if (!platform) $('platformPreview').classList.add('hidden');
});

$('loadUrl').addEventListener('click', async () => {
  const value = $('mediaUrl').value.trim();
  if (!value) {
    $('platformNote').textContent = 'Please paste a video or direct media URL first.';
    $('platformNote').classList.remove('hidden');
    return;
  }
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP/HTTPS URLs are supported.');
    const social = socialVideoEmbed(value);
    if (social) {
      $('platformNote').textContent = social.platform + ' link recognized. Loading official player…';
      $('platformNote').classList.remove('hidden');
      $('platformPreview').classList.add('hidden');
      showSocialPreview(social);
      $('platformNote').textContent = social.platform + ' link recognized. Preview is ready below.';
      return;
    }
    $('loadUrl').disabled = true;
    $('loadUrl').textContent = 'Loading…';
    $('platformNote').textContent = 'Fetching direct media file securely…';
    $('platformNote').classList.remove('hidden');
    const proxyUrl = 'https://media-studio.shanpalia786.workers.dev/api/fetch-media?url=' + encodeURIComponent(url.toString());
    const response = await fetch(proxyUrl);
    const contentType = (response.headers.get('Content-Type') || '').toLowerCase();
    if (!response.ok) {
      const problem = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {};
      throw new Error(problem.error || 'Could not fetch media (HTTP ' + response.status + ').');
    }
    const blob = await response.blob();
    if (!blob.size || !(blob.type.startsWith('video/') || blob.type.startsWith('audio/') || blob.type === 'application/octet-stream')) {
      throw new Error('URL did not return a recognized audio/video file.');
    }
    const fileName = decodeURIComponent(url.pathname.split('/').pop() || 'remote-media').replace(/[^a-zA-Z0-9._-]/g, '_');
    setFile(blob, fileName);
    $('platformNote').textContent = 'Media URL loaded successfully. You can now preview or convert it.';
    $('platformPreview').classList.add('hidden');
  } catch (error) {
    $('platformNote').textContent = error.message + ' If this is a social link, make sure it is a full public video URL.';
    $('platformNote').classList.remove('hidden');
  } finally {
    $('loadUrl').disabled = false;
    $('loadUrl').textContent = 'Preview Video';
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

function cleanTranscript(raw) {
  return String(raw || '').replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();
}

$('generateLyrics').addEventListener('click', async () => {
  if (!selectedBlob) {
    $('aiLyricsStatus').textContent = 'Please upload an audio or video file in the Converter section first.';
    return;
  }
  const button = $('generateLyrics');
  if (selectedBlob.size > 25 * 1024 * 1024) {
    $('aiLyricsStatus').textContent = 'This free transcription endpoint accepts files up to 25 MB. Please use a smaller audio/video file.';
    return;
  }
  button.disabled = true;
  $('aiLyricsStatus').textContent = 'Sending audio to Whisper AI securely…';
  try {
    const form = new FormData();
    const mime = selectedBlob.type || 'application/octet-stream';
    const ext = (selectedName.split('.').pop() || 'audio').toLowerCase();
    const allowed = ['mp3','mp4','mpeg','mpga','m4a','wav','ogg','webm','flac'];
    const safeExt = allowed.includes(ext) ? ext : (mime.includes('mp4') ? 'mp4' : mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'mp3');
    form.append('file', selectedBlob, 'media.' + safeExt);
    $('aiLyricsStatus').textContent = 'Recognizing the spoken language automatically…';
    const response = await fetch('https://media-studio.shanpalia786.workers.dev/api/transcribe', {
      method: 'POST',
      body: form
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 413) throw new Error('File is larger than 25 MB. Please choose a shorter or smaller file.');
      if (response.status === 429) throw new Error('Free usage limit reached. Please wait and try again later.');
      if (response.status === 503) throw new Error('Transcription service is not configured yet. Add the Groq API key to the Cloudflare Worker secret.');
      throw new Error(data.error || 'Transcription request failed (' + response.status + ').');
    }
    const text = cleanTranscript(data.text);
    if (!text) throw new Error('No clear speech was recognized. Try a clearer clip with less background music.');
    $('lyricsText').value = text;
    detectedLanguage = data.language || '';
    const languageNames = { hindi: 'Hindi (हिंदी)', english: 'English', urdu: 'Urdu (اردو)', arabic: 'Arabic (العربية)', bengali: 'Bengali (বাংলা)', punjabi: 'Punjabi (ਪੰਜਾਬੀ)', spanish: 'Spanish', french: 'French' };
    const detectedLabel = languageNames[String(detectedLanguage).toLowerCase()] || detectedLanguage || 'Auto detected';
    $('detectedLanguage').textContent = 'Detected song language: ' + detectedLabel;
    $('translatedLyrics').value = '';
    $('aiLyricsStatus').textContent = 'Speech recognized. Original lyrics are shown in the detected language. You can translate them below.';
  } catch (error) {
    $('aiLyricsStatus').textContent = 'Could not generate text: ' + error.message;
  } finally {
    button.disabled = false;
  }
});


$('translateLyrics').addEventListener('click', async () => {
  const sourceText = $('lyricsText').value.trim();
  const targetLanguage = $('targetLanguage').value;
  if (!sourceText) {
    $('translateStatus').textContent = 'First generate or paste the original lyrics above.';
    return;
  }
  const button = $('translateLyrics');
  button.disabled = true;
  $('translateStatus').textContent = 'Translating lyrics into ' + targetLanguage + '…';
  try {
    const response = await fetch('https://media-studio.shanpalia786.workers.dev/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sourceText, targetLanguage, sourceLanguage: detectedLanguage || 'auto-detected' })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 429) throw new Error('Translation rate limit reached. Please try again later.');
      if (response.status === 503) throw new Error('Translation service is not configured. Check the Groq API secret.');
      throw new Error(data.error || 'Translation failed (' + response.status + ').');
    }
    if (!data.translation) throw new Error('No translated text was returned.');
    $('translatedLyrics').value = data.translation;
    $('translateStatus').textContent = 'Translation complete: ' + targetLanguage + '. Original lyrics have not been changed.';
  } catch (error) {
    $('translateStatus').textContent = 'Could not translate: ' + error.message;
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

