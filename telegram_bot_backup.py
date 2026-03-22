
import os
import subprocess
import asyncio
from telegram import Update
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    MessageHandler,
    ContextTypes,
    filters,
)

# 環境変数からトークンを読み込み
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_TOKEN")
if not TELEGRAM_TOKEN:
    raise RuntimeError("TELEGRAM_TOKEN が設定されていません。環境変数にセットしてください。")

def ask_claude(prompt: str) -> str:
    try:
        full_prompt = f"""
あなたはDayDreamHubの開発アシスタントです。

このプロジェクトのコードベースを理解した上で回答してください。

ユーザー質問:
{prompt}
"""

        result = subprocess.run(
            ["claude", "-p", full_prompt],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=60
        )
        return result.stdout.strip()
    except Exception as e:
        return f"エラーが発生しました: {e}"


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    print("START HANDLER CALLED")
    await update.message.reply_text("これは自作botの/startです")


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    text = update.message.text
    await update.message.chat.send_action(action="typing")
    try:
        # claude call is blocking; run in executor to avoid blocking event loop
        answer = await asyncio.get_event_loop().run_in_executor(None, ask_claude, text)
    except Exception as e:
        answer = f"エラーが発生しました: {e}"
    await context.bot.send_message(chat_id=update.effective_chat.id, text=answer)


def main() -> None:
    app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    print("Bot 起動中 ...")
    app.run_polling()


if __name__ == "__main__":
    main()
