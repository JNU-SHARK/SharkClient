r"""
External Shark detection server.

Control IPC:
  - Windows: named pipe \\.\pipe\SharkDetectionPipe
  - Unix:    Unix domain socket at $TMPDIR/shark_detection.sock

Frame payload:
  - Preferred on Windows: shared memory descriptor in `image_shm`
  - Fallback: base64 JPEG/PNG in `image`

The client sends length-prefixed UTF-8 JSON frames:
  [4-byte little-endian length][JSON payload]
"""
from __future__ import annotations

import base64
import json
import logging
import mmap
import os
import socket
import struct
import sys
import time
import traceback
from io import BytesIO
from pathlib import Path
from typing import Callable

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[1]
AI_ROOT = Path(os.environ.get("SHARK_AI_ROOT", REPO_ROOT / "AI Server")).resolve()
if str(AI_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_ROOT))

try:
    from server.Server import DetectionServer
except ImportError:
    from Server import DetectionServer  # type: ignore


PIPE_NAME = r"\\.\pipe\SharkDetectionPipe"
UNIX_SOCK_PATH = os.path.join(
    os.environ.get("SHARK_CACHE_DIR") or os.environ.get("TMPDIR", "/tmp"),
    "shark_detection.sock",
)
READY_MARKER = "[PipeServer] ready"
MAX_FRAME_BYTES = 64 * 1024 * 1024

logger = logging.getLogger("detection_pipe_server")
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)


def _read_exact(read_fn: Callable[[int], bytes], n: int) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        chunk = read_fn(n - len(buf))
        if not chunk:
            raise EOFError("IPC connection closed")
        buf.extend(chunk)
    return bytes(buf)


def _encode_frame(obj: object) -> bytes:
    payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    return struct.pack("<I", len(payload)) + payload


def _decode_frame(read_fn: Callable[[int], bytes]) -> dict:
    header = _read_exact(read_fn, 4)
    (length,) = struct.unpack("<I", header)
    if length == 0 or length > MAX_FRAME_BYTES:
        raise ValueError(f"Bad frame length: {length}")
    payload = _read_exact(read_fn, length)
    return json.loads(payload.decode("utf-8"))


def _read_shared_bytes(desc: dict) -> bytes:
    name = desc.get("name")
    size = int(desc.get("size") or 0)
    if not name or size <= 0 or size > MAX_FRAME_BYTES:
        raise ValueError("Invalid shared-memory image descriptor")

    if os.name == "nt":
        with mmap.mmap(-1, size, tagname=name, access=mmap.ACCESS_READ) as mm:
            return mm.read(size)

    path = desc.get("path")
    if path:
        with open(path, "rb") as f:
            return f.read(size)

    raise RuntimeError("Shared-memory image transport is only enabled on Windows")


def _load_image(req: dict) -> Image.Image:
    shm_desc = req.get("image_shm")
    if isinstance(shm_desc, dict):
        image_bytes = _read_shared_bytes(shm_desc)
    else:
        img_b64 = req.get("image") or req.get("image_b64") or ""
        if not img_b64:
            raise ValueError("Missing image payload")
        if "," in img_b64:
            img_b64 = img_b64.split(",", 1)[1]
        image_bytes = base64.b64decode(img_b64)

    image = Image.open(BytesIO(image_bytes))
    image.load()
    return image


