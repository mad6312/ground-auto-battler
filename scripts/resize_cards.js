/**
 * scripts/resize_cards.js
 * カードイラスト一括高精細リサイズ＆アンシャープバッチスクリプト
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

    // 2. 元画像の安全バックアップ
    console.log('[2/3] 元画像の退避・バックアップを確認中...');
    for (const file of files) {
        const srcPath = path.join(CARDS_DIR, file);
        const backupPath = path.join(BACKUP_DIR, file);

        // バックアップ側にまだ存在しない場合のみコピー（元画像の保持）
        if (!fs.existsSync(backupPath)) {
            fs.copyFileSync(srcPath, backupPath);
        }
    }
    console.log('      元画像は cards_original/ に安全に保管されています。\n');

    // 3. 高品質リサイズ処理の実行
    console.log(`[3/3] Lanczos3 + 輪郭強調による高精細縮小を実行中 (${TARGET_WIDTH}x${TARGET_HEIGHT} px)...`);

    const hasAssetsFallback = fs.existsSync(ASSETS_FALLBACK_DIR);
    let successCount = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const inputPath = path.join(BACKUP_DIR, file); // 常に安全な元画像から処理
        const outputCardPath = path.join(CARDS_DIR, file);

        try {
            // sharpによる最高品質リサイズ & 輪郭シャープネス補正
            const buffer = await sharp(inputPath)
                .resize(TARGET_WIDTH, TARGET_HEIGHT, {
                    fit: 'cover',
                    kernel: sharp.kernel.lanczos3 // 最も鮮明な補間フィルター
                })
                .sharpen({
                    sigma: 0.9,  // 輪郭検出半径
                    m1: 1.1,     // 平坦部のシャープネス
                    m2: 2.2      // エッジ部のシャープネス（主線をクッキリ立たせる）
                })
                .webp({
                    quality: 90, // 高品位WebP
                    effort: 6    // 最大圧縮効率探索
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
    console.log(`  全画像の最適化が完了しました！ (成功: ${successCount} 件)`);
    console.log('  ・元画像: public/images/cards_original/ に永久保存');
    console.log('  ・高精細画像: public/images/cards/ に配置完了');
    console.log('====================================================\n');
}

run().catch(err => {
    console.error('致命的エラー:', err);
    process.exit(1);
});