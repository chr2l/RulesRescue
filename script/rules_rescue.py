#!/usr/bin/env python3
"""
rules_rescue.py — récupérer des cartes Rules (Starknet) bloquées sur un ancien
compte Argent X jamais déployé.

Tout tourne sur TA machine. La seed est demandée de façon masquée, n'est jamais
écrite sur le disque ni envoyée sur le réseau : seuls des appels RPC publics en
lecture (et, en mode --execute uniquement, des transactions SIGNÉES) partent.

Installation :
    pip install starknet-py

Étapes :
    1) find      → retrouve quel compte (index + version Argent) correspond à l'adresse des cartes
    2) check     → vérifie l'état on-chain (classe déclarée, déployé ou non, solde STRK/ETH)
    3) migrate   → SIMULE le déploiement + le transfert des cartes (rien n'est envoyé)
    4) migrate --execute → envoie vraiment, après confirmation tapée à la main

Exemples :
    python rules_rescue.py find  --target 0xADRESSE_DES_CARTES
    python rules_rescue.py check --target 0xADRESSE_DES_CARTES
    python rules_rescue.py migrate --target 0xADRESSE_DES_CARTES --to 0xTON_NOUVEAU_WALLET --ids cartes.json
    python rules_rescue.py migrate --target 0xADRESSE_DES_CARTES --to 0x... --ids cartes.json --execute

Comptes Rules d'origine (jamais migrés) : bloqués, voir --rules-key et le guide.
"""
import argparse, asyncio, getpass, hashlib, hmac, json, sys, unicodedata

from starknet_py.hash.address import compute_address
from starknet_py.hash.selector import get_selector_from_name
from starknet_py.net.signer.key_pair import KeyPair
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.models import StarknetChainId
from starknet_py.net.client_models import Call, ResourceBounds, ResourceBoundsMapping

RULES_CARDS = 0x05B456031650C1DE9EEC123D3E7D06A684D321A346D4A7CAC9FD86C2B77CF70F
STRK = 0x04718F5A0FC34CC1AF16A1CDEE98FFB20C31F5CD61D6AB07201858F4287C938D
ETH = 0x049D36570D4E46F48E99674BD3FCC84644DDD6B96F7C741B1562B82F9E004DC7
RPCS = [
    "https://api.zan.top/public/starknet-mainnet",
    "https://starknet-mainnet.public.blastapi.io/rpc/v0_8",
    "https://free-rpc.nethermind.io/mainnet-juno/v0_8",
    "https://rpc.starknet.lava.build",
    "https://starknet.drpc.org",
]

# --- Types de comptes Argent / Braavos connus (classe + calldata du constructeur) ---
PROXY = 0x25EC026985A3BF9D0CC1FE17326B245DFDC3FF89B8FDE106542A3EA56C5A918
INIT = get_selector_from_name("initialize")
TYPES = {
    "argent-cairo0-0.2.3":   ("proxy", 0x33434AD846CDD5F23EB73FF09FE6FDDD568284A0FB7D1BE20EE482F044DABE2),
    "argent-cairo0-0.2.3.1": ("proxy", 0x1A7820094FEAF82D53F53F214B81292D717E7BB9A92BB2488092CD306F3993F),
    "argent-cairo0-0.2.2":   ("proxy", 0x3E327DE1C40540B98D05CBCB13552008E36F0EC8D61D46956D2F9752C294328),
    "argent-cairo0-old":     ("proxy", 0x90AA7A9203BFF78BFB24F0753C180A33D4BAD95B1F4F510B36B00993815704),
    "argent-0.3.0":          ("c1",    0x1A736D6ED154502257F02B1CCDF4D9D1089F80811CD6ACAD48E6B6A9D1F2003),
    "argent-0.3.1":          ("c1",    0x29927C8AF6BCCF3F6FDA035981E765A7BDBF18A2DC0D630494F8758AA908E2B),
    "argent-0.4.0 (Ready)":  ("v4",    0x036078334509B514626504EDC9FB252328D1A240E4E948BEF8D0C08DFF45927F),
}

def deploy_params(kind, ch, pk):
    if kind == "proxy":
        return PROXY, [ch, INIT, 2, pk, 0]
    if kind == "c1":
        return ch, [pk, 0]
    return ch, [0, pk, 1]

# --- Dérivation de clé façon Argent X (BIP39 → clé ETH → HD Starknet → grind) ---
P = 2**256 - 2**32 - 977
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
     0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)
SN_ORDER = 0x0800000000000010FFFFFFFFFFFFFFFFB781126DCAE7B2321E66A241ADC64D2F

