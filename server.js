/**
 * server.js
 * グラウンド・オートバトラー メインサーバーエントリーポイント
 * (画像のみ長期キャッシュ・コード即時反映 最適化版)
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

// 静的ファイルのホスティング設定
app.use(express.static(path.join(__dirname, 'public'), {
    // JSやCSS、HTMLはコード改修が即座に反映されるようデフォルトキャッシュを無効化
    maxAge: 0,
    setHeaders: (res, filePath) => {
        // 画像アセット（webp, png, jpg, svg等）のみ7日間の強力キャッシュを適用
        if (/\.(webp|png|jpg|jpeg|svg|ico)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        } else {
            // JS, CSS, HTML は常に最新の変更をサーバーへ確認・即時反映
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// Socket.ioイベントハンドラの登録
registerSocketHandlers(io);

// サーバー起動
server.listen(PORT, () => {
    console.log(`Ground Auto Battler server is running on http://localhost:${PORT}`);
});