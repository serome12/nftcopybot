import { ethers } from "ethers";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import http from "node:http";

dotenv.config();

// Dummy HTTP server to satisfy Render Free Web Service health checks
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("NFT Copy Bot is running live!\n");
}).listen(PORT, () => {
  console.log(`🌐 Health check server listening on port ${PORT}`);
});

const WS_RPC_URL = process.env.WS_RPC_URL;
const TARGET_WALLETS = new Set(
  process.env.TARGET_WALLET?.split(",").map((addr) => addr.trim().toLowerCase())
);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!WS_RPC_URL || TARGET_WALLETS.size === 0 || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("❌ Missing required environment variables!");
  process.exit(1);
}

const telegram = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
const TRANSFER_EVENT_TOPIC = ethers.id("Transfer(address,address,uint256)");

async function sendTelegramAlert(message) {
  try {
    await telegram.sendMessage(TELEGRAM_CHAT_ID, message, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error("⚠️ Telegram alert error:", err.message);
  }
}

function startWebSocketMonitor() {
  console.log(`🔌 Monitoring ${TARGET_WALLETS.size} target wallet(s)...`);
  const provider = new ethers.WebSocketProvider(WS_RPC_URL);

  provider.on("block", async (blockNumber) => {
    try {
      const block = await provider.getBlock(blockNumber, true);
      if (!block || !block.prefetchedTransactions) return;

      for (const tx of block.prefetchedTransactions) {
        if (tx.from && TARGET_WALLETS.has(tx.from.toLowerCase())) {
          const ethSent = ethers.formatEther(tx.value);
          const receipt = await provider.getTransactionReceipt(tx.hash);
          if (receipt) {
            parseLogsAndAlert(tx, receipt, ethSent);
          }
        }
      }
    } catch (error) {
      console.error("Error processing block:", error.message);
    }
  });

  provider.on("error", (err) => {
    console.error("⚠️ Provider WebSocket error:", err.message || err);
    setTimeout(startWebSocketMonitor, 5000);
  });
}

function parseLogsAndAlert(tx, receipt, ethSent) {
  receipt.logs.forEach((log) => {
    if (log.topics[0] === TRANSFER_EVENT_TOPIC && log.topics.length === 4) {
      const from = ethers.stripZerosLeft(log.topics[1]);
      const tokenId = BigInt(log.topics[3]).toString();

      const isMint = from === "0x0000000000000000000000000000000000000000";
      const actionType = isMint ? "✨ NFT MINT DETECTED" : "🛒 NFT TRADE / TRANSFER";

      const alertMsg = `
🚨 <b>${actionType}</b>

<b>Wallet Tracked:</b> <code>${tx.from}</code>
<b>ETH Sent:</b> ${ethSent} ETH
<b>Token ID:</b> #${tokenId}
<b>Contract:</b> <code>${log.address}</code>

🔗 <a href="https://etherscan.io/tx/${tx.hash}">Etherscan Tx</a> | <a href="https://opensea.io/assets/ethereum/${log.address}/${tokenId}">OpenSea Link</a>
`;

      sendTelegramAlert(alertMsg);
      console.log(`📱 Push alert sent for Token #${tokenId}`);
    }
  });
}

sendTelegramAlert(`🚀 <b>NFT Wallet Tracker Active</b>\nMonitoring <b>${TARGET_WALLETS.size}</b> wallet(s)!`);
startWebSocketMonitor();
