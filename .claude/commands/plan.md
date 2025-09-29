---
description: Execute the implementation planning workflow using the plan template to generate design artifacts.
---

The user input to you can be provided directly by the agent or as a command argument - you **MUST** consider it before proceeding with the prompt (if not empty).

User input:

$ARGUMENTS

Given the implementation details provided as an argument, do this:

1. **Check if setup is needed**: Look for existing plan.md in specs/ directory. If plan.md exists, extract FEATURE_SPEC, IMPL_PLAN, SPECS_DIR, BRANCH paths from the existing file headers instead of running setup script. **Only run** `.specify/scripts/bash/setup-plan.sh --json` if no plan.md exists in any specs/ subdirectory. Parse JSON for paths. All future file paths must be absolute.
   - BEFORE proceeding, inspect FEATURE_SPEC for a `## Clarifications` section with at least one `Session` subheading. If missing or clearly ambiguous areas remain (vague adjectives, unresolved critical choices), PAUSE and instruct the user to run `/clarify` first to reduce rework. Only continue if: (a) Clarifications exist OR (b) an explicit user override is provided (e.g., "proceed without clarification"). Do not attempt to fabricate clarifications yourself.
2. Read and analyze the feature specification to understand:
   - The feature requirements and user stories
   - Functional and non-functional requirements
   - Success criteria and acceptance criteria
   - Any technical constraints or dependencies mentioned

3. Read the constitution at `.specify/memory/constitution.md` to understand constitutional requirements.

4. Execute the implementation plan template:
   - Load `.specify/templates/plan-template.md` (already copied to IMPL_PLAN path)
   - Set Input path to FEATURE_SPEC
   - **Detect existing artifacts and determine resume point** using step 3 of Execution Flow
   - **Parse scope from user arguments** (Phase 0, Phase 1, resume, continue) or ask if not specified
   - Run the Execution Flow (main) function steps 1-13 based on detected state and scope
   - The template is self-contained and executable with multi-session support
   - Follow error handling and gate checks as specified
   - **Skip completed steps** based on artifact detection
   - Let the template guide artifact generation in $SPECS_DIR:
     - Phase 0 generates research.md (skip if exists)
     - Phase 1 generates data-model.md, contracts/, quickstart.md (skip completed)
     - Phase 2 describes task generation approach only
   - Incorporate user-provided details from arguments into Technical Context: $ARGUMENTS
   - **Update Resume Instructions section** with current session state
   - Update Progress Tracking as you complete each phase

5. Verify execution completed:
   - Check Progress Tracking shows **requested scope** complete (not necessarily all phases)
   - Ensure all required artifacts for the scope were generated
   - Confirm no ERROR states in execution
   - **Verify Resume Instructions updated** with current state for next session

6. Report results with:
   - Branch name and current phase status
   - File paths and generated artifacts for this session
   - **Next steps** and recommended scope for subsequent sessions
   - **Resume command suggestion** if work remains incomplete

Use absolute paths with the repository root for all file operations to avoid path issues.
