"""Web限定公開の副作用なし自己テスト。"""
from __future__ import annotations

import importlib.util
import sys
import tempfile
from pathlib import Path

module_path = Path(__file__).with_name("web_limited_publish.py")
spec = importlib.util.spec_from_file_location("web_limited_publish", module_path)
assert spec and spec.loader
publisher = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = publisher
spec.loader.exec_module(publisher)


class FakeTransport:
    def __init__(self, *, corrupt_readback: bool = False, fail_upload: str | None = None):
        self.remote: dict[str, bytes] = {}
        self.corrupt_readback = corrupt_readback
        self.fail_upload = fail_upload
        self.dry_runs: list[str] = []

    def dry_run(self, name: str, digest: str) -> None:
        self.dry_runs.append(name)

    def upload(self, name: str, payload: bytes) -> None:
        if name == self.fail_upload:
            raise publisher.PublishError("fixture upload failure")
        self.remote[name] = payload

    def download(self, name: str) -> bytes:
        value = self.remote[name]
        return b"corrupt" if self.corrupt_readback and name == "app.html" else value


payloads = {"mdvisualizer.html": b"html fixture", "app.html": b"php fixture"}
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    history_project = root / "isolated-project"
    (history_project / "dev" / "history" / "v9.8.7").mkdir(parents=True)
    options = {"payloads": payloads, "history_project_root": history_project, "write_results": False}
    plan = publisher.run("Plan", False, "v9.8.7", **options)
    assert plan["phases"] == [{"name": "manifest", "status": "passed"}]

    try:
        publisher.run("Publish", False, "v9.8.7", **options)
        raise AssertionError("未承認Publishが拒否されませんでした")
    except publisher.PublishError as exc:
        assert "PublishConfirmed" in str(exc)

    blocked = {"unexpected.txt": b"blocked"}
    try:
        publisher.run("Plan", False, "v9.8.7", payloads=blocked, history_project_root=history_project, write_results=False)
        raise AssertionError("許可リスト外が拒否されませんでした")
    except publisher.PublishError:
        pass

    fake = FakeTransport(corrupt_readback=True)
    original = publisher.check_http
    publisher.check_http = lambda *args, **kwargs: None
    try:
        publisher.run("Publish", True, "v9.8.7", fake, payloads=payloads, website_root=root, history_project_root=history_project, write_results=False)
        raise AssertionError("ハッシュ不一致が検出されませんでした")
    except publisher.PublishError as exc:
        assert "ハッシュ" in str(exc)
        assert [phase["name"] for phase in exc.result["phases"]] == ["stage", "ftp-dry-run:app.html", "ftp-dry-run:mdvisualizer.html", "upload:mdvisualizer.html", "upload:app.html", "ftp-readback:app.html", "failed"]
    finally:
        publisher.check_http = original

    verified = FakeTransport()
    verified.remote.update(payloads)
    publisher.check_http = lambda *args, **kwargs: None
    try:
        verify_result = publisher.run("Verify", False, "v9.8.7", verified, payloads=payloads, history_project_root=history_project, write_results=False)
    finally:
        publisher.check_http = original
    assert [phase["name"] for phase in verify_result["phases"]] == ["ftp-readback:app.html", "ftp-readback:mdvisualizer.html", "http-verify"]

    try:
        publisher.result_root("../v9.8.7", history_project)
        raise AssertionError("親ディレクトリ指定が拒否されませんでした")
    except publisher.PublishError as exc:
        assert "形式" in str(exc)

    try:
        publisher.result_root("v9.8.8", history_project)
        raise AssertionError("存在しない履歴が拒否されませんでした")
    except publisher.PublishError as exc:
        assert "履歴フォルダー" in str(exc)
    assert fake.dry_runs == ["app.html", "mdvisualizer.html"]

    partial = FakeTransport(fail_upload="app.html")
    publisher.check_http = lambda *args, **kwargs: None
    try:
        publisher.run("Publish", True, "v9.8.7", partial, payloads=payloads, website_root=root, history_project_root=history_project, write_results=False)
        raise AssertionError("部分失敗が集計されませんでした")
    except publisher.PublishError as exc:
        assert "fixture upload failure" in str(exc)
        assert [phase["name"] for phase in exc.result["phases"]] == ["stage", "ftp-dry-run:app.html", "ftp-dry-run:mdvisualizer.html", "upload:mdvisualizer.html", "upload:app.html", "failed"]
    finally:
        publisher.check_http = original

    # CLIはネットワーク処理をmockし、Publishの2種類のlockを検証する。
    cli_output = root / "cli-output"
    cli_project = root / "cli-project"
    original_result_root = publisher.result_root
    original_run = publisher.run
    original_project_root = publisher.PROJECT_ROOT
    original_argv = sys.argv[:]
    publisher.result_root = lambda version: cli_output
    publisher.run = lambda *args, **kwargs: {"mode": args[0], "phases": []}
    publisher.PROJECT_ROOT = cli_project
    try:
        sys.argv = [str(module_path), "--mode", "Publish", "--version", "v9.8.7", "--publish-confirmed"]
        assert publisher.main() == 0
        assert not (cli_output / ".publish.lock").exists()
        assert not (cli_project / ".tools" / "validation-locks" / "shared-build.lock").exists()

        cli_output.mkdir(parents=True, exist_ok=True)
        duplicate_publish = cli_output / ".publish.lock"
        duplicate_publish.write_text("fixture", encoding="utf-8")
        assert publisher.main() == 2
        assert duplicate_publish.exists(), "既存の公開lockを削除してはいけません"
        duplicate_publish.unlink()

        duplicate_shared = cli_project / ".tools" / "validation-locks" / "shared-build.lock"
        duplicate_shared.parent.mkdir(parents=True, exist_ok=True)
        duplicate_shared.write_text("fixture", encoding="utf-8")
        assert publisher.main() == 2
        assert duplicate_shared.exists(), "既存の共有build lockを削除してはいけません"
        assert not (cli_output / ".publish.lock").exists(), "取得済みの公開lockは共有lock失敗時に解放します"
    finally:
        sys.argv = original_argv
        publisher.result_root = original_result_root
        publisher.run = original_run
        publisher.PROJECT_ROOT = original_project_root

print("Web限定公開の自己テストに成功しました。")
