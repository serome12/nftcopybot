import { ethers } from "ethers";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import http from "http";

dotenv.config();

process.on("uncaughtException", (err) => {
  console.error("⚠️ Uncaught Exception:", err.message || err);
});

process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled Rejection:", reason);
});

// Render Health Check Server
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("NFT Copy Bot is running!\n");
}).listen(PORT, () => {
  console.log(`🌐 Health check server listening on port ${PORT}`);
});

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function getTargetWallets() {
  const rawWallets = process.env.TARGET_WALLET || "";
  const walletArray = rawWallets.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
  return new Set(walletArray);
}

let provider = null;

async function startWebSocketMonitor() {
  if (provider) {
    provider.removeAllListeners();
    try {
      await provider.destroy();
    } catch (e) {
      // safe ignore
    }
  }

  const targetWallets = getTargetWallets();
  console.log(`🎯 Tracking ${targetWallets.size} wallet(s) on Robinhood Chain L2...`);

  try {
    provider = new ethers.WebSocketProvider(process.env.WS_RPC_URL);

    bot.sendMessage(
      CHAT_ID,
      `🚀 **Robinhood L2 Copy Bot Online**\nMonitoring **${targetWallets.size}** address(es)!`,
      { parse_mode: "Markdown" }
    ).catch((err) => console.error("Telegram send error:", err.message));

    // Listen to incoming blocks with prefetched transactions
    provider.on("block", async (blockNumber) => {
      try {
        const block = await provider.getBlock(blockNumber, true);
        if (!block || !block.prefetchedTransactions) return;

        for (const tx of block.prefetchedTransactions) {
          if (!tx.from) continue;

          const sender = tx.from.toLowerCase();
          if (targetWallets.has(sender)) {
            console.log(`⚡ TARGET MATCH: Tx Hash ${tx.hash}`);

            const valueEth = ethers.formatEther(tx.value || 0);
            const explorerUrl = `https://robinhoodchain.blockscout.com/tx/${tx.hash}`;

            const message = `🚨 **ROBINHOOD L2 ACTIVITY DETECTED** 🚨\n\n` +
              `**Wallet:** \`${tx.from}\`\n` +
              `**Value:** ${valueEth} ETH\n` +
              `**To:** \`${tx.to || "Contract Deployment / Mint"}\`\n\n` +
              `🔗 [View Tx on Blockscout](${explorerUrl})`;

            await bot.sendMessage(CHAT_ID, message, {
              parse_mode: "Markdown",
              disable_web_page_preview: true,
            });
          }
        }
      } catch (err) {
        console.error(`Error processing block ${blockNumber}:`, err.message);
      }
    });

    provider.on("error", (err) => {
      console.error("⚠️ Provider error:", err.message);
      setTimeout(startWebSocketMonitor, 5000);
    });

  } catch (err) {
    console.error("❌ Provider setup failed:", err.message);
    setTimeout(startWebSocketMonitor, 5000);
  }
}

startWebSocketMonitor();

// 12-hour process exit safeguard to clear RAM on Render
setInterval(() => {
  console.log("♻️ Scheduled restart to free RAM...");
  process.exit(0);
}, 12 * 60 * 60 * 1000);
