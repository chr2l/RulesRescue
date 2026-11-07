# Rules Rescue

Retrouver et récupérer ses cartes **Rules** (rules.art, NFT ERC-1155 sur Starknet) après la fermeture du site.

- Site : **https://rules.elie.place** (collection d'une adresse, Dex des 168 modèles, guide pas à pas, outil)
- Projet **non officiel**, sans lien avec Rules Labs. Aucune connexion de wallet sur le site : il ne fait que lire la blockchain.

*English: an unofficial tool to find and recover Rules trading cards (Starknet NFTs) after rules.art shut down. The site is available in English with `?lang=en`.*

## Pourquoi les cartes « disparaissent »

Fin 2023, la migration Rules envoyait les cartes vers le compte actif de l'extension Argent X ou Braavos connectée. Beaucoup de ces comptes Argent X (v0.3.0) n'ont jamais été déployés. Aujourd'hui, Ready (ex-Argent) calcule une autre adresse (v0.4.0) à partir de la même seed, donc il ne les affiche pas. Les cartes sont toujours là : il faut recalculer l'ancienne adresse, la déployer et transférer les cartes.

Vérifié par simulation sur mainnet (octobre 2026) : déploiement ≈ 0,03 STRK, transfert ≈ 0,06 STRK par lot de 40 cartes.

## Organisation du dépôt

| Chemin | Rôle |
|---|---|
| [`script/rules_rescue.py`](script/rules_rescue.py) | Outil à lancer **sur sa propre machine** : `find`, `check`, `migrate` (voir plus bas). |
| [`site/src/`](site/src) | Sources du site : `head.html` (styles), `app.html` (page et JavaScript), `guide.html` / `guide.en.html` (guide FR / EN), `infos.html` (mentions légales), `worker.template.js` (Cloudflare Worker). |
| [`site/build.py`](site/build.py) | Assemble les sources dans `site/dist/` (page unique + Worker). |
| [`site/dist/`](site/dist) | Résultat du build, tel qu'il est publié. |
| [`docs/architecture.md`](docs/architecture.md) | Fonctionnement du site, routes du Worker, sources de données, publication. |
| [`docs/historique.md`](docs/historique.md) | Les étapes du projet, pull request par pull request. |
| `CLAUDE.md`, `.claude/` | Notes et réglages pour les sessions Claude Code qui ont écrit une grande partie du code. |

## Le script de récupération

```bash
pip install starknet-py
python script/rules_rescue.py find    --target 0xADRESSE_DES_CARTES
python script/rules_rescue.py check   --target 0xADRESSE_DES_CARTES
python script/rules_rescue.py migrate --target 0xADRESSE_DES_CARTES --to 0xDESTINATION --ids cartes.json
python script/rules_rescue.py migrate --target 0xADRESSE_DES_CARTES --to 0xDESTINATION --ids cartes.json --execute
```

- `find` retrouve, hors ligne, quel compte de la seed correspond à l'adresse des cartes.
- `check` lit l'état on-chain (déployé ou non, soldes).
- `migrate` **simule** le déploiement et le transfert ; rien n'est envoyé sans `--execute` puis la saisie de `OUI`.
- `cartes.json` se télécharge depuis la page Collection du site.

**Sécurité** : la seed est saisie masquée, n'est jamais écrite sur le disque ni envoyée sur le réseau. Lis le script avant de l'utiliser. Personne n'a besoin de ta seed pour t'aider.

## Construire le site

```bash
python site/build.py   # écrit site/dist/index.html et site/dist/worker.js
```

Ouvre ensuite `site/dist/index.html` dans un navigateur : la page s'affiche, mais les données (`/api/...`) ne viennent qu'avec le Worker. Le détail est dans [docs/architecture.md](docs/architecture.md).

## Contribuer

Les tickets et pull requests sont les bienvenus. Les pull requests passées racontent comment chaque fonctionnalité a été construite et testée : c'est la meilleure porte d'entrée pour relire le code.

## Droits

- Les illustrations des cartes appartiennent à leurs artistes ; le nom et la marque Rules à Rules Labs. Ce dépôt ne contient aucune image de carte.
- Le style de l'interface reprend celui de [ruleslabs/interface](https://github.com/ruleslabs/interface) (licence ISC).
- Mentions légales complètes : https://rules.elie.place/#infos
