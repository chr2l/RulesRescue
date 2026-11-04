# CLAUDE.md — rules-rescue

- But : aider les anciens utilisateurs de rules.art à retrouver/récupérer leurs cartes (Starknet ERC-1155, contrat 0x05b4…f70f).
- `script/rules_rescue.py` : Python + starknet-py. Ne jamais logger/écrire la seed. Simulation par défaut, `--execute` + saisie OUI pour envoyer.
- `site/` : sources dans `src/`, build `python site/build.py` → `dist/worker.js` (Worker Cloudflare `rules-rescue`, domaine rules.elie.place). Données via l'API publique Voyager (`/api/nft-transfers`, `/api/nft/{contract}/{id}`), images relayées par `/img/{id}`.
- RPC qui accepte les requêtes navigateur : https://api.zan.top/public/starknet-mainnet
- Style : tokens CSS dans `src/head.html` (sombre, violet #9f04dc, Archivo Black / Inter / Inconsolata). Ne pas reprendre le logo Rules ; mention « non officiel ».
- Ne jamais committer de seed, clé privée, ni les images des cartes.

## Publication & état (30/10/2026)
- Le HTML vit dans le KV `rules-rescue-site` (id df3fe9d9f39849b18b314f741a41b420), clés `html` et `script`. Publier : `python site/build.py`, puis écrire `site/dist/index.html` dans la clé `html` (API Cloudflare KV ou page `/admin?t=<ADMIN_TOKEN>#<base64 JSON {html,script}>`). Ne jamais committer le jeton.
- Worker : routes `/api/cards`, `/api/meta`, `/img/{id}`, `/api/history` (stats d'un compte), `/api/cdx` (Wayback), `/admin`, `/admin/put`.
- À faire : publier la DA « façon Rules » (commit sur main, pas encore en ligne) ; images HD/GIF via Wayback (429 → requêtes lentes, galerie privée uniquement) ; parcours Braavos non testé.
- Droits : le dépôt ruleslabs/interface n'a pas de licence → ne reprendre ni logo, ni images, ni sons ; seulement palette et polices Google.

- rtk actif (hook) : sortie Bash compressée auto. Sortie brute : `rtk bypass <cmd>`. Read/Grep/Glob non concernés.
