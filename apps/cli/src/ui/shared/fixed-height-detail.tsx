import { Box, Text } from 'ink';
import { cloneElement, Fragment, isValidElement, type FC, type ReactElement } from 'react';

type FixedDetailRow = ReactElement | false | null | undefined;

interface FixedHeightDetailProps {
  height: number;
  overflowRow?: ((hiddenRowCount: number) => ReactElement) | undefined;
  rows: FixedDetailRow[];
}

function withStableLineBehavior(row: ReactElement, key: string): ReactElement {
  if (isValidElement(row) && row.type === Text) {
    const textRow = row as ReactElement<{ wrap?: string | undefined }>;
    return cloneElement(textRow, {
      key,
      wrap: textRow.props.wrap ?? 'truncate-end',
    });
  }

  return cloneElement(row, { key });
}

export const FixedHeightDetail: FC<FixedHeightDetailProps> = ({ height, rows, overflowRow }) => {
  if (height <= 0) {
    return null;
  }

  const normalizedRows = rows.filter((row): row is ReactElement => Boolean(row));
  const hiddenRowCount = Math.max(0, normalizedRows.length - height);

  let visibleRows = normalizedRows.slice(0, height);
  if (hiddenRowCount > 0) {
    const defaultOverflowRow = (
      <Text dimColor>{`  ... ${hiddenRowCount} more detail line${hiddenRowCount === 1 ? '' : 's'}`}</Text>
    );

    visibleRows = [
      ...normalizedRows.slice(0, Math.max(0, height - 1)),
      overflowRow ? overflowRow(hiddenRowCount) : defaultOverflowRow,
    ];
  }

  while (visibleRows.length < height) {
    visibleRows.push(<Text> </Text>);
  }

  return (
    <Box
      flexDirection="column"
      paddingTop={0}
    >
      {visibleRows.map((row, index) => (
        <Fragment key={index}>{withStableLineBehavior(row, `detail-row-${index}`)}</Fragment>
      ))}
    </Box>
  );
};
