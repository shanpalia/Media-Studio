import os, re, tempfile, subprocess, json
from pathlib import Path
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from urllib.parse import urlparse

app=FastAPI(title="Media Studio Downloader API")
app.add_middleware(CORSMiddleware, allow_origins=["https://shanpalia.github.io"], allow_methods=["GET"], allow_headers=["*"])
ALLOWED={"youtube.com","youtu.be","instagram.com","facebook.com","fb.watch","tiktok.com","threads.net","threads.com","pinterest.com","pin.it","x.com","twitter.com"}
def valid_url(raw):
    try:
        u=urlparse(raw); host=(u.hostname or "").lower()
        return u.scheme in ("http","https") and any(host==d or host.endswith("."+d) for d in ALLOWED)
    except: return False
def run_ytdlp(args):
    p=subprocess.run(["yt-dlp","--no-warnings","--no-playlist","--no-check-certificates","--socket-timeout","15"]+args,capture_output=True,text=True,timeout=90)
    if p.returncode: raise HTTPException(422, (p.stderr or "This public URL is not downloadable by the supported extractor.")[-700:])
    return p.stdout
@app.get("/health")
def health(): return {"ok":True,"service":"media-studio-downloader"}
@app.get("/info")
def info(url:str=Query(...,max_length=2048)):
    if not valid_url(url): raise HTTPException(400,"Unsupported or invalid URL")
    raw=run_ytdlp(["--dump-single-json","--skip-download",url])
    try: d=json.loads(raw)
    except: raise HTTPException(502,"Could not read media metadata")
    fmts=[]
    for f in d.get("formats",[]):
        if f.get("url") and (f.get("vcodec")!="none" or f.get("acodec")!="none"):
            fmts.append({"format_id":f.get("format_id"),"ext":f.get("ext"),"height":f.get("height"),"width":f.get("width"),"filesize":f.get("filesize") or f.get("filesize_approx"),"vcodec":f.get("vcodec"),"acodec":f.get("acodec")})
    return {"title":d.get("title"),"duration":d.get("duration"),"thumbnail":d.get("thumbnail"),"extractor":d.get("extractor"),"formats":fmts[:60]}
@app.get("/download")
def download(url:str=Query(...,max_length=2048),kind:str="video",height:int=720):
    if not valid_url(url): raise HTTPException(400,"Unsupported or invalid URL")
    if kind not in ("video","audio"): raise HTTPException(400,"Invalid format")
    if height not in (360,480,720,1080): raise HTTPException(400,"Invalid resolution")
    tmp=tempfile.mkdtemp(prefix="msdl-")
    out=str(Path(tmp)/"%(title).80s.%(ext)s")
    args=["--no-playlist","--restrict-filenames","--max-filesize","300M","-o",out]
    if kind=="audio": args += ["-x","--audio-format","mp3","--audio-quality","192K"]
    else: args += ["-f",f"bv*[height<={height}]+ba/b[height<={height}]/b","--merge-output-format","mp4"]
    run_ytdlp(args+[url])
    paths=list(Path(tmp).glob("*"))
    if not paths: raise HTTPException(502,"No output file produced")
    path=paths[0]
    return FileResponse(path,filename=path.name,background=None)
