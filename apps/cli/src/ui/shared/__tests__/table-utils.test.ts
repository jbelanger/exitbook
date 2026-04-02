import { describe, expect, it } from 'vitest';

import { buildTextTableHeader, createColumns } from '../table-utils.js';

describe('table-utils', () => {
  it('right-aligns headers for right-aligned columns', () => {
    const columns = createColumns([{ amount: '1.23', name: 'BTC' }], {
      amount: {
        align: 'right',
        format: (item) => item.amount,
        minWidth: 8,
      },
      name: {
        format: (item) => item.name,
        minWidth: 4,
      },
    });

    const header = buildTextTableHeader(
      columns.widths,
      {
        amount: 'AMOUNT',
        name: 'NAME',
      },
      ['name', 'amount'],
      { alignments: columns.alignments, gap: ' | ' }
    );

    expect(header).toBe('NAME |   AMOUNT');
  });
});
