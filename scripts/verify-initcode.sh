#!/usr/bin/env bash
# Prüft, dass INIT_CODE / INIT_CODE_HASH in src/mainnet-deploy.ts exakt aus diesem Repo reproduzierbar sind:
# Creation-Code per `forge inspect` + ABI-kodierte Konstruktor-Args (USDC, [0x713B…A106], [10000]).
# Nur lokal, keine Netzwerkzugriffe. Exit 0 = identisch, 1 = Abweichung.
set -euo pipefail
cd "$(dirname "$0")/.."

FILE=src/mainnet-deploy.ts
USDC=0x3600000000000000000000000000000000000000
RECIPIENT=0x713B265c525f5aED566A014DcE7E00d3197dA106

creation=$(forge inspect contracts/ZahlknopfSplit.sol:ZahlknopfSplit bytecode)
args=$(cast abi-encode "constructor(address,address[],uint16[])" "$USDC" "[$RECIPIENT]" "[10000]")
expected="${creation}${args#0x}"
expected_hash=$(cast keccak "$expected")

actual=$(sed -n "s/^export const INIT_CODE = '\(0x[0-9a-fA-F]*\)' as Hex$/\1/p" "$FILE")
actual_hash=$(sed -n "s/^export const INIT_CODE_HASH = '\(0x[0-9a-fA-F]*\)' as Hex$/\1/p" "$FILE")

fail=0
if [ -z "$actual" ]; then echo "FEHLER: INIT_CODE nicht in $FILE gefunden"; exit 1; fi
if [ "${expected,,}" = "${actual,,}" ]; then echo "OK   INIT_CODE identisch ($(( (${#actual}-2)/2 )) Bytes)"; else echo "FEHLER: INIT_CODE weicht ab"; fail=1; fi
if [ "${expected_hash,,}" = "${actual_hash,,}" ]; then echo "OK   INIT_CODE_HASH $actual_hash"; else echo "FEHLER: INIT_CODE_HASH weicht ab (neu: $expected_hash, Datei: $actual_hash)"; fail=1; fi
if [ "$(cast keccak "$actual")" = "${actual_hash,,}" ]; then echo "OK   keccak256(INIT_CODE) = INIT_CODE_HASH"; else echo "FEHLER: Hash passt nicht zur Konstante"; fail=1; fi
readme_hash=$(grep -c "$expected_hash" README.md || true)
if [ "$readme_hash" -ge 1 ]; then echo "OK   README nennt den Hash"; else echo "FEHLER: README nennt den Hash nicht"; fail=1; fi
exit $fail
