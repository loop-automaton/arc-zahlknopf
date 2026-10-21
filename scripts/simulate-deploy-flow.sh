#!/usr/bin/env bash
# Simuliert den Mainnet-Deploy-Flow der UI ohne echte Transaktion:
#  1) Arc TESTNET, nur eth_call/eth_estimateGas: Init-Code from Wegwerf-Adresse (kein Key nötig).
#  2) Lokales anvil (kein Fork, kein Netz): Deploy von 0x713B per --auto-impersonate (kein Key),
#     Contract-Adresse aus dem Receipt, dann dieselbe Prüflogik wie die UI (scripts/verify-split.ts),
#     exakter approve + pay gegen ein lokales Mock-USDC, das an 0x3600…0000 eingesetzt wird.
#  3) Negativtest: bestehender Testnet-Contract (andere Empfänger) muss die Prüfung NICHT bestehen.
set -euo pipefail
cd "$(dirname "$0")/.."

INIT=$(sed -n "s/^export const INIT_CODE = '\(0x[0-9a-fA-F]*\)' as Hex$/\1/p" src/mainnet-deploy.ts)
RUNTIME_HASH=$(sed -n "s/^export const RUNTIME_CODE_HASH = '\(0x[0-9a-fA-F]*\)' as Hex$/\1/p" src/mainnet-deploy.ts)
EXPECTED_ADDR=$(sed -n "s/^export const EXPECTED_ADDRESS_NONCE0 = '\(0x[0-9a-fA-F]*\)' as Address$/\1/p" src/mainnet-deploy.ts)
ME=0x713B265c525f5aED566A014DcE7E00d3197dA106
THROWAWAY=0x800600637acE0c5afA6fa09c987D246Cf52C351b   # öffentliche Adresse der Testnet-Wegwerf-Wallet
USDC=0x3600000000000000000000000000000000000000
TESTNET=https://rpc.testnet.arc.io

echo "== 1) Arc Testnet (nur lesend)"
rt=$(cast call --from "$THROWAWAY" --rpc-url "$TESTNET" --create "$INIT")
[ "$(cast keccak "$rt")" = "$RUNTIME_HASH" ] && echo "OK   eth_call --create: Runtime-Hash = $RUNTIME_HASH" || { echo "FAIL Runtime-Hash"; exit 1; }
echo "OK   eth_estimateGas --create: $(cast estimate --from "$THROWAWAY" --rpc-url "$TESTNET" --create "$INIT") Gas"

echo "== 2) Lokales anvil (Port 8547, kein Fork)"
anvil --port 8547 --auto-impersonate --silent --chain-id 5042 &
APID=$!
trap 'kill $APID 2>/dev/null || true' EXIT
L=http://127.0.0.1:8547
for _ in $(seq 1 50); do cast chain-id --rpc-url $L >/dev/null 2>&1 && break; sleep 0.2; done
# Mock-USDC (aus den Foundry-Testhelfern) an die echte USDC-Adresse setzen, ME 5 USDC geben
forge build --quiet
MOCK_RT=$(forge inspect contracts/test-helpers/MockERC20.sol:MockERC20 deployedBytecode)
cast rpc --rpc-url $L anvil_setCode $USDC "$MOCK_RT" >/dev/null
cast rpc --rpc-url $L anvil_setBalance $ME 0x56BC75E2D63100000 >/dev/null
txh=$(cast send --rpc-url $L --unlocked --from $ME --create "$INIT" --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["transactionHash"])')
addr=$(cast receipt --rpc-url $L "$txh" contractAddress)
[ "${addr,,}" = "${EXPECTED_ADDR,,}" ] && echo "OK   Adresse aus Receipt = vorab berechnet ($addr)" || echo "WARN Adresse $addr ≠ $EXPECTED_ADDR"
bun scripts/verify-split.ts $L "$addr"

# exakter approve + pay wie in der UI (Calldaten identisch zur UI-Kodierung)
cast send --rpc-url $L --unlocked --from $ME $USDC "mint(address,uint256)" $ME 5000000 >/dev/null
APPROVE=$(cast calldata "approve(address,uint256)" "$addr" 1000000)
ORDER=$(cast format-bytes32-string "loop-mainnet-test-1")
PAY=$(cast calldata "pay(uint256,bytes32)" 1000000 "$ORDER")
echo "     approve-Calldaten: $APPROVE"
echo "     pay-Calldaten:     $PAY"
cast send --rpc-url $L --unlocked --from $ME $USDC "$APPROVE" >/dev/null
echo "OK   Allowance nach approve: $(cast call --rpc-url $L $USDC 'allowance(address,address)(uint256)' $ME "$addr") (exakt 1000000 erwartet)"
before=$(cast call --rpc-url $L $USDC 'balanceOf(address)(uint256)' $ME)
cast send --rpc-url $L --unlocked --from $ME "$addr" "$PAY" >/dev/null
after=$(cast call --rpc-url $L $USDC 'balanceOf(address)(uint256)' $ME)
echo "OK   pay ausgeführt; USDC-Saldo 0x713B vorher $before, nachher $after (100 % an sich selbst → gleich)"
echo "OK   Contract-Saldo: $(cast call --rpc-url $L $USDC 'balanceOf(address)(uint256)' "$addr"), Rest-Allowance: $(cast call --rpc-url $L $USDC 'allowance(address,address)(uint256)' $ME "$addr")"

echo "== 3) Negativtest: Testnet-Contract 0x4536…aEA8 (5 %/95 %, andere Empfänger) darf NICHT bestehen"
if bun scripts/verify-split.ts "$TESTNET" 0x45364c0e727Fb6DEB933bD108c361a0F6413aEA8; then echo "FAIL Negativtest hat bestanden"; exit 1; else echo "OK   Negativtest korrekt abgelehnt"; fi
echo "== Simulation fertig (keine Transaktion auf Testnet oder Mainnet)"
