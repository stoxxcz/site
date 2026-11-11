# Бот: 3GP → MP4

Отправь боту файл `.3gp` — он вернёт `.mp4` (H.264 + AAC).

## Запуск
Нужны Python 3.10+ и `ffmpeg`.

```bash
pip install -r requirements.txt
export BOT_TOKEN="токен_от_BotFather"
python bot.py
```

Ограничение Telegram Bot API: бот может скачивать файлы до 20 МБ.
