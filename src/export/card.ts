import type { Rect } from '../core/types';

export interface CardInput {
  imageWidth: number;
  imageHeight: number;
  heading: string;
  time: string;
  subtitle: string;
  body: string;
}

/** One wrapped paragraph group. `y` is the top of the first line; lines are `lineHeight` tall. */
export interface CardBlock {
  font: string;
  color: string;
  lines: string[];
  x: number;
  y: number;
  lineHeight: number;
}

export interface CardLayout {
  width: 1080;
  height: number;
  image: Rect | null;
  blocks: CardBlock[];
}

const CARD_WIDTH = 1080;
const MARGIN = 48;
const CONTENT_WIDTH = CARD_WIDTH - MARGIN * 2; // 984
const BLOCK_GAP = 32;
const LINE_HEIGHT_RATIO = 1.5;
const FONT_FAMILY = '-apple-system, "PingFang TC", sans-serif';

const BACKGROUND = '#ffffff';
const COLOR_PRIMARY = '#111111';
const COLOR_SUBTITLE = '#333333';

const HEADING_SIZE = 36;
const SUBTITLE_SIZE = 40;
const BODY_SIZE = 34;

// CJK ideographs, kana, hangul, bopomofo, CJK symbols/punctuation and full-width forms.
const CJK_RE =
  /[⺀-⿟　-鿿ꥠ-꥿가-퟿豈-﫿︰-﹏＀-￯\u{20000}-\u{2FA1F}]/u;

type Measure = (text: string, font: string) => number;

type Token = { kind: 'cjk' | 'word' | 'space'; text: string };

/** Splits one paragraph into CJK chars (breakable anywhere), words and runs of spaces. */
function tokenize(paragraph: string): Token[] {
  const tokens: Token[] = [];
  let run: Token | null = null;
  for (const ch of paragraph) {
    const kind: Token['kind'] = CJK_RE.test(ch) ? 'cjk' : /\s/u.test(ch) ? 'space' : 'word';
    if (kind === 'cjk') {
      tokens.push({ kind, text: ch });
      run = null;
    } else if (run && run.kind === kind) {
      run.text += ch;
    } else {
      run = { kind, text: ch };
      tokens.push(run);
    }
  }
  return tokens;
}

/** Greedily fills lines with `text` char by char; used for a word wider than a whole line. */
function hardBreak(text: string, font: string, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    // Always place at least one char per line so a pathological measure cannot loop forever.
    if (line !== '' && measure(line + ch, font) > maxWidth) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

function wrapParagraph(paragraph: string, font: string, maxWidth: number, measure: Measure): string[] {
  if (paragraph === '') return [''];

  const lines: string[] = [];
  let line = '';
  const flush = () => {
    lines.push(line.trimEnd());
    line = '';
  };

  for (const token of tokenize(paragraph)) {
    if (measure(line + token.text, font) <= maxWidth) {
      line += token.text;
      continue;
    }
    if (token.kind === 'space') {
      // Spaces never start a wrapped line; the break itself replaces them.
      if (line !== '') flush();
      continue;
    }
    if (line.trim() !== '') flush();
    else line = '';
    if (measure(token.text, font) <= maxWidth) {
      line = token.text;
    } else {
      // A single word wider than the line: split it by character.
      const pieces = hardBreak(token.text, font, maxWidth, measure);
      for (const piece of pieces.slice(0, -1)) lines.push(piece);
      line = pieces[pieces.length - 1] ?? '';
    }
  }
  if (line !== '' || lines.length === 0) flush();
  return lines;
}

/** Wraps text for a given font: CJK breaks per char, other text at spaces, `\n` is forced. */
function wrapText(text: string, font: string, maxWidth: number, measure: Measure): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .flatMap((paragraph) => wrapParagraph(paragraph, font, maxWidth, measure));
}

/**
 * Pure layout of a note card (1080 px wide). Block `y` values are the top of each block;
 * `measure` returns the rendered width of `text` in `font` (canvas `measureText` in the browser).
 */
export function layoutCard(input: CardInput, measure: Measure): CardLayout {
  let y = MARGIN;
  let image: Rect | null = null;
  const blocks: CardBlock[] = [];

  if (input.imageWidth > 0 && input.imageHeight > 0) {
    image = {
      x: MARGIN,
      y,
      width: CONTENT_WIDTH,
      height: (input.imageHeight * CONTENT_WIDTH) / input.imageWidth,
    };
    y += image.height + BLOCK_GAP;
  }

  const addBlock = (text: string, font: string, size: number, color: string) => {
    const lineHeight = size * LINE_HEIGHT_RATIO;
    const lines = wrapText(text, font, CONTENT_WIDTH, measure);
    blocks.push({ font, color, lines, x: MARGIN, y, lineHeight });
    y += lines.length * lineHeight + BLOCK_GAP;
  };

  addBlock(
    [input.heading, input.time].filter((part) => part !== '').join(' · '),
    `bold ${HEADING_SIZE}px ${FONT_FAMILY}`,
    HEADING_SIZE,
    COLOR_PRIMARY,
  );
  if (input.subtitle.trim() !== '') {
    addBlock(`「${input.subtitle}」`, `${SUBTITLE_SIZE}px ${FONT_FAMILY}`, SUBTITLE_SIZE, COLOR_SUBTITLE);
  }
  if (input.body.trim() !== '') {
    addBlock(input.body.trimEnd(), `${BODY_SIZE}px ${FONT_FAMILY}`, BODY_SIZE, COLOR_PRIMARY);
  }

  // `y` now includes one trailing block gap; swap it for the bottom margin.
  return { width: CARD_WIDTH, height: y - BLOCK_GAP + MARGIN, image, blocks };
}

/** Draws the layout to a PNG. Browser-only (needs OffscreenCanvas). */
export async function renderCard(layout: CardLayout, image: ImageBitmap | null): Promise<Blob> {
  const canvas = new OffscreenCanvas(layout.width, Math.ceil(layout.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');

  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (layout.image && image) {
    const { x, y, width, height } = layout.image;
    ctx.drawImage(image, x, y, width, height);
  }

  ctx.textBaseline = 'middle';
  for (const block of layout.blocks) {
    ctx.font = block.font;
    ctx.fillStyle = block.color;
    block.lines.forEach((line, i) => {
      ctx.fillText(line, block.x, block.y + i * block.lineHeight + block.lineHeight / 2);
    });
  }

  return canvas.convertToBlob({ type: 'image/png' });
}

/** Creates a `measure` function backed by a canvas 2d context. Browser-only. */
export function createCanvasMeasure(): Measure {
  const ctx = new OffscreenCanvas(1, 1).getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  return (text, font) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}
