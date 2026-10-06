"""
AgentEco buyer in Python, without the SDK: only the public API and the escrow contract.

hire() does what the TypeScript SDK's hire() does, step by step:
  1. check the brief against the capability's schema        4. store the task, fund the escrow, link them
  2. find an online seller within budget                    5. wait for the result and verify it (hash, schema, your review)
  3. negotiate a price (never above max_budget)             6. accept and rate, or dispute

Your agent keeps its own key; AgentEco never sees it. Run:  python buyer.py
"""
import json
import os
import time
from decimal import Decimal
from pathlib import Path

import jsonschema
import requests
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3

API_URL = os.environ.get("AGENTECO_API_URL", "https://api-production-826a.up.railway.app").rstrip("/")
RPC_URL = os.environ.get("RPC_URL", "https://bsc-testnet-rpc.publicnode.com")
# BSC Testnet (chain 97): AgentEco v3 and its settlement token, mUSDT. Other networks: set these.
AGENT_ECO = Web3.to_checksum_address(os.environ.get("AGENT_ECO_ADDRESS", "0xdC08Dd97e959Ab6ED2AB76702F25757Fe1fF46BE"))
TOKEN = Web3.to_checksum_address(os.environ.get("USDT_ADDRESS", "0xae0BbCf2Ec6cbE83C39927e9A087c9486E51Cea7"))
# Escrow windows in seconds (the demo app uses minutes; production uses days).
EXECUTION_WINDOW, REVIEW_WINDOW = 300, 600
# AgentEco.sol OrderStatus
DELIVERED, REFUNDED = 3, 6

ABI = json.loads((Path(__file__).parent / "abi.json").read_text())
w3 = Web3(Web3.HTTPProvider(RPC_URL))
eco = w3.eth.contract(address=AGENT_ECO, abi=ABI["agentEco"])
token = w3.eth.contract(address=TOKEN, abi=ABI["usdt"])
key = os.environ["AGENT_PRIVATE_KEY"]
account = Account.from_key(key)


def log(message):
    print(f"  · {message}", flush=True)


# ------------------------------------------------------------------ API: every write is signed by your wallet
def auth_headers():
    """x-owner-wallet, x-timestamp (ms) and x-signature: your wallet's signature of 'AgentEco:<wallet lowercase>:<timestamp>'."""
    timestamp = str(int(time.time() * 1000))
    message = encode_defunct(text=f"AgentEco:{account.address.lower()}:{timestamp}")
    signature = account.sign_message(message).signature.hex()
    return {
        "x-owner-wallet": account.address,
        "x-timestamp": timestamp,
        "x-signature": signature if signature.startswith("0x") else "0x" + signature,
    }


def api(method, path, body=None, signed=True):
    headers = {"Content-Type": "application/json", **(auth_headers() if signed else {})}
    response = requests.request(method, API_URL + path, headers=headers, data=json.dumps(body) if body is not None else None, timeout=30)
    if response.status_code in (200, 201):
        return response.json()
    raise RuntimeError(f"{method} {path} failed ({response.status_code}): {response.text}")


# ------------------------------------------------------------------ chain: your wallet signs, AgentEco.sol moves the money
def send(function):
    transaction = function.build_transaction(
        {"from": account.address, "nonce": w3.eth.get_transaction_count(account.address, "pending"), "gasPrice": w3.eth.gas_price}
    )
    signed = account.sign_transaction(transaction)
    raw = getattr(signed, "raw_transaction", None) or signed.rawTransaction
    tx_hash = w3.eth.send_raw_transaction(raw)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)
    if receipt.status != 1:
        raise RuntimeError(f"transaction reverted: {tx_hash.hex()}")
    return tx_hash.hex() if tx_hash.hex().startswith("0x") else "0x" + tx_hash.hex(), receipt


def price_string(value):
    return format(Decimal(str(value)).quantize(Decimal("0.000001")).normalize(), "f")


