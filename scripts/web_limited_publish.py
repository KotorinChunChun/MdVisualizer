"""MdVisualizer Web版の2ファイルだけを安全に公開する補助処理。"""
from __future__ import annotations

import argparse
import ftplib
import hashlib
import io
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEBSITE_ROOT = Path(r"C:\develop\excel-chunchun")
PUBLIC_BASE_URL = "https://excel-chunchun.sakura.ne.jp/test/mdvisualizer"
ARTIFACTS = (
    ("mdvisualizer.html", PROJECT_ROOT / "web-platform" / "release" / "web" / "mdvisualizer.html"),
    ("app.html", PROJECT_ROOT / "web-platform" / "apps" / "web" / "php" / "app.html"),
)


class PublishError(RuntimeError):
    pass


class Transport(Protocol):
    def dry_run(self, name: str, digest: str) -> None: ...
    def upload(self, name: str, payload: bytes) -> None: ...
    def download(self, name: str) -> bytes: ...


@dataclass(frozen=True)
class Settings:
    host: str
    user: str
    password: str
    port: int
    remote_base: str
    tls_server_name: str = ""


@dataclass(frozen=True)
class OwnedLock:
    path: Path
    descriptor: int
    token: str


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise PublishError("既存のFTP設定を読み取れません。") from exc
    for line in lines:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return values


def load_settings() -> Settings:
    env = load_env(WEBSITE_ROOT / ".env")
    if env.get("FTP_TLS", "true").strip().lower() != "true":
        raise PublishError("Web公開はFTPS専用です。平文FTPには接続しません。")
    required = ("FTP_HOST", "FTP_USER", "FTP_PASS")
    if any(not env.get(key, "").strip() for key in required):
        raise PublishError("既存のFTP設定が不足しています。")
    try:
        port = int(env.get("FTP_PORT", "21"))
    except ValueError as exc:
        raise PublishError("既存のFTPポート設定が不正です。") from exc
    remote_base = env.get("FTP_REMOTE_DIR", "").strip().rstrip("/")
    if not remote_base:
        raise PublishError("既存のFTP公開先設定が不足しています。")
    return Settings(env["FTP_HOST"].strip(), env["FTP_USER"].strip(), env["FTP_PASS"].strip(), port, remote_base, env.get("FTP_TLS_SERVER_NAME", "").strip())


class FtpTransport:
    def __init__(self, settings: Settings):
        self.settings = settings

    def dry_run(self, name: str, digest: str) -> None:
        # ネットワーク接続を伴わない。許可リストとハッシュは呼出し側で検証済み。
        self._assert_allowed_name(name)
        if len(digest) != 64:
            raise PublishError("FTPドライランの対象が許可リストと一致しません。")

    @staticmethod
    def _assert_allowed_name(name: str) -> None:
        if name not in {artifact[0] for artifact in ARTIFACTS}:
            raise PublishError("FTP対象が許可リストと一致しません。")

    def _connect(self) -> ftplib.FTP:
        ftp = None
        try:
            ftp = ftplib.FTP_TLS(context=ssl.create_default_context())
            ftp.encoding = "utf-8"
            ftp.connect(self.settings.host, self.settings.port, timeout=30)
            ftp.host = self.settings.tls_server_name or {"219.94.129.84": "www1074.sakura.ne.jp"}.get(self.settings.host, self.settings.host)
            ftp.auth()
            ftp.login(self.settings.user, self.settings.password)
            ftp.prot_p()
            ftp.set_pasv(True)
            return ftp
        except Exception as exc:
            if ftp is not None:
                ftp.close()
            raise PublishError("FTPSの証明書検証・接続・認証に失敗しました。") from exc

    def _change_to_target(self, ftp: ftplib.FTP, *, create: bool) -> None:
        try:
            ftp.cwd(self.settings.remote_base)
            for directory in ("test", "mdvisualizer"):
                try:
                    ftp.cwd(directory)
                except ftplib.error_perm:
                    if not create:
                        raise
                    ftp.mkd(directory)
                    ftp.cwd(directory)
        except Exception as exc:
            raise PublishError("FTP公開先を準備できません。") from exc

    def upload(self, name: str, payload: bytes) -> None:
        self._assert_allowed_name(name)
        try:
            with self._connect() as ftp:
                self._change_to_target(ftp, create=True)
                ftp.storbinary(f"STOR {name}", io.BytesIO(payload))
                try:
                    ftp.sendcmd(f"SITE CHMOD 644 {name}")
                except Exception:
                    pass
        except PublishError:
            raise
        except Exception as exc:
            raise PublishError("FTPアップロードに失敗しました。") from exc

    def download(self, name: str) -> bytes:
        self._assert_allowed_name(name)
        payload = io.BytesIO()
        try:
            with self._connect() as ftp:
                self._change_to_target(ftp, create=False)
                ftp.retrbinary(f"RETR {name}", payload.write)
        except PublishError:
            raise
        except Exception as exc:
            raise PublishError("FTP読み戻しに失敗しました。") from exc
        return payload.getvalue()


