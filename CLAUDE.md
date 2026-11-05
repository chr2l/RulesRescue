# CLAUDE.md — rules-rescue

- But : aider les anciens utilisateurs de rules.art à retrouver/récupérer leurs cartes (Starknet ERC-1155, contrat 0x05b4…f70f).
- `script/rules_rescue.py` : Python + starknet-py. Ne jamais logger/écrire la seed. Simulation par défaut, `--execute` + saisie OUI pour envoyer.
- `site/` : sources dans `src/`, build `python site/build.py` → `dist/worker.js` (Worker Cloudflare `rules-rescue`, domaine rules.elie.place). Données via l'API publique Voyager (`/api/nft-transfers`, `/api/nft/{contract}/{id}`), images relayées par `/img/{id}`.
- RPC qui accepte les requêtes navigateur : https://api.zan.top/public/starknet-mainnet
- Style : look Rules (ruleslabs/interface) dans `src/head.html` : header 57px, onglets soulignés, filtres en colonne, cartes Rules, violet #9f04dc. Logo « RULES RESCUE » en SVG inline dans app.html (wordmark Rules S2 + « RESCUE » redessiné), réutilisé avec l'accord de l'utilisateur (04/11/2026). Toujours la mention « non officiel ».
- Ne jamais committer de seed, clé privée, ni les images des cartes.

## Publication & état (30/10/2026)
- Le HTML vit dans le KV `rules-rescue-site` (id df3fe9d9f39849b18b314f741a41b420), clés `html` et `script`. Publier : `python site/build.py`, puis écrire `site/dist/index.html` dans la clé `html` (API Cloudflare KV ou page `/admin?t=<ADMIN_TOKEN>#<base64 JSON {html,script}>`). Ne jamais committer le jeton.
- Worker : routes `/api/cards`, `/api/meta`, `/img/{id}`, `/api/history` (stats d'un compte), `/api/market` (ventes agrégées des deux marchés), `/api/token?id=` (historique d'un exemplaire), `/api/dex`, `/api/cdx` (Wayback), `/admin`, `/admin/put`.
- Marchés : Cairo 1 `0x01fea6…9937` (FulfillOrder) et ancien Cairo 0 `0x063a4b…be8` (OfferCreated/OfferAccepted, adresse tirée de l'historique de ruleslabs/sdk-core). Seuils n° bas / tirages / coefficients C-Score : `SCARCE` dans app.html (sdk-core).
- Langues : FR par défaut, EN via `?lang=en` (attributs `data-en*` dans app.html, guide anglais dans `src/guide.en.html`).
- Médias HD : bucket R2 `rules-assets` servi sur media.elie.place (Access bypass) ; correspondance par nom de carte dans `MAN`/`DUP` (app.html), Pinata en secours.
- Admin d'elie.place : sur `/`, le worker transmet le seul cookie `elie_s` (posé sur .elie.place par le portail) à `https://elie.place/api/moi` ; si rôle admin + double facteur, il injecte `window.RR_ADMIN` (adresse + « ADMIN_NAME »). Sans ça : pas de possession dans le Dex, pas de section « ADMIN_NAME » (`#moi`) dans la barre.
- `/moi` : profil privé (collection Ready), protégé par l'app Cloudflare Access « rules.elie.place/moi » ; le worker refuse sans en-tête Access.
- Ne jamais nommer une fonction globale `history` (écrase window.history).
- À faire : parcours Braavos non testé.
- Droits : ruleslabs/interface déclare ISC dans package.json (pas de fichier LICENSE). Repris : palette, mise en page, logo S2 (accord de l'utilisateur). Pas d'images ni de sons du dépôt. L'idée d'un fork React a été abandonnée (PR #12 fermée) : tout reste dans `site/`.

- rtk actif (hook) : sortie Bash compressée auto. Sortie brute : `rtk bypass <cmd>`. Read/Grep/Glob non concernés.
