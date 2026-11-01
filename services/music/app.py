"""KingSports private importer. Cloud Tasks owns the lifetime of every import."""
import hmac
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import requests
from fastapi import Depends, FastAPI, Header, HTTPException
from google.cloud import tasks_v2
from google.protobuf import duration_pb2
from pydantic import BaseModel, Field

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
VIDEO = re.compile(r"^[A-Za-z0-9_-]{11}$")
UUID = re.compile(r"^[a-f0-9-]{36}$")


def authenticated(authorization: str = Header(default="")):
    token = os.environ.get("MUSIC_SERVICE_TOKEN", "")
    if not token or not hmac.compare_digest(authorization, f"Bearer {token}"):
        raise HTTPException(401, "Unauthorized")


def run(arguments, timeout=120):
    # Never run a shell or accept user-supplied yt-dlp flags/URLs.
    result = subprocess.run(arguments, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError("Media processing failed")
    return result.stdout


def downloader(*args):
    return ["yt-dlp", "--ignore-config", "--js-runtimes", "node", "--no-playlist", "--no-warnings", "--socket-timeout", "20", *args]


class Search(BaseModel):
    query: str = Field(min_length=3, max_length=100)


class Job(BaseModel):
    id: str
    videoId: str
    callbackUrl: str


def check_job(job):
    origin = os.environ["API_ORIGIN"].rstrip("/")
    if not UUID.fullmatch(job.id) or not VIDEO.fullmatch(job.videoId):
        raise HTTPException(400, "Invalid job")
    if job.callbackUrl != f"{origin}/api/internal/music/{job.id}":
        raise HTTPException(400, "Invalid callback")


@app.post("/search", dependencies=[Depends(authenticated)])
def search(body: Search):
    try:
        # Search text is always prefixed, never treated as an arbitrary URL.
        output = run(downloader("--flat-playlist", "--dump-single-json", "--playlist-end", "8", "--", f"ytsearch8:{body.query.strip()}"), timeout=20)
        entries = json.loads(output).get("entries") or []
        return {"results": [{"videoId": e["id"], "title": str(e.get("title") or "Untitled")[:200], "artist": str(e.get("uploader") or e.get("channel") or "")[:100], "duration": e.get("duration"), "thumbnail": f"https://i.ytimg.com/vi/{e['id']}/mqdefault.jpg"} for e in entries if VIDEO.fullmatch(e.get("id", "")) and not e.get("is_live") and (e.get("duration") or 0) <= 1200]}
    except (RuntimeError, subprocess.TimeoutExpired, ValueError):
        raise HTTPException(502, "Search unavailable")


@app.post("/jobs", status_code=202, dependencies=[Depends(authenticated)])
def enqueue(job: Job):
    check_job(job)
    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(os.environ["GOOGLE_CLOUD_PROJECT"], os.environ["TASKS_LOCATION"], os.environ.get("TASKS_QUEUE", "king-sports-music"))
    task = tasks_v2.Task(http_request=tasks_v2.HttpRequest(
        http_method=tasks_v2.HttpMethod.POST,
        url=f"{os.environ['SERVICE_URL'].rstrip('/')}/process",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {os.environ['MUSIC_SERVICE_TOKEN']}"},
        body=job.model_dump_json().encode(),
    ), dispatch_deadline=duration_pb2.Duration(seconds=900))
    client.create_task(parent=parent, task=task)
    return {"queued": True}


def callback(job, method="GET", data=None, suffix=""):
    response = requests.request(method, job.callbackUrl + suffix, headers={"Authorization": f"Bearer {os.environ['MUSIC_SERVICE_TOKEN']}"}, json=data, timeout=30)
    response.raise_for_status()
    return response.json()


def prepare_audio(directory, video_id):
    source = f"https://www.youtube.com/watch?v={video_id}"
    # Prefer native AAC/M4A for broad iPhone/Android support, avoiding re-encoding.
    run(downloader("--max-filesize", "50M", "--match-filters", "!is_live & duration <= 1200", "--write-info-json", "--no-write-thumbnail", "-f", "bestaudio[ext=m4a]/bestaudio", "-o", str(directory / "source.%(ext)s"), "--", source), timeout=540)
    candidates = [p for p in directory.glob("source.*") if p.suffix in (".m4a", ".webm", ".opus", ".ogg", ".mp4")]
    if len(candidates) != 1 or candidates[0].stat().st_size > 50 * 1024 * 1024:
        raise RuntimeError("No suitable audio stream")
    original = candidates[0]
    metadata = json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(original)], 30))
    duration = float(metadata["format"]["duration"])
    if not 0 < duration <= 1200:
        raise RuntimeError("Track duration exceeds limit")
    audio = next(s for s in metadata["streams"] if s["codec_type"] == "audio")
    output = directory / "track.m4a"
    codec = ["-c:a", "copy"] if audio["codec_name"] == "aac" else ["-c:a", "aac", "-b:a", "192k"]
    run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(original), "-map", "0:a:0", "-vn", *codec, "-movflags", "+faststart", str(output)], 120)
    if output.stat().st_size > 50 * 1024 * 1024:
        raise RuntimeError("Audio exceeds size limit")
    info = json.loads((directory / "source.info.json").read_text())
    return output, {"status": "ready", "title": str(info.get("track") or info.get("title") or "Untitled")[:200], "artist": str(info.get("artist") or info.get("uploader") or "")[:100], "duration": duration}


@app.post("/process", dependencies=[Depends(authenticated)])
def process(job: Job, x_cloudtasks_taskretrycount: str = Header(default="0")):
    check_job(job)
    if callback(job)["status"] in ("ready", "failed"):
        return {"ok": True}
    callback(job, "POST", {"status": "processing"})
    try:
        with tempfile.TemporaryDirectory(prefix="king-sports-") as temporary:
            audio, metadata = prepare_audio(Path(temporary), job.videoId)
            upload = callback(job, "POST", suffix="/upload")["url"]
            # Only accept the storage host configured by the operator.
            if urlparse(upload).scheme != "https" or urlparse(upload).hostname != urlparse(os.environ["B2_ENDPOINT"]).hostname:
                raise RuntimeError("Invalid storage endpoint")
            with audio.open("rb") as stream:
                response = requests.put(upload, data=stream, headers={"Content-Type": "audio/mp4"}, timeout=120)
                response.raise_for_status()
            callback(job, "POST", metadata)
    except (RuntimeError, subprocess.TimeoutExpired, ValueError, KeyError, StopIteration):
        # Source/codec failures are terminal; retry is an explicit user action.
        callback(job, "POST", {"status": "failed"})
    except requests.RequestException:
        if x_cloudtasks_taskretrycount.isdigit() and int(x_cloudtasks_taskretrycount) >= 2:
            callback(job, "POST", {"status": "failed"})
        else:
            raise
    # Network/storage errors retry durably, up to the queue's three-attempt limit.
    return {"ok": True}
