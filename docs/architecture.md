# Architecture

Le site tient en **une page HTML** servie par **un Cloudflare Worker**. Pas de framework, pas de base de données : toutes les données viennent de la blockchain Starknet, lues à la demande.

```
navigateur ──► Worker (rules.elie.place) ──► API publique Voyager (transferts, métadonnées)
     │                    │                └► RPC Starknet public (événements du contrat, marchés)
     │                    └► KV « site » : la page, le script, le Dex
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

`python site/build.py` assemble `head + app (+ guide + infos)` dans `site/dist/index.html` et copie le Worker dans `site/dist/worker.js`.

Langues : français par défaut, anglais avec `?lang=en` (attributs `data-en*` dans la page, sections `data-lang`).

## Routes du Worker

| Route | Rôle |
|---|---|
| `/` | La page (lue dans le KV, clé `html`). |
| `/api/cards?address=` | Cartes détenues par une adresse (Voyager). |
| `/api/meta?ids=` | Métadonnées de cartes (liste d'identifiants). |
| `/api/history?address=` | Statistiques et historique d'un compte (transferts, comptes d'origine, ventes). |
| `/api/market` | Ventes agrégées des deux marchés Rules (Cairo 1 `0x01fea6…9937`, `FulfillOrder` ; ancien Cairo 0 `0x063a4b…be8`, `OfferCreated` / `OfferAccepted`). |
| `/api/token?id=` | Historique d'un exemplaire. |
| `/api/dex` | Les 168 modèles (KV, clé `dex`). |
| `/api/cdx` | Anciennes pages de rules.art (Wayback Machine). |
| `/img/{id}`, `/ipfs/{cid}` | Images relayées et mises en cache. |
| `/rules_rescue.py` | Le script (KV, clé `script`). |
| `/admin`, `/admin/put` | Mise à jour de la page et du script, protégée par le secret `ADMIN_TOKEN`. |
| `/moi` | Profil privé de l'administrateur, derrière Cloudflare Access. |

Les réponses lentes (événements on-chain) sont gardées quelques minutes dans le cache Cloudflare.

### Réglages du Worker

| Nom | Type | Rôle |
|---|---|---|
| `SITE` | KV | Page (`html`), script (`script`), Dex (`dex`). |
| `ADMIN_TOKEN` | secret | Jeton de `/admin/put`. |
| `ADMIN_ADDR`, `ADMIN_NAME` | variables | Adresse et pseudo affichés pour l'administrateur connecté. Sans elles, la partie admin est simplement désactivée. |

## Publication

1. `python site/build.py`
2. Écrire `site/dist/index.html` dans la clé `html` du KV (API Cloudflare, ou la page `/admin`).
3. Si le Worker a changé : déployer `site/dist/worker.js` en gardant ses liaisons.

## Le contrat des cartes

`0x05b456031650c1de9eec123d3e7d06a684d321a346d4a7cac9fd86c2b77cf70f` (ERC-1155). Les seuils « n° bas », tirages maximum et coefficients du C-Score viennent de [ruleslabs/sdk-core](https://github.com/ruleslabs/sdk-core) (constante `SCARCE` dans `app.html`).
