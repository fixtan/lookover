# test/make_images.py — 試験用の画像を作る (test/files/ に置く)
# 使い方: python3 test/make_images.py
import os, shutil, random
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'files')
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(os.path.join(OUT, 'sub'))

def quad(w, h):
    """四隅の色が違う絵。向きの確認用。左上=赤、右上=緑、左下=青、右下=白。"""
    im = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w // 2 - 1, h // 2 - 1], fill=(255, 0, 0))
    d.rectangle([w // 2, 0, w - 1, h // 2 - 1], fill=(0, 255, 0))
    d.rectangle([0, h // 2, w // 2 - 1, h - 1], fill=(0, 0, 255))
    d.rectangle([w // 2, h // 2, w - 1, h - 1], fill=(255, 255, 255))
    return im

quad(400, 300).save(os.path.join(OUT, 'img1.png'))
Image.new('RGB', (320, 240), (200, 60, 60)).save(os.path.join(OUT, 'img2.png'))
Image.new('RGB', (320, 240), (60, 200, 60)).save(os.path.join(OUT, 'img10.png'))
Image.new('RGB', (64, 48), (60, 60, 200)).save(os.path.join(OUT, 'small.bmp'))
quad(200, 100).save(os.path.join(OUT, 'pic.webp'), quality=95)
quad(120, 80).save(os.path.join(OUT, '日本語 の名前.png'))

# なだらかな色の変化 + 細かい模様。色の調整とシャープの確認用。
g = Image.new('RGB', (256, 256))
px = g.load()
random.seed(1)
for y in range(256):
    for x in range(256):
        n = random.randint(-12, 12)
        px[x, y] = (max(0, min(255, x + n)), max(0, min(255, y + n)), max(0, min(255, (x + y) // 2 + n)))
g.save(os.path.join(OUT, 'grad.png'))

# 半透明を含む絵
a = Image.new('RGBA', (200, 200), (0, 0, 0, 0))
ImageDraw.Draw(a).ellipse([20, 20, 180, 180], fill=(255, 120, 0, 160))
a.save(os.path.join(OUT, 'alpha.png'))

# 「撮ったときの向き」が入った JPEG。中身は横長 (400 × 300) だが、右へ 90 度回して見るのが正しい。
p = quad(400, 300)
ex = p.getexif()
ex[0x0112] = 6
p.save(os.path.join(OUT, 'photo_exif6.jpg'), quality=95, exif=ex)


# EXIF 入りの写真 (画像の情報の試験用)。件数を変えないよう info フォルダに置く。
# カメラ: Canon EOS R6、1/250 秒、f/1.8、ISO 400、85mm (35mm 換算 85)、撮影 2026-10-04 12:34:56、位置: 北緯 35°40'48" 東経 139°45'36"
os.makedirs(os.path.join(OUT, 'info'))
from PIL.TiffImagePlugin import IFDRational as R
ex = Image.Exif()
ex[0x010F] = 'Canon'; ex[0x0110] = 'Canon EOS R6'; ex[0x0131] = 'TestSoft 1.0'; ex[0x0112] = 1
e2 = ex.get_ifd(0x8769)
e2[0x9003] = '2026:10:04 12:34:56'; e2[0x829A] = R(1, 250); e2[0x829D] = R(18, 10); e2[0x8827] = 400
e2[0x920A] = R(85, 1); e2[0xA405] = 85; e2[0xA434] = 'RF85mm F1.2 L USM'
g2 = ex.get_ifd(0x8825)
g2[1] = 'N'; g2[2] = (R(35, 1), R(40, 1), R(48, 1)); g2[3] = 'E'; g2[4] = (R(139, 1), R(45, 1), R(36, 1))
quad(300, 200).save(os.path.join(OUT, 'info', 'photo_info.jpg'), quality=92, exif=ex)
quad(300, 200).save(os.path.join(OUT, 'info', 'photo_info.webp'), quality=90, exif=ex)
quad(120, 80).save(os.path.join(OUT, 'info', 'photo_info.png'), exif=ex)
quad(120, 80).save(os.path.join(OUT, 'info', 'plain.jpg'))

# 大きい絵 (速さの確認用)
big = Image.effect_noise((4000, 3000), 40).convert('RGB')
big.save(os.path.join(OUT, 'zz_big.jpg'), quality=88)

# 動く GIF (赤 → 緑 → 青、1 コマ 0.12 秒)。sub フォルダに置く (ほかの試験の件数を変えないため)。
frames = [Image.new('RGB', (80, 60), c) for c in [(255, 0, 0), (0, 255, 0), (0, 0, 255)]]
frames[0].save(os.path.join(OUT, 'sub', 'anim.gif'), save_all=True, append_images=frames[1:], duration=120, loop=0)
frames[0].save(os.path.join(OUT, 'sub', 'still.gif'))

Image.new('RGB', (10, 10), (1, 2, 3)).save(os.path.join(OUT, 'sub', 'inner.png'))
open(os.path.join(OUT, 'note.txt'), 'w').write('画像ではない')
open(os.path.join(OUT, 'broken.png'), 'wb').write(b'\x89PNG\r\n\x1a\nthis is not really a png')
# 見た目の確認用 (test/shots.mjs) に、写真らしい絵を 1 枚。試験用のフォルダとは別に置く。
from PIL import ImageFilter
DEMO = os.path.join(HERE, 'demo')
os.makedirs(DEMO, exist_ok=True)
random.seed(3)
w, h = 1600, 1000
im = Image.new('RGB', (w, h))
px = im.load()
for y in range(h):
    for x in range(w):
        px[x, y] = (int(40 + 150 * x / w), int(70 + 110 * y / h), int(170 - 110 * x / w))
d = ImageDraw.Draw(im)
for i in range(40):
    x = random.randint(0, w); y = random.randint(0, h); r = random.randint(20, 140)
    d.ellipse([x - r, y - r, x + r, y + r], fill=(random.randint(40, 255), random.randint(40, 255), random.randint(40, 255)))
d.rectangle([500, 380, 1100, 470], fill=(250, 250, 250))
d.text((520, 410), "name@example.com  /  090-0000-0000", fill=(20, 20, 20))
im.filter(ImageFilter.GaussianBlur(1)).save(os.path.join(DEMO, 'demo.jpg'), quality=90)

print(sorted(os.listdir(OUT)))