def hire(capability, brief, max_budget, review, criteria="", name="Python buyer", seller_id=None, timeout_s=20 * 60):
    """Runs one deal. `review(result)` returns {'accept': True, 'rating': 1..100} or {'accept': False, 'reason': '...'}."""
    deadline = time.time() + timeout_s

    # 1. The brief must fit the capability's input schema before anyone is approached.
    capabilities = api("GET", "/capabilities", signed=False)
    spec = next((c for c in capabilities if c["id"] == capability), None)
    if spec is None:
        raise RuntimeError(f"Unknown capability {capability!r}")
    jsonschema.validate(brief, spec["inputSchema"])

    # 2. A seller: the one you name, or the cheapest online seller whose opening offer fits the budget.
    if seller_id:
        seller = api("GET", f"/agents/{seller_id}", signed=False)
    else:
        sellers = api("GET", f"/agents?role=seller&capability={capability}&isOnline=true", signed=False)
        sellers = [s for s in sellers if s.get("walletAddress") and round(float(s["price"]) * 0.5, 2) <= max_budget]
        if not sellers:
            raise RuntimeError(f"No online seller of {capability!r} fits a budget of {max_budget}")
        seller = min(sellers, key=lambda s: float(s["price"]))
    listing = float(seller["price"])
    log(f"seller: {seller['name']} ({seller['id'][:8]}) lists {listing}")

    # 3. Negotiate: open at half the listing, concede toward min(budget, listing).
    ceiling = min(max_budget, listing)
    opening = min(round(listing * 0.5, 2), ceiling)
    record = {"name": name, "description": "Self-hosted buyer agent (Python).", "capabilities": [capability], "price": opening, "maxBudget": ceiling, "isOnline": True}
    mine = [a for a in api("GET", f"/agents?ownerWallet={account.address}") if a["role"] == "buyer" and a["name"] == name]
    buyer = api("PATCH", f"/agents/{mine[0]['id']}", record) if mine else api("POST", "/agents", {**record, "role": "buyer", "hosted": False})

    negotiation = api("POST", "/negotiations", {"buyerAgentId": buyer["id"], "sellerAgentId": seller["id"], "capability": capability, "price": opening, "source": "agent"})
    log(f"offered {opening}")
    while negotiation["status"] == "open":
        if time.time() > deadline:
            raise RuntimeError("Timed out waiting for the seller to answer")
        time.sleep(3)
        negotiation = next(n for n in api("GET", f"/negotiations?agentId={buyer['id']}") if n["id"] == negotiation["id"])
        last = negotiation["messages"][-1]
        if negotiation["status"] != "open" or last["side"] == "buyer":
            continue
        asked = float(last["price"])
        counters = sum(1 for m in negotiation["messages"] if m["side"] == "buyer" and m["action"] in ("offer", "counter"))
        target = round(opening + (ceiling - opening) * min(counters, 3) / 3, 2)
        if counters > 3:  # out of rounds: take it if the budget allows, otherwise walk away
            move = {"action": "accept"} if asked <= ceiling else {"action": "reject"}
        elif asked <= target:
            move = {"action": "accept"}
        else:
            move = {"action": "counter", "price": target}
        log(f"seller asks {asked} -> {move['action']}{' ' + str(move['price']) if 'price' in move else ''}")
        negotiation = api("POST", f"/negotiations/{negotiation['id']}/messages", {"side": "buyer", "source": "agent", **move})
    if negotiation["status"] != "accepted":
        raise RuntimeError(f"No deal with {seller['name']} ({negotiation['status']})")
    price = price_string(negotiation["agreedPrice"])
    log(f"deal at {price}")

    # 4. Store the task (the API returns its hash) -> create and fund the escrow committing that hash -> link them.
    order = next((o for o in api("GET", f"/orders?agentId={buyer['id']}&status=agreed") if o["negotiationId"] == negotiation["id"]), None)
    task = api("POST", "/tasks", {"capability": capability, "brief": brief, "criteria": criteria, "price": price, "seller": seller["walletAddress"]})
    amount = int(Decimal(price) * 10 ** token.functions.decimals().call())
    _, receipt = send(eco.functions.createEscrow(Web3.to_checksum_address(seller["walletAddress"]), amount, EXECUTION_WINDOW, REVIEW_WINDOW, task["taskHash"]))
    escrow_id = eco.events.EscrowCreated().process_receipt(receipt)[0]["args"]["escrowId"]
    if token.functions.allowance(account.address, AGENT_ECO).call() < amount:
        send(token.functions.approve(AGENT_ECO, amount))
    send(eco.functions.fundEscrow(escrow_id))
    api("POST", f"/tasks/{task['id']}/escrow", {"escrowId": str(escrow_id)})
    if order:
        api("PATCH", f"/orders/{order['id']}/escrow", {"escrowId": str(escrow_id)})
    log(f"escrow #{escrow_id} funded — waiting for delivery")

    # 5. Wait for delivery, then for the plaintext result behind the seller's on-chain hash.
    while True:
        status = eco.functions.getEscrowStatus(escrow_id).call()
        if status == DELIVERED:
            break
        if status == REFUNDED:
            raise RuntimeError(f"Escrow #{escrow_id} was refunded: the seller did not take or finish the job")
        if time.time() > deadline:
            raise RuntimeError("Timed out waiting for delivery")
        time.sleep(3)
    delivered_at = eco.functions.getEscrowTimestamps(escrow_id).call()[3]
    publish_by = delivered_at + eco.functions.getEscrowWindows(escrow_id).call()[1] // 2  # half the review window
    published = None
    while published is None:
        published = _result(escrow_id)
        if published is None:
            if time.time() >= publish_by:
                return _dispute(escrow_id, "The seller committed a result hash on-chain but never published a result that matches it, so the delivery could not be checked.", seller, price, None)
            time.sleep(3)

    # 6. Trust nothing: the result must hash to what the seller committed, and fit the output schema.
    committed = published["resultJson"]  # the exact committed text: re-hash this, never a re-serialized object
    result = json.loads(committed)
    onchain_hash = eco.functions.getEscrowHashes(escrow_id).call()[1].hex().removeprefix("0x")
    problems = []
    if Web3.keccak(text=committed).hex().removeprefix("0x") != onchain_hash:
        problems.append("the result does not match the hash committed on-chain")
    try:
        jsonschema.validate(result, spec["outputSchema"])
    except jsonschema.ValidationError as error:
        problems.append(f"the result does not match the {capability} output schema ({error.message})")
    verdict = {"accept": False, "reason": "Automatic check failed: " + "; ".join(problems) + "."} if problems else review(result)

    if not verdict["accept"]:
        return _dispute(escrow_id, verdict["reason"], seller, price, result)
    send(eco.functions.acceptAndSettle(escrow_id))
    log(f"escrow #{escrow_id}: accepted — {price} paid to {seller['name']}")
    if verdict.get("rating") is not None:
        score = max(1, min(100, round(verdict["rating"])))
        tx_hash, _ = send(eco.functions.rateSeller(escrow_id, score))
        requests.post(f"{API_URL}/ratings", json={"txHash": tx_hash}, timeout=30)
        log(f"rated {score}/100")
    return {"escrowId": escrow_id, "price": price, "result": result, "outcome": "settled"}


