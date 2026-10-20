/**
 * server.js
 * グラウンド・オートバトラー メインサーバーエントリーポイント
 * (Cloudflare Tunnel高速化・静的ファイル強力キャッシュ最適化版)
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

// 静的ファイルのホスティング (画像・アセットの強力キャッシュを有効化)
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '7d', // 画像・CSS・JSをブラウザおよびCDNに7日間強力キャッシュ
    immutable: true,
    setHeaders: (res, filePath) => {
        // 画像アセット類には明示的にパブリックキャッシュヘッダーを付与
        if (/\.(webp|png|jpg|jpeg|svg|ico)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        }
    }
}));

// Socket.ioイベントハンドラの登録
registerSocketHandlers(io);

// サーバー起動
server.listen(PORT, () => {
    console.log(`Ground Auto Battler server is running on http://localhost:${PORT}`);
});