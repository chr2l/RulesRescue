#!/usr/bin/env python3
"""Assemble site/src/* + script/rules_rescue.py into site/dist/index.html and site/dist/worker.js."""
import json, pathlib
here = pathlib.Path(__file__).parent
src = here / "src"
html = (src / "head.html").read_text() + "</head><body>" + (src / "app.html").read_text().replace("__GUIDE__", (src / "guide.html").read_text()) + "</body></html>"
script = (here.parent / "script" / "rules_rescue.py").read_text()
worker = (src / "worker.template.js").read_text().replace("__HTML__", json.dumps(html)).replace("__SCRIPT__", json.dumps(script))
(here / "dist").mkdir(exist_ok=True)
(here / "dist" / "index.html").write_text(html)
(here / "dist" / "worker.js").write_text(worker)
print(f"index.html {len(html)//1024} KB, worker.js {len(worker)//1024} KB")
