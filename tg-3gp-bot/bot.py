"""Telegram-бот: присылаешь .3gp — получаешь .mp4 (H.264 + AAC)."""
import asyncio
import logging
import os
import tempfile
from pathlib import Path

from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

logging.basicConfig(format="%(asctime)s %(levelname)s %(message)s", level=logging.INFO)
log = logging.getLogger("bot")

TOKEN = os.environ.get("BOT_TOKEN")
MAX_SIZE = 20 * 1024 * 1024  # лимит скачивания файлов через Bot API


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text("Привет! Отправь мне файл .3gp (видео или документом), и я пришлю его в .mp4.")


async def convert(src: Path, dst: Path) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-i", str(src),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
        "-movflags", "+faststart", str(dst),
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
    )
    _, err = await proc.communicate()
    return proc.returncode, err.decode(errors="ignore")[-800:]


async def handle_file(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    msg = update.message
    media = msg.document or msg.video
    name = getattr(media, "file_name", None) or "video.3gp"
    mime = getattr(media, "mime_type", "") or ""

    if not (name.lower().endswith(".3gp") or "3gpp" in mime):
        await msg.reply_text("Это не .3gp файл. Пришли, пожалуйста, файл с расширением .3gp.")
        return
    if media.file_size and media.file_size > MAX_SIZE:
        await msg.reply_text("Файл больше 20 МБ — Telegram не даёт ботам скачивать такие файлы.")
        return

    status = await msg.reply_text("⏳ Конвертирую...")
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "input.3gp"
        dst = Path(tmp) / (Path(name).stem + ".mp4")
        tg_file = await media.get_file()
        await tg_file.download_to_drive(src)

        code, err = await convert(src, dst)
        if code != 0 or not dst.exists():
            log.error("ffmpeg failed: %s", err)
            await status.edit_text("❌ Не удалось сконвертировать файл.")
            return

        with dst.open("rb") as f:
            await msg.reply_document(document=f, filename=dst.name, caption="✅ Готово!")
        await status.delete()


def main() -> None:
    if not TOKEN:
        raise SystemExit("Задай токен: export BOT_TOKEN=...")
    app = Application.builder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.Document.ALL | filters.VIDEO, handle_file))
    log.info("Бот запущен")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