def artifact_bytes(artifacts=ARTIFACTS) -> dict[str, bytes]:
    result: dict[str, bytes] = {}
    for name, source in artifacts:
        if name not in {"mdvisualizer.html", "app.html"}:
            raise PublishError("公開対象が許可リストと一致しません。")
        try:
            result[name] = source.read_bytes()
        except OSError as exc:
            raise PublishError(f"公開正本 {name} を読み取れません。") from exc
    return result


def stage(payloads: dict[str, bytes], website_root: Path = WEBSITE_ROOT) -> None:
    target = website_root / "www" / "test" / "mdvisualizer"
    for name, payload in payloads.items():
        destination = target / name
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_suffix(destination.suffix + ".mdvisualizer-stage")
            temporary.write_bytes(payload)
            os.replace(temporary, destination)
            if sha256(destination.read_bytes()) != sha256(payload):
                raise PublishError(f"ステージ済み {name} のハッシュが一致しません。")
        except PublishError:
            raise
        except OSError as exc:
            raise PublishError(f"ステージ済み {name} を検証できません。") from exc


def check_http(url: str, expected_status: int, expected_digest: str | None = None, expected_length: int | None = None) -> None:
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            status = response.status
            content_type = response.headers.get_content_type()
            data = response.read()
            length = response.headers.get("Content-Length")
    except urllib.error.HTTPError as exc:
        if exc.code == expected_status:
            return
        raise PublishError("公開HTTPの状態が期待値と一致しません。") from exc
    except Exception as exc:
        raise PublishError("公開HTTPを確認できません。") from exc
    if status != expected_status:
        raise PublishError("公開HTTPの状態が期待値と一致しません。")
    if expected_status == 200 and content_type != "text/html":
        raise PublishError("公開HTMLのMIME型が期待値と一致しません。")
    if expected_length is not None and (length is None or int(length) != expected_length or len(data) != expected_length):
        raise PublishError("公開HTMLのContent-Lengthが期待値と一致しません。")
    if expected_digest is not None and sha256(data) != expected_digest:
        raise PublishError("公開HTMLのSHA-256が期待値と一致しません。")


def result_root(version: str, project_root: Path = PROJECT_ROOT) -> Path:
    if not re.fullmatch(r"v\d+\.\d+\.\d+(?:\.\d+)?", version):
        raise PublishError("対象版の形式が不正です。")
    history = project_root / "dev" / "history" / version
    if not history.is_dir():
        raise PublishError("対象版の履歴フォルダーが存在しません。")
    return history / "logs" / "web-limited-publish"