class RequestHandler:
    def __init__(self, detector: DetectionServer):
        self.detector = detector

    def handle(self, req: dict) -> dict:
        try:
            op = req.get("op", "")
            if op == "ping":
                return {"success": True, "pong": True, "timestamp": time.time()}
            if op == "detect":
                return self._detect(req)
            if op == "detect_armor":
                return self._detect_armor(req)
            if op == "detect_car":
                return self._detect_car(req)
            return {"success": False, "error": f"Unknown op: {op!r}"}
        except Exception as exc:
            traceback.print_exc()
            return {"success": False, "error": f"{type(exc).__name__}: {exc}", "detections": []}

    def _with_common_fields(self, req: dict, result: dict) -> dict:
        result.setdefault("active_provider", getattr(self.detector, "active_provider", None))
        if "inference_time" in result and "inference_time_ms" not in result:
            result["inference_time_ms"] = round(float(result["inference_time"]) * 1000.0, 3)
        result.setdefault("transport", req.get("transport", "pipe"))
        return result

    def _detect(self, req: dict) -> dict:
        image = _load_image(req)
        result = self.detector.detect_all(
            image,
            req.get("armor_conf", 0.25),
            req.get("car_conf", 0.25),
            req.get("iou_threshold", 0.45),
            req.get("max_size", 1280),
        )
        return self._with_common_fields(req, result)

    def _detect_armor(self, req: dict) -> dict:
        image = _load_image(req)
        detections = self.detector.detect_armor(image, req.get("conf", 0.25))
        return self._with_common_fields(
            req,
            {
                "success": True,
                "detections": detections,
                "count": len(detections),
                "image_size": {"width": image.width, "height": image.height},
                "timestamp": time.time(),
            },
        )

    def _detect_car(self, req: dict) -> dict:
        image = _load_image(req)
        detections = self.detector.detect_car(image, req.get("conf", 0.25))
        return self._with_common_fields(
            req,
            {
                "success": True,
                "detections": detections,
                "count": len(detections),
                "image_size": {"width": image.width, "height": image.height},
                "timestamp": time.time(),
            },
        )


def _client_loop(handler: RequestHandler, read_fn: Callable[[int], bytes], write_all) -> None:
    while True:
        req = _decode_frame(read_fn)
        write_all(_encode_frame(handler.handle(req)))


def _serve_windows(handler: RequestHandler) -> None:
    try:
        import pywintypes  # type: ignore
        import win32file  # type: ignore
        import win32pipe  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "Windows Named Pipe requires pywin32. Install it in the Python "
            "environment used by the client: python -m pip install pywin32"
        ) from exc

    buffer_size = 1 << 20
    print(READY_MARKER, flush=True)
    logger.info("Windows named pipe listening on %s", PIPE_NAME)

    while True:
        pipe = win32pipe.CreateNamedPipe(
            PIPE_NAME,
            win32pipe.PIPE_ACCESS_DUPLEX,
            win32pipe.PIPE_TYPE_BYTE | win32pipe.PIPE_READMODE_BYTE | win32pipe.PIPE_WAIT,
            win32pipe.PIPE_UNLIMITED_INSTANCES,
            buffer_size,
            buffer_size,
            0,
            None,
        )
        try:
            win32pipe.ConnectNamedPipe(pipe, None)
            logger.info("Client connected")

            def read_fn(n: int) -> bytes:
                hr, data = win32file.ReadFile(pipe, n)
                if hr != 0:
                    raise EOFError(f"ReadFile hr={hr}")
                return data

            _client_loop(handler, read_fn, lambda data: win32file.WriteFile(pipe, data))
        except pywintypes.error as exc:
            logger.warning("Pipe error: %s", exc)
        except EOFError:
            logger.info("Client disconnected")
        except Exception:
            logger.exception("Unexpected client error")
        finally:
            try:
                win32pipe.DisconnectNamedPipe(pipe)
            except Exception:
                pass
            try:
                win32file.CloseHandle(pipe)
            except Exception:
                pass


def _serve_unix(handler: RequestHandler) -> None:
    try:
        os.unlink(UNIX_SOCK_PATH)
    except FileNotFoundError:
        pass

    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(UNIX_SOCK_PATH)
    srv.listen(4)
    print(READY_MARKER, flush=True)
    logger.info("Unix socket listening on %s", UNIX_SOCK_PATH)

    while True:
        conn, _ = srv.accept()
        logger.info("Client connected")
        try:
            _client_loop(handler, conn.recv, conn.sendall)
        except EOFError:
            logger.info("Client disconnected")
        except Exception:
            logger.exception("Unexpected client error")
        finally:
            conn.close()


def main() -> None:
    armor = AI_ROOT / "model" / "armor.onnx"
    car = AI_ROOT / "model" / "car.onnx"
    if not armor.is_file() or not car.is_file():
        logger.error("Models missing: %s / %s", armor, car)
        sys.exit(2)

    force_provider = os.environ.get("ONNX_PROVIDER") or None
    logger.info("Loading DetectionServer (provider=%s)...", force_provider or "auto")
    detector = DetectionServer(str(armor), str(car), force_provider=force_provider, logger=logger)
    handler = RequestHandler(detector)

    if os.name == "nt":
        _serve_windows(handler)
    else:
        _serve_unix(handler)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("Shutting down")
