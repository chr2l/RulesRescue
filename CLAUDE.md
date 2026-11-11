# CLAUDE.md — rules-rescue

- But : aider les anciens utilisateurs de rules.art à retrouver/récupérer leurs cartes (Starknet ERC-1155, contrat 0x05b4…f70f).
- `script/rules_rescue.py` : Python + starknet-py. Ne jamais logger/écrire la seed. Simulation par défaut, `--execute` + saisie OUI pour envoyer.
- `site/` : sources dans `src/`, build `python site/build.py` → `dist/worker.js` (Worker Cloudflare `rules-rescue`, domaine rulesrescue.elie.place ; l'ancien rules.elie.place redirige en 301 depuis le 11/11/2026). Données via l'API publique Voyager (`/api/nft-transfers`, `/api/nft/{contract}/{id}`), images relayées par `/img/{id}`.
- RPC qui accepte les requêtes navigateur : https://api.zan.top/public/starknet-mainnet
- Style : look Rules (ruleslabs/interface) dans `src/head.html` : header 57px, onglets soulignés, filtres en colonne, cartes Rules, violet #9f04dc. Logo « RULES RESCUE » en SVG inline dans app.html (wordmark Rules S2 + « RESCUE » redessiné), réutilisé avec l'accord de l'utilisateur (04/11/2026). Toujours la mention « non officiel ».
- Ne jamais committer de seed, clé privée, ni les images des cartes.
- Dépôt PUBLIC : jamais d'adresse de wallet personnelle, de pseudo, d'e-mail, d'identifiant Cloudflare ni de chemin local dans le code, les commits ou les PR. Données de l'admin = variables du Worker. Les PR se fusionnent à la main (plus d'auto-merge).

## Publication & état (30/10/2026)
- Publication automatique (depuis le 07/11/2026) : Workers Builds reconstruit et publie à chaque commit sur `main` (`python3 site/build.py` puis `npx wrangler deploy`, réglages dans `wrangler.jsonc`). La page et le script sont des fichiers statiques du Worker (`site/dist/public/`, binding ASSETS) ; le KV `rules-rescue-site` (binding SITE) ne garde que les données du Dex (clé `dex`). `site/dist/` n'est plus dans git.
- Worker : routes `/api/cards`, `/api/meta`, `/img/{id}`, `/api/history` (stats d'un compte), `/api/market` (ventes agrégées des deux marchés), `/api/token?id=` (historique d'un exemplaire), `/api/dex`, `/api/cdx` (Wayback), page `#infos` (mentions légales, `src/infos.html`). Plus de `/admin` : tout passe par GitHub. Doc lecteurs : `docs/`.
- Secrets du Worker : `ADMIN_ADDR` / `ADMIN_NAME` (admin d'elie.place). Toujours en *secret* (un `wrangler deploy` efface les variables simples). L'id du KV dans `wrangler.jsonc` n'est pas un secret.
- Marchés : Cairo 1 `0x01fea6…9937` (FulfillOrder) et ancien Cairo 0 `0x063a4b…be8` (OfferCreated/OfferAccepted, adresse tirée de l'historique de ruleslabs/sdk-core). Seuils n° bas / tirages / coefficients C-Score : `SCARCE` dans app.html (sdk-core).
- Langues : FR par défaut, EN via `?lang=en` (attributs `data-en*` dans app.html, guide anglais dans `src/guide.en.html`).
- Médias HD : bucket R2 `rules-assets` servi sur media.elie.place (Access bypass) ; correspondance par nom de carte dans `MAN`/`DUP` (app.html), Pinata en secours.
- Admin d'elie.place : sur `/`, le worker transmet le seul cookie `elie_s` (posé sur .elie.place par le portail) à `https://elie.place/api/moi` ; si rôle admin + double facteur, il injecte `window.RR_ADMIN` (adresse + pseudo, lus dans les variables du Worker `ADMIN_ADDR` / `ADMIN_NAME`). Sans ça : pas de possession dans le Dex, pas de section profil (`#moi`) dans la barre.
- `/moi` : profil privé (collection Ready), protégé par l'app Cloudflare Access « rules.elie.place/moi (profil privé) », qui couvre rules.elie.place/moi et rulesrescue.elie.place/moi ; le worker refuse sans en-tête Access.
- Ne jamais nommer une fonction globale `history` (écrase window.history).
- À faire : parcours Braavos non testé.
- Droits : ruleslabs/interface déclare ISC dans package.json (pas de fichier LICENSE). Repris : palette, mise en page, logo S2 (accord de l'utilisateur). Pas d'images ni de sons du dépôt. L'idée d'un fork React a été abandonnée (PR #12 fermée) : tout reste dans `site/`.

- rtk actif (hook) : sortie Bash compressée auto. Sortie brute : `rtk bypass <cmd>`. Read/Grep/Glob non concernés.
