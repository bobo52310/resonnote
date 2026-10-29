import { beforeEach, describe, expect, it } from 'vitest';
import { deepQueryAll, extractSubtitle } from '../../../src/platforms/disney/subtitle';

/** The cue markup measured on disneyplus.com 2026-10-29, inside the region's open shadow root. */
const cue = (...lines: string[]) =>
  `<div class="hive-subtitle-renderer-wrapper">
     <div class="hive-subtitle-renderer-cue-positioning-box">
       <div class="hive-subtitle-renderer-cue-window">
         <span class="hive-subtitle-renderer-cue">${lines
           .map((line) => `<span class="hive-subtitle-renderer-line">${line}</span>`)
           .join('<br>')}</span>
       </div>
     </div>
   </div>`;

/** `disney-web-player-ui > timed-text-override-region` with the given shadow root content. */
function mountRegion(shadowHtml: string, mode: 'open' | 'closed' = 'open') {
  document.body.innerHTML = '<disney-web-player-ui><timed-text-override-region></timed-text-override-region></disney-web-player-ui>';
  const region = document.querySelector('timed-text-override-region')!;
  const root = region.attachShadow({ mode });
  root.innerHTML = shadowHtml;
  return region;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('extractSubtitle', () => {
  it('reads a single line from the region shadow root', () => {
    mountRegion(cue('三、五年前賣得還行'));
    expect(extractSubtitle(document)).toBe('三、五年前賣得還行');
  });

  it('joins several lines with a single space and collapses whitespace', () => {
    mountRegion(cue('First line', '  second\n  line  '));
    expect(extractSubtitle(document)).toBe('First line second line');
  });

  it('joins separate cues too and skips empty lines', () => {
    mountRegion(`${cue('one')}${cue('')}${cue('two')}`);
    expect(extractSubtitle(document)).toBe('one two');
  });

  it('is empty while the region shows no cue', () => {
    mountRegion('<div class="hive-subtitle-renderer-wrapper"></div>');
    expect(extractSubtitle(document)).toBe('');
  });

  it('is empty when the region has no open shadow root', () => {
    mountRegion(cue('hidden from us'), 'closed');
    expect(extractSubtitle(document)).toBe('');
  });

  it('falls back to the old .dss-subtitle-renderer-line anywhere in the document', () => {
    document.body.innerHTML = `
      <div class="dss-hls-subtitle-overlay"><div class="dss-subtitle-renderer-wrapper">
        <span class="dss-subtitle-renderer-cue">
          <span class="dss-subtitle-renderer-line">Old</span>
          <span class="dss-subtitle-renderer-line">renderer</span>
        </span></div></div>`;
    expect(extractSubtitle(document)).toBe('Old renderer');
  });

  it('finds the old class inside another element\'s open shadow root', () => {
    document.body.innerHTML = '<some-player></some-player>';
    document.querySelector('some-player')!.attachShadow({ mode: 'open' }).innerHTML =
      '<span class="dss-subtitle-renderer-line">Deep</span>';
    expect(extractSubtitle(document)).toBe('Deep');
  });

  it('also reads a .hive-subtitle-renderer-line left in the light DOM (earlier layout)', () => {
    document.body.innerHTML = `<div class="TimedTextOverlay">${cue('Light DOM')}</div>`;
    expect(extractSubtitle(document)).toBe('Light DOM');
  });

  it('prefers the region over a stale line elsewhere', () => {
    document.body.innerHTML = '<span class="dss-subtitle-renderer-line">stale</span><disney-web-player-ui><timed-text-override-region></timed-text-override-region></disney-web-player-ui>';
    document.querySelector('timed-text-override-region')!.attachShadow({ mode: 'open' }).innerHTML = cue('current');
    expect(extractSubtitle(document)).toBe('current');
  });

  it('is empty when there is no subtitle anywhere', () => {
    document.body.innerHTML = '<p>nothing</p>';
    expect(extractSubtitle(document)).toBe('');
  });

  it('does not modify the page', () => {
    const region = mountRegion(cue('keep me'));
    const before = region.shadowRoot!.innerHTML;
    extractSubtitle(document);
    expect(region.shadowRoot!.innerHTML).toBe(before);
  });
});

describe('deepQueryAll', () => {
  it('finds matches in the light DOM and in nested open shadow roots', () => {
    document.body.innerHTML = '<p class="x" id="light"></p><div id="outer"></div>';
    const outer = document.getElementById('outer')!.attachShadow({ mode: 'open' });
    outer.innerHTML = '<p class="x" id="in-outer"></p><div id="inner"></div>';
    outer.getElementById('inner')!.attachShadow({ mode: 'open' }).innerHTML = '<p class="x" id="in-inner"></p>';

    expect(deepQueryAll(document, '.x').map((el) => el.id).sort()).toEqual(['in-inner', 'in-outer', 'light']);
  });
});
