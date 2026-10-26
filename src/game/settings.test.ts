import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings';

describe('parseSettings', () => {
  it('falls back to defaults for missing or junk input', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([1])).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ uiScale: 7, quality: 'ultra', bloom: 'yes', fpsCap: 45 })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('keeps valid values and clamps volumes', () => {
    const s = parseSettings({
      uiScale: 1.15,
      quality: 'low',
      bloom: false,
      fpsCap: 60,
      masterVolume: 3,
      sfxVolume: -1,
    });
    expect(s).toMatchObject({
      uiScale: 1.15,
      quality: 'low',
      bloom: false,
      fpsCap: 60,
      masterVolume: 1,
      sfxVolume: 0,
    });
  });
});
