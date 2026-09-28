#!/usr/bin/env python3
"""
Build the one face every generated PDF prints in: Lao from Phetsarath OT, digits and Latin from Tinos.

Phetsarath OT is the face official Lao letters are expected in, but its digits and Latin letters
look out of place in a typeset letter; the letters are expected to carry those in Times New Roman.
Times New Roman itself may not be redistributed, so Tinos stands in for it: an OFL face drawn to
match Times New Roman glyph for glyph and width for width.

The two are merged into ONE font rather than switched between while drawing. pdfkit and pdfmake
both measure, wrap and align a line in a single face; a line that changed face mid-way would be
measured wrong wherever it is centred, right-aligned or wrapped — the date line, ເລກທີ, every
signature heading. One file keeps both renderers as they are.

    pip install fonttools
    python3 back/scripts/fonts/build-letter-font.py [path/to/Tinos-Regular.ttf]

Without an argument Tinos is downloaded from google/fonts. Writes
back/src/assets/fonts/HalLetter-Regular.ttf. Both sources are under the SIL Open Font License 1.1
(see back/src/assets/fonts/OFL.txt), and neither declares a Reserved Font Name; the result is
named HAL Letter all the same, so it is never mistaken for either original.
"""
import sys
import tempfile
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.merge import Merger
from fontTools.ttLib import TTFont

FONTS = Path(__file__).resolve().parents[2] / 'src' / 'assets' / 'fonts'
LAO = FONTS / 'PhetsarathOT-Regular.ttf'
OUT = FONTS / 'HalLetter-Regular.ttf'
TINOS_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/tinos/Tinos-Regular.ttf'

# What Tinos supplies: ASCII and Latin-1 print characters, and the typographic punctuation a letter
# uses. Not the space — Lao sets its words apart with Phetsarath's own — and not the soft hyphen.
# Everything else, Lao, Thai and ₭ included, stays Phetsarath's.
LATIN = (
    list(range(0x21, 0x7F))
    + [c for c in range(0xA1, 0x100) if c != 0xAD]
    + [0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026]
)

FAMILY = 'HAL Letter'


def subset_font(src: Path, dst: Path, unicodes: list[int]) -> None:
    options = subset.Options()
    # Hinting programs cannot be merged across fonts, and a PDF does not use them.
    options.hinting = False
    options.layout_features = ['*']
    options.name_IDs = ['*']
    options.notdef_outline = True
    options.drop_tables += ['kern', 'Debg']
    font = subset.load_font(str(src), options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    subset.save_font(font, str(dst), options)


def main() -> None:
    work = Path(tempfile.mkdtemp())
    if len(sys.argv) > 1:
        tinos = Path(sys.argv[1])
    else:
        tinos = work / 'Tinos-Regular.ttf'
        urllib.request.urlretrieve(TINOS_URL, tinos)

    lao_cmap = TTFont(LAO).getBestCmap()
    latin = [c for c in LATIN if c in TTFont(tinos).getBestCmap()]
    lao_keep = [c for c in lao_cmap if c not in set(latin)]

    lao_part = work / 'lao.ttf'
    latin_part = work / 'latin.ttf'
    subset_font(LAO, lao_part, lao_keep)
    subset_font(tinos, latin_part, latin)

    # Phetsarath first: its tables lead where the merger must pick one, and its taller ascent and
    # deeper descent (Lao stacks marks above and below) win the vertical metrics either way.
    merged = Merger().merge([str(lao_part), str(latin_part)])

    name = merged['name']
    for rec in list(name.names):
        if rec.nameID in (1, 3, 4, 6, 16, 17):
            name.removeNames(nameID=rec.nameID)
    name.setName(FAMILY, 1, 3, 1, 0x409)
    name.setName('Regular', 2, 3, 1, 0x409)
    name.setName(f'{FAMILY} Regular', 3, 3, 1, 0x409)
    name.setName(f'{FAMILY} Regular', 4, 3, 1, 0x409)
    name.setName('HALLetter-Regular', 6, 3, 1, 0x409)
    name.setName(
        'Lao glyphs from Phetsarath OT (c) Ministry of Posts and Telecommunications, Laos; '
        'digits and Latin from Tinos (c) The Tinos Project Authors. Both SIL OFL 1.1.',
        0, 3, 1, 0x409,
    )
    merged.save(OUT)
    print(f'wrote {OUT} ({OUT.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
