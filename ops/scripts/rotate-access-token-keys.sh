#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${OUTPUT_DIR:-.}"

mkdir -p "${OUTPUT_DIR}"
openssl genpkey -algorithm Ed25519 -out "${OUTPUT_DIR}/access-token-private.pem"
openssl pkey -in "${OUTPUT_DIR}/access-token-private.pem" -pubout -out "${OUTPUT_DIR}/access-token-public.pem"

echo "Generated:"
echo "  ${OUTPUT_DIR}/access-token-private.pem"
echo "  ${OUTPUT_DIR}/access-token-public.pem"
