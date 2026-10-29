# CLAUDE.md — rules-rescue

- But : aider les anciens utilisateurs de rules.art à retrouver/récupérer leurs cartes (Starknet ERC-1155, contrat 0x05b4…f70f).
- `script/rules_rescue.py` : Python + starknet-py. Ne jamais logger/écrire la seed. Simulation par défaut, `--execute` + saisie OUI pour envoyer.
- `site/` : sources dans `src/`, build `python site/build.py` → `dist/worker.js` (Worker Cloudflare `rules-rescue`, domaine rules.elie.place). Données via l'API publique Voyager (`/api/nft-transfers`, `/api/nft/{contract}/{id}`), images relayées par `/img/{id}`.
- RPC qui accepte les requêtes navigateur : https://api.zan.top/public/starknet-mainnet
- Style : tokens CSS dans `src/head.html` (sombre, violet #9f04dc, Archivo Black / Inter / Inconsolata). Ne pas reprendre le logo Rules ; mention « non officiel ».
- Ne jamais committer de seed, clé privée, ni les images des cartes.
