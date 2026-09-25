import { describe, expect, it } from 'vitest';
import { laoLineBreaks } from './document-pdf.service';

const ZWSP = '​';

/** Lao has no spaces between words; the letter marks where a line may break between them. */
describe('laoLineBreaks', () => {
  it('puts an invisible break point between Lao words', () => {
    expect(laoLineBreaks('ສະນັ້ນຈຶ່ງເຮັດ').split(ZWSP)).toEqual(['ສະນັ້ນ', 'ຈຶ່ງ', 'ເຮັດ']);
  });

  it('changes nothing a reader can see', () => {
    const text = 'ຈຸດປະສົງໃນການສ້າງຟີເຈີນີ້ ແມ່ນເພື່ອ HAL Express Laos 1 ຄັ້ງ/ບິນ (COD)\n• ຕ້ອງເປັນບິນ';
    expect(laoLineBreaks(text).replaceAll(ZWSP, '')).toBe(text);
  });

  it('never splits inside a word — a vowel or tone mark stays with its consonant', () => {
    for (const part of laoLineBreaks('ເພື່ອຕອບສະໜອງຄວາມຕ້ອງການ').split(ZWSP)) {
      expect(part).not.toMatch(/^[ັິ-ຼ່-ໍ]/);
      expect(part).not.toMatch(/[ເ-ໄ]$/);
    }
  });

  it('leaves text without Lao untouched', () => {
    expect(laoLineBreaks('PRIT-HAL-2026-0002')).toBe('PRIT-HAL-2026-0002');
  });
});