def _add(a, b):
    if a is None: return b
    if b is None: return a
    if a[0] == b[0] and (a[1] + b[1]) % P == 0: return None
    l = ((3 * a[0] * a[0]) * pow(2 * a[1], -1, P) if a == b else (b[1] - a[1]) * pow(b[0] - a[0], -1, P)) % P
    x = (l * l - a[0] - b[0]) % P
    return (x, (l * (a[0] - x) - a[1]) % P)

def _mul(k, p=G):
    r = None
    while k:
        if k & 1: r = _add(r, p)
        p = _add(p, p); k >>= 1
    return r

def _derive(seed, path):
    I = hmac.new(b"Bitcoin seed", seed, hashlib.sha512).digest()
    k, c = int.from_bytes(I[:32], "big"), I[32:]
    for part in path.split("/")[1:]:
        h = part.endswith("'"); i = int(part.rstrip("'")) + (0x80000000 if h else 0)
        if h: data = b"\0" + k.to_bytes(32, "big") + i.to_bytes(4, "big")
        else:
            pt = _mul(k); data = bytes([2 + (pt[1] & 1)]) + pt[0].to_bytes(32, "big") + i.to_bytes(4, "big")
        I = hmac.new(c, data, hashlib.sha512).digest()
        k, c = (int.from_bytes(I[:32], "big") + k) % N, I[32:]
    return k

def _grind(key):
    lim = 2**256 - (2**256 % SN_ORDER); kb = key.to_bytes(32, "big"); i = 0
    while True:
        h = int.from_bytes(hashlib.sha256(kb + i.to_bytes(1 if i < 256 else 2, "big")).digest(), "big")
        if h < lim: return h % SN_ORDER
        i += 1

def argentx_key(mnemonic, index):
    m = unicodedata.normalize("NFKD", " ".join(mnemonic.lower().split()))
    seed = hashlib.pbkdf2_hmac("sha512", m.encode(), b"mnemonic", 2048)
    eth = _derive(seed, "m/44'/60'/0'/0/0")
    h = hex(eth)[2:]; h = h if len(h) % 2 == 0 else "0" + h
    return _grind(_derive(bytes.fromhex(h), f"m/44'/9004'/0'/0/{index}"))

def ask_seed():
    s = getpass.getpass("Seed (12/24 mots, saisie masquée) : ")
    if len(s.split()) not in (12, 15, 18, 21, 24):
        sys.exit("Nombre de mots invalide.")
    return s

def find_account(mnemonic, target, max_index=20):
    for i in range(max_index):
        sk = argentx_key(mnemonic, i); pk = KeyPair.from_private_key(sk).public_key
        for name, (kind, ch) in TYPES.items():
            cls, cd = deploy_params(kind, ch, pk)
            if compute_address(class_hash=cls, constructor_calldata=cd, salt=pk, deployer_address=0) == target:
                return i, name, sk, pk, cls, cd
    return None

async def get_client(rpc):
    for url in ([rpc] if rpc else RPCS):
        try:
            c = FullNodeClient(node_url=url); await c.get_block_number(); return c, url
        except Exception as e:
            print(f"  RPC indisponible : {url} ({type(e).__name__})")
    sys.exit("Aucun RPC joignable. Passe --rpc <url> (Alchemy, Infura, Nethermind…).")

async def balance(client, token, addr):
    r = await client.call_contract(Call(to_addr=token, selector=get_selector_from_name("balance_of"), calldata=[addr]))
    return r[0] + (r[1] << 128 if len(r) > 1 else 0)

def u256(x): return [x & ((1 << 128) - 1), x >> 128]

def load_ids(path):
    data = json.load(open(path, encoding="utf-8"))
    return [(int(d["id"]), int(d.get("q", 1))) for d in data]

def transfer_calls(frm, to, items, chunk=40):
    sel = get_selector_from_name("batch_transfer_from")
    calls = []
    for k in range(0, len(items), chunk):
        part = items[k:k + chunk]
        cd = [frm, to, len(part)]
        for i, _ in part: cd += u256(i)
        cd.append(len(part))
        for _, q in part: cd += u256(q)
        calls.append(Call(to_addr=RULES_CARDS, selector=sel, calldata=cd))
    return calls

BIG = ResourceBoundsMapping(
    l1_gas=ResourceBounds(max_amount=10**5, max_price_per_unit=10**14),
    l1_data_gas=ResourceBounds(max_amount=10**5, max_price_per_unit=10**14),
    l2_gas=ResourceBounds(max_amount=10**9, max_price_per_unit=10**11),
)

