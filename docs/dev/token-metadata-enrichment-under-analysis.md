# Token Trust, Reference Metadata, And Asset Review

Status: preferred greenfield direction

If we were starting fresh, we would not design this around one merged token
metadata record plus optional extra fields.

We would design it around four separate concerns:

- on-chain asset facts
- risk evidence
- reference evidence
- persistent review state

## Problem Statement

The immediate bug was an Arbitrum spam token reusing the `USDC` symbol.
The actual failure was broader:

- ingestion accepted same-symbol contracts with weak trust signals
- token trust and token metadata were conflated
- accounting could relax identity beyond raw contract address
- the only strong safety boundary appeared late, during accounting

That means the problem is not "how do we enrich token metadata?"
The problem is:

"What should the system believe about an on-chain asset before linking,
review, and accounting happen?"

## Greenfield Answer

If we were starting today, we would model blockchain assets like this:

### 1. Asset facts

Facts are contract-local data returned by chain-facing providers.

Examples:

- contract address / mint
- blockchain
- symbol
- name
- decimals
- logo URL
- total supply
- provider-returned contract metadata

These are descriptive facts.
They are not trust decisions.

### 2. Risk evidence

Risk evidence is additive evidence that an asset may be suspicious,
spam, spoofed, or otherwise requires review.

Examples:

- provider explicit spam flag
- provider explicit unverified-contract signal
- suspicious URL / homograph / obfuscated metadata
- unsolicited airdrop plus suspicious context
- same-chain same-symbol collision
- symbol collision with a known listed contract

Risk evidence is not the same as exclusion.
It should push assets into `needs-review`, not silently hide them.

### 3. Reference evidence

Reference evidence answers:

- is this contract recognized by a known external registry?
- if yes, what canonical identifier does it map to?

Examples:

- CoinGecko coin ID
- CoinGecko platform ID
- "matched listed contract"
- "no match found"

Reference evidence is useful for ambiguity resolution.
It is not a spam verdict.

### 4. Review state

Review state is user-facing workflow state.

Examples:

- `clear`
- `needs-review`
- `reviewed`
- `excluded-from-accounting`

This state must persist independently from balance projections.
It is the product-level answer to "what should the user look at next?"

## Core Design Rules

### Keep trust separate from metadata

We should not continue with one merged token record that mixes:

- raw provider metadata
- spam hints
- canonical-reference hints
- review workflow state

That shape is fine for cacheable descriptive fields.
It is the wrong shape for policy and review.

### Keep review separate from exclusion

`excluded from accounting` and `needs review` are different concepts.

- exclusion is accounting policy
- review is investigation state

Included assets can still need review.
Excluded assets can already be reviewed.

Any model or UI that collapses those into one state is too weak.

### Keep accounting fail-closed

Accounting should still fail closed when unresolved ambiguity or high-confidence
risk remains in scope.

The current ambiguity gate is the right safety instinct.
It is just too late and too structural on its own.

### Keep ingestion permissive

We still need to import chain history even when an asset looks suspicious.

Do not silently drop transactions.
Persist them, attach evidence, and surface them for review.

## Provider Strategy

### CoinGecko should not be mandatory

CoinGecko is useful as optional reference evidence.
It should not be required to use the app.

No CoinGecko key must mean:

- reference evidence unavailable or unknown

It must not mean:

- token is suspicious by default
- app cannot function
- asset is automatically excluded

### CoinGecko is not the primary spam oracle

CoinGecko is better at answering:

- "is this contract known and listed?"

It is not the right primary answer for:

- "is this token spam?"

Those are different questions.

### Prefer providers with explicit risk semantics for spam

For spam detection, the stronger signals come from:

- providers that explicitly label spam or suspicious tokens
- contract verification signals
- asset-local heuristic detectors
- ambiguity detectors inside our own system

In the current system, Moralis-style provider spam flags are closer to the
question we actually want answered than CoinGecko listing status.

