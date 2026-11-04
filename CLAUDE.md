# CLAUDE.md — rules-rescue

- But : aider les anciens utilisateurs de rules.art à retrouver/récupérer leurs cartes (Starknet ERC-1155, contrat 0x05b4…f70f).
- `script/rules_rescue.py` : Python + starknet-py. Ne jamais logger/écrire la seed. Simulation par défaut, `--execute` + saisie OUI pour envoyer.
- `site/` : sources dans `src/`, build `python site/build.py` → `dist/worker.js` (Worker Cloudflare `rules-rescue`, domaine rules.elie.place). Données via l'API publique Voyager (`/api/nft-transfers`, `/api/nft/{contract}/{id}`), images relayées par `/img/{id}`.
- RPC qui accepte les requêtes navigateur : https://api.zan.top/public/starknet-mainnet
- Style : tokens CSS dans `src/head.html` (sombre, violet #9f04dc, Archivo Black / Inter / Inconsolata). Ne pas reprendre le logo Rules ; mention « non officiel ».
- Ne jamais committer de seed, clé privée, ni les images des cartes.

## Publication & état (30/10/2026)
- Le HTML vit dans le KV `rules-rescue-site` (id df3fe9d9f39849b18b314f741a41b420), clés `html` et `script`. Publier : `python site/build.py`, puis écrire `site/dist/index.html` dans la clé `html` (API Cloudflare KV ou page `/admin?t=<ADMIN_TOKEN>#<base64 JSON {html,script}>`). Ne jamais committer le jeton.
- Worker : routes `/api/cards`, `/api/meta`, `/img/{id}`, `/api/history` (stats d'un compte), `/api/market` (ventes agrégées des deux marchés), `/api/token?id=` (historique d'un exemplaire), `/api/dex`, `/api/cdx` (Wayback), `/admin`, `/admin/put`.
- Marchés : Cairo 1 `0x01fea6…9937` (FulfillOrder) et ancien Cairo 0 `0x063a4b…be8` (OfferCreated/OfferAccepted, adresse tirée de l'historique de ruleslabs/sdk-core). Seuils n° bas / tirages / coefficients C-Score : `SCARCE` dans app.html (sdk-core).
- Langues : FR par défaut, EN via `?lang=en` (attributs `data-en*` dans app.html, guide anglais dans `src/guide.en.html`).
- Médias HD : bucket R2 `rules-assets` servi sur media.elie.place (Access bypass) ; correspondance par nom de carte dans `MAN`/`DUP` (app.html), Pinata en secours.
- `/moi` : profil privé (collection Ready), protégé par l'app Cloudflare Access « rules.elie.place/moi » ; le worker refuse sans en-tête Access.
- Ne jamais nommer une fonction globale `history` (écrase window.history).
- À faire : parcours Braavos non testé.

## App React (`app/`, fork de ruleslabs/interface)
- Build : `cd app && yarn install --ignore-scripts && yarn build` (prebuild : copie Tuto/Outil depuis `site/src/guide.html`, compile les traductions). Pas de typecheck en prod.
- L'API GraphQL Rules est morte : `src/graphql/data/__generated__/types-and-hooks.ts` est un stub ; les données passent par `src/rescue/api.ts` (Worker `/api/cards`, `/api/meta`, `/api/dex`, `/img/{id}`).
- Un profil = `/user/0xADRESSE/cards|packs`. Pages ajoutées : `/dex`, `/tuto`, `/outil`. Textes en français en dur (locale par défaut fr-FR).
- Aperçu : Worker `rules-rescue-beta` (`app/wrangler.toml`, `app/worker/index.js`, relaie `/api`, `/img`, `/ipfs` vers rules.elie.place), déployé par `.github/workflows/deploy-beta.yml` avec le secret `CLOUDFLARE_API_TOKEN`. Ne basculer rules.elie.place qu'avec l'accord de l'utilisateur.
- Droits : ruleslabs/interface n'a pas de fichier LICENSE mais son package.json déclare ISC (Charles Lanier). Le 04/11/2026 l'utilisateur a demandé de forker l'app (dossier `app/`), d'en réutiliser les images/sons et le logo Rules S2 complété par « RESCUE » dans le même style (`app/src/images/logo-rescue.svg`). Garder `app/LICENSE` et la mention « non officiel » (bandeau + badge du header + footer).

- rtk actif (hook) : sortie Bash compressée auto. Sortie brute : `rtk bypass <cmd>`. Read/Grep/Glob non concernés.
