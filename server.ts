import "dotenv/config";
import express from "express";
import TelegramBot from "node-telegram-bot-api";
import { getUser, incrementUserCount, saveJob } from "./src/db.ts";
import { generateVideo, checkVideoStatus } from "./src/freepik.ts";
import axios from "axios";

const token = process.env.TELEGRAM_BOT_TOKEN || "";
const bot = new TelegramBot(token, { polling: true });
const app = express();
const PORT = 3000;

const DAILY_LIMIT = 50;

// User state tracking
const userStates = new Map<number, { photoId: string; caption: string; model?: string; duration?: string }>();

const MODELS = [
  { id: "kling_v2.1_std", name: "Kling v2.1 Std" },
  { id: "kling_v2.1_pro", name: "Kling v2.1 Pro" },
  { id: "kling_v2.5_pro", name: "Kling v2.5 Pro" },
  { id: "kling_v2.6_pro", name: "Kling v2.6 Pro" },
  { id: "hailuo_2.3", name: "Hailuo 2.3" },
  { id: "seedance_pro", name: "Seedance Pro" },
  { id: "seedance_1.5", name: "Seedance 1.5" },
];

const DURATIONS = ["5", "10"];

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Halo! Kirimkan foto dengan caption untuk mulai generate video AI.\n\nKuota harian: 50 video.");
});

bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  const user = getUser(chatId.toString());

  if (user.daily_count >= DAILY_LIMIT) {
    return bot.sendMessage(chatId, "Maaf, kuota harian Anda (50 video) sudah habis. Silakan coba lagi besok.");
  }

  const photo = msg.photo?.[msg.photo.length - 1];
  const caption = msg.caption || "Generate video from this image";

  if (!photo) return;

  userStates.set(chatId, { photoId: photo.file_id, caption });

  const modelButtons = MODELS.map((m) => [{ text: m.name, callback_data: `model:${m.id}` }]);

  bot.sendMessage(chatId, "Pilih Model Video:", {
    reply_markup: {
      inline_keyboard: modelButtons,
    },
  });
});

bot.on("callback_query", async (query) => {
  const chatId = query.message?.chat.id;
  if (!chatId) return;

  const data = query.data || "";
  const state = userStates.get(chatId);

  if (!state) {
    return bot.answerCallbackQuery(query.id, { text: "Sesi kadaluarsa. Silakan kirim foto lagi." });
  }

  if (data.startsWith("model:")) {
    const modelId = data.split(":")[1];
    state.model = modelId;
    userStates.set(chatId, state);

    const durationButtons = DURATIONS.map((d) => ({ text: `${d} Detik`, callback_data: `dur:${d}` }));

    bot.editMessageText("Pilih Durasi Video:", {
      chat_id: chatId,
      message_id: query.message?.message_id,
      reply_markup: {
        inline_keyboard: [durationButtons],
      },
    });
  } else if (data.startsWith("dur:")) {
    const duration = data.split(":")[1];
    state.duration = duration;
    
    bot.answerCallbackQuery(query.id, { text: "Memulai proses..." });
    bot.editMessageText("⏳ Sedang memproses gambar...", {
      chat_id: chatId,
      message_id: query.message?.message_id,
    });

    try {
      // Get file link from Telegram
      const file = await bot.getFile(state.photoId);
      const imageUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

      // Start generation
      const jobId = await generateVideo(imageUrl, state.caption, state.model!, state.duration!);
      saveJob(chatId.toString(), jobId, state.model!, state.caption);
      incrementUserCount(chatId.toString());

      bot.editMessageText("🚀 Video sedang di-generate. Mohon tunggu, ini mungkin memakan waktu beberapa menit...", {
        chat_id: chatId,
        message_id: query.message?.message_id,
      });

      // Start Polling
      pollStatus(chatId, jobId);
      userStates.delete(chatId);
    } catch (error: any) {
      bot.sendMessage(chatId, `❌ Gagal: ${error.message}`);
      userStates.delete(chatId);
    }
  }
});

async function pollStatus(chatId: number, jobId: string) {
  const interval = setInterval(async () => {
    try {
      const result = await checkVideoStatus(jobId);
      
      if (result.status === "completed" && result.video?.url) {
        clearInterval(interval);
        bot.sendMessage(chatId, "✅ Video selesai!");
        bot.sendVideo(chatId, result.video.url, { caption: "Hasil generate video AI Freepik" });
      } else if (result.status === "failed") {
        clearInterval(interval);
        bot.sendMessage(chatId, `❌ Gagal generate video: ${result.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error("Polling error:", error);
      // Don't clear interval on network error, just retry
    }
  }, 10000); // Poll every 10 seconds

  // Timeout after 10 minutes
  setTimeout(() => {
    clearInterval(interval);
  }, 10 * 60 * 1000);
}

// Health check and Railway binding
app.get("/", (req, res) => res.send("Bot is running!"));
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});
