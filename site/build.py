#!/usr/bin/env python3
"""Assemble site/src/* into site/dist/index.html and copy the Worker to site/dist/worker.js.
Le Worker lit la page et le script dans KV ; /admin les met à jour (voir README)."""
import json, pathlib
here = pathlib.Path(__file__).parent
src = here / "src"
html = (src / "head.html").read_text() + "</head><body>" + (src / "app.html").read_text().replace("__GUIDE__", (src / "guide.html").read_text() + (src / "guide.en.html").read_text()).replace("__INFOS__", (src / "infos.html").read_text()) + "</body></html>"
script = (here.parent / "script" / "rules_rescue.py").read_text()
worker = (src / "worker.template.js").read_text()
(here / "dist").mkdir(exist_ok=True)
(here / "dist" / "index.html").write_text(html)
(here / "dist" / "worker.js").write_text(worker)
print(f"index.html {len(html)//1024} KB, worker.js {len(worker)//1024} KB")
