# Draws the setup progress runner: a cute pixel version of the prototype's icon character (flame-shaped
# head in yellow/red/orange, sunglasses, black leather jacket), as two transparent GIFs:
#   assets/runner.gif        4-frame run cycle, shown at the front of the progress bar
#   assets/runner-cheer.gif  2-frame cheer, when 8 or more of the 10 pages worked
#   assets/runner-thumbs.gif 2-frame thumbs up, when 3 to 7 pages worked
#   assets/runner-sad.gif    2-frame sad ending (frown, tear), when fewer than 3 pages worked
#   assets/runner-stand.gif  standing still, when the setup was cancelled or couldn't run
# Needs Pillow:  python3 -m pip install --target /tmp/pylib Pillow && PYTHONPATH=/tmp/pylib python3 runner-sprite.py
from pathlib import Path
from PIL import Image

PALETTE = {
    'Y': (255, 194, 26),   # yellow (left of the head, hands)
    'O': (255, 122, 26),   # orange (right of the head)
    'R': (227, 58, 58),    # red (middle stripe)
    'K': (26, 26, 26),     # black (glasses, jacket, trousers)
    'G': (90, 90, 90),     # jacket highlights
    'W': (255, 255, 255),  # glint on the glasses, zip
    'P': (255, 143, 163),  # pink cheeks
    'B': (120, 60, 30),    # shoe soles
    'T': (110, 190, 255),  # tear
}

# 18 columns wide. The head is big on purpose (chibi).
HEAD = [
    "...........OO.....",
    "....Y.....OOO.....",
    "...YY....ROOOO....",
    "...YYY..RROOOO....",
    "..YYYYYRRROOOOO...",
    "..YYYYYRRROOOOO...",
    "..KWKKKRRKWKKKO...",   # sunglasses, with a glint on each lens
    "..KKKKKRRKKKKKO...",
    "..YPYYYRRROOOPO...",   # pink cheeks
    "...YYKYRRROKOO....",   # big smile
    "...YYYKKKKKOO.....",
    "....YYRRROOO......",
    ".....YRRROO.......",
]
TORSO = [
    "....GKKKKKKG......",   # leather jacket: collar, zip
    "...KKKGKWKGKK.....",
    "...KKKKKWKKKK.....",
    "....KKKKWKKK......",
]
# Arms (sleeves and hands, over the torso rows) and legs differ per frame.
RUN_ARMS = [
    ["..KK.........KK...", ".KY...........KY..", "..................", ".................."],   # swing 1
    ["..................", "..KK.........KK...", "..YK.........KY...", ".................."],   # passing
    ["..................", "..KK.........KK...", "..KY..........KY..", "..Y..............."],   # swing 2
    ["..................", "..KK.........KK...", "..YK.........KY...", ".................."],   # passing
]
RUN_LEGS = [
    ["....KK...KK.......", "...KK.....KK......", "..KK.......KK.....", ".BBK.......KBB...."],   # stride
    [".....KK.KK........", ".....KK.KK........", ".....KK.KK........", "....BBK.KBB......."],   # passing
    ["....KK...KK.......", "....KK....KK......", "...KK......KK.....", "..BBK.......KBB..."],   # stride (other way)
    [".....KK.KK........", ".....KK.KK........", ".....KK.KK........", "....BBK.KBB......."],   # passing
]
RUN_BOB = [1, 0, 1, 0]   # passing frames sit 1 pixel higher

CHEER_ARMS = [   # sleeves at the shoulders
    ["..K..........K....", "..................", "..................", ".................."],
    ["..K..........K....", "..................", "..................", ".................."],
]
CHEER_RAISED = [   # arms up beside the head (head rows 9-12): a little two-step wave
    [".................", ".Y............Y..", ".K............K..", "..K..........K..."],
    ["Y..............Y.", ".K.............K.", ".K............K..", "..K..........K..."],
]
CHEER_LEGS = [
    [".....KK.KK........", ".....KK.KK........", ".....KK.KK........", "....BBK.KBB......."],
    ["....KK...KK.......", "....KK...KK.......", "....KK...KK.......", "...BBK...KBB......"],
]
CHEER_BOB = [0, 1]

# Thumbs up (3 to 7 of the 10 pages worked): one arm up beside the head with a thumb, a little bounce.
THUMB_ARMS = ["............KK....", "..K...............", "..Y...............", ".................."]
THUMB_RAISED = [   # head rows 9-12: arm out to the side, fist up, thumb on top
    ["................Y.", "...............YY.", "...............K..", "..............K..."],
    [".................Y", "...............YY.", "...............K..", "..............K..."],
]
THUMB_LEGS = SAD_LEGS = None   # set below