async def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["find", "check", "migrate"])  # find = vérifie seed/clé
    ap.add_argument("--target", required=True, help="adresse qui détient les cartes")
    ap.add_argument("--to", help="wallet de destination (migrate)")
    ap.add_argument("--ids", help="fichier JSON [{id, q}] des cartes (migrate)")
    ap.add_argument("--rpc", help="URL RPC Starknet mainnet")
    ap.add_argument("--execute", action="store_true", help="envoyer vraiment (sinon simulation)")
    ap.add_argument("--rules-key", action="store_true",
                    help="compte Rules d'origine : utiliser la clé privée exportée depuis rules.art au lieu d'une seed")
    a = ap.parse_args()
    target = int(a.target, 16)

    if a.cmd == "check":
        client, url = await get_client(a.rpc); print("RPC :", url)
        try:
            ch = await client.get_class_hash_at(target); print("Compte DÉPLOYÉ, classe", hex(ch))
        except Exception:
            print("Compte NON déployé (normal pour un compte de migration Rules).")
        for name, (kind, ch) in TYPES.items():
            try: await client.get_class_by_hash(ch); ok = "déclarée"
            except Exception: ok = "INTROUVABLE"
            print(f"  classe {name:24s} {ok}")
        print("Solde STRK :", (await balance(client, STRK, target)) / 1e18)
        print("Solde ETH  :", (await balance(client, ETH, target)) / 1e18)
        return

    if a.rules_key:
        sys.exit("Comptes Rules d'origine : bloqués. Leur contrat (classe 0x01c644…) refuse les transactions v3 "
                 "('Account: invalid tx version') et Starknet n'accepte plus les transactions v1 (testé le 30/10/2026). "
                 "Même avec la clé exportée, les cartes ne peuvent plus en sortir. Voir le guide sur rulesrescue.elie.place.")
    else:
        mnemonic = ask_seed()
        print("Recherche du compte (calcul local, ~30 s)…")
        hit = find_account(mnemonic, target)
        del mnemonic
        if not hit:
            sys.exit("Aucun compte Argent X (index 0–19) de cette seed ne donne cette adresse.")
        idx, name, sk, pk, cls, cd = hit
        print(f"Trouvé : compte n°{idx}, type {name}.")
        if a.cmd == "find":
            return

    if not a.to or not a.ids:
        sys.exit("migrate demande --to et --ids.")
    to = int(a.to, 16)
    items = load_ids(a.ids)
    print(f"{len(items)} objets ({sum(q for _, q in items)} exemplaires) → {hex(to)}")
    client, url = await get_client(a.rpc); print("RPC :", url)
    kp = KeyPair.from_private_key(sk)
    acc = Account(address=target, client=client, key_pair=kp, chain=StarknetChainId.MAINNET)
    try:
        await client.get_class_hash_at(target); deployed = True
    except Exception:
        deployed = False
    calls = transfer_calls(target, to, items)

    if not a.execute:
        txs, nonce = [], 0
        if not deployed:
            txs.append(await acc.sign_deploy_account_v3(class_hash=cls, contract_address_salt=pk,
                                                       constructor_calldata=cd, nonce=0, resource_bounds=BIG))
            nonce = 1
        else:
            nonce = await acc.get_nonce()
        for c in calls:
            txs.append(await acc.sign_invoke_v3(calls=[c], nonce=nonce, resource_bounds=BIG)); nonce += 1
        print(f"Simulation de {len(txs)} transaction(s), sans frais ni envoi…")
        try:
            res = await client.simulate_transactions(transactions=txs, skip_fee_charge=True)
        except Exception as e:
            sys.exit(f"SIMULATION REFUSÉE par le réseau :\n{e}")
        total = 0
        for i, r in enumerate(res):
            tr = r.transaction_trace
            rev = getattr(getattr(tr, "execute_invocation", None), "revert_reason", None)
            fee = r.fee_estimation.overall_fee; total += fee
            print(f"  tx {i}: {'ÉCHEC – ' + str(rev) if rev else 'OK'}  (frais estimés {fee/1e18:.4f} STRK)")
        print(f"Frais totaux estimés : {total/1e18:.4f} STRK. Envoie un peu plus que ça en STRK à {hex(target)} avant --execute.")
        return

    if input(f"Taper OUI pour déployer et transférer vers {hex(to)} : ").strip() != "OUI":
        sys.exit("Annulé.")
    if not deployed:
        print("Déploiement du compte…")
        r = await Account.deploy_account_v3(address=target, class_hash=cls, salt=pk, key_pair=kp,
                                            client=client, constructor_calldata=cd, auto_estimate=True)
        await r.wait_for_acceptance(); print("  déployé.")
    for k, c in enumerate(calls):
        r = await acc.execute_v3(calls=[c], auto_estimate=True)
        await client.wait_for_tx(r.transaction_hash)
        print(f"  lot {k + 1}/{len(calls)} transféré : {hex(r.transaction_hash)}")
    print("Terminé. Vérifie sur https://voyager.online/contract/" + hex(to))

if __name__ == "__main__":
    asyncio.run(main())