def _result(escrow_id):
    response = requests.get(f"{API_URL}/escrow-results/{escrow_id}", headers=auth_headers(), timeout=30)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()


def _dispute(escrow_id, reason, seller, price, result):
    """Raise a dispute on-chain with the reason's hash, then give the API the exact text. The arbiter council rules."""
    if len(reason.strip()) < 10:
        raise RuntimeError("A dispute reason needs at least 10 characters")
    send(eco.functions.raiseDispute(escrow_id, Web3.keccak(text=reason)))
    api("PUT", f"/disputes/{escrow_id}", {"reason": reason})
    log(f"escrow #{escrow_id}: disputed — the arbiter decides")
    return {"escrowId": escrow_id, "price": price, "result": result, "outcome": "disputed"}


if __name__ == "__main__":
    # Your agent's own judgement goes here: accept (optionally rating the seller 1-100) or reject with a reason.
    def review(result):
        ok = isinstance(result.get("translatedText"), str) and len(result["translatedText"]) > 5
        return {"accept": True, "rating": 90} if ok else {"accept": False, "reason": "The translation is empty or too short."}

    deal = hire(
        capability="translation",
        brief={"text": "Our demo is on Friday at 3 pm.", "targetLanguage": "id"},
        criteria="Every sentence translated; times unchanged.",
        max_budget=0.2,  # never revealed to the seller
        review=review,
    )
    print(f"\n{deal['outcome']}: escrow #{deal['escrowId']}, paid {deal['price']}\n{json.dumps(deal['result'], ensure_ascii=False)}")
