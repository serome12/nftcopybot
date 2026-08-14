import { ethers } from "ethers";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import http from "node-http";

dotenv.config();

// Prevent process crashes on unhandled WebSocket or network errors
process.on("uncaughtException", (err) => {
  console.error("⚠️ Uncaught Exception caught:", err.message || err);
});

process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled Rejection caught:", reason);
});

// Dummy HTTP server for Render Free Web Service health checks
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("NFT Copy Bot is running!\n");
}).listen(PORT, () => {
  console.log(`🌐 Health check server listening on port ${PORT}`);
});

// Initialize Telegram Bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Helper function to parse target wallets (supports comma-separated list)
function getTargetWallets() {
  const rawWallets = process.env.TARGET_WALLET || "";
  const walletArray = rawWallets.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
  return new Set(walletArray);
}

let provider = null;

async function startWebSocketMonitor() {
  // 1. CLEANUP: Destroy old provider and remove listeners to prevent memory leaks
  if (provider) {
    provider.removeAllListeners();
    try {
      await provider.destroy();
    } catch (e) {
      // Ignore if socket was already closed
    }
  }

  const targetWallets = getTargetWallets();
  console.log(`🎯 Tracking ${targetWallets.size} target wallet(s)...`);

  try {
    console.log("🔌 Connecting to WebSocket RPC...");
    provider = new ethers.WebSocketProvider(process.env.WS_RPC_URL);

    // Send startup notification to Telegram
    bot.sendMessage(
      CHAT_ID,
      `🚀 **NFT Copy Bot Online**\nMonitoring **${targetWallets.size}** wallet address(es) for activity!`,
      { parse_mode: "Markdown" }
    ).catch((err) => console.error("Telegram send error:", err.message));

    // 2. LISTEN TO INCOMING BLOCKS
    provider.on("block", async (blockNumber) => {
      try {
        const block = await provider.getBlock(blockNumber, true);
        if (!block || !block.prefetchedTransactions) return;

        for (const tx of block.prefetchedTransactions) {
          if (!tx.from) continue;

          const sender = tx.from.toLowerCase();
          if (targetWallets.has(sender)) {
            console.log(`⚡ Match found! Tx Hash: ${tx.hash} from ${sender}`);

            const valueEth = ethers.formatEther(tx.value || 0);
            const etherscanUrl = `https://etherscan.io/tx/${tx.hash}`;
            const openseaUrl = `https://opensea.io/${tx.from}`;

            const message = `🚨 **TARGET WALLET ACTIVITY DETECTED** 🚨\n\n` +
              `**Wallet:** \`${tx.from}\`\n` +
              `**Value:** ${valueEth} ETH\n` +
              `**To:** \`${tx.to || "Contract Deployment"}\`\n\n` +
              `🔗 [View on Etherscan](${etherscanUrl})\n` +
              `⛵ [View on OpenSea](${openseaUrl})`;

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

    // 3. RECONNECT CLEANLY ON ERROR
    provider.on("error", (err) => {
      console.error("⚠️ Provider WebSocket error:", err.message);
      setTimeout(startWebSocketMonitor, 5000);
    });

  } catch (err) {
    console.error("❌ Failed to initialize WebSocket provider:", err.message);
    setTimeout(startWebSocketMonitor, 5000);
  }
}

// Start tracking loop
startWebSocketMonitor();

// 4. MEMORY SAFEGUARD: Auto-restart process every 12 hours to flush RAM on Render
setInterval(() => {
  console.log("♻️ Scheduled process exit to clear RAM...");
  process.exit(0);
}, 12 * 60 * 60 * 1000);
