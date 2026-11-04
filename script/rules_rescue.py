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
    python rules_rescue.py find  --target 0x079be...
    python rules_rescue.py check --target 0x079be...
    python rules_rescue.py migrate --target 0x079be... --to 0xTON_NOUVEAU_WALLET --ids cartes.json
    python rules_rescue.py migrate --target 0x079be... --to 0x... --ids cartes.json --execute

Comptes Rules d'origine (jamais migrés) : --rules-key. Le compte ne peut plus
signer de transaction (il n'accepte que la v1, refusée par le réseau), mais il
peut encore signer un message hors ligne. Le script signe un « ordre » de la
marketplace Rules (carte contre 0 STRK) ; ton nouveau wallet l'exécute, et le
contrat des cartes laisse la marketplace transférer sans approbation.
    python rules_rescue.py check   --target 0xCOMPTE_RULES --rules-key
    python rules_rescue.py migrate --target 0xCOMPTE_RULES --to 0xWALLET --ids cartes.json --rules-key
"""
import argparse, asyncio, getpass, hashlib, hmac, json, secrets, sys, time, unicodedata

from starknet_py.hash.address import compute_address
from starknet_py.hash.selector import get_selector_from_name
from starknet_py.net.signer.key_pair import KeyPair
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.models import StarknetChainId
from starknet_py.net.client_models import Call, ResourceBounds, ResourceBoundsMapping
from starknet_py.hash.utils import pedersen_hash, message_signature, private_to_stark_key
from starknet_py.cairo.felt import encode_shortstring

RULES_CARDS = 0x05B456031650C1DE9EEC123D3E7D06A684D321A346D4A7CAC9FD86C2B77CF70F
STRK = 0x04718F5A0FC34CC1AF16A1CDEE98FFB20C31F5CD61D6AB07201858F4287C938D
# Marketplace Rules (ruleslabs/marketplace) : le contrat des cartes l'autorise à transférer sans approbation.
RULES_MARKET = 0x01FEA6C39F413EE5A5D81704E4FC45D814C86711947B2973F8DF2A733D6D9937
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

# --- Comptes Rules d'origine : ordres signés hors ligne (marketplace Rules) ---
# Reproduit ruleslabs/marketplace src/marketplace/order.cairo + starknet-messages typed_data.cairo.
# Vérifié contre le vecteur de test ORDER_HASH_1 / ORDER_SIGNATURE_1 du dépôt.
SS = encode_shortstring
U256_T = 0x1094260A770342332E6A73E9256B901D484A438925316205B4B6FF25DF4A97A
ITEM_T = 0x2F28211A4B264A061FC03D701A04B11E2A0A6D97C4F26FD564B3AF79DFB9C1D
ORDER_T = 0xF5CB0008CCF4DF0EA7C494DC3453108B2CC44F5BAAC3214BAB30FBFBE1BF40
DOMAIN_T = 0x38938178EBDF241A3764698E540EAD3E19ED2FB6120E27429961A2378E8B51

def _chain(*xs):
    h = 0
    for x in xs: h = pedersen_hash(h, x)
    return pedersen_hash(h, len(xs))

def _hu(x): return _chain(U256_T, x & ((1 << 128) - 1), x >> 128)

def order_hash(offerer, card_id, qty, cons_token, cons_amount, end_time, salt, chain_id=SS("SN_MAIN")):
    offer = _chain(ITEM_T, RULES_CARDS, _hu(card_id), _hu(qty), 3)
    cons = _chain(ITEM_T, cons_token, _hu(0), _hu(cons_amount), 1)
    msg = _chain(ORDER_T, offer, cons, end_time, salt)
    dom = _chain(DOMAIN_T, SS("Rules Marketplace"), chain_id, SS("1.0"))
    return _chain(SS("StarkNet Message"), dom, offerer, msg)

def order_calldata(card_id, qty, cons_token, cons_amount, end_time, salt):
    # Item::ERC1155 = variante 3, Item::ERC20 = variante 1
    return [3, RULES_CARDS, *u256(card_id), *u256(qty), 1, cons_token, *u256(cons_amount), end_time, salt]

def rescue_calls(offerer, sk, items, end_time, cons_token=STRK, chunk=20):
    """Un fulfill_order par carte, signé avec la clé Rules ; regroupés par lots."""
    sel = get_selector_from_name("fulfill_order")
    calls = []
    for card_id, qty in items:
        salt = secrets.randbits(250)
        h = order_hash(offerer, card_id, qty, cons_token, 0, end_time, salt)
        r, s_ = message_signature(h, sk)
        calls.append(Call(to_addr=RULES_MARKET, selector=sel,
                          calldata=[offerer, *order_calldata(card_id, qty, cons_token, 0, end_time, salt), 2, r, s_]))
    return [calls[k:k + chunk] for k in range(0, len(calls), chunk)]

async def view(client, to, name, cd=()):
    return await client.call_contract(Call(to_addr=to, selector=get_selector_from_name(name), calldata=list(cd)))

def ask_key(label):
    k = getpass.getpass(f"{label} (0x…, saisie masquée) : ").strip()
    try: return int(k, 16)
    except ValueError: sys.exit("Clé invalide (attendu : nombre hexadécimal 0x…).")

async def rules_check(client, target, sk=None):
    """Vérifie que le compte est un compte Rules, que la clé correspond et que la marketplace est toujours branchée."""
    ok = True
    try:
        v = (await view(client, target, "get_version"))[0]
        print("Version du compte :", bytes.fromhex(f"{v:x}").decode(errors="replace"))
    except Exception as e:
        print("get_version a échoué (compte non déployé ou pas un compte Rules) :", type(e).__name__); ok = False
    try:
        pk = (await view(client, target, "get_signer_public_key"))[0]
        print("Clé publique du compte :", hex(pk))
        if sk is not None:
            mine = private_to_stark_key(sk)
            print("Clé fournie :", "CORRESPOND" if mine == pk else f"NE CORRESPOND PAS ({hex(mine)})")
            ok = ok and mine == pk
    except Exception as e:
        print("get_signer_public_key a échoué :", type(e).__name__); ok = False
    m = (await view(client, RULES_CARDS, "marketplace"))[0]
    print("Marketplace autorisée par le contrat des cartes :", hex(m), "(OK)" if m == RULES_MARKET else "(DIFFÉRENTE, la méthode ne marchera pas)")
    try:
        print("Classe de la marketplace :", hex(await client.get_class_hash_at(RULES_MARKET)))
    except Exception:
        print("Marketplace introuvable on-chain."); ok = False
    return ok and m == RULES_MARKET

async def rules_migrate(a, client, target, to, items):
    sk = ask_key("Clé privée exportée de rules.art")
    if not await rules_check(client, target, sk):
        sys.exit("Vérifications échouées : rien n'a été signé.")
    blk = await client.get_block("latest")
    end_time = blk.timestamp + 3600 * 6   # ordres valables 6 h seulement
    batches = rescue_calls(target, sk, items, end_time)
    del sk
    print(f"{len(items)} ordres signés hors ligne, valables jusqu'à {time.strftime('%d/%m %H:%M', time.localtime(end_time))}, "
          f"{len(batches)} transaction(s) depuis {hex(to)}.")
    try:
        await client.get_class_hash_at(to)
    except Exception:
        sys.exit("Le wallet de destination n'est pas déployé : fais une première transaction avec (ou déploie-le dans Ready) puis relance.")

    if not a.execute:
        # Simulation sans la clé du wallet : signature ignorée (skip_validate), aucun frais, rien n'est envoyé.
        dummy = Account(address=to, client=client, key_pair=KeyPair.from_private_key(1), chain=StarknetChainId.MAINNET)
        nonce = await dummy.get_nonce(); txs = []
        for b in batches:
            txs.append(await dummy.sign_invoke_v3(calls=b, nonce=nonce, resource_bounds=BIG)); nonce += 1
        print(f"Simulation de {len(txs)} transaction(s) depuis le wallet de destination…")
        try:
            res = await client.simulate_transactions(transactions=txs, skip_validate=True, skip_fee_charge=True)
        except Exception as e:
            sys.exit(f"SIMULATION REFUSÉE par le réseau :\n{e}")
        total = 0
        for i, r in enumerate(res):
            rev = getattr(getattr(r.transaction_trace, "execute_invocation", None), "revert_reason", None)
            fee = r.fee_estimation.overall_fee; total += fee
            print(f"  tx {i}: {'ÉCHEC – ' + str(rev) if rev else 'OK'}  (frais estimés {fee/1e18:.4f} STRK)")
        print(f"Frais totaux estimés : {total/1e18:.4f} STRK, payés par le wallet de destination. "
              "Les ordres de cette simulation sont jetés ; --execute en signe de nouveaux.")
        return

    if input(f"Taper OUI pour transférer les cartes vers {hex(to)} : ").strip() != "OUI":
        sys.exit("Annulé.")
    dk = ask_key("Clé privée du wallet de destination (Ready : Paramètres > Compte > Exporter la clé privée)")
    acc = Account(address=to, client=client, key_pair=KeyPair.from_private_key(dk), chain=StarknetChainId.MAINNET)
    del dk
    for k, b in enumerate(batches):
        r = await acc.execute_v3(calls=b, auto_estimate=True)
        await client.wait_for_tx(r.transaction_hash)
        print(f"  lot {k + 1}/{len(batches)} transféré : {hex(r.transaction_hash)}")
    print("Terminé. Vérifie sur https://voyager.online/contract/" + hex(to))

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

    if a.cmd == "check" and a.rules_key:
        client, url = await get_client(a.rpc); print("RPC :", url)
        print("Méthode marketplace :", "possible" if await rules_check(client, target) else "IMPOSSIBLE")
        return

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
        if a.cmd != "migrate":
            sys.exit("Avec --rules-key : utilise check (vérifie le compte et la clé) ou migrate.")
        if not a.to or not a.ids:
            sys.exit("migrate demande --to et --ids.")
        client, url = await get_client(a.rpc); print("RPC :", url)
        await rules_migrate(a, client, target, int(a.to, 16), load_ids(a.ids))
        return
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
