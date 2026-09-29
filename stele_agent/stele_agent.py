#!/usr/bin/env python3
"""Stelen-Agent des Stele CMS (SPEC §10).

Läuft auf dem Stelen-PC neben Chrome im Kiosk-Modus und meldet alle ``--interval`` Sekunden
Systemwerte an das CMS (``POST /api/agent/report``). Auf Anforderung (Befehl ``screenshot``) und nur mit
``--allow-screenshots`` nimmt er ein Bildschirmfoto auf, verkleinert es auf max. 540 px Breite und lädt es
hoch (``POST /api/agent/screenshot``).

Nur Standardbibliothek; ``psutil``, ``mss`` und ``Pillow`` werden genutzt, wenn vorhanden.
Robust: Netzfehler → Wiederholung mit wachsender Pause (max. 5 min), der Agent stürzt nie ab.

Aufruf:
    python3 stele_agent.py --server http://127.0.0.1:8090 --key <schlüssel> [--interval 60] [--allow-screenshots]
Der Schlüssel kann statt ``--key`` auch in der Umgebungsvariablen ``STELE_AGENT_KEY`` stehen
(dann erscheint er nicht in der Prozessliste).
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import os
import platform
import random
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

AGENT_VERSION = "1.0.0"
MAX_BACKOFF_S = 300
SCREENSHOT_MAX_WIDTH = 540
HTTP_TIMEOUT_S = 20
SCREENSHOTS_DISABLED = "Screenshots auf der Stele deaktiviert"

log = logging.getLogger("stele_agent")

try:  # optional
    import psutil  # type: ignore
except Exception:  # pragma: no cover - abhängig von der Installation
    psutil = None


# ---------------------------------------------------------------------------
# Systemwerte
# ---------------------------------------------------------------------------

def _round(value, digits=1):
    try:
        return None if value is None else round(float(value), digits)
    except (TypeError, ValueError):
        return None


class CpuSampler:
    """CPU-Auslastung in % über das Intervall seit dem letzten Aufruf (psutil oder /proc/stat)."""

    def __init__(self):
        self._last = None
        if psutil:
            try:
                psutil.cpu_percent(interval=None)  # Startwert setzen
            except Exception:
                pass
        else:
            self._last = self._read_proc()

    @staticmethod
    def _read_proc():
        try:
            with open("/proc/stat", encoding="ascii") as fh:
                parts = fh.readline().split()[1:]
            values = [int(v) for v in parts]
            idle = values[3] + (values[4] if len(values) > 4 else 0)
            return sum(values), idle
        except Exception:
            return None

    def percent(self):
        if psutil:
            try:
                return _round(psutil.cpu_percent(interval=None))
            except Exception:
                return None
        now = self._read_proc()
        prev, self._last = self._last, now
        if not now or not prev:
            return None
        total = now[0] - prev[0]
        idle = now[1] - prev[1]
        return _round(100.0 * (total - idle) / total) if total > 0 else None


def ram_percent():
    if psutil:
        try:
            return _round(psutil.virtual_memory().percent)
        except Exception:
            pass
    if sys.platform.startswith("linux"):
        try:
            info = {}
            with open("/proc/meminfo", encoding="ascii") as fh:
                for line in fh:
                    key, _, rest = line.partition(":")
                    info[key] = int(rest.split()[0])
            total = info["MemTotal"]
            avail = info.get("MemAvailable", info.get("MemFree", 0))
            return _round(100.0 * (total - avail) / total)
        except Exception:
            return None
    if os.name == "nt":
        try:
            import ctypes

            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("sullAvailExtendedVirtual", ctypes.c_ulonglong)]

            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
            return _round(stat.dwMemoryLoad)
        except Exception:
            return None
    return None


def disk_percent():
    path = os.environ.get("SystemDrive", "C:") + "\\" if os.name == "nt" else "/"
    try:
        usage = shutil.disk_usage(path)
        return _round(100.0 * usage.used / usage.total)
    except Exception:
        return None


def temperature():
    """Höchste plausible CPU-/Gehäusetemperatur in °C oder None."""
    if psutil and hasattr(psutil, "sensors_temperatures"):
        try:
            temps = psutil.sensors_temperatures() or {}
            values = [t.current for entries in temps.values() for t in entries if t.current and 0 < t.current < 130]
            if values:
                return _round(max(values))
        except Exception:
            pass
    if sys.platform.startswith("linux"):
        values = []
        try:
            base = "/sys/class/thermal"
            for name in os.listdir(base):
                if not name.startswith("thermal_zone"):
                    continue
                try:
                    with open(os.path.join(base, name, "temp"), encoding="ascii") as fh:
                        v = int(fh.read().strip()) / 1000.0
                    if 0 < v < 130:
                        values.append(v)
                except Exception:
                    continue
        except Exception:
            pass
        if values:
            return _round(max(values))
    return None


def uptime_s():
    if psutil:
        try:
            return int(time.time() - psutil.boot_time())
        except Exception:
            pass
    if sys.platform.startswith("linux"):
        try:
            with open("/proc/uptime", encoding="ascii") as fh:
                return int(float(fh.read().split()[0]))
        except Exception:
            return None
    if os.name == "nt":
        try:
            import ctypes
            ctypes.windll.kernel32.GetTickCount64.restype = ctypes.c_ulonglong
            return int(ctypes.windll.kernel32.GetTickCount64() // 1000)
        except Exception:
            return None
    return None


def ip_addresses():
    ips = []
    if psutil:
        try:
            for addrs in psutil.net_if_addrs().values():
                for a in addrs:
                    if a.family == socket.AF_INET and not a.address.startswith("127."):
                        ips.append(a.address)
        except Exception:
            pass
    if not ips:
        # Primäre Adresse ermitteln, ohne Daten zu senden (UDP-connect setzt nur die Route).
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("192.0.2.1", 9))
                ips.append(s.getsockname()[0])
        except Exception:
            pass
        try:
            for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
                addr = info[4][0]
                if not addr.startswith("127.") and addr not in ips:
                    ips.append(addr)
        except Exception:
            pass
    return sorted(set(ips))


def _mss_instance():
    import mss  # type: ignore
    factory = getattr(mss, "MSS", None) or mss.mss  # neuere mss-Versionen: mss.MSS
    return factory()


def screen_size():
    """Bildschirmauflösung {w, h} oder None."""
    try:
        with _mss_instance() as sct:
            mon = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]
            return {"w": int(mon["width"]), "h": int(mon["height"])}
    except Exception:
        pass
    if os.name == "nt":
        try:
            import ctypes
            user32 = ctypes.windll.user32
            try:
                user32.SetProcessDPIAware()
            except Exception:
                pass
            return {"w": int(user32.GetSystemMetrics(0)), "h": int(user32.GetSystemMetrics(1))}
        except Exception:
            return None
    if shutil.which("xrandr") and os.environ.get("DISPLAY"):
        try:
            out = subprocess.run(["xrandr", "--current"], capture_output=True, text=True, timeout=5).stdout
            for line in out.splitlines():
                if " current " in line:
                    part = line.split(" current ", 1)[1].split(",", 1)[0]
                    w, h = part.replace(" ", "").split("x")
                    return {"w": int(w), "h": int(h)}
        except Exception:
            return None
    return None


def collect_report(cpu: CpuSampler):
    return {
        "hostname": socket.gethostname(),
        "os": f"{platform.system()} {platform.release()}".strip(),
        "uptime_s": uptime_s(),
        "cpu": cpu.percent(),
        "ram": ram_percent(),
        "disk": disk_percent(),
        "temp": temperature(),
        "ips": ip_addresses(),
        "screen": screen_size(),
        "agent_version": AGENT_VERSION,
    }


# ---------------------------------------------------------------------------
# Bildschirmfoto
# ---------------------------------------------------------------------------

def _pil_to_jpeg(img):
    img = img.convert("RGB")
    if img.width > SCREENSHOT_MAX_WIDTH:
        height = max(1, round(img.height * SCREENSHOT_MAX_WIDTH / img.width))
        img = img.resize((SCREENSHOT_MAX_WIDTH, height))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80, optimize=True)
    return buf.getvalue()


def take_screenshot() -> bytes:
    """Bildschirm aufnehmen → JPEG (max. 540 px breit). Wirft RuntimeError, wenn nichts klappt."""
    fake = os.environ.get("STELE_AGENT_FAKE_SCREENSHOT")
    errors = []
    try:
        from PIL import Image  # type: ignore
    except Exception:
        Image = None

    if fake:  # Test-Attrappe: Datei statt echter Aufnahme (nie den echten Desktop in Tests fotografieren)
        if Image is None:
            with open(fake, "rb") as fh:
                return fh.read()
        return _pil_to_jpeg(Image.open(fake))

    if Image is not None:
        try:
            with _mss_instance() as sct:
                mon = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]
                shot = sct.grab(mon)
                return _pil_to_jpeg(Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX"))
        except Exception as exc:
            errors.append(f"mss: {exc}")
        try:
            from PIL import ImageGrab  # type: ignore
            return _pil_to_jpeg(ImageGrab.grab())
        except Exception as exc:
            errors.append(f"ImageGrab: {exc}")

    # Kommandozeilen-Werkzeuge (Linux): ImageMagick (X11) oder grim (Wayland)
    if shutil.which("import") and os.environ.get("DISPLAY"):
        try:
            out = subprocess.run(["import", "-silent", "-window", "root", "-resize", f"{SCREENSHOT_MAX_WIDTH}x>",
                                  "-quality", "80", "jpeg:-"], capture_output=True, timeout=30, check=True).stdout
            if out:
                return out
        except Exception as exc:
            errors.append(f"import: {exc}")
    if shutil.which("grim") and os.environ.get("WAYLAND_DISPLAY"):
        try:
            out = subprocess.run(["grim", "-t", "jpeg", "-"], capture_output=True, timeout=30, check=True).stdout
            if out and Image is not None:
                return _pil_to_jpeg(Image.open(io.BytesIO(out)))
            if out:
                return out
        except Exception as exc:
            errors.append(f"grim: {exc}")
    raise RuntimeError("Bildschirmfoto nicht möglich (" + "; ".join(errors or ["kein Werkzeug gefunden – mss/Pillow installieren"]) + ")")


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

class AgentError(Exception):
    def __init__(self, message, status=0):
        super().__init__(message)
        self.status = status


class Client:
    def __init__(self, server: str, key: str):
        self.server = server.rstrip("/")
        self.key = key

    def _request(self, path, data: bytes, content_type: str):
        req = urllib.request.Request(self.server + path, data=data, method="POST", headers={
            "Content-Type": content_type,
            "Accept": "application/json",
            "X-Stele-Key": self.key,
            "User-Agent": f"stele-agent/{AGENT_VERSION}",
        })
        try:
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as res:
                body = res.read()
        except urllib.error.HTTPError as exc:
            message = f"HTTP {exc.code}"
            try:
                message = json.loads(exc.read().decode("utf-8"))["error"]["message"]
            except Exception:
                pass
            raise AgentError(message, exc.code) from None
        except (urllib.error.URLError, OSError) as exc:
            raise AgentError(f"Server nicht erreichbar: {getattr(exc, 'reason', exc)}") from None
        try:
            return json.loads(body.decode("utf-8")) if body else {}
        except ValueError:
            raise AgentError("Ungültige Antwort des Servers") from None

    def report(self, payload: dict):
        return self._request("/api/agent/report", json.dumps(payload).encode("utf-8"), "application/json; charset=utf-8")

    def screenshot(self, jpeg: bytes, command_id=None):
        boundary = uuid.uuid4().hex
        parts = []
        if command_id is not None:
            parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="command_id"\r\n\r\n{command_id}\r\n').encode())
        parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="screenshot.jpg"\r\n'
                      'Content-Type: image/jpeg\r\n\r\n').encode() + jpeg + b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode())
        return self._request("/api/agent/screenshot", b"".join(parts), f"multipart/form-data; boundary={boundary}")


# ---------------------------------------------------------------------------
# Hauptschleife
# ---------------------------------------------------------------------------

class Agent:
    def __init__(self, client: Client, interval: int, allow_screenshots: bool):
        self.client = client
        self.interval = max(10, int(interval))
        self.allow_screenshots = allow_screenshots
        self.cpu = CpuSampler()
        self.failures = 0
        self.results = []        # Befehlsergebnisse für den nächsten Bericht
        self.handled = []        # zuletzt ausgeführte Befehls-IDs (Doppelausführung vermeiden)
        self.last_screenshot_at = None

    def run_once(self):
        payload = collect_report(self.cpu)
        if self.results:
            payload["command_results"] = self.results[:50]
        if self.last_screenshot_at:
            payload["screenshot_at"] = self.last_screenshot_at
        res = self.client.report(payload)
        self.results = self.results[len(payload.get("command_results", [])):]
        for cmd in (res or {}).get("commands") or []:
            self.handle(cmd)

    def handle(self, cmd):
        cid = cmd.get("id")
        name = cmd.get("command")
        if cid is not None:
            if cid in self.handled:
                return
            self.handled = (self.handled + [cid])[-100:]
        if name != "screenshot":
            log.info("Befehl %s ignoriert (übernimmt der Player)", name)
            return
        if not self.allow_screenshots:
            log.info("Screenshot angefordert, aber deaktiviert")
            self.results.append({"id": cid, "ok": False, "message": SCREENSHOTS_DISABLED})
            return
        try:
            jpeg = take_screenshot()
            self.client.screenshot(jpeg, cid)
            self.last_screenshot_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            self.results.append({"id": cid, "ok": True, "message": f"Screenshot hochgeladen ({len(jpeg) // 1024} KB)"})
            log.info("Screenshot hochgeladen (%d Bytes)", len(jpeg))
        except Exception as exc:  # nie abstürzen
            log.warning("Screenshot fehlgeschlagen: %s", exc)
            self.results.append({"id": cid, "ok": False, "message": str(exc)[:300]})

    def next_delay(self, ok: bool):
        if ok:
            self.failures = 0
            return self.interval
        self.failures += 1
        # 15 s, 30 s, 60 s … höchstens 5 min, mit etwas Streuung
        base = min(MAX_BACKOFF_S, 15 * (2 ** (self.failures - 1)))
        return base * random.uniform(0.8, 1.0)

    def loop(self, once=False):
        log.info("Stelen-Agent %s gestartet – Server %s, Intervall %d s, Screenshots %s",
                 AGENT_VERSION, self.client.server, self.interval, "erlaubt" if self.allow_screenshots else "deaktiviert")
        while True:
            ok = False
            try:
                self.run_once()
                ok = True
            except AgentError as exc:
                level = logging.ERROR if exc.status in (401, 403) else logging.WARNING
                log.log(level, "Bericht fehlgeschlagen: %s", exc)
            except Exception as exc:  # unerwartet – protokollieren, weiterlaufen
                log.exception("Unerwarteter Fehler: %s", exc)
            if once:
                return ok
            delay = self.next_delay(ok)
            if not ok:
                log.info("Neuer Versuch in %d s", delay)
            time.sleep(delay)


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Stelen-Agent des Stele CMS: meldet Systemwerte, nimmt auf Wunsch Screenshots auf.")
    p.add_argument("--server", default=os.environ.get("STELE_AGENT_SERVER", "http://127.0.0.1:8090"),
                   help="Adresse des CMS, z. B. http://192.168.1.10:8090")
    p.add_argument("--key", default=os.environ.get("STELE_AGENT_KEY"), help="Stelen-Schlüssel (oder STELE_AGENT_KEY)")
    p.add_argument("--interval", type=int, default=60, help="Sekunden zwischen zwei Berichten (Standard 60, min. 10)")
    p.add_argument("--allow-screenshots", action="store_true", help="Screenshots auf Anforderung des CMS erlauben")
    p.add_argument("--once", action="store_true", help="nur einen Bericht senden und beenden (Test)")
    p.add_argument("--verbose", "-v", action="store_true", help="ausführliche Ausgabe")
    args = p.parse_args(argv)
    if not args.key:
        p.error("Stelen-Schlüssel fehlt (--key oder Umgebungsvariable STELE_AGENT_KEY)")
    if not args.server.startswith(("http://", "https://")):
        p.error("--server muss mit http:// oder https:// beginnen")
    return args


def main(argv=None):
    args = parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    agent = Agent(Client(args.server, args.key), args.interval, args.allow_screenshots)
    try:
        ok = agent.loop(once=args.once)
    except KeyboardInterrupt:
        log.info("Beendet")
        return 0
    return 0 if ok in (None, True) else 1


if __name__ == "__main__":
    sys.exit(main())
