#!/usr/bin/env python3
"""Screenshots für die README neu erzeugen (docs/img/*.png).

Startet alles selbst und räumt danach auf – die eigene Instanz (Port 8090, data/) bleibt unberührt:
  1. Testinstanz mit frischen Demo-Daten in einem Temp-Ordner (Standard Port 18095)
  2. Chrome headless mit eigenem Profil und eigenem CDP-Port (Standard 19225), Sprache de-DE
  3. Player der Demo-Stele und Stelen-Agent (ohne Bildschirmfotos) für echte Monitoring-Werte
  4. Zusätzliche Beispieldaten: PDF, zweite Stele, Zeitplan-Eintrag, Touch-Nutzung, Stelen-Screenshot
  5. Aufnahmen je Abschnitt; Stelen-Schlüssel und lokale Pfade werden vorher im Bild ersetzt

Aufruf (aus dem Repo):
  .venv/bin/python -m pip install -r requirements-dev.txt     # einmalig (websocket-client)
  .venv/bin/python docs/screenshots.py                         # alle Abschnitte
  .venv/bin/python docs/screenshots.py media editor            # nur einzelne Abschnitte
  .venv/bin/python docs/screenshots.py --list                  # Abschnitte anzeigen

Voraussetzungen: Chrome/Chromium (sonst CHROME=/pfad/zu/chrome), ffmpeg für das Demo-Video.
"""
import argparse, base64, io, json, os, shutil, signal, subprocess, sys, tempfile, time, urllib.request, uuid
from pathlib import Path

try:
    import websocket  # websocket-client
    from PIL import Image, ImageDraw, ImageFont
except ImportError as exc:  # pragma: no cover
    sys.exit(f"Fehlendes Paket ({exc.name}). Bitte: .venv/bin/python -m pip install -r requirements-dev.txt")

ROOT = Path(__file__).resolve().parent.parent
TOPBAR_CLOSEST = "dialog, .topbar, .show-top, .menu"
MASK_PATH = "/srv/stele-cms/data"


