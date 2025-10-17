#!/bin/bash

# Script to remove low-value comments from TypeScript files
# Focuses on obvious/redundant comments that don't add value

TARGET_DIR="packages/import/src"

echo "Cleaning up low-value comments in $TARGET_DIR..."

# Function to remove comments that match certain patterns
remove_obvious_comments() {
    # Remove comments that just say what the code does
    find "$TARGET_DIR" -name "*.ts" -type f -exec sed -i '' \
        -e '/^[[:space:]]*\/\/ Load raw data from storage$/d' \
        -e '/^[[:space:]]*\/\/ Handle Result type - fail fast/d' \
        -e '/^[[:space:]]*\/\/ Save /d' \
        -e '/^[[:space:]]*\/\/ Mark all processed raw data items as processed/d' \
        -e '/^[[:space:]]*\/\/ Log the processing results$/d' \
        -e '/^[[:space:]]*\/\/ Check for existing/d' \
        -e '/^[[:space:]]*\/\/ Import raw data$/d' \
        -e '/^[[:space:]]*\/\/ Update session with error/d' \
        -e '/^[[:space:]]*\/\/ Fetch and validate/d' \
        -e '/^[[:space:]]*\/\/ Process each/d' \
        -e '/^[[:space:]]*\/\/ Validate CSV data using Zod schemas$/d' \
        -e '/^[[:space:]]*\/\/ Log first few validation errors for debugging$/d' \
        -e '/^[[:space:]]*\/\/ Verify [a-z]* classification$/d' \
        -e '/^[[:space:]]*\/\/ Verify [a-z]*$/d' \
        -e '/^[[:space:]]*\/\/ Verify metadata$/d' \
        -e '/^[[:space:]]*\/\/ Verify amount$/d' \
        -e '/^[[:space:]]*\/\/ Verify fee$/d' \
        -e '/^[[:space:]]*\/\/ Extract /d' \
        -e '/^[[:space:]]*\/\/ Test /d' \
        -e '/^[[:space:]]*\/\/ Mock /d' \
        -e '/^[[:space:]]*\/\/ Create a mock/d' \
        -e '/^[[:space:]]*\/\/ Should have/d' \
        -e '/^[[:space:]]*\/\/ Auto-register providers/d' \
        -e '/^[[:space:]]*\/\/ Initialize wallet for this address/d' \
        -e '/^[[:space:]]*\/\/ Fetch transactions based on/d' \
        -e '/^[[:space:]]*\/\/ Wrap each transaction with provider provenance/d' \
        -e '/^[[:space:]]*\/\/ Keep original provider response for audit trail$/d' \
        -e '/^[[:space:]]*\/\/ Check cache first/d' \
        -e '/^[[:space:]]*\/\/ Skip addresses that/d' \
        -e '/^[[:space:]]*\/\/ Add transactions to the unique set/d' \
        -e '/^[[:space:]]*\/\/ Always use mainnet$/d' \
        -e '/^[[:space:]]*\/\/ Cast to BlockchainImportParams for blockchain imports$/d' \
        -e '/^[[:space:]]*\/\/ Group raw data by session ID$/d' \
        -e '/^[[:space:]]*\/\/ Get raw data items that match our filters/d' \
        -e '/^[[:space:]]*\/\/ Create sessions with raw data structure/d' \
        -e '/^[[:space:]]*\/\/ Filter to only pending items for this session$/d' \
        -e '/^[[:space:]]*\/\/ Combine import params and result metadata/d' \
        -e '/^[[:space:]]*\/\/ For both blockchain and exchange imports/d' \
        -e '/^[[:space:]]*\/\/ Blockchain imports now store normalized data/d' \
        -e '/^[[:space:]]*\/\/ Exchange imports have always stored/d' \
        -e '/^[[:space:]]*\/\/ raw_data and normalized_data are JSON strings/d' \
        -e '/^[[:space:]]*\/\/ Fallback to raw_data if normalized_data/d' \
        -e '/^[[:space:]]*\/\/ Create processor with session-specific context$/d' \
        -e '/^[[:space:]]*\/\/ Process this session/d' \
        -e '/^[[:space:]]*\/\/ Other errors (network, auth, etc.)$/d' \
        {} \;
    
    echo "Removed obvious action comments"
}

# Function to remove inline obvious comments
remove_inline_obvious() {
    find "$TARGET_DIR" -name "*.ts" -type f -exec sed -i '' \
        -e 's/[[:space:]]*\/\/ Convert satoshis to BTC$//' \
        -e 's/[[:space:]]*\/\/ Convert to BTC$//' \
        -e 's/[[:space:]]*\/\/ User is sender$//' \
        -e 's/[[:space:]]*\/\/ User is recipient$//' \
        -e 's/[[:space:]]*\/\/ User is also recipient$//' \
        -e 's/[[:space:]]*\/\/ User initiates contract call$//' \
        -e 's/[[:space:]]*\/\/ Most recent session$//' \
        -e 's/[[:space:]]*\/\/ One item failed validation$//' \
        {} \;
    
    echo "Removed inline obvious comments"
}

# Execute cleanup
remove_obvious_comments
remove_inline_obvious

echo "Comment cleanup complete!"
echo "Please review changes with: git diff packages/import/src"
