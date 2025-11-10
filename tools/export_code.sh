#!/usr/bin/env bash
set -euo pipefail

# Toggle: set to "true" to include *.test.ts files.
INCLUDE_TESTS="${INCLUDE_TESTS:-false}"

# Package roots
ROOTS=("../apps" "../packages")

for root in "${ROOTS[@]}"; do
  for pkg in "$root"/*; do
    if [ -d "$pkg" ]; then
      pkg_name=$(basename "$pkg")
      out_file="./files_${pkg_name}.txt"

      echo "Processing $pkg -> $out_file"

      if [[ "$INCLUDE_TESTS" == "true" ]]; then
        # Include *.test.ts
        find "$pkg" -type f \
          \( -name "*.ts" -o -name "*.json" \) \
          ! -path "*/node_modules/*" \
          -exec sh -c 'echo "===== {} ====="; cat "{}"' \; \
          > "$out_file"
      else
        # Exclude *.test.ts
        find "$pkg" -type f \
          \( \( -name "*.ts" ! -name "*.test.ts" \) -o -name "*.json" \) \
          ! -path "*/node_modules/*" \
          -exec sh -c 'echo "===== {} ====="; cat "{}"' \; \
          > "$out_file"
      fi
    fi
  done
done

echo "File logs generated."