# Sad ending (fewer than 3 of the 10 pages worked): frown, drooping arms, a tear running down.
SAD_FACE = [   # replaces head rows 8-10
    ["..YYYYYRRROOOOO...", "...YYYYKKKOOO.....", "...YYKYRRROKOO...."],
    ["..YTYYYRRROOOOO...", "...YYYYKKKOOO.....", "...YYKYRRROKOO...."],
]
SAD_TEAR = [   # where the tear is in each frame (row, column), drawn over the face
    [(8, 3)],
    [(9, 3)],
]
SAD_ARMS = ["..K..........K....", "..K..........K....", "..Y..........Y....", ".................."]
SAD_LEGS = [".....KK.KK........", ".....KK.KK........", ".....KK.KK........", "....BBK.KBB......."]
THUMB_LEGS = SAD_LEGS

W, H = 18, len(HEAD) + len(TORSO) + 4 + 1   # + 1 row of room for the bob


def overlay(base, top):
    return ''.join(t if t != '.' else b for b, t in zip(base, top))


def frame(arms, legs, bob, raised=None, face=None, tears=()):
    head = HEAD[:]
    for i, row in enumerate(face or []):
        head[8 + i] = row
    for r, c in tears:
        head[r] = head[r][:c] + 'T' + head[r][c + 1:]
    for i, row in enumerate(raised or []):
        head[9 + i] = overlay(head[9 + i].ljust(W, '.'), row.ljust(W, '.'))
    body = TORSO[:]
    for i, row in enumerate(arms):
        if i < len(body):
            body[i] = overlay(body[i], row)
    rows = ['.' * W] * (1 - bob) + head + body + legs + ['.' * W] * bob
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for y, row in enumerate(rows[:H]):
        for x, ch in enumerate(row[:W]):
            if ch in PALETTE:
                img.putpixel((x, y), PALETTE[ch] + (255,))
    return img


def save_gif(frames, path, ms):
    # Palette GIF with index 0 transparent; each frame replaces the last (disposal 2).
    pal = [0, 0, 0] + [c for rgb in PALETTE.values() for c in rgb]
    pal += [0] * (768 - len(pal))
    out = []
    for f in frames:
        p = Image.new('P', f.size, 0)
        p.putpalette(pal)
        for y in range(f.height):
            for x in range(f.width):
                r, g, b, a = f.getpixel((x, y))
                if a:
                    p.putpixel((x, y), 1 + list(PALETTE.values()).index((r, g, b)))
        out.append(p)
    out[0].save(path, save_all=True, append_images=out[1:], duration=ms, loop=0, transparency=0, disposal=2)


if __name__ == '__main__':
    assets = Path(__file__).resolve().parents[2] / 'assets'
    save_gif([frame(a, l, b) for a, l, b in zip(RUN_ARMS, RUN_LEGS, RUN_BOB)], assets / 'runner.gif', 110)
    save_gif([frame(a, l, b, r) for a, l, b, r in zip(CHEER_ARMS, CHEER_LEGS, CHEER_BOB, CHEER_RAISED)], assets / 'runner-cheer.gif', 260)
    save_gif([frame(RUN_ARMS[1], RUN_LEGS[1], 0)], assets / 'runner-stand.gif', 1000)
    save_gif([frame(SAD_ARMS, SAD_LEGS, 0, face=f, tears=t) for f, t in zip(SAD_FACE, SAD_TEAR)], assets / 'runner-sad.gif', 450)
    save_gif([frame(THUMB_ARMS, THUMB_LEGS, b, r) for b, r in zip([0, 1], THUMB_RAISED)], assets / 'runner-thumbs.gif', 350)   # still, when a run ends with something to look at
    # Big previews to look at (not used by the extension)
    for name, frames in (('run', [frame(a, l, b) for a, l, b in zip(RUN_ARMS, RUN_LEGS, RUN_BOB)]),
                         ('thumbs', [frame(THUMB_ARMS, THUMB_LEGS, b, r) for b, r in zip([0, 1], THUMB_RAISED)]),
                         ('sad', [frame(SAD_ARMS, SAD_LEGS, 0, face=f, tears=t) for f, t in zip(SAD_FACE, SAD_TEAR)]),
                         ('cheer', [frame(a, l, b, r) for a, l, b, r in zip(CHEER_ARMS, CHEER_LEGS, CHEER_BOB, CHEER_RAISED)])):
        sheet = Image.new('RGBA', (W * len(frames) + 4 * (len(frames) - 1), H), (255, 255, 255, 255))
        for i, f in enumerate(frames):
            sheet.alpha_composite(f, (i * (W + 4), 0))
        sheet.resize((sheet.width * 12, sheet.height * 12), Image.NEAREST).save(Path(__import__('os').environ.get('PREVIEW_DIR', '/tmp')) / f'runner-{name}-preview.png')
    print('ok', W, H)
