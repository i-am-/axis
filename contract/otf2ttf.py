"""Converts a CFF-flavoured OpenType font (.otf) to TrueType outlines (.ttf).

pdf-lib labels every embedded font as TrueType, so a CFF font ends up
mislabelled inside the signed PDF; strict viewers complain. Quadratic
outlines make the label true. Usage: otf2ttf.py in.otf out.ttf
"""
import sys
from fontTools.ttLib import TTFont, newTable
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

src, dst = sys.argv[1], sys.argv[2]
font = TTFont(src)
glyph_set = font.getGlyphSet()
glyf = newTable("glyf")
glyf.glyphOrder = font.getGlyphOrder()
glyf.glyphs = {}
for name in glyf.glyphOrder:
    pen = TTGlyphPen(glyph_set)
    glyph_set[name].draw(Cu2QuPen(pen, max_err=1.0, reverse_direction=True))
    glyf.glyphs[name] = pen.glyph()
font["glyf"] = glyf
font["loca"] = newTable("loca")
font["maxp"].tableVersion = 0x00010000
for attr in ("maxZones", "maxTwilightPoints", "maxStorage", "maxFunctionDefs", "maxInstructionDefs",
             "maxStackElements", "maxSizeOfInstructions", "maxComponentElements"):
    setattr(font["maxp"], attr, 0)
font["maxp"].maxZones = 1
font["post"].formatType = 2.0
font["post"].extraNames = []
font["post"].mapping = {}
font["post"].glyphOrder = glyf.glyphOrder
del font["CFF "]
if "VORG" in font:
    del font["VORG"]
font.sfntVersion = "\x00\x01\x00\x00"
font.save(dst)
