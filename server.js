/**
 * server.js
 * グラウンド・オートバトラー メインサーバーエントリーポイント
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { registerSocketHandlers } = require('./src/server/socketHandlers');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// 静的ファイルのホスティング
app.use(express.static(path.join(__dirname, 'public')));

// Socket.ioイベントハンドラの登録
registerSocketHandlers(io);

// サーバー起動
server.listen(PORT, () => {
    console.log(`Ground Auto Battler server is running on http://localhost:${PORT}`);
});