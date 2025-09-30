#!/usr/bin/env bash
set -euo pipefail

# Package roots
ROOTS=("../apps" "../packages" "../packages/shared")

for root in "${ROOTS[@]}"; do
  for pkg in "$root"/*; do
    if [ -d "$pkg" ]; then
      pkg_name=$(basename "$pkg")
      out_file="./files_${pkg_name}.txt"

      echo "Processing $pkg -> $out_file"

      find "$pkg" -type f \( \( -name "*.ts" ! -name "*.test.ts" \) -o -name "*.json" \) \
        ! -path "*/node_modules/*" \
        -exec sh -c 'echo "===== {} ====="; cat "{}"' \; \
        > "$out_file"
    fi
  done
done
echo "File logs generated."