Greenfield, we should model this as a first-class risk-evidence seam instead of
burying it inside a generic token metadata record.

### Reference providers should be optional enrichers

If we use CoinGecko or similar registries, they should be optional reference
enrichers.

They help with:

- same-symbol collisions
- stablecoin spoofing
- showing the user which contract appears canonical
- raising confidence in review prompts

They should not sit in the same operational failover lane as RPC and explorer
providers.

## Suggested Capability Shape

Greenfield, the capability split should look like this:

### Chain providers

Own on-chain facts.

Examples:

- decimals
- token name and symbol
- provider-local metadata
- explicit provider spam / verification flags when available

### Asset review enrichment

Owns evidence collection and review-state assembly.

Inputs:

- chain-provider facts
- optional risk-provider responses
- optional reference-provider responses
- internal ambiguity detectors
- heuristic detectors

Outputs:

- risk evidence
- reference evidence
- computed review status
- concise warning summary for UI

### Assets view

This should be the first-class review surface.

It should show:

- current holdings
- historical activity
- included/excluded state
- `needs-review` state
- warning summary
- why the asset was flagged

It should not be reduced to an exclusion console.

### Balance projection

Balance projections may denormalize review and warning indicators for read
convenience.

They must not own:

- trust policy
- review policy
- source-of-truth review state

## How The System Should Behave

### Ingestion

- import the transaction
- fetch or assemble asset facts
- collect risk evidence
- assign `needs-review` when evidence warrants it
- persist the transaction and asset-review context

### Linking

Linking should become more conservative around suspicious assets.

Examples:

- lower confidence when an asset is `needs-review`
- avoid auto-linking through suspicious token movements
- require review when ambiguity is material

### Accounting

Accounting should:

- continue to fail closed on unresolved same-symbol ambiguity
- fail closed on unresolved high-confidence spoofing or spam signals when they
  are in scope
- never silently collapse identity because symbols happen to match

### Assets view

Assets view should make review actionable.

The first slice should support:

- filtering to `needs-review`
- showing concise evidence
- showing same-symbol collisions
- showing whether a known registry matched the contract
- letting the user confirm the asset as intentional
- letting the user exclude it from accounting

## Confidence Policy

We should make the confidence rules explicit.

### `clear`

Use when:

- no meaningful risk evidence exists
- no unresolved ambiguity exists

### `needs-review`

Use when any of the following holds:

- provider spam flag exists
- suspicious metadata heuristics fire
- same-chain same-symbol collision exists
- symbol collision exists with a known listed contract
- reference evidence is mixed or conflicting
- linking or accounting would otherwise be forced to guess

### `reviewed`

Use when:

- the user explicitly confirmed the asset as intentional

This is not the same as "verified by provider."
It is a user workflow state.

### `excluded-from-accounting`

Use when:

- the user excluded the asset from accounting policy

This may coexist with `reviewed`.

## What We Should Not Build

Do not build:

- a hand-maintained canonical token allowlist
- a design where CoinGecko absence implies spam
- a design where CoinGecko is required for basic app use
- a design where exclusion is the only review action
- a design where one `source` field tries to explain all trust semantics
- a design where balance projections become the trust-policy owner

## First Slice Recommendation

Keep the first implementation narrow and strong.

### Scope

- EVM only
- current ambiguity gate stays in place
- add explicit asset review state
- surface it in `assets view`

### First evidence sources

- existing provider spam / verification flags where available
- current heuristic scam detectors
- same-chain same-symbol ambiguity detection
- optional CoinGecko reference matching when configured

### First user-visible outcomes

- `assets view --needs-review`
- row/detail display of review state and warning summary
- "confirm intentional asset" action
- "exclude from accounting" action
- accounting still blocks unresolved ambiguity

This gets the important behavior in place without pretending we can solve
global token trust in one pass.

## Current Safety Boundary

Today the ambiguity gate remains the active safety boundary.