def create_run_directory(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    directory = root / f"{stamp}-{os.getpid()}"
    directory.mkdir()
    return directory


def acquire_lock(path: Path) -> OwnedLock | None:
    """Create a lock without replacing a stale or another process's lock."""
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return None
    try:
        token = uuid.uuid4().hex
        os.write(descriptor, f"MdVisualizer limited web publish {token}\n".encode("ascii"))
    except OSError:
        os.close(descriptor)
        # 作成直後の自分のlockだけを後始末する。
        path.unlink(missing_ok=True)
        raise
    return OwnedLock(path, descriptor, token)


def release_owned_lock(lock: OwnedLock | None) -> None:
    if lock is None:
        return
    try:
        os.close(lock.descriptor)
    finally:
        try:
            # 自分が作成した内容のままの場合だけ削除する。既存・置換済みlockは残す。
            if lock.path.read_text(encoding="ascii") == f"MdVisualizer limited web publish {lock.token}\n":
                lock.path.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            pass


def write_result(result: dict, output_root: Path) -> Path:
    path = output_root / "result.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def run(mode: str, confirmed: bool, version: str, transport: Transport | None = None, *, payloads: dict[str, bytes] | None = None, website_root: Path = WEBSITE_ROOT, public_base: str = PUBLIC_BASE_URL, history_project_root: Path = PROJECT_ROOT, write_results: bool = True) -> dict:
    if mode == "Publish" and not confirmed:
        raise PublishError("Publish には PublishConfirmed が必要です。")
    output_root = result_root(version, history_project_root)
    data = payloads if payloads is not None else artifact_bytes()
    if set(data) != {"mdvisualizer.html", "app.html"}:
        raise PublishError("公開対象が許可リストと一致しません。")
    manifest = {name: {"sha256": sha256(value), "length": len(value)} for name, value in sorted(data.items())}
    result = {"mode": mode, "version": version, "artifacts": manifest, "phases": []}
    run_directory: Path | None = None
    if write_results:
        run_directory = create_run_directory(output_root)
        (run_directory / "manifest.json").write_text(json.dumps({"version": version, "artifacts": manifest}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        if mode == "Plan":
            result["phases"].append({"name": "manifest", "status": "passed"})
            return result
        if mode == "Publish":
            stage(data, website_root)
            result["phases"].append({"name": "stage", "status": "passed"})
            active_transport = transport if transport is not None else FtpTransport(load_settings())
            for name, entry in manifest.items():
                active_transport.dry_run(name, entry["sha256"])
                result["phases"].append({"name": f"ftp-dry-run:{name}", "status": "passed"})
            for name, value in data.items():
                try:
                    active_transport.upload(name, value)
                except PublishError:
                    result["phases"].append({"name": f"upload:{name}", "status": "failed"})
                    raise
                result["phases"].append({"name": f"upload:{name}", "status": "passed"})
        if mode in {"Publish", "Verify"}:
            active_transport = transport if transport is not None else FtpTransport(load_settings())
            for name, entry in manifest.items():
                try:
                    if sha256(active_transport.download(name)) != entry["sha256"]:
                        raise PublishError(f"FTP読み戻し {name} のハッシュが一致しません。")
                except PublishError:
                    result["phases"].append({"name": f"ftp-readback:{name}", "status": "failed"})
                    raise
                result["phases"].append({"name": f"ftp-readback:{name}", "status": "passed"})
        check_http(f"{public_base}/mdvisualizer.html", 200, manifest["mdvisualizer.html"]["sha256"], manifest["mdvisualizer.html"]["length"])
        check_http(f"{public_base}/index.php", 200)
        check_http(f"{public_base}/app.html", 403)
        result["phases"].append({"name": "http-verify", "status": "passed"})
        return result
    except PublishError as exc:
        result["error"] = str(exc)
        result["phases"].append({"name": "failed", "status": "failed"})
        # 自己テストと呼出し元は、失敗後も完了済みフェーズを判定できる。
        setattr(exc, "result", result)
        raise
    except Exception as exc:
        failure = PublishError("限定公開処理で予期しない失敗が発生しました。")
        result["error"] = str(failure)
        result["phases"].append({"name": "failed", "status": "failed"})
        setattr(failure, "result", result)
        raise failure from exc
    finally:
        if run_directory is not None:
            write_result(result, run_directory)


def main() -> int:
    parser = argparse.ArgumentParser(description="MdVisualizer Web版の2ファイル限定公開")
    parser.add_argument("--mode", choices=("Plan", "Publish", "Verify"), default="Plan")
    parser.add_argument("--version", required=True)
    parser.add_argument("--publish-confirmed", action="store_true")
    args = parser.parse_args()
    try:
        output_root = result_root(args.version)
    except PublishError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    lock_path = output_root / ".publish.lock"
    shared_build_lock = PROJECT_ROOT / ".tools" / "validation-locks" / "shared-build.lock"
    publish_lock: OwnedLock | None = None
    shared_lock: OwnedLock | None = None
    if args.mode == "Publish":
        output_root.mkdir(parents=True, exist_ok=True)
        publish_lock = acquire_lock(lock_path)
        if publish_lock is None:
            print("別のWeb公開処理が実行中です。", file=sys.stderr)
            return 2
        shared_lock = acquire_lock(shared_build_lock)
        if shared_lock is None:
            release_owned_lock(publish_lock)
            print("共有生成を含む検証またはビルドが実行中、または未確認のlockが残っています。", file=sys.stderr)
            return 2
    try:
        result = run(args.mode, args.publish_confirmed, args.version)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except PublishError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        if args.mode == "Publish":
            release_owned_lock(shared_lock)
            release_owned_lock(publish_lock)


if __name__ == "__main__":
    raise SystemExit(main())
