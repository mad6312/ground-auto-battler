/**
 * scripts/resize_cards.js
 * カードイラスト一括高精細リサイズバッチスクリプト (滑らか・最高画質版)
 *
 * 【実行方法】
 * node scripts/resize_cards.js
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// フォルダパス設定
const CARDS_DIR = path.join(__dirname, '../public/images/cards');
const BACKUP_DIR = path.join(__dirname, '../public/images/cards_original');
const ASSETS_FALLBACK_DIR = path.join(__dirname, '../public/assets/cards');

// 出力解像度設定 (120x90 に対する Retina 3倍 超高精細サイズ: 360x270)
const TARGET_WIDTH = 360;
const TARGET_HEIGHT = 270;

async function run() {
    console.log('====================================================');
    console.log('  グラウンド・オートバトラー カードイラスト高画質最適化バッチ');
    console.log('  (過剰シャープ排除・シルキー＆クリア最高画質設定)');
    console.log('====================================================\n');

    if (!fs.existsSync(CARDS_DIR)) {
        console.error(`エラー: 対象フォルダが見つかりません: ${CARDS_DIR}`);
        process.exit(1);
    }

    // 1. バックアップフォルダの確認と作成
    if (!fs.existsSync(BACKUP_DIR)) {
        console.log(`[1/3] 元画像保管用フォルダを作成中: ${BACKUP_DIR}`);
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const files = fs.readdirSync(CARDS_DIR).filter(file => {
        return /\.(webp|png|jpg|jpeg)$/i.test(file);
    });

    if (files.length === 0) {
        console.log('処理対象の画像ファイルが見つかりませんでした。');
        return;
    }

    console.log(`対象ファイル数: ${files.length} 件\n`);

    // 2. 元画像の安全バックアップ確認
    console.log('[2/3] 元画像（cards_original/）の存在を確認中...');
    for (const file of files) {
        const srcPath = path.join(CARDS_DIR, file);
        const backupPath = path.join(BACKUP_DIR, file);

        if (!fs.existsSync(backupPath)) {
            fs.copyFileSync(srcPath, backupPath);
        }
    }
    console.log('      元画像は cards_original/ に安全に保管されています。\n');

    // 3. 高品質リサイズ処理の実行（過剰シャープなし・素直で美しいLanczos3縮小）
    console.log(`[3/3] 自然で滑らかなLanczos3縮小を実行中 (${TARGET_WIDTH}x${TARGET_HEIGHT} px, Quality: 95)...`);

    const hasAssetsFallback = fs.existsSync(ASSETS_FALLBACK_DIR);
    let successCount = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const inputPath = path.join(BACKUP_DIR, file); // 常に保管された元画像から生成
        const outputCardPath = path.join(CARDS_DIR, file);

        try {
            // 過度なアンシャープマスクを廃止し、Lanczos3補間のみで自然かつクッキリと縮小
            const buffer = await sharp(inputPath)
                .resize(TARGET_WIDTH, TARGET_HEIGHT, {
                    fit: 'cover',
                    kernel: sharp.kernel.lanczos3
                })
                .webp({
                    quality: 95, // 最高品位WebP（ノイズなし）
                    effort: 6
                })
                .toBuffer();

            // カード画像フォルダへ書き出し
            fs.writeFileSync(outputCardPath, buffer);

            // フォールバック先（public/assets/cards/）が存在する場合は同期コピー
            if (hasAssetsFallback) {
                const outputFallbackPath = path.join(ASSETS_FALLBACK_DIR, file);
                fs.writeFileSync(outputFallbackPath, buffer);
            }

            successCount++;
            process.stdout.write(`\r      進捗: ${successCount} / ${files.length} 完了 (${file})`);
        } catch (err) {
            console.error(`\nエラー発生: ${file}`, err.message);
        }
    }

    console.log('\n\n====================================================');
    console.log(`  全画像の再生成が完了しました！ (成功: ${successCount} 件)`);
    console.log('  ザラつきが消え、元画像特有の滑らかさと鮮明さが蘇りました。');
    console.log('====================================================\n');
}

run().catch(err => {
    console.error('致命的エラー:', err);
    process.exit(1);
});