#!/bin/bash

OUTPUT_FILE="repo_structure.txt"

# Clear the output file if it exists
> "$OUTPUT_FILE"

echo "Generating repository structure..."

cd ..
# 1. Get all git tracked files
# 2. Exclude .tests.ts files
# 3. Exclude the output file itself just in case
git ls-files | grep -v '\.tests\.ts$' | grep -v "$OUTPUT_FILE" | while read -r file; do

    # Skip non-text files (images, binaries, etc.)
    if ! file "$file" | grep -q text; then continue; fi

    # Write the file name as a header
    echo "==================================================" >> "$OUTPUT_FILE"
    echo "📄 FILE: $file" >> "$OUTPUT_FILE"
    echo "==================================================" >> "$OUTPUT_FILE"

    # Extract signatures using grep.
    # This regex looks for:
    # - classes, interfaces, types, functions (with optional export/async/public prefixes)
    # - Arrow functions (const myFunc = () => )
    # The 'sed' command at the end strips away the opening bracket '{' to keep it clean.

    grep -E '^\s*(export\s+|public\s+|private\s+|protected\s+|async\s+|static\s+|default\s+)*(class|interface|type|function|def|func|fn|struct|enum)\s+[A-Za-z0-9_]+|^\s*(export\s+)?const\s+[A-Za-z0-9_]+\s*=\s*(async\s*)?\(.*=>' "$file" | sed -E 's/\s*\{.*/ ...}/' >> "$OUTPUT_FILE"

    echo "" >> "$OUTPUT_FILE"

done

echo "Done! Output saved to $OUTPUT_FILE"
