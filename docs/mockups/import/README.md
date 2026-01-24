# Morphing Dashboard Mockups

Visual mockups and specifications for the CLI telemetry dashboard.

## Design Concept

The dashboard uses a **3-section layout** that morphs between phases:

- **Header** (static): App info, target, current phase
- **Body** (dynamic): Changes based on import → processing → completion summary
- **Footer** (persistent): Scrolling event log that persists across all phases (including completion)

## Files

- `phase-1-spec.md` - Phase 1/2: Import specification (includes visual mockup)
  - Data sources validated against codebase
  - Field-level specifications and implementation approach

- `phase-2-spec.md` - Phase 2/2: Processing specification (includes visual mockup)
  - New events: TokenMetadataEvent, ScamDetectionEvent, enhanced ProcessEvent
  - Where to emit events from services

- `phase-3-spec.md` - Completion Summary specification (includes visual mockup)
  - Static summary after phases complete
  - Aggregates stats from Phase 1 & 2 (no new events needed)

## Implementation Status

- [ ] Phase 1/2: Import Dashboard (ready - uses existing events + instrumentation)
- [ ] Phase 2/2: Processing Dashboard (requires new events: metadata, scam, enhanced process)
- [ ] Completion Summary (ready - reuses Phase 1 & 2 state)

See `IMPLEMENTATION-CHECKLIST.md` for detailed implementation steps.

## Key Principles

1. **Grounded in Reality**: Specs validated against actual codebase capabilities
2. **High-Level Design**: Focus on what to show, not implementation details
3. **Progressive Enhancement**: Start with Phase 1, iterate based on feedback

## Formatting Notes

- Table columns use fixed widths to keep box drawings aligned across mockups
- Status values include units (e.g., `334ms`) and request rates use `req/s` consistently
