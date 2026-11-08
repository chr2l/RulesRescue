# Architecture

Le site tient en **une page HTML** servie par **un Cloudflare Worker**. Pas de framework, pas de base de données : toutes les données viennent de la blockchain Starknet, lues à la demande.

```
navigateur ──► Worker (rules.elie.place) ──► API publique Voyager (transferts, métadonnées)
     │                    │                └► RPC Starknet public (événements du contrat, marchés)
     │                    ├► fichiers statiques (ASSETS) : la page et le script
     │                    └► KV « SITE » : le Dex
     └► médias HD : copie R2 des fichiers IPFS des cartes (Pinata en secours)
```

## Sources

| Fichier | Contenu |
|---|---|
| `site/src/head.html` | Styles (palette et mise en page façon Rules, violet `#9f04dc`). |
| `site/src/app.html` | Structure de la page et tout le JavaScript. Navigation par ancre : `#explorer`, `#dex`, `#tuto`, `#outil`, `#infos` (et `#infos/<partie>`). |
| `site/src/guide.html`, `guide.en.html` | Guide de récupération et outil, en français et en anglais. |
| `site/src/infos.html` | Mentions légales et à propos, avec sommaire latéral. |
| `site/src/worker.template.js` | Le Worker. |

`python3 site/build.py` assemble `head + app (+ guide + infos)` dans `site/dist/public/index.html`, copie le script dans `site/dist/public/rules_rescue.py` et le Worker dans `site/dist/worker.js`.

Langues : français par défaut, anglais avec `?lang=en` (attributs `data-en*` dans la page, sections `data-lang`).

## Routes du Worker

| Route | Rôle |
|---|---|
| `/` | La page (fichier statique ; le Worker y ajoute l'état admin si besoin). |
| `/api/cards?address=` | Cartes détenues par une adresse (Voyager). |
| `/api/meta?ids=` | Métadonnées de cartes (liste d'identifiants). |
| `/api/history?address=` | Statistiques et historique d'un compte (transferts, comptes d'origine, ventes). |
| `/api/market` | Ventes agrégées des deux marchés Rules (Cairo 1 `0x01fea6…9937`, `FulfillOrder` ; ancien Cairo 0 `0x063a4b…be8`, `OfferCreated` / `OfferAccepted`). |
| `/api/token?id=` | Historique d'un exemplaire. |
| `/api/dex` | Les 168 modèles (KV, clé `dex`). |
| `/api/cdx` | Anciennes pages de rules.art (Wayback Machine). |
| `/img/{id}`, `/ipfs/{cid}` | Images relayées et mises en cache. |
| `/rules_rescue.py` | Le script (fichier statique, servi en téléchargement). |
| `/moi` | Profil privé de l'administrateur, derrière Cloudflare Access. |

Les réponses lentes (événements on-chain) sont gardées quelques minutes dans le cache Cloudflare.

### Réglages du Worker

| Nom | Type | Rôle |
|---|---|---|
| `ASSETS` | fichiers statiques | `site/dist/public/` : la page et le script. |
| `SITE` | KV | Données du Dex (clé `dex`). |
| `ADMIN_ADDR`, `ADMIN_NAME` | secrets | Adresse et pseudo affichés pour l'administrateur connecté. Sans elles, la partie admin est simplement désactivée. |

## Publication

Automatique avec Cloudflare Workers Builds : à chaque commit sur `main`, Cloudflare lance `python3 site/build.py` puis `npx wrangler deploy`. Toute la configuration est dans `wrangler.jsonc` (nom `rules-rescue`, domaine, KV, fichiers statiques). Les secrets ne sont pas dans le dépôt : ils se règlent dans Cloudflare (`npx wrangler secret put ADMIN_ADDR`).

## Le contrat des cartes

`0x05b456031650c1de9eec123d3e7d06a684d321a346d4a7cac9fd86c2b77cf70f` (ERC-1155). Les seuils « n° bas », tirages maximum et coefficients du C-Score viennent de [ruleslabs/sdk-core](https://github.com/ruleslabs/sdk-core) (constante `SCARCE` dans `app.html`).
