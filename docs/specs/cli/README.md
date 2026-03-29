# CLI Specs Index

Exitbook's CLI specs are organized around user goals, not package boundaries. Start with the shared language docs, then drop into the command-family spec that owns the flow you are changing.

## Shared Language

- [`cli-design-language-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/cli-design-language-spec.md): user mental model, information architecture, copy rules, and growth rules for new commands
- [`cli-surface-v2-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/cli-surface-v2-spec.md): presentation modes, command intents, and cross-command output behavior

## Workspace Setup

- [`profiles/profiles-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/profiles/profiles-spec.md)
- [`accounts/accounts-view-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/accounts/accounts-view-spec.md)
- [`blockchains/blockchains-view-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/blockchains/blockchains-view-spec.md)
- [`providers/providers-view-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/providers/providers-view-spec.md)
- [`providers/providers-benchmark-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/providers/providers-benchmark-spec.md)

## Sync And Rebuild

- [`import/dashboard-design-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/import/dashboard-design-spec.md)
- [`reprocess/reprocess-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/reprocess/reprocess-spec.md)
- [`links/links-run-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/links/links-run-spec.md)
- [`prices/prices-enrich-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/prices/prices-enrich-spec.md)
- [`balance/balance-view-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/balance/balance-view-spec.md)

## Review And Resolve

- [`accounts/accounts-view-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/accounts/accounts-view-spec.md)
- [`transactions/transactions-view-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/transactions/transactions-view-spec.md)
- [`links/links-view-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/links/links-view-spec.md)
- [`links/links-confirm-reject-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/links/links-confirm-reject-spec.md)
- [`assets/assets-view-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/assets/assets-view-spec.md)
- [`prices/prices-view-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/prices/prices-view-spec.md)

## Analyze And Export

- [`portfolio/portfolio-view-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/portfolio/portfolio-view-spec.md)
- [`cost-basis/cost-basis-view-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/cost-basis/cost-basis-view-spec.md)
- [`balance/balance-view-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/balance/balance-view-spec.md)

## Cleanup And Safety

- [`clear/clear-view-spec.md`](/Users/joel/Dev/exitbook/docs/specs/cli/clear/clear-view-spec.md)

## Coverage Notes

- Some command families still keep multiple runnable subcommands under a single family spec. When you add a new runnable target, either expand the existing family spec deliberately or add a dedicated doc beside it.
- The top-level UX rule is consistency by journey: setup, sync, review, analyze, and maintain should feel like one product even when the implementation spans multiple packages.
