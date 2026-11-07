#!/usr/bin/env python3
"""Assemble site/src/* : la page et le script vont dans site/dist/public/ (fichiers statiques du Worker),
le Worker dans site/dist/worker.js. Lancé par Workers Builds à chaque commit sur main (wrangler.jsonc)."""
import json, pathlib
here = pathlib.Path(__file__).parent
src = here / "src"
html = (src / "head.html").read_text() + "</head><body>" + (src / "app.html").read_text().replace("__GUIDE__", (src / "guide.html").read_text() + (src / "guide.en.html").read_text()) + "</body></html>"
script = (here.parent / "script" / "rules_rescue.py").read_text()
worker = (src / "worker.template.js").read_text()
pub = here / "dist" / "public"
pub.mkdir(parents=True, exist_ok=True)
(pub / "index.html").write_text(html)
(pub / "rules_rescue.py").write_text(script)
(here / "dist" / "worker.js").write_text(worker)
print(f"index.html {len(html)//1024} KB, worker.js {len(worker)//1024} KB")
