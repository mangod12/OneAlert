import { expect, it } from 'vitest';
import { timelineEntryLink } from './timelineEntryLink';
it('keeps absent links separate from invalid links and ignores unrelated criteria', () => {
  expect(timelineEntryLink(new URLSearchParams('task=4'))).toEqual({ id: null, invalid: false });
  expect(timelineEntryLink(new URLSearchParams('task=4&note=21'))).toEqual({ id: 21, invalid: false });
  expect(timelineEntryLink(new URLSearchParams(`note=${Number.MAX_SAFE_INTEGER}`))).toEqual({ id: Number.MAX_SAFE_INTEGER, invalid: false });
});
it.each(['note=', 'note=0', 'note=-1', 'note=021', 'note=2.1', 'note=2e1', 'note=0x15', 'note=%2B21', 'note=+21', 'note=21+', 'note=Infinity', 'note=NaN', 'note=9007199254740992', 'note=21&note=22', 'note=21&note=21'])('never coerces or chooses between ambiguous entry links: %s', query => {
  expect(timelineEntryLink(new URLSearchParams(query))).toEqual({ id: null, invalid: true });
});
