import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
import requests
import app as service


class MusicTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "MUSIC_SERVICE_TOKEN": "private-test-token", "API_ORIGIN": "https://api.example",
            "GOOGLE_CLOUD_PROJECT": "test-project", "TASKS_LOCATION": "us-central1",
            "SERVICE_URL": "https://service.example", "B2_ENDPOINT": "https://s3.example",
        })
        self.environment.start()
        self.client = TestClient(service.app, raise_server_exceptions=False)
        self.headers = {"Authorization": "Bearer private-test-token"}
        self.job = {"id": "11111111-1111-4111-8111-111111111111", "videoId": "abcdefghijk", "callbackUrl": "https://api.example/api/internal/music/11111111-1111-4111-8111-111111111111"}

    def tearDown(self):
        self.environment.stop()

    def test_auth_and_callback_validation(self):
        self.assertEqual(self.client.post("/search", json={"query": "song"}).status_code, 401)
        self.assertEqual(self.client.post("/jobs", json={**self.job, "callbackUrl": "https://attacker.example"}, headers=self.headers).status_code, 400)
        self.assertEqual(self.client.post("/jobs", json={**self.job, "videoId": "--exec rm"}, headers=self.headers).status_code, 400)

    @patch.object(service, "run")
    def test_search_treats_input_as_text_and_filters_results(self, run):
        run.return_value = '{"entries":[{"id":"abcdefghijk","title":"Song","duration":120},{"id":"ABCDEFGHIJK","duration":9000},{"id":"invalid"}]}'
        response = self.client.post("/search", json={"query": "--exec evil"}, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["results"]), 1)
        self.assertEqual(run.call_args.args[0][-1], "ytsearch8:--exec evil")

    @patch.object(service.tasks_v2, "CloudTasksClient")
    def test_import_is_queued_not_run_in_background_thread(self, client):
        response = self.client.post("/jobs", json=self.job, headers=self.headers)
        self.assertEqual(response.status_code, 202)
        task = client.return_value.create_task.call_args.kwargs["task"]
        self.assertEqual(task.http_request.url, "https://service.example/process")
        self.assertEqual(task.dispatch_deadline.seconds, 900)
        self.assertEqual(task.http_request.headers["Authorization"], self.headers["Authorization"])

    @patch.object(service, "prepare_audio")
    @patch.object(service, "callback")
    def test_duplicate_completed_task_does_not_download(self, callback, prepare):
        callback.return_value = {"status": "ready"}
        response = self.client.post("/process", json=self.job, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        prepare.assert_not_called()

    @patch.object(service, "prepare_audio", side_effect=RuntimeError("unavailable"))
    @patch.object(service, "callback")
    def test_source_failure_is_reported(self, callback, prepare):
        callback.return_value = {"status": "queued"}
        self.assertEqual(self.client.post("/process", json=self.job, headers=self.headers).status_code, 200)
        self.assertEqual(callback.call_args.args[2], {"status": "failed"})

    @patch.object(service, "prepare_audio", side_effect=requests.ConnectionError("offline"))
    @patch.object(service, "callback")
    def test_network_failure_retries_then_reports_failed(self, callback, prepare):
        callback.return_value = {"status": "queued"}
        self.assertEqual(self.client.post("/process", json=self.job, headers=self.headers).status_code, 500)
        self.assertEqual(self.client.post("/process", json=self.job, headers={**self.headers, "X-CloudTasks-TaskRetryCount": "2"}).status_code, 200)
        self.assertEqual(callback.call_args.args[2], {"status": "failed"})

    def test_native_aac_is_copied_and_other_codecs_are_converted(self):
        for codec, expected in [("aac", "copy"), ("opus", "aac")]:
            with self.subTest(codec=codec), tempfile.TemporaryDirectory() as tmp:
                directory = Path(tmp)
                (directory / "source.webm").write_bytes(b"audio")
                (directory / "source.info.json").write_text('{"title":"Song","uploader":"Artist"}')
                def run(arguments, *args, **kwargs):
                    if arguments[0] == "ffprobe":
                        return '{"format":{"duration":"120"},"streams":[{"codec_type":"audio","codec_name":"' + codec + '"}]}'
                    if arguments[0] == "ffmpeg":
                        self.assertEqual(arguments[arguments.index("-c:a") + 1], expected)
                        Path(arguments[-1]).write_bytes(b"finished")
                    return ""
                with patch.object(service, "run", side_effect=run):
                    output, metadata = service.prepare_audio(directory, "abcdefghijk")
                    self.assertEqual(output.suffix, ".m4a")
                    self.assertEqual(metadata["duration"], 120)


if __name__ == "__main__":
    unittest.main()
