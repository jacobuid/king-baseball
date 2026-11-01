"""KingSports private importer. Cloud Tasks owns the lifetime of every import."""
import hmac
import json
import logging
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
from ytmusicapi import YTMusic
from ytmusicapi.exceptions import YTMusicError

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
        diagnostic = result.stderr[-2000:]
        if "--cookies" in arguments:
            # Parser errors can echo a cookie row. Keep authenticated stderr private.
            diagnostic = "Authenticated download failed; detailed output withheld"
            for needle, message in (("not a bot", "YouTube still requires sign-in verification"), ("HTTP Error 403", "Source returned HTTP 403"), ("PO Token", "Source requires an additional playback token"), ("cookies are no longer valid", "YouTube session cookies are no longer valid")):
                if needle in result.stderr:
                    diagnostic = message
                    break
        logging.getLogger('king_sports.music').warning('Media command failed (%s): %s', arguments[0], diagnostic)
        raise RuntimeError("Media processing failed")
    return result.stdout


def downloader(*args):
    return ["yt-dlp", "--ignore-config", "--js-runtimes", "node", "--no-playlist", "--no-warnings", "--socket-timeout", "20", *args]


def youtube_cookie_arguments(directory):
    configured = os.environ.get("YOUTUBE_COOKIES_FILE")
    if not configured:
        return []
    source = Path(configured)
    if source.stat().st_size > 65536:
        raise RuntimeError("YouTube cookie file exceeds the secret size limit")
    lines = source.read_text(encoding="utf-8-sig").splitlines()
    if not lines or lines[0].strip() not in ("# Netscape HTTP Cookie File", "# HTTP Cookie File"):
        raise RuntimeError("YouTube cookies must use Netscape cookies.txt format")
    selected = ["# Netscape HTTP Cookie File"]
    for line in lines[1:]:
        if not line.strip() or (line.startswith("#") and not line.startswith("#HttpOnly_")):
            continue
        fields = line.split("\t")
        if len(fields) != 7:
            raise RuntimeError("Invalid YouTube cookie file format")
        domain = fields[0].removeprefix("#HttpOnly_").lstrip(".").lower()
        # An accidental whole-browser export must not send other account cookies.
        if domain == "youtube.com" or domain.endswith(".youtube.com"):
            selected.append(line)
    if len(selected) == 1:
        raise RuntimeError("Cookie file contains no YouTube cookies")
    # yt-dlp rewrites its cookie jar. Never write back to the read-only secret mount
    # or share a mutable jar between simultaneous requests.
    cookie_copy = directory / "youtube-cookies.txt"
    cookie_copy.touch(mode=0o600, exist_ok=False)
    cookie_copy.write_text("\n".join(selected) + "\n", encoding="utf-8")
    return ["--cookies", str(cookie_copy)]


class Search(BaseModel):
    query: str = Field(min_length=3, max_length=100)


class MusicSession(requests.Session):
    def request(self, method, url, **kwargs):
        kwargs.setdefault("timeout", 15)
        return super().request(method, url, **kwargs)


def music_result(entry):
    video_id = entry.get("videoId", "")
    duration = entry.get("duration_seconds")
    if not isinstance(video_id, str) or not VIDEO.fullmatch(video_id) or entry.get("isAvailable") is False:
        return None
    if not isinstance(duration, (int, float)) or isinstance(duration, bool) or not 0 < duration <= 1200:
        return None
    artist = ", ".join(a["name"] for a in entry.get("artists", []) if isinstance(a, dict) and isinstance(a.get("name"), str))
    thumbnail = f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"
    for candidate in reversed(entry.get("thumbnails") or []):
        url = candidate.get("url", "") if isinstance(candidate, dict) else ""
        parsed = urlparse(url)
        host = parsed.hostname or ""
        if parsed.scheme == "https" and any(host == domain or host.endswith("." + domain) for domain in ("googleusercontent.com", "ytimg.com", "ggpht.com")):
            thumbnail = url
            break
    album = entry.get("album") or {}
    return {"videoId": video_id, "title": str(entry.get("title") or "Untitled")[:200], "artist": artist[:100], "album": str(album.get("name") or "")[:150] if isinstance(album, dict) else "", "duration": duration, "thumbnail": thumbnail, "isExplicit": entry.get("isExplicit") if isinstance(entry.get("isExplicit"), bool) else None}


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
        # Each request has an anonymous client/session; no account cookies are used.
        with MusicSession() as session:
            client = YTMusic(requests_session=session)
            entries = [
                *client.search(body.query.strip(), filter="songs", limit=8),
                *client.search(body.query.strip(), filter="videos", limit=8),
            ]
        results = []
        seen = set()
        for entry in entries:
            result = music_result(entry)
            if result and result["videoId"] not in seen:
                results.append(result)
                seen.add(result["videoId"])
            if len(results) == 12:
                break
        return {"results": results}
    except (YTMusicError, requests.RequestException, ValueError, KeyError, IndexError):
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
    run(downloader(*youtube_cookie_arguments(directory), "--max-filesize", "50M", "--match-filters", "!is_live & duration <= 1200", "--write-info-json", "--no-write-thumbnail", "-f", "bestaudio[ext=m4a]/bestaudio", "-o", str(directory / "source.%(ext)s"), "--", source), timeout=540)
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
