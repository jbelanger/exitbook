# Color Tier Conventions

All Ink-based UIs follow a three-tier color hierarchy for consistency and readability.

## Signal Tier (Icons & Status)

Primary visual indicators that draw attention:

- **Green `✓`** - Completed/success
- **Cyan spinner `⠋`** - Active/in-progress
- **Yellow `⚠`** - Warning/failed
- **White/bold `▸`** - Cursor/selection indicator
- **Red** - Critical errors (use sparingly)

## Content Tier (What You Read)

The main information users need to process:

- **White/bold** - Primary labels (phase names, titles)
- **White** - Standard text (IDs, general info)
- **Green** - Positive values (counts, amounts, successful states)
- **Yellow** - Caution values (warnings, medium-confidence)
- **Cyan** - Identifiers (source names, provider names)
- **Red** - Error values (low confidence <70%)

## Context Tier (Recedes)

Supporting information that shouldn't compete for attention:

- **Dim** - Secondary information:
  - Durations `(1.2s)`
  - Parentheticals `(sources)`, `(targets)`
  - Tree characters `├─`, `└─`
  - Arrows `→`
  - Timestamps
  - Separators/dividers
  - Controls bar
  - Link types

## Usage Guidelines

1. **Never rely on color alone** - Always pair colors with text or symbols
2. **Use dim liberally** - It helps create visual hierarchy
3. **Bold for emphasis** - Use on primary labels and selected items
4. **Consistent mapping** - Same semantic meaning = same color across all UIs
5. **Accessibility** - Status icons always have accompanying text

## Examples

```typescript
// Good: Icon + color + text
<Text color="green">✓</Text> Completed <Text dimColor>(1.2s)</Text>

// Good: Multi-tier hierarchy
<Text bold>Importing</Text> · <Text color="green">47 new</Text> <Text dimColor>(via kraken)</Text>

// Bad: Color only, no text
<Text color="red">●</Text>

// Bad: Everything bold
<Text bold>Account #123 (resuming · 1,234 transactions)</Text>
```
