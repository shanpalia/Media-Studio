import json
import shutil
import imageio_ffmpeg
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

app = FastAPI(title="Media Studio Downloader API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://shanpalia.github.io"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

ALLOWED = {
    "youtube.com", "youtu.be", "instagram.com", "facebook.com", "fb.watch",
    "tiktok.com", "threads.net", "threads.com", "pinterest.com", "pin.it",
    "x.com", "twitter.com",
}


def valid_url(raw: str) -> bool:
    try:
        parsed = urlparse(raw)
        host = (parsed.hostname or "").lower()
        return (
            parsed.scheme in ("http", "https")
            and not parsed.username
            and not parsed.password
            and any(host == domain or host.endswith("." + domain) for domain in ALLOWED)
        )
    except Exception:
        return False


def run_ytdlp(args: list[str]) -> str:
    try:
        proc = subprocess.run(
            ["yt-dlp", "--no-warnings", "--no-playlist", "--socket-timeout", "20", "--ffmpeg-location", imageio_ffmpeg.get_ffmpeg_exe()]
            + args,
            capture_output=True,
            text=True,
            timeout=150,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Platform response timed out. Please try again.")
    except FileNotFoundError:
        raise HTTPException(503, "Downloader engine is temporarily unavailable.")

    if proc.returncode:
        error = (proc.stderr or proc.stdout or "Media could not be extracted.")[-1200:]
        lower = error.lower()
        if "cannot parse data" in lower and "facebook" in lower:
            raise HTTPException(
                503,
                "Facebook is currently changing its video page format, so this link cannot be read right now. Try a public video/reel link later. Private, login-only and restricted posts are not supported.",
            )
        if any(term in lower for term in ("login", "cookies", "private", "not available", "sign in")):
            raise HTTPException(
                422,
                "This post is private, login-protected, unavailable, or restricted. Only publicly accessible media is supported.",
            )
        raise HTTPException(422, "This platform could not provide the media. Try another public post link.")
    return proc.stdout


@app.get("/")
def root():
    return {"ok": True, "service": "Media Studio Downloader API", "health": "/health"}


@app.get("/health")
def health():
    return {"ok": True, "service": "media-studio-downloader"}


@app.get("/info")
def info(url: str = Query(..., max_length=2048)):
    if not valid_url(url):
        raise HTTPException(400, "Unsupported or invalid URL")
    raw = run_ytdlp(["--dump-single-json", "--skip-download", url])
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(502, "The platform returned unreadable media details.")

    formats = []
    for item in data.get("formats", []):
        if item.get("url") and (
            item.get("vcodec") != "none" or item.get("acodec") != "none"
        ):
            formats.append({
                "format_id": item.get("format_id"),
                "ext": item.get("ext"),
                "height": item.get("height"),
                "width": item.get("width"),
                "filesize": item.get("filesize") or item.get("filesize_approx") or (round(float(data.get("duration") or 0) * float(item.get("tbr") or 0) * 1000 / 8) or None),
                "filesize_estimated": not bool(item.get("filesize") or item.get("filesize_approx")) and bool(item.get("tbr") and data.get("duration")),
                "abr": item.get("abr") or item.get("tbr"),
                "vcodec": item.get("vcodec"),
                "acodec": item.get("acodec"),
            })
    return {
        "title": data.get("title"),
        "duration": data.get("duration"),
        "thumbnail": data.get("thumbnail"),
        "extractor": data.get("extractor"),
        "formats": formats[:60],
    }


@app.get("/download")
def download(
    url: str = Query(..., max_length=2048),
    kind: str = "video",
    height: int = 720,
    audio_quality: int = 192,
    format_id: str | None = None,
):
    if not valid_url(url):
        raise HTTPException(400, "Unsupported or invalid URL")
    if kind not in ("video", "audio"):
        raise HTTPException(400, "Invalid format")
    if height < 1 or height > 4320:
        raise HTTPException(400, "Invalid resolution")
    if audio_quality not in (128, 192, 320):
        raise HTTPException(400, "Invalid audio quality")
    if format_id is not None and (len(format_id) > 40 or not all(ch.isalnum() or ch in "._+-" for ch in format_id)):
        raise HTTPException(400, "Invalid format selection")

    temp_dir = tempfile.mkdtemp(prefix="msdl-")
    output = str(Path(temp_dir) / "%(title).80s.%(ext)s")
    args = [
        "--no-playlist", "--restrict-filenames", "--max-filesize", "300M",
        "-o", output,
    ]
    if kind == "audio":
        if format_id:
            args += ["-f", format_id]
        else:
            args += ["-x", "--audio-format", "mp3", "--audio-quality", f"{audio_quality}K"]
    else:
        selected_format = f"{format_id}+bestaudio/{format_id}" if format_id else f"bv*[height<={height}]+ba/b[height<={height}]/b"
        args += [
            "-f", selected_format,
            "--merge-output-format", "mp4",
        ]

    try:
        run_ytdlp(args + [url])
        files = [path for path in Path(temp_dir).glob("*") if path.is_file()]
        if not files:
            raise HTTPException(502, "No downloadable file was produced.")
        result = files[0]
        return FileResponse(
            result,
            filename=result.name,
            background=BackgroundTask(shutil.rmtree, temp_dir, ignore_errors=True),
        )
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
