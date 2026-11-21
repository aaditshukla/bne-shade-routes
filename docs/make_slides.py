"""Build docs/slides.pptx: two slides, then a live demo.

Run from the repo root:
    uv run --with python-pptx --with "qrcode[pil]" python docs/make_slides.py

Numbers come from ai/out/stats.json and docs/demo-routes.md (rerun find-demo-routes.ts first if the
data changed). Speaker notes hold the demo script and the Q&A crib.
"""
import io
import json
from pathlib import Path

import qrcode
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.util import Inches, Pt

ROOT = Path(__file__).resolve().parent.parent
URL = "https://bne-shade-routes.vercel.app/"
URL_SHORT = "bne-shade-routes.vercel.app"
STATS = json.loads((ROOT / "ai/out/stats.json").read_text(encoding="utf-8"))
EX = ROOT / "ai/out/examples"

NAVY = RGBColor(0x0F, 0x1B, 0x2D)
CARD = RGBColor(0x1A, 0x2A, 0x42)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
SUN = RGBColor(0xFF, 0xB7, 0x03)
SHADE = RGBColor(0x2E, 0xC4, 0xB6)
MUTED = RGBColor(0x9A, 0xA5, 0xB1)

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
BLANK = prs.slide_layouts[6]


def slide(notes: str):
    s = prs.slides.add_slide(BLANK)
    bg = s.background.fill
    bg.solid()
    bg.fore_color.rgb = NAVY
    s.notes_slide.notes_text_frame.text = notes.strip()
    return s


def text(s, x, y, w, h, runs, size=24, color=WHITE, bold=False, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP):
    """runs: a string, or a list of paragraphs; a paragraph is a string or a list of (text, color) pairs."""
    tb = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    paras = [runs] if isinstance(runs, str) else runs
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.space_after = Pt(size * 0.35)
        for t, c in ([(para, color)] if isinstance(para, str) else para):
            r = p.add_run()
            r.text = t
            r.font.size = Pt(size)
            r.font.bold = bold
            r.font.color.rgb = c
            r.font.name = "Segoe UI"
    return tb


def card(s, x, y, w, h, color=CARD):
    shp = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    shp.adjustments[0] = 0.08
    shp.fill.solid()
    shp.fill.fore_color.rgb = color
    shp.line.fill.background()
    return shp


