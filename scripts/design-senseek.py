"""Build Senseek's outlined wordmark and deterministic vector artwork."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from html import escape

ROOT = Path(__file__).resolve().parent.parent / "assets" / "senseek"
FONT = ROOT / "source" / "Manrope-wght.ttf"
INK = "#23483B"
LIME = "#D6EDAC"
PAPER = "#F6F7F1"
fonts = {}

def text_path(text, x, baseline, size, color=INK, weight=650, tracking=0):
    if weight not in fonts:
        fonts[weight] = instantiateVariableFont(TTFont(FONT), {"wght": weight}, inplace=False)
    font = fonts[weight]
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    scale = size / font["head"].unitsPerEm
    output = []
    pen_x = x
    for char in text:
        name = cmap[ord(char)]
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(pen)
        if pen.getCommands():
            output.append(f'<path transform="translate({pen_x:.3f} {baseline}) scale({scale:.6f} {-scale:.6f})" d="{pen.getCommands()}"/>')
        pen_x += glyphs[name].width * scale + tracking
    return f'<g fill="{color}" aria-label="{escape(text)}">' + "".join(output) + "</g>", pen_x - x - tracking

def svg(content, width, height, label):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{escape(label)}"><title>{escape(label)}</title>{content}</svg>'

def mark(color=INK, accent=None, context=None, small=False):
    """A source page with one highlighted sentence and a clear search lens."""
    accent = accent or color
    context = context or color
    page_width = 6.6 if small else 5.8
    lens_width = 7 if small else 6.5
    # Shift right to balance the page outline's greater visual weight on the left.
    out = ['<g transform="translate(2 -2)">']
    # The interrupted page boundary leaves room for the lens, without overlaps.
    out.append(f'<path d="M65 33V23a7 7 0 0 0-7-7H24a7 7 0 0 0-7 7v48a7 7 0 0 0 7 7h20" fill="none" stroke="{color}" stroke-width="{page_width}" stroke-linecap="round" stroke-linejoin="round"/>')
    out.append(f'<path d="M27 29h23M27 64h9" fill="none" stroke="{context}" stroke-width="{5.5 if small else 4.8}" stroke-linecap="round"/>')
    if small:
        out.append(f'<rect x="25" y="39" width="26" height="10" rx="3" fill="{accent}"/>')
    else:
        # Real negative space in the highlight band keeps standalone SVGs transparent.
        out.append(f'<path fill="{accent}" fill-rule="evenodd" d="M28 39h20a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H28a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3ZM31.5 42.6a1.4 1.4 0 0 0 0 2.8h13a1.4 1.4 0 0 0 0-2.8Z"/>')
    out.append(f'<circle cx="63" cy="63" r="16" fill="none" stroke="{color}" stroke-width="{lens_width}"/><path d="m75 75 9 9" fill="none" stroke="{color}" stroke-width="7" stroke-linecap="round"/>')
    return ''.join(out) + '</g>'

def tile(size=96, background=INK, color=LIME):
    light = background != INK
    line = INK if light else PAPER
    accent = INK if light else LIME
    context = "#6E8F67" if light else "#91AD91"
    return f'<g transform="scale({size/96})"><rect width="96" height="96" rx="25" fill="{background}"/>{mark(line,accent,context,small=size<=24)}</g>'

def logo(color=INK, icon_background=INK, icon_color=LIME):
    word, width = text_path("senseek", 168, 141, 150, color, weight=700, tracking=-5)
    content = f'<g transform="translate(8 27)">{tile(128, icon_background, icon_color)}</g>' + word
    return content, round(176 + width), 182

def save(name, content, width, height, label):
    (ROOT / name).write_text(svg(content, width, height, label), encoding="utf-8")

def centered_text(text, center, baseline, size, color=INK, weight=500, tracking=0):
    _, width = text_path(text, 0, baseline, size, color, weight, tracking)
    return text_path(text, center-width/2, baseline, size, color, weight, tracking)[0]

def generate():
    content, width, height = logo()
    save("senseek-logo.svg", content, width, height, "Senseek")
    inverse, _, _ = logo(PAPER, LIME, INK)
    save("senseek-logo-inverse.svg", inverse, width, height, "Senseek — light wordmark for dark backgrounds")
    save("senseek-mark.svg", mark(INK,"#85AB53","#8CA087"), 96, 96, "Senseek — find a highlighted sentence in a page")
    save("senseek-mark-inverse.svg", mark(PAPER,LIME,"#91AD91"), 96, 96, "Senseek page-search symbol — light")
    save("senseek-icon.svg", tile(), 96, 96, "Senseek app icon")
    save("senseek-icon-light.svg", tile(background=LIME, color=INK), 96, 96, "Senseek app icon — light")
    save("source/senseek-icon-small.svg", tile(size=16), 16, 16, "Senseek toolbar icon — optically adjusted")
    word, word_width = text_path("senseek", 8, 143, 160, weight=700, tracking=-5.3)
    save("senseek-wordmark.svg", word, round(word_width+16), 164, "Senseek wordmark")
    mono_word, _ = text_path("senseek", 168, 141, 150, "#000000", weight=700, tracking=-5)
    mono = f'<g transform="translate(8 27) scale({128/96})">{mark("#000000")}</g>' + mono_word
    save("senseek-logo-mono.svg", mono, width, height, "Senseek — monochrome")

    lockup = content + text_path("Semantic Page Search", 168, 193, 25, INK, weight=500, tracking=.1)[0]
    lockup += text_path("Find what you mean.", 168, 235, 22, "#778C77", weight=450, tracking=.15)[0]
    save("senseek-lockup.svg", lockup, width, 260, "Senseek. Semantic Page Search. Find what you mean.")

    # The sheet starts with the actual product action: locating a source sentence.
    out = [f'<rect width="1600" height="1230" fill="{PAPER}"/>']
    out.append(text_path("SENSEEK / SEARCH THE PAGE", 80, 63, 12, "#7C8D7D", 550, 2)[0])
    out.append(text_path("02", 1500, 63, 12, "#7C8D7D", 550, 1)[0])
    out.append('<path d="M80 90H1520" stroke="#DAE0D5"/>')
    out.append(f'<g transform="translate({(1600-width)/2} 171)">{content}</g>')
    out.append(centered_text("Semantic Page Search", 800, 400, 26, INK, 500, .5))
    out.append(centered_text("Find what you mean.", 800, 449, 24, "#738670", 450, .1))

    # Show the mark's three literal ingredients at useful scale.
    out.append('<path d="M80 528H1520" stroke="#DAE0D5"/>')
    out.append(text_path("THE PRODUCT, IN ONE SYMBOL", 80, 572, 11, "#7C8D7D", 550, 1.5)[0])
    out.append(f'<g transform="translate(100 603)"><path d="M4 0h39a5 5 0 0 1 5 5v49a5 5 0 0 1-5 5H4a5 5 0 0 1-5-5V5a5 5 0 0 1 5-5Z" fill="none" stroke="{INK}" stroke-width="3.5"/><path d="M10 16h25M10 29h21M10 43h27" stroke="#9CAC90" stroke-width="3.5" stroke-linecap="round"/></g>')
    out.append(text_path("The current page", 176, 632, 19, INK, 650)[0])
    out.append(text_path("Read the original context.", 176, 660, 13, "#7C8D7D", 450)[0])
    out.append('<path d="M550 592V693M1040 592V693" stroke="#DAE0D5"/>')
    out.append('<rect x="601" y="614" width="65" height="25" rx="5" fill="#D6EDAC"/><path d="M610 626h41" stroke="#5D803B" stroke-width="3.5" stroke-linecap="round"/><path d="M606 651h49M606 667h33" stroke="#9CAC90" stroke-width="3.5" stroke-linecap="round"/>')
    out.append(text_path("The matching sentence", 696, 632, 19, INK, 650)[0])
    out.append(text_path("Highlight what answers your question.", 696, 660, 13, "#7C8D7D", 450)[0])
    out.append(f'<g transform="translate(1100 608)"><circle cx="20" cy="20" r="18" fill="none" stroke="{INK}" stroke-width="4"/><path d="m34 34 16 16" stroke="{INK}" stroke-width="5" stroke-linecap="round"/></g>')
    out.append(text_path("Find it in place", 1170, 632, 19, INK, 650)[0])
    out.append(text_path("Go straight to the source.", 1170, 660, 13, "#7C8D7D", 450)[0])

    out.append('<rect x="80" y="765" width="695" height="303" rx="24" fill="#23483B"/>')
    out.append(text_path("ON DARK", 115, 807, 11, "#98B19A", 500, 2)[0])
    out.append(f'<g transform="translate({80+(695-width*.7)/2} 876) scale(.7)">{inverse}</g>')

    out.append('<rect x="801" y="765" width="719" height="303" rx="24" fill="#EDF0E6"/>')
    out.append(text_path("BUILT FOR YOUR TOOLBAR", 839, 807, 11, "#7D9076", 500, 2)[0])
    for x, y, size in [(863, 907, 16), (950, 899, 32), (1055, 891, 48), (1200, 851, 128)]:
        out.append(f'<g transform="translate({x} {y})">{tile(size)}</g>')
        out.append(centered_text(f"{size} px", x+size/2, 1020, 11, "#89997F", 500))
    out.append('<path d="M80 1125H1520" stroke="#DAE0D5"/>')
    out.append(text_path("FIND MEANING. SEE THE SOURCE.", 80, 1161, 11, "#7C8D7D", 550, 1.8)[0])
    for i, (color, label) in enumerate([(INK, "FOREST"), (LIME, "HIGHLIGHT"), (PAPER, "PAPER")]):
        x = 1140+i*130
        out.append(f'<rect x="{x}" y="1144" width="18" height="18" rx="5" fill="{color}" stroke="#CBD4C3" stroke-width=".5"/>')
        out.append(text_path(label, x+27, 1157, 9, "#7C8D7D", 550, .7)[0])
    save("previews/senseek-brand-sheet.svg", "".join(out), 1600, 1230, "Senseek logo — a page, a highlighted sentence, and a search lens.")

    # Primary preview is deliberately minimal so the logo can be reviewed by itself.
    hero = f'<rect width="1600" height="880" fill="{PAPER}"/>'
    large_word, large_width = text_path("senseek", 0, 415, 150, weight=700, tracking=-5)
    start = (1600-256-70-large_width)/2
    hero += f'<g transform="translate({start} 270)">{tile(256)}</g>'
    hero += f'<g transform="translate({start+326} 0)">{large_word}</g>'
    hero += text_path("Semantic Page Search", start+331, 478, 28, INK, 500, .15)[0]
    hero += text_path("Find what you mean.", start+332, 528, 25, "#738670", 450, .1)[0]
    save("previews/senseek-preview.svg", hero, 1600, 880, "Senseek — Semantic Page Search. Find what you mean.")

if __name__ == "__main__":
    generate()
