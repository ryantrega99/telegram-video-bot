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
const userStates = new Map<number, { photoId?: string; caption?: string; model?: string; duration?: string }>();

const MODELS = [
  { id: "seedance_pro", name: "Seedance Pro" },
  { id: "seedance_1.5", name: "Seedance 1.5" },
  { id: "kling_v2.1_std", name: "Kling v2.1 Std" },
  { id: "kling_v2.1_pro", name: "Kling v2.1 Pro" },
  { id: "kling_v2.5_pro", name: "Kling v2.5 Pro" },
  { id: "kling_v2.6_pro", name: "Kling v2.6 Pro" },
  { id: "hailuo_2.3", name: "Hailuo 2.3" },
  { id: "wan_v2.6_hd", name: "WAN v2.6 HD" },
];

const DURATIONS = ["5", "10"];

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const modelButtons = MODELS.map((m) => [{ text: m.name, callback_data: `model:${m.id}` }]);

  bot.sendMessage(chatId, "Selamat datang! Silakan pilih model video untuk memulai:", {
    reply_markup: {
      inline_keyboard: modelButtons,
    },
  });
});

bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  const user = getUser(chatId.toString());
  const state = userStates.get(chatId);

  if (!state || !state.model || !state.duration) {
    return bot.sendMessage(chatId, "Silakan pilih model dan durasi terlebih dahulu dengan mengetik /start");
  }

  if (user.daily_count >= DAILY_LIMIT) {
    return bot.sendMessage(chatId, "Maaf, kuota harian Anda (50 video) sudah habis. Silakan coba lagi besok.");
  }

  const photo = msg.photo?.[msg.photo.length - 1];
  const caption = msg.caption || "Generate video from this image";

  if (!photo) return;

  state.photoId = photo.file_id;
  state.caption = caption;
  userStates.set(chatId, state);

  bot.sendMessage(chatId, "⏳ Sedang memproses gambar...");

  try {
    // Get file link from Telegram
    const file = await bot.getFile(state.photoId);
    const imageUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

    // Start generation
    const jobId = await generateVideo(imageUrl, state.caption, state.model!, state.duration!);
    saveJob(chatId.toString(), jobId, state.model!, state.caption);
    incrementUserCount(chatId.toString());

    bot.sendMessage(chatId, "🚀 Video sedang di-generate. Mohon tunggu, ini mungkin memakan waktu beberapa menit...");

    // Start Polling
    pollStatus(chatId, jobId);
    userStates.delete(chatId);
  } catch (error: any) {
    bot.sendMessage(chatId, `❌ Gagal: ${error.message}`);
    userStates.delete(chatId);
  }
});

bot.on("callback_query", async (query) => {
  const chatId = query.message?.chat.id;
  if (!chatId) return;

  const data = query.data || "";
  let state = userStates.get(chatId) || {};

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
    userStates.set(chatId, state);
    
    bot.answerCallbackQuery(query.id, { text: "Durasi dipilih!" });
    bot.editMessageText(`Model: ${MODELS.find(m => m.id === state.model)?.name}\nDurasi: ${duration} Detik\n\nSekarang silakan kirim **Foto** dengan **Caption** untuk generate video.`, {
      chat_id: chatId,
      message_id: query.message?.message_id,
      parse_mode: "Markdown"
    });
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
