# Morphing Dashboard Mockups

Visual mockups and specifications for the CLI telemetry dashboard.

## Design Concept

The dashboard uses a **3-section layout** that morphs between phases:

- **Header** (static): App info, target, current phase
- **Body** (dynamic): Changes based on import → processing → complete
- **Footer** (persistent): Scrolling event log that persists across phases

## Files

### Visual Mockups

- `phase-1-import.txt` - Import phase UI showing provider health and velocity
- `phase-2-processing.txt` - Processing phase UI showing pipeline and bottlenecks
- `phase-3-complete.txt` - Completion summary

### Specifications

- `phase-1-spec.md` - Phase 1 (Import) specification
  - Data sources validated against codebase
  - Field-level specifications
  - Implementation approach

- `phase-2-spec.md` - Phase 2 (Processing) specification
  - **Problem**: Processing currently has no observability (CLI hangs)
  - **Solution**: Add events for metadata fetching, scam detection, pipeline health
  - Event types to add (TokenMetadataEvent, ScamDetectionEvent, enhanced ProcessEvent)
  - Where to emit events from

- `phase-3-spec.md` - Phase 3 (Completion) specification
  - Static summary after completion
  - Aggregates stats from Phase 1 & 2 (no new events needed)
  - Shows final counts, timing, discovered tokens, scams detected

## Implementation Status

- [ ] Phase 1: Import Dashboard (ready - uses existing events + instrumentation)
- [ ] Phase 2: Processing Dashboard (requires new events: metadata, scam, enhanced process)
- [ ] Phase 3: Completion Summary (ready - reuses Phase 1 & 2 state)

## Key Principles

1. **Grounded in Reality**: Specs validated against actual codebase capabilities
2. **High-Level Design**: Focus on what to show, not implementation details
3. **Progressive Enhancement**: Start with Phase 1, iterate based on feedback

## Formatting Notes

- Table columns use fixed widths to keep box drawings aligned across mockups.
- Status values include units (e.g., `334ms`) and request rates use `req/s` consistently.
