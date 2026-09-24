"""Global constants: canvas, fps, fonts, palettes."""
import os
os.environ.setdefault('LD_LIBRARY_PATH', '/opt/film/libshim:/opt/pw-browsers/chromium-1194/chrome-linux')
ROOT = '/opt/film'
W, H = 1920, 1080
FPS = 24
SR = 48000            # audio sample rate
# B-line 4:3 frame inside 16:9
BX, BW = 240, 1440

F = ROOT + '/fonts/OTF/SimplifiedChinese/'
FONTS = {
    'serif': F + 'SourceHanSerifSC-Regular.otf',
    'serif-light': F + 'SourceHanSerifSC-Light.otf',
    'serif-xlight': F + 'SourceHanSerifSC-ExtraLight.otf',
    'serif-medium': F + 'SourceHanSerifSC-Medium.otf',
    'serif-semibold': F + 'SourceHanSerifSC-SemiBold.otf',
    'serif-bold': F + 'SourceHanSerifSC-Bold.otf',
    'serif-heavy': F + 'SourceHanSerifSC-Heavy.otf',
    'sans': F + 'SourceHanSansSC-Regular.otf',
    'sans-xlight': F + 'SourceHanSansSC-ExtraLight.otf',
    'sans-light': F + 'SourceHanSansSC-Light.otf',
    'sans-normal': F + 'SourceHanSansSC-Normal.otf',
    'sans-medium': F + 'SourceHanSansSC-Medium.otf',
    'sans-bold': F + 'SourceHanSansSC-Bold.otf',
    'sans-heavy': F + 'SourceHanSansSC-Heavy.otf',
    'hand': ROOT + '/fonts/wenkai.ttf',
}

# ---- palettes (RGB tuples) ----
# A line 【循环】: cold evidence room
A_BG = (230, 233, 235)
A_INK = (27, 32, 38)
A_MID = (107, 115, 123)
A_FAINT = (205, 211, 216)
RED = (179, 49, 44)          # the one accent: 「贷」 and 「月」
# B line 【倒计时】: sketchbook paper, warm -> grey as the countdown runs out
B_PAPER_WARM = (238, 227, 207)
B_PAPER_GREY = (214, 214, 211)
GRAPHITE = (46, 43, 40)
NIGHT = (11, 15, 23)
LAMP = (244, 217, 160)
TEA = (242, 194, 122)        # milk-tea shop warm light
RGB_M = (214, 62, 190)       # Li's RGB desk glow
RGB_C = (40, 200, 230)
BLACK = (0, 0, 0)
WHITE = (240, 240, 236)
