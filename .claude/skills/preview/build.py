#!/usr/bin/env python3
"""Baut eine Vorschau-Webseite aus einer Spec (JSON) und Bildern.

  .claude/skills/preview/build.py <spec.json> --out <ordner>

Ergebnis: <ordner>/index.html + <ordner>/img/*.jpg (PNG wird zu JPG, max. 1920 px breit).
Bilder in der Spec: "images": {"key": "pfad/zum/bild.png", ...} (relativ zur Spec)
oder automatisch alle Bilder aus --img-dir (key = Dateiname ohne Endung).
Aufbau der Spec und Section-Typen: .claude/skills/preview/README.md, Beispiel: example/spec.json.

Am Ende stehen die files-Map und die capabilities fuer das Artifact-Tool (file_path = <ordner>/index.html).
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
WS = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
IMG_EXT = (".png", ".jpg", ".jpeg", ".webp")


def mockup_tokens():
    """Für Live-Mockups: Design-Tokens der Admin-Oberfläche (hell + dunkel, web/admin/css/tokens.css),
    damit Mockups mit --bg, --surface, --border, --text, --primary … wie die echte UI aussehen."""
    return open(os.path.join(WS, "web", "admin", "css", "tokens.css"), encoding="utf-8").read()


def convert(src, dst_dir, key, max_w, quality):
    from PIL import Image
    im = Image.open(src)
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    rel = f"img/{key}.jpg"
    im.convert("RGB").save(os.path.join(dst_dir, rel), quality=quality, optimize=True)
    return {"src": rel, "w": im.width, "h": im.height}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("spec")
    ap.add_argument("--out", required=True, help="Ausgabeordner (Scratchpad)")
    ap.add_argument("--img-dir", help="alle Bilder dieses Ordners uebernehmen (key = Dateiname)")
    ap.add_argument("--max-width", type=int, default=1920)
    ap.add_argument("--quality", type=int, default=82)
    args = ap.parse_args()

    spec_dir = os.path.dirname(os.path.abspath(args.spec))
    spec = json.load(open(args.spec, encoding="utf-8"))
    os.makedirs(os.path.join(args.out, "img"), exist_ok=True)

    sources = {}
    if args.img_dir:
        for f in sorted(os.listdir(args.img_dir)):
            if f.lower().endswith(IMG_EXT):
                sources[os.path.splitext(f)[0]] = os.path.join(args.img_dir, f)
    for key, path in (spec.get("images") or {}).items():
        sources[key] = path if os.path.isabs(path) else os.path.join(spec_dir, path)

    images = {}
    for key, path in sources.items():
        if not os.path.exists(path):
            sys.exit(f"Bild fehlt: {key} -> {path}")
        images[key] = convert(path, args.out, key, args.max_width, args.quality)
    spec["images"] = images

    # alle referenzierten Keys pruefen, damit keine leeren Rahmen entstehen
    used = set()
    for sec in spec.get("sections", []):
        used |= {it["img"] for it in sec.get("items", []) if isinstance(it, dict) and it.get("img")}
        used |= {k for p in sec.get("pairs", []) for k in (p["before"], p["after"])}
        used |= {s["img"] for f in sec.get("flows", []) for s in f["steps"]}
    missing = sorted(used - images.keys())
    if missing:
        sys.exit("Fehlende Bilder in der Spec: " + ", ".join(missing))

    tpl = open(os.path.join(HERE, "template.html"), encoding="utf-8").read()
    tokens = mockup_tokens()
    # </script> im eingebetteten Inhalt unschaedlich machen
    blob = json.dumps(spec, ensure_ascii=False).replace("</", "<\\/")
    title = spec.get("short") or spec.get("title") or "Vorschau"
    html = (tpl.replace("__TITLE__", title.replace("<", "&lt;"))
               .replace("/*__SPEC__*/null", blob)
               .replace("/*__TOKENS__*/", tokens.replace("</", "<\\/")))
    out_html = os.path.join(args.out, "index.html")
    open(out_html, "w", encoding="utf-8").write(html)

    size = os.path.getsize(out_html) + sum(os.path.getsize(os.path.join(args.out, i["src"])) for i in images.values())
    print(f"ok: {out_html}  ({len(images)} Bilder, {size / 1e6:.1f} MB)")
    files = {i["src"]: os.path.join(os.path.abspath(args.out), i["src"]) for i in images.values()}
    print("Artifact files =", json.dumps(files, ensure_ascii=False))
    if spec.get("feedback", True):
        print('Artifact capabilities = {"comments": {}}  (Rueckmeldefelder -> sendToClaude)')


if __name__ == "__main__":
    main()
