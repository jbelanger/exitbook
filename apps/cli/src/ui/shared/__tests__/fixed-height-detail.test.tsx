import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { FixedHeightDetail } from '../fixed-height-detail.jsx';

describe('FixedHeightDetail', () => {
  it('pads shorter content to the requested height', () => {
    const { lastFrame } = render(
      <FixedHeightDetail
        height={4}
        rows={[<Text key="one">one</Text>, <Text key="two">two</Text>]}
      />
    );

    expect(lastFrame()?.split('\n').length).toBe(4);
  });

  it('clips overflowing rows and shows an overflow indicator', () => {
    const { lastFrame } = render(
      <FixedHeightDetail
        height={3}
        rows={[
          <Text key="one">one</Text>,
          <Text key="two">two</Text>,
          <Text key="three">three</Text>,
          <Text key="four">four</Text>,
        ]}
      />
    );

    const frame = lastFrame();
    expect(frame).toContain('one');
    expect(frame).toContain('two');
    expect(frame).toContain('... 1 more detail line');
    expect(frame).not.toContain('three');
    expect(frame).not.toContain('four');
  });
});
