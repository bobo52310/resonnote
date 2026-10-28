import { describe, expect, it } from 'vitest';
import { layoutCard, type CardBlock, type CardInput, type CardLayout } from '../../src/export/card';

const CJK = /[⺀-鿿豈-﫿＀-￯]/;

/** CJK char = font size wide, anything else = half the font size. */
function fakeMeasure(text: string, font: string): number {
  const size = Number(/(\d+)px/.exec(font)?.[1]);
  let width = 0;
  for (const ch of text) width += CJK.test(ch) ? size : size * 0.5;
  return width;
}

const FONT_FAMILY = '-apple-system, "PingFang TC", sans-serif';

function blockAt(layout: CardLayout, index: number): CardBlock {
  const block = layout.blocks.at(index);
  if (!block) throw new Error(`no block at index ${index}`);
  return block;
}

function input(overrides: Partial<CardInput> = {}): CardInput {
  return {
    imageWidth: 1920,
    imageHeight: 1080,
    heading: '黑暗榮耀 第1季第3集',
    time: '16:43',
    subtitle: '你好嗎',
    body: '這一幕很有感覺',
    ...overrides,
  };
}

describe('layoutCard', () => {
  it('is 1080 wide and scales a 1920x1080 image to the 984 content width', () => {
    const layout = layoutCard(input(), fakeMeasure);
    expect(layout.width).toBe(1080);
    expect(layout.image).toEqual({ x: 48, y: 48, width: 984, height: 553.5 });
  });

  it('wraps 500 CJK chars within content width', () => {
    const body = '字'.repeat(500);
    const layout = layoutCard(input({ body }), fakeMeasure);
    const block = blockAt(layout, -1);
    expect(block.lines.length).toBeGreaterThan(1);
    for (const line of block.lines) {
      expect(fakeMeasure(line, block.font)).toBeLessThanOrEqual(984);
    }
    // Nothing is dropped or duplicated by the wrapping.
    expect(block.lines.join('')).toBe(body);
  });

  it('keeps only the heading block when subtitle and body are empty, and is shorter', () => {
    const full = layoutCard(input(), fakeMeasure);
    const bare = layoutCard(input({ subtitle: '', body: '' }), fakeMeasure);
    expect(bare.blocks).toHaveLength(1);
    expect(blockAt(bare, 0).lines).toEqual(['黑暗榮耀 第1季第3集 · 16:43']);
    expect(bare.height).toBeLessThan(full.height);
  });

  it('sets image to null when imageWidth is 0 and starts text at the top margin', () => {
    const layout = layoutCard(input({ imageWidth: 0, imageHeight: 0 }), fakeMeasure);
    expect(layout.image).toBeNull();
    expect(blockAt(layout, 0).y).toBe(48);
  });

  it('turns a newline into a forced line break', () => {
    const layout = layoutCard(input({ body: 'a\nb' }), fakeMeasure);
    expect(blockAt(layout, -1).lines).toEqual(['a', 'b']);
  });

  it('uses the specified fonts, colors, line heights and spacing', () => {
    const layout = layoutCard(input(), fakeMeasure);
    const heading = blockAt(layout, 0);
    const subtitle = blockAt(layout, 1);
    const body = blockAt(layout, 2);

    expect(heading).toMatchObject({
      font: `bold 36px ${FONT_FAMILY}`,
      color: '#111111',
      lines: ['黑暗榮耀 第1季第3集 · 16:43'],
      x: 48,
      lineHeight: 54,
    });
    expect(subtitle).toMatchObject({
      font: `40px ${FONT_FAMILY}`,
      color: '#333333',
      lines: ['「你好嗎」'],
      x: 48,
      lineHeight: 60,
    });
    expect(body).toMatchObject({
      font: `34px ${FONT_FAMILY}`,
      color: '#111111',
      lines: ['這一幕很有感覺'],
      x: 48,
      lineHeight: 51,
    });

    // image 48 + 553.5, gap 32, then each block is lines * lineHeight with 32 between.
    expect(heading.y).toBe(48 + 553.5 + 32);
    expect(subtitle.y).toBe(heading.y + 54 + 32);
    expect(body.y).toBe(subtitle.y + 60 + 32);
    expect(layout.height).toBe(body.y + 51 + 48);
  });

  it('breaks non-CJK text at spaces and keeps lines within the width', () => {
    const body = 'the quick brown fox jumps over the lazy dog '.repeat(8).trim();
    const layout = layoutCard(input({ body }), fakeMeasure);
    const block = blockAt(layout, -1);
    expect(block.lines.length).toBeGreaterThan(1);
    for (const line of block.lines) {
      expect(fakeMeasure(line, block.font)).toBeLessThanOrEqual(984);
      expect(line).toBe(line.trim());
    }
    // Words are never split when each one fits on a line.
    expect(block.lines.join(' ')).toBe(body);
  });

  it('hard-breaks a single word that is wider than the content width', () => {
    const body = 'x'.repeat(200);
    const layout = layoutCard(input({ body }), fakeMeasure);
    const block = blockAt(layout, -1);
    expect(block.lines.length).toBeGreaterThan(1);
    for (const line of block.lines) {
      expect(fakeMeasure(line, block.font)).toBeLessThanOrEqual(984);
    }
    expect(block.lines.join('')).toBe(body);
  });

  it('wraps mixed CJK and English without losing characters', () => {
    const body = '我覺得 this scene 的燈光 is amazing 而且配樂也很好'.repeat(6);
    const layout = layoutCard(input({ body }), fakeMeasure);
    const block = blockAt(layout, -1);
    for (const line of block.lines) {
      expect(fakeMeasure(line, block.font)).toBeLessThanOrEqual(984);
    }
    const strip = (s: string) => s.replace(/\s+/g, '');
    expect(strip(block.lines.join(''))).toBe(strip(body));
  });

  it('keeps a blank line between paragraphs', () => {
    const layout = layoutCard(input({ body: 'a\n\nb' }), fakeMeasure);
    expect(blockAt(layout, -1).lines).toEqual(['a', '', 'b']);
  });

  it('wraps a long heading too', () => {
    const layout = layoutCard(input({ heading: '很長的標題'.repeat(20) }), fakeMeasure);
    const heading = blockAt(layout, 0);
    expect(heading.lines.length).toBeGreaterThan(1);
    for (const line of heading.lines) {
      expect(fakeMeasure(line, heading.font)).toBeLessThanOrEqual(984);
    }
  });
});
