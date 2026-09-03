import { messageByteCountLabel } from '../../copy/uxCopy';
import { focusSettingsSection, scrollSettingsToSection } from '../settingsSectionFocus';

describe('scrollSettingsToSection', () => {
  it('animates when Reduce Motion is off', () => {
    const scrollTo = jest.fn();
    scrollSettingsToSection({ scrollTo }, 240, false);
    expect(scrollTo).toHaveBeenCalledWith({ y: 240, animated: true });
  });

  it('does not animate under Reduce Motion', () => {
    const scrollTo = jest.fn();
    scrollSettingsToSection({ scrollTo }, 720, true);
    expect(scrollTo).toHaveBeenCalledWith({ y: 720, animated: false });
  });
});

describe('focusSettingsSection', () => {
  it('sets accessibility focus when the host has a native tag', () => {
    const findTag = jest.fn().mockReturnValue(11);
    const focus = jest.fn();
    focusSettingsSection({} as never, { findTag, focus });
    expect(findTag).toHaveBeenCalled();
    expect(focus).toHaveBeenCalledWith(11);
  });

  it('does nothing when the host has no native tag', () => {
    const findTag = jest.fn().mockReturnValue(null);
    const focus = jest.fn();
    focusSettingsSection(null, { findTag, focus });
    expect(focus).not.toHaveBeenCalled();
  });
});

describe('messageByteCountLabel', () => {
  it('keeps the live threshold counter concise', () => {
    expect(messageByteCountLabel(820, 1000)).toBe('820 / 1000 bytes');
  });
});
