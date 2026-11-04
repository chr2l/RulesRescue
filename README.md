# Rules Rescue

Retrouver et récupérer ses cartes **Rules** (rules.art, NFT ERC-1155 sur Starknet) après la fermeture du site.

Site public : **https://rules.elie.place** (Explorer, guide de récupération, outil).

## Contenu

| Dossier | Rôle |
|---|---|
| `script/rules_rescue.py` | Outil local : `find` (retrouve le vieux compte Argent X à partir de la seed, hors ligne), `check` (état on-chain), `migrate` (simule puis, avec `--execute`, déploie le compte et transfère les cartes). |
| `site/src/` | Sources du site : `head.html` (styles), `app.html` (explorateur), `guide.html` (guide + outil), `worker.template.js` (Cloudflare Worker). |
| `site/build.py` | Assemble `site/dist/index.html` et `site/dist/worker.js`. |
| `app/` | Nouvelle interface : fork non officiel de [ruleslabs/interface](https://github.com/ruleslabs/interface) (ISC, Charles Lanier), branché sur le Worker. Aperçu sur beta.rules.elie.place. |

## Pourquoi les cartes « disparaissent »

Fin 2023, la migration Rules envoyait les cartes vers le compte actif de l'extension Argent X ou Braavos connectée. Ces comptes Argent X v0.3.0 n'ont souvent jamais été déployés. Ready (ex-Argent) calcule aujourd'hui une autre adresse (v0.4.0) avec la même seed, donc ne les affiche pas. Le script recalcule l'ancienne adresse, la déploie et transfère les cartes.

Vérifié par simulation sur mainnet (octobre 2026) : déploiement ≈ 0,03 STRK, transfert ≈ 0,06 STRK par lot de 40 cartes.

## Utilisation du script

```bash
pip install starknet-py
python script/rules_rescue.py find    --target 0xADRESSE_DES_CARTES
python script/rules_rescue.py check   --target 0xADRESSE_DES_CARTES
python script/rules_rescue.py migrate --target 0xADRESSE_DES_CARTES --to 0xDESTINATION --ids cartes.json
python script/rules_rescue.py migrate --target 0xADRESSE_DES_CARTES --to 0xDESTINATION --ids cartes.json --execute
```

`cartes.json` se télécharge depuis l'Explorer du site. La seed est saisie masquée et ne quitte jamais la machine.

## Déploiement

1. `python site/build.py` (assemble `site/dist/index.html`, copie le Worker dans `site/dist/worker.js`).
2. Le Worker Cloudflare `rules-rescue` (domaine `rules.elie.place`, application Access en bypass = accès sans login) lit la page et le script dans le KV `rules-rescue-site`.
3. Pour mettre à jour la page et le script : ouvrir `https://rules.elie.place/admin?t=<ADMIN_TOKEN>#<base64 de {"html":…, "script":…}>` (le jeton est un secret du Worker, jamais committé). Le code du Worker se redéploie via l'API Cloudflare.

Site non officiel, sans lien avec Rules Labs. Les illustrations des cartes appartiennent à leurs artistes ; le site ne les héberge pas, il les relaie depuis l'explorateur Voyager.
