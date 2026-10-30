#!/usr/bin/env python3
"""
Сборка сайта УМКД из PDF.

Что делает скрипт:
  1. Рендерит каждую страницу PDF в картинку WebP двух размеров:
       pages/001.webp     - обычный размер (быстро грузится)
       pages_hi/001.webp  - высокое разрешение (подгружается при увеличении)
  2. Достаёт текст каждой страницы для поиска -> data/text.json
  3. Собирает data/data.js (страницы + оглавление + текст) - его читает js/app.js.
     Оглавление редактируется вручную в data/toc.json.

Требуется: Python 3.9+, Pillow, poppler-utils (pdftoppm, pdftotext).
Запуск:    python3 build.py umkd.pdf
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).parent
SIZES = {            # папка: (ширина px, качество WebP)
    "pages":    (1400, 82),
    "pages_hi": (2400, 84),
}


def run(*cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def page_count(pdf):
    for line in run("pdfinfo", str(pdf)).splitlines():
        if line.startswith("Pages:"):
            return int(line.split()[1])
    raise RuntimeError("не удалось определить число страниц")


def render(pdf, n):
    ratio = None
    for folder, (width, quality) in SIZES.items():
        out = ROOT / folder
        out.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory() as tmp:
            run("pdftoppm", "-scale-to-x", str(width), "-scale-to-y", "-1",
                "-png", str(pdf), f"{tmp}/p")
            for i, png in enumerate(sorted(Path(tmp).glob("p-*.png")), 1):
                im = Image.open(png).convert("RGB")
                ratio = ratio or im.height / im.width
                im.save(out / f"{i:03d}.webp", "WEBP", quality=quality, method=6)
        print(f"{folder}: {n} стр., {width}px")
    return ratio


def extract_text(pdf, n):
    texts = []
    for i in range(1, n + 1):
        t = run("pdftotext", "-f", str(i), "-l", str(i), "-layout", str(pdf), "-")
        texts.append(" ".join(t.split()))
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data" / "text.json").write_text(
        json.dumps(texts, ensure_ascii=False), encoding="utf-8")
    print("текст для поиска сохранён")


def write_data_js(n, ratio):
    """Один .js-файл вместо fetch(): сайт работает и при открытии index.html двойным кликом."""
    toc = json.loads((ROOT / "data" / "toc.json").read_text(encoding="utf-8"))
    text = json.loads((ROOT / "data" / "text.json").read_text(encoding="utf-8"))
    payload = {"pages": n, "ratio": round(ratio, 4), "toc": toc, "text": text}
    (ROOT / "data" / "data.js").write_text(
        "window.UMKD=" + json.dumps(payload, ensure_ascii=False) + ";\n", encoding="utf-8")
    print("data/data.js записан")


def main():
    pdf = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "umkd.pdf")
    n = page_count(pdf)
    ratio = render(pdf, n)
    extract_text(pdf, n)
    write_data_js(n, ratio)
    print("готово")


if __name__ == "__main__":
    main()