def qr(s, x, y, size):
    img = qrcode.make(URL, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    s.shapes.add_picture(buf, Inches(x), Inches(y), Inches(size), Inches(size))


def footer(s, label=URL_SHORT):
    text(s, 0.5, 6.95, 12.3, 0.4, label, size=12, color=MUTED)


def photo(s, fn, x, y, w, aspect=0.41):
    """Street photo cropped to one shape: car dashboard off the bottom first, then sky off the top."""
    pic = s.shapes.add_picture(str(EX / fn), Inches(x), Inches(y), Inches(w))
    w_px, h_px = pic.image.size
    keep = min(1.0, (w_px * aspect) / h_px)
    pic.crop_bottom = min(0.30, 1 - keep)
    pic.crop_top = 1 - keep - pic.crop_bottom
    pic.height = int(pic.width * aspect)
    return pic.height / 914400


p = STATS["precision"]

# ── Slide 1 · The idea (Idea and imagination). Small QR so the room can start playing now.
s = slide(f"""
[~25 s] Hi, we're Musa, Aadit and Eric. Scan the code: it's live, play along.
It's 34 degrees in Brisbane, and the shortest walk is the worst walk. At noon today the sun is 82 degrees up,
almost straight overhead, so even a 20 m building throws only about 3 m of shadow.
The shade you actually walk under is awnings, verandahs and trees, and no map knows where the awnings are.
So we taught Claude to find them in street photos. These three are real finds from around this building.
""")
text(s, 0.7, 0.45, 9.5, 0.6, [[("Shade Router", SHADE), ("  ·  walking directions that keep you in the shade", MUTED)]], size=20, bold=True)
text(s, 0.7, 1.05, 9.6, 1.9, [[("It's 34°. The ", WHITE), ("shortest", SUN), (" walk is the ", WHITE), ("worst", SUN), (" walk.", WHITE)]], size=46, bold=True)
facts = [
    ("82°", "sun height at noon today: almost overhead"),
    ("≈3 m", "shadow from a 20 m building at noon"),
    ("0", "maps that know where the awnings are"),
]
for i, (big, small) in enumerate(facts):
    x = 0.7 + i * 3.25
    text(s, x, 2.95, 3.05, 0.9, big, size=44, bold=True, color=SUN)
    text(s, x, 3.8, 3.0, 0.8, small, size=15, color=MUTED)
text(s, 0.7, 4.55, 12, 0.6, [[("So ", WHITE), ("Claude", SHADE), (" finds the shade in street photos:", WHITE)]], size=22, bold=True)
for i, (fn, label) in enumerate([
    ("awning_381557243182240.jpg", "awning"),
    ("verandah_952316658903442.jpg", "verandah"),
    ("covered_walkway_1370764803300042.jpg", "covered walkway"),
]):
    x = 0.7 + i * 4.05
    h = photo(s, fn, x, 5.2, 3.85, aspect=0.38)
    text(s, x, 5.2 + h - 0.45, 3.85, 0.4, label, size=13, bold=True, color=WHITE, align=PP_ALIGN.RIGHT)
card(s, 10.75, 0.45, 1.95, 2.45)
qr(s, 10.9, 0.6, 1.65)
text(s, 10.75, 2.3, 1.95, 0.5, "play along", size=13, bold=True, color=SUN, align=PP_ALIGN.CENTER)
footer(s, "Street imagery © Mapillary contributors (CC BY-SA)")

# ── Slide 2 · How it works + numbers + big QR; stays up during the live demo
#    (Technical ingenuity, Execution and craft, Interactivity, Presentation and demo).
s = slide(f"""
[~20 s] How it works, four steps. Map: streets and buildings from OpenStreetMap, trees from Brisbane City Council.
Sun: the sun's path is known, so we compute every shadow for today in advance, every 15 minutes.
AI eyes: Claude Haiku looked at {STATS['images_checked']} street photos and flagged {STATS['first_pass_positives']} covered footpaths.
A second, separate Claude Sonnet pass re-checked each one and threw out {STATS['rejected_pct']:.0f}%. We hand-checked 30: {p['pct']:.0f}% right.
Route: everything is baked into small files, so your phone does the routing itself. No server, instant.

[~60 s LIVE DEMO, leave this slide up, switch to the phone]
1. Start is the venue. Search "Duncan Street & Wickham Street". 9 am: shortest vs shadiest; 1.3 fewer sun-minutes for 0.4 extra minutes of walking.
2. Drag the time slider to 12:00: shadows shrink, the route changes. At noon the awnings do the work.
3. Drag to 16:30: shadows swing east, the route flips again.
4. Search "Boundary Street & Ivory Lane": the big one, 2.5 fewer sun-minutes at 9 am.
5. (Laptop, if time) open the 3D view.
Close: "Scan it and find your shady way to lunch."

Q&A crib:
- Isn't this Cool Walks / inShade? They model shade from above. At 82 degrees the shade left is awnings and verandahs, which height data can't see.
- Is the AI right? A separate verifier re-checks every positive (rejected 47%); 30 hand-checked, 90% precision.
- Building heights? OSM where tagged, else levels x 3.2 m, else 6 m (most here). Near noon it barely matters.
- Photos? Newest street-level Mapillary photos here are 2019. Feed it new photos, no code change.
- Scale? Per map box: more photos, more vision calls. Cost grows with street length, not users.
- How much shade? 1 to 2.5 fewer sun-minutes on a 4 to 8 minute walk: less sun for almost the same walk.
- Next? A UV budget from the forecast, more suburbs.
""")
text(s, 0.7, 0.45, 8.6, 0.9, "How it works", size=38, bold=True)
steps = [
    ("1  Map", "Streets and buildings from OpenStreetMap, trees from Brisbane City Council.", WHITE),
    ("2  Sun", "Every shadow for today, every 15 minutes, worked out in advance.", SUN),
    ("3  AI eyes", "Claude spots awnings in street photos. A second Claude double-checks each one.", SHADE),
    ("4  Route", "Your phone picks the shadiest path. No server, instant.", WHITE),
]
for i, (title, body, col) in enumerate(steps):
    x = 0.7 + (i % 2) * 4.3
    y = 1.45 + (i // 2) * 1.75
    card(s, x, y, 4.1, 1.55)
    text(s, x + 0.25, y + 0.12, 3.7, 0.55, title, size=22, bold=True, color=col)
    text(s, x + 0.25, y + 0.68, 3.7, 0.85, body, size=14, color=MUTED)
funnel = [
    (str(STATS["images_checked"]), "street photos"),
    (str(STATS["first_pass_positives"]), "flagged by Claude Haiku"),
    (str(STATS["verified"]), "confirmed by Claude Sonnet"),
    (str(STATS["edges_covered"]), "streets now shaded"),
    (f"{p['pct']:.0f}%", f"right ({p['correct']}/{p['checked']} hand-checked)"),
]
for i, (big, small) in enumerate(funnel):
    x = 0.7 + i * 1.72
    text(s, x, 5.1, 1.65, 0.7, big, size=30, bold=True, color=SUN if i == 4 else WHITE, align=PP_ALIGN.CENTER)
    text(s, x, 5.8, 1.65, 0.8, small, size=12, color=MUTED, align=PP_ALIGN.CENTER)
card(s, 9.45, 0.45, 3.3, 6.3)
qr(s, 9.7, 0.7, 2.8)
text(s, 9.45, 3.55, 3.3, 0.9, [[("Try it now", SUN)], [(URL_SHORT, WHITE)]], size=15, bold=True, align=PP_ALIGN.CENTER)
text(s, 9.7, 4.6, 2.85, 2.1, [
    [("Pick a destination, drag the time slider.", WHITE)],
    [("Try: Duncan St & Wickham St", MUTED)],
    [("or Boundary St & Ivory Ln", MUTED)],
], size=13, align=PP_ALIGN.CENTER)
footer(s, "Map data © OpenStreetMap contributors  ·  Trees: Brisbane City Council open data  ·  Street imagery © Mapillary contributors")

out = ROOT / "docs/slides.pptx"
prs.save(out)
print(f"wrote {out} ({len(prs.slides)} slides)")