# ---------------------------------------------------------------------------
# Minimaler CDP-Client (Chrome DevTools Protocol)
# ---------------------------------------------------------------------------
class Page:
    def __init__(self, ws_url, errors):
        self.ws = websocket.create_connection(ws_url, max_size=None, suppress_origin=True, timeout=60)
        self.seq = 0
        self.errors = errors
        self.width, self.height = 1440, 900
        self.send("Page.enable")
        self.send("Runtime.enable")

    def send(self, method, **params):
        self.seq += 1
        my = self.seq
        self.ws.send(json.dumps({"id": my, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == my:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error'].get('message')}")
                return msg.get("result", {})
            self._event(msg)

    def _event(self, msg):
        m, p = msg.get("method"), msg.get("params", {})
        if m == "Runtime.exceptionThrown":
            self.errors.append("Fehler: " + p.get("exceptionDetails", {}).get("exception", {}).get("description", "?")[:200])
        elif m == "Runtime.consoleAPICalled" and p.get("type") == "error":
            self.errors.append("console.error: " + " ".join(str(a.get("value", a.get("description", ""))) for a in p.get("args", []))[:200])

    def js(self, expr, *args):
        """Ausdruck oder Funktion (mit Argumenten) im Browser auswerten, Ergebnis als Python-Wert."""
        if args or expr.lstrip().startswith(("(", "async")):
            expr = f"({expr})({', '.join(json.dumps(a) for a in args)})"
        r = self.send("Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True)
        if "exceptionDetails" in r:
            raise RuntimeError(r["exceptionDetails"].get("exception", {}).get("description", "JS-Fehler"))
        return r.get("result", {}).get("value")

    def viewport(self, w=None, h=None):
        self.width, self.height = w or self.width, h or self.height
        self.send("Emulation.setDeviceMetricsOverride", width=self.width, height=self.height, deviceScaleFactor=1, mobile=False)
        time.sleep(0.4)

    def goto(self, url, wait=1.5):
        self.send("Page.navigate", url=url)
        for _ in range(100):
            time.sleep(0.2)
            try:
                if self.js("document.readyState") == "complete":
                    break
            except RuntimeError:
                pass
        time.sleep(wait)

    def png(self):
        self.send("Page.bringToFront")
        return Image.open(io.BytesIO(base64.b64decode(self.send("Page.captureScreenshot", format="png")["data"])))

    def key(self, key="Escape", code=27):
        for t in ("keyDown", "keyUp"):
            self.send("Input.dispatchKeyEvent", type=t, key=key, code=key, windowsVirtualKeyCode=code)
        time.sleep(0.5)

    def click_at(self, x, y):
        for t in ("mousePressed", "mouseReleased"):
            self.send("Input.dispatchMouseEvent", type=t, x=x, y=y, button="left", clickCount=1)

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


class Browser:
    def __init__(self, cdp_port, profile, errors):
        exe = os.environ.get("CHROME") or next((shutil.which(n) for n in ("google-chrome", "chromium", "chromium-browser", "chrome") if shutil.which(n)), None)
        if not exe:
            sys.exit("Chrome/Chromium nicht gefunden – Pfad per CHROME=… angeben.")
        self.port, self.errors = cdp_port, errors
        self.proc = subprocess.Popen([
            exe, "--headless=new", "--no-sandbox", "--hide-scrollbars", "--lang=de-DE", "--accept-lang=de-DE,de",
            f"--remote-debugging-port={cdp_port}", f"--user-data-dir={profile}", "--no-first-run",
            "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env={**os.environ, "LANG": "de_DE.UTF-8", "LANGUAGE": "de_DE"})
        self.version = wait_json(f"http://127.0.0.1:{cdp_port}/json/version", 30)
        self.browser_ws = websocket.create_connection(self.version["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
        self.seq = 0

    def _send(self, method, **params):
        self.seq += 1
        self.browser_ws.send(json.dumps({"id": self.seq, "method": method, "params": params}))
        while True:
            msg = json.loads(self.browser_ws.recv())
            if msg.get("id") == self.seq:
                if "error" in msg:
                    raise RuntimeError(msg["error"].get("message"))
                return msg.get("result", {})

    def new_page(self, url="about:blank", w=1440, h=900, theme="light", isolated=False):
        """Neuer Tab; isolated=True → eigener Kontext ohne Cookies (wie ein fremdes Gerät)."""
        params = {"url": "about:blank"}
        if isolated:
            params["browserContextId"] = self._send("Target.createBrowserContext")["browserContextId"]
        tid = self._send("Target.createTarget", **params)["targetId"]
        p = Page(f"ws://127.0.0.1:{self.port}/devtools/page/{tid}", self.errors)
        p.target = tid
        p.send("Page.addScriptToEvaluateOnNewDocument",
               source=f"try {{ localStorage.setItem('stelecms.theme', '{theme}'); }} catch (e) {{}}")
        p.viewport(w, h)
        if url != "about:blank":
            p.goto(url)
        return p

    def close_page(self, p):
        p.close()
        try:
            self._send("Target.closeTarget", targetId=p.target)
        except RuntimeError:
            pass

    def quit(self):
        try:
            self.browser_ws.close()
        except Exception:
            pass
        stop(self.proc)


def wait_json(url, timeout):
    end = time.time() + timeout
    while time.time() < end:
        try:
            with urllib.request.urlopen(url, timeout=2) as r:
                return json.loads(r.read())
        except Exception:
            time.sleep(0.3)
    raise SystemExit(f"Keine Antwort von {url} nach {timeout} s.")


def stop(proc):
    """Eigenen Kindprozess beenden (nur per Handle, kein pkill)."""
    if proc and proc.poll() is None:
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()


# ---------------------------------------------------------------------------
# Aufnahme-Hilfen
# ---------------------------------------------------------------------------
BOX_JS = """(expr, skip) => {
  const e = (0, eval)(expr);
  const list = (Array.isArray(e) ? e : [e]).filter(Boolean);
  if (!list.length) return null;
  const r = list.map(x => x.getBoundingClientRect());
  const bar = list[0].closest(skip) ? null : document.querySelector('.topbar, .show-top');
  const tb = bar && getComputedStyle(bar).position !== 'static' ? bar.getBoundingClientRect().bottom : 0;
  return {x: Math.min(...r.map(a => a.left)), y: Math.min(...r.map(a => a.top)),
          x2: Math.max(...r.map(a => a.right)), y2: Math.max(...r.map(a => a.bottom)), vh: innerHeight, tb};
}"""
LAST_JS = "(expr) => { const e = (0, eval)(expr); const l = (Array.isArray(e) ? e : [e]).filter(Boolean); return l; }"


def card(title):
    return f"[...document.querySelectorAll('.card')].find(c => c.querySelector('.card__title')?.textContent.includes({json.dumps(title)}))"


DLG = "document.querySelector('dialog[open]')"


class Shooter:
    def __init__(self, base, key, data_dir, out):
        self.base, self.key, self.data_dir, self.out = base, key, str(data_dir), Path(out)
        self.written = []

    def mask(self, p):
        p.js("""(key, dir, repl) => {
          const fix = (t) => t.split(key).join('<schlüssel>').split(dir).join(repl);
          const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n; (n = walk.nextNode());) if (n.nodeValue.includes(key) || n.nodeValue.includes(dir)) n.nodeValue = fix(n.nodeValue);
          for (const e of document.querySelectorAll('input, textarea')) if (e.value.includes(key) || e.value.includes(dir)) e.value = fix(e.value);
        }""", self.key, self.data_dir, MASK_PATH)

    def shot(self, p, name, expr=None, pad=16):
        """Ganze Ansicht (expr=None) oder Ausschnitt um ein Element bzw. eine Liste von Elementen."""
        self.mask(p)
        if expr is None:
            return self._save(p.png(), name)
        p.js(f"(expr) => {{ const l = ({LAST_JS})(expr); l[l.length - 1]?.scrollIntoView({{block: 'center'}}); }}", expr)
        time.sleep(0.4)
        box = p.js(BOX_JS, expr, TOPBAR_CLOSEST)
        if not box:
            print(f"  ! kein Element für {name}")
            return None
        old_h = p.height
        if not (box["y"] >= 0 and box["y2"] <= box["vh"]):
            # Fenster kurz vergrößern, Ausschnitt unter die feste Kopfleiste schieben
            need = int(box["y2"] - box["y"] + 2 * pad + 160)
            if need > box["vh"]:
                p.viewport(h=need)
            box = p.js(BOX_JS, expr, TOPBAR_CLOSEST)
            p.js(f"() => window.scrollBy(0, {box['y']} - {(box['tb'] or 0) + pad + 8})")
            time.sleep(0.8)
            self.mask(p)
            box = p.js(BOX_JS, expr, TOPBAR_CLOSEST)
        img = p.png()
        if p.height != old_h:
            p.viewport(h=old_h)
        W, H = img.size
        crop = (max(0, int(box["x"] - pad)), max(int(box["tb"] or 0), int(box["y"] - pad)),
                min(W, int(box["x2"] + pad)), min(H, int(box["y2"] + pad)))
        return self._save(img.crop(crop), name)

    def _save(self, img, name):
        path = self.out / f"{name}.png"
        img.convert("RGB").quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(path, optimize=True)
        self.written.append(path)
        print(f"  {os.path.relpath(path, ROOT)}  {img.width}×{img.height}")
        return path


def go(p, hash_, wait=1.5):
    p.js("(h) => { location.hash = h; window.scrollTo(0, 0); }", hash_)
    time.sleep(wait)


def click(p, sel, text, wait=1.0):
    p.js("(sel, text) => [...document.querySelectorAll(sel)].find(b => b.textContent.includes(text))?.click()", sel, text)
    time.sleep(wait)


def api(p, method, path, body=None):
    return p.js("""async (m, path, body) => {
      const s = await (await fetch('/api/auth/session')).json();
      const r = await fetch(path, {method: m, headers: {'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf_token || ''},
                                   body: body ? JSON.stringify(body) : undefined});
      return r.json();
    }""", method, path, body)


def login(p, base, user="admin"):
    p.goto(base + "/admin/")
    p.js("""async (u) => {
      await fetch('/api/auth/dev-login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: u})});
    }""", user)
    p.goto(base + "/admin/", wait=2)


def tall(p, h):
    p.viewport(h=h)


# ---------------------------------------------------------------------------
# Beispieldaten
# ---------------------------------------------------------------------------
def demo_pdf():
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", 90)
        small = ImageFont.truetype("DejaVuSans.ttf", 48)
    except OSError:
        font = small = ImageFont.load_default()
    pages = []
    for i, (title, color) in enumerate([("Lageplan", (15, 39, 71)), ("Erdgeschoss", (11, 61, 46)), ("1. Obergeschoss", (122, 16, 32))]):
        im = Image.new("RGB", (1080, 1528), (245, 246, 249))
        d = ImageDraw.Draw(im)
        d.rectangle([0, 0, 1080, 260], fill=color)
        d.text((70, 90), title, font=font, fill="white")
        for r in range(4):
            x, y = 70 + (r % 2) * 480, 360 + (r // 2) * 460
            d.rectangle([x, y, x + 420, y + 400], outline=color, width=8)
            d.text((x + 40, y + 40), f"Raum {i + 1}.{r + 1}", font=small, fill=color)
        pages.append(im)
    buf = io.BytesIO()
    pages[0].save(buf, "PDF", save_all=True, append_images=pages[1:], resolution=150)
    return buf.getvalue()


def upload_screenshot(base, key, jpeg):
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"screen.jpg\"\r\n"
            f"Content-Type: image/jpeg\r\n\r\n").encode() + jpeg + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(f"{base}/api/agent/screenshot", data=body, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "X-Stele-Key": key})
    urllib.request.urlopen(req, timeout=10).read()


def enrich(p, player, base, key):
    p.js("""async (b64) => {
      const s = await (await fetch('/api/auth/session')).json();
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const fd = new FormData();
      fd.append('files', new Blob([bytes], {type: 'application/pdf'}), 'Lageplan.pdf');
      fd.append('tags', JSON.stringify(['Wegweiser']));
      await fetch('/api/contents/upload', {method: 'POST', body: fd, headers: {'X-CSRF-Token': s.csrf_token}});
    }""", base64.b64encode(demo_pdf()).decode())
    api(p, "POST", "/api/steles", {"name": "Stele Mensa", "location": "Mensa, Erdgeschoss", "ip_address": "10.0.0.42", "default_presentation_id": 1})
    api(p, "POST", "/api/schedule", {"stele_id": 1, "presentation_id": 3, "label": "Sommerfest", "days": [6, 7],
                                     "start_time": "10:00", "end_time": "18:00", "priority": 1})
    # Touch-Nutzung: Menü öffnen, Kachel antippen, zurück zur Diashow
    for i in range(3):
        player.click_at(270, 480)
        time.sleep(1.5)
        player.js("(i) => [...document.querySelectorAll('button, [role=button]')].filter(b => b.offsetParent)[i]?.click()", i)
        time.sleep(3)
        player.js("() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Zur Startseite'))?.click()")
        time.sleep(2)
    # „Letzter Screenshot“: Bild des Test-Players (der Agent nimmt nie den Desktop auf)
    im = player.png().convert("RGB")
    im.thumbnail((540, 960))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    upload_screenshot(base, key, buf.getvalue())


# ---------------------------------------------------------------------------
# Abschnitte (Reihenfolge = Aufnahme)
# ---------------------------------------------------------------------------
def s_player(s, b, p, ctx):
    pl = ctx["player"]
    time.sleep(3)
    s.shot(pl, "player")
    pl.click_at(270, 480)
    time.sleep(2)
    s.shot(pl, "player-touch")
    click(pl, "button", "Öffnungszeiten", 2)
    s.shot(pl, "player-touch-item")
    click(pl, "button", "Zur Startseite", 1)


def s_overview(s, b, p, ctx):
    go(p, "/", 2.5)
    s.shot(p, "dashboard")
    s.shot(p, "topbar", "document.querySelector('.topbar__right')", pad=8)
    d = b.new_page(theme="dark")
    d.goto(s.base + "/admin/#/", wait=2.5)
    s.shot(d, "dashboard-dark")
    b.close_page(d)


def s_login(s, b, p, ctx):
    q = b.new_page(s.base + "/admin/", isolated=True)
    s.shot(q, "login")
    q.viewport(540, 960)
    q.goto(s.base + "/player/", wait=3)
    s.shot(q, "player-pairing")
    b.close_page(q)


def s_media(s, b, p, ctx):
    go(p, "/media", 2)
    s.shot(p, "media")
    s.shot(p, "media-toolbar", "[document.querySelector('.page-header'), document.querySelector('.md-toolbar')]")
    click(p, ".page-header__actions button", "Neu", 0.6)
    s.shot(p, "media-new", "[document.querySelector('.page-header__actions'), document.querySelector('.menu')]", pad=12)
    p.key()
    click(p, ".segmented button", "Liste", 1.2)
    s.shot(p, "media-list", "document.querySelector('.md-results')")
    click(p, ".segmented button", "Raster", 1.0)
    tall(p, 1250)
    p.js("() => [...document.querySelectorAll('.md-card')].find(c => c.textContent.includes('Sommerfest'))?.querySelector('.md-card__media, .md-card__title')?.click()")
    time.sleep(1.5)
    s.shot(p, "media-detail", DLG, pad=0)
    p.key()
    tall(p, 900)
    click(p, ".page-header__actions button", "Neu", 0.6)
    click(p, ".menu button, .menu [role=menuitem]", "Webseite", 1.0)
    p.js(f"() => {{ const i = {DLG}?.querySelector('input'); if (i) {{ i.value = 'https://example.com'; i.dispatchEvent(new Event('input', {{bubbles: true}})); }} }}")
    time.sleep(0.5)
    s.shot(p, "media-web", DLG, pad=0)
    p.key()
    go(p, "/media/text/6", 3)
    s.shot(p, "text-editor")
    s.shot(p, "text-templates", card("Vorlage"))
    s.shot(p, "text-design", card("Gestaltung"))


def s_editor(s, b, p, ctx):
    go(p, "/presentations", 2)
    s.shot(p, "presentations", "[document.querySelector('.page-header'), document.querySelector('.pl-grid')]")
    go(p, "/presentations/2", 3.5)
    s.shot(p, "editor")
    s.shot(p, "editor-slides", card("Folien"))
    tall(p, 1350)
    props = "document.querySelector('.pe-props')"
    s.shot(p, "editor-slide", props)
    click(p, "[role=tab]", "Diashow", 1.2)
    s.shot(p, "editor-show", props)
    click(p, "[role=tab]", "Rahmen", 1.2)
    s.shot(p, "editor-frame", props)
    tall(p, 900)
    click(p, ".page-header__actions button", "Vorschau", 3.5)
    s.shot(p, "editor-preview", DLG, pad=0)
    p.key()
    go(p, "/presentations/3", 3)
    s.shot(p, "editor-review", "[document.querySelector('.page-header'), document.querySelector('main .alert')]")


def s_designs(s, b, p, ctx):
    go(p, "/designs", 2)
    s.shot(p, "designs", "[document.querySelector('.page-header'), document.querySelector('.de-grid')]")
    go(p, "/designs/1", 3)
    s.shot(p, "design-editor")
    s.shot(p, "design-header-footer", f"[{card('Header')}, {card('Footer')}]")
    go(p, "/touch-menus/1", 3)
    s.shot(p, "touch-editor")
    s.shot(p, "touch-tiles", card("Kacheln"))


def s_schedule(s, b, p, ctx):
    go(p, "/schedule", 2.5)
    s.shot(p, "schedule", f"[document.querySelector('.page-header'), document.querySelector('.sch-weeknav'), {card('Wochenansicht')}]")
    s.shot(p, "schedule-entries", card("Einträge"))
    tall(p, 1250)
    p.js("() => document.querySelectorAll('.sch-entry, tr.is-clickable')[0]?.click()")
    time.sleep(1.2)
    s.shot(p, "schedule-dialog", DLG, pad=0)
    p.key()
    tall(p, 900)


def s_steles(s, b, p, ctx):
    go(p, "/steles", 2)
    s.shot(p, "steles", "[document.querySelector('.page-header'), document.querySelector('main .grid-auto')]")
    go(p, "/steles/1", 3)
    s.shot(p, "stele-detail")
    click(p, "[role=tab]", "Einstellungen", 1.2)
    s.shot(p, "stele-settings", "document.querySelector('.sd-settings')")
    click(p, "[role=tab]", "Verbindung", 1.2)
    s.shot(p, "stele-connection", "document.querySelector('.sd-conn')")
    click(p, "[role=tab]", "Befehle", 1.2)
    s.shot(p, "stele-log", "document.querySelector('.sd-log')")
    # Neues Gerät meldet sich mit Kopplungscode → Assistent zeigt ihn an
    q = b.new_page(s.base + "/player/", 540, 960, isolated=True)
    time.sleep(2)
    go(p, "/steles", 2)
    click(p, ".page-header__actions button", "Stele hinzufügen", 1.5)
    s.shot(p, "stele-wizard", DLG, pad=0)
    p.key()
    b.close_page(q)


def s_monitoring(s, b, p, ctx):
    go(p, "/monitoring", 3)
    s.shot(p, "monitoring", "[document.querySelector('.page-header'), document.querySelector('main .alert'), document.querySelector('.mon-steles')]")
    s.shot(p, "monitoring-avail", card("Verfügbarkeit"))
    s.shot(p, "monitoring-pc", f"[{card('Stelen-PC')}, {card('Touch-Nutzung')}]")
    s.shot(p, "monitoring-log", f"[{card('Wiedergabeprotokoll')}, {card('Ereignisse')}]")
    s.shot(p, "monitoring-screenshot", card("Letzter Screenshot"))
    s.shot(p, "monitoring-server", card("Server"))


def s_admin(s, b, p, ctx):
    page_ = "document.querySelector('main .page') || document.querySelector('.page')"
    go(p, "/users", 2)
    s.shot(p, "users", "[document.querySelector('.page-header'), document.querySelector('.usr-filter'), document.querySelector('main .table-wrap')]")
    click(p, ".page-header__actions button", "Benutzer anlegen", 1.2)
    s.shot(p, "user-dialog", DLG, pad=0)
    p.key()
    go(p, "/roles", 2.5)
    s.shot(p, "roles")
    click(p, "[role=tab]", "Vergleich", 1.5)
    s.shot(p, "roles-compare", "document.querySelector('.tabs__panel')")
    go(p, "/audit", 2)
    p.js("() => document.querySelector('.aud-entry__sum, .aud-entry summary, .aud-entry button')?.click()")
    time.sleep(0.8)
    s.shot(p, "audit", "[document.querySelector('.page-header'), document.querySelector('.aud-filter'), ...[...document.querySelectorAll('.aud-entry')].slice(0, 6)]")
    go(p, "/settings", 2)
    s.shot(p, "settings", page_)
    click(p, "[role=tab]", "Sicherheit", 1.2)
    s.shot(p, "settings-security", page_)
    click(p, "[role=tab]", "System", 1.2)
    s.shot(p, "settings-system", page_)
    go(p, "/profile", 2)
    s.shot(p, "profile", f"[document.querySelector('.prf-head'), {card('Persönliche Angaben')}, {card('Darstellung')}]")


def s_show(s, b, p, ctx):
    p.goto(s.base + "/admin/show-stele-index.html", wait=3)
    s.shot(p, "show-tour", "document.querySelector('#rundgang')")
    s.shot(p, "show-create", "document.querySelector('#anlegen')")
    s.shot(p, "show-gallery", "document.querySelector('#bausteine')")
    p.goto(s.base + "/admin/")


SECTIONS = {
    "player": s_player, "overview": s_overview, "login": s_login, "media": s_media, "editor": s_editor,
    "designs": s_designs, "schedule": s_schedule, "steles": s_steles, "monitoring": s_monitoring,
    "admin": s_admin, "show": s_show,
}


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="README-Screenshots in einer isolierten Testinstanz erzeugen.")
    ap.add_argument("sections", nargs="*", help="Abschnitte (Standard: alle), siehe --list")
    ap.add_argument("--list", action="store_true", help="Abschnitte anzeigen und beenden")
    ap.add_argument("--port", type=int, default=18095, help="Port der Testinstanz (18090–18099, Standard 18095)")
    ap.add_argument("--cdp-port", type=int, default=19225, help="DevTools-Port für Chrome (Standard 19225)")
    ap.add_argument("--out", default=str(ROOT / "docs" / "img"), help="Zielordner (Standard docs/img)")
    ap.add_argument("--warmup", type=int, default=60, help="Sekunden Laufzeit von Player und Agent vor den Aufnahmen (Standard 60)")
    ap.add_argument("--no-agent", action="store_true", help="Stelen-Agent nicht starten (Karten „Stelen-PC“ bleiben leer)")
    ap.add_argument("--keep", action="store_true", help="Temp-Ordner (Daten, Protokolle) nach dem Lauf behalten")
    args = ap.parse_args()
    if args.list:
        print("\n".join(SECTIONS))
        return
    unknown = [x for x in args.sections if x not in SECTIONS]
    if unknown:
        sys.exit(f"Unbekannte Abschnitte: {', '.join(unknown)} – verfügbar: {', '.join(SECTIONS)}")
    if not 18090 <= args.port <= 18099:
        sys.exit("Bitte einen Testport 18090–18099 verwenden (8090 ist die eigene Instanz).")
    Path(args.out).mkdir(parents=True, exist_ok=True)

    tmp = Path(tempfile.mkdtemp(prefix="stele-shots-"))
    data = tmp / "data"
    base = f"http://127.0.0.1:{args.port}"
    errors, procs, browser = [], [], None
    print(f"Testinstanz {base}, Daten {tmp}")
    try:
        env = {**os.environ, "STELECMS_PORT": str(args.port), "STELECMS_DATA": str(data), "STELECMS_HOST": "127.0.0.1",
               "STELECMS_SEED_DEMO": "1", "STELECMS_BACKGROUND": "1"}
        log = open(tmp / "server.log", "w")
        procs.append(subprocess.Popen([sys.executable, str(ROOT / "server" / "run.py")], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT))
        wait_json(base + "/api/auth/session", 90)

        browser = Browser(args.cdp_port, tmp / "chrome", errors)
        p = browser.new_page()
        login(p, base)
        stele = api(p, "GET", "/api/steles/1")
        key = stele["player_url"].split("key=", 1)[1]

        player = browser.new_page(f"{base}/player/?key={key}", 540, 960)
        time.sleep(8)  # Manifest laden, erste Folie zeigen
        if not args.no_agent:
            agent_env = {**os.environ, "STELE_AGENT_KEY": key, "STELE_AGENT_SERVER": base}
            procs.append(subprocess.Popen([sys.executable, str(ROOT / "stele_agent" / "stele_agent.py"), "--interval", "10"],
                                          env=agent_env, stdout=open(tmp / "agent.log", "w"), stderr=subprocess.STDOUT))
        print("Beispieldaten anlegen …")
        enrich(p, player, base, key)
        print(f"Player und Agent laufen {args.warmup} s …")
        time.sleep(args.warmup)
        p.goto(base + "/admin/", wait=2)

        shooter = Shooter(base, key, data, args.out)
        ctx = {"player": player}
        for name in args.sections or SECTIONS:
            print(f"== {name}")
            try:
                SECTIONS[name](shooter, browser, p, ctx)
            except Exception as exc:
                errors.append(f"Abschnitt {name}: {type(exc).__name__}: {exc}")
                print(f"  ! Abschnitt {name} fehlgeschlagen: {exc}")
        print(f"\n{len(shooter.written)} Bilder geschrieben nach {args.out}")
    finally:
        if browser:
            browser.quit()
        for proc in reversed(procs):
            stop(proc)
        if args.keep:
            print(f"Temp-Ordner behalten: {tmp}")
        else:
            shutil.rmtree(tmp, ignore_errors=True)
    if errors:
        print("\nFehler/Warnungen:\n  " + "\n  ".join(errors))
        sys.exit(1)
    print("Keine Fehler.")


if __name__ == "__main__":
    main()
