const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { downloadFile, getVideoInfo, cleanupTempFiles } = require('../utils/helpers');

// /sitaiコマンドの定義
const sitaiCommand = new SlashCommandBuilder()
    .setName('sitai')
    .setDescription('自動動画編集（素材→固定動画のパターンで結合）')
    .addAttachmentOption(option =>
        option.setName('素材')
            .setDescription('使用する素材mp4ファイル')
            .setRequired(true))
    .addAttachmentOption(option =>
        option.setName('名前')
            .setDescription('名前として使用するmp4ファイル')
            .setRequired(true));

// 同時実行中のsitaiコマンド数を管理
const activeSitaiCommands = new Set(); // 実行中のギルドIDを記録
const MAX_CONCURRENT_SITAI = 3; // 最大同時実行数

// sitaiコマンドで使用する固定動画のパスを取得する関数
function getNormalizedFixedVideoPath(originalFileNameWithExt) {
    const fixedVideoDir = path.join(__dirname, '../video', 'sitai');
    const baseName = path.parse(originalFileNameWithExt).name; // "1", "2" など
    const normalizedFileName = `${baseName}_norm.mp4`; // 期待する正規化ファイル名
    const normalizedFilePath = path.join(fixedVideoDir, normalizedFileName);
    const originalFilePath = path.join(fixedVideoDir, originalFileNameWithExt);

    // 正規化済みファイルが存在すればそれを使用
    if (fs.existsSync(normalizedFilePath)) {
        // 元ファイルより正規化済みファイルが古い場合は、元ファイルを使う（何らかの理由で正規化に失敗した場合など）
        if (fs.existsSync(originalFilePath) && fs.statSync(normalizedFilePath).mtimeMs < fs.statSync(originalFilePath).mtimeMs){
            console.warn(`⚠️  正規化済みファイル ${normalizedFileName} は元のファイル ${originalFileNameWithExt} より古いため、元ファイルを使用します。`);
            return originalFilePath;
        }
        return normalizedFilePath;
    }
    // 正規化済みファイルが存在しない場合は、元のファイルパスを返す (フォールバック)
    console.warn(`🔍 正規化済みファイル ${normalizedFileName} が見つかりません。元のファイル ${originalFileNameWithExt} を使用します。`);
    return originalFilePath; 
}

// 動画を結合する関数
async function concatenateVideos(videoList, outputPath) {
    return new Promise((resolve, reject) => {
        const tempDir = path.dirname(outputPath);
        const concatFilePath = path.join(tempDir, 'concat_list.txt');
        
        const concatContent = videoList.map(videoPath => {
            const escapedPath = videoPath.replace(/\\/g, '/').replace(/'/g, "\\'");
            return `file '${escapedPath}'`;
        }).join('\n');
        
        fs.writeFileSync(concatFilePath, concatContent);
        console.log('📝 動画リストファイル作成:', concatFilePath);
        console.log('📋 結合する動画:', videoList.length, '本');

        // 最初にストリームコピーを試みる
        ffmpeg()
            .input(concatFilePath)
            .inputOptions(['-f', 'concat', '-safe', '0'])
            .outputOptions(['-c', 'copy']) // ストリームコピー
            .output(outputPath)
            .on('start', (commandLine) => {
                console.log('🎬 動画結合開始 (ストリームコピー試行):', commandLine);
            })
            .on('end', () => {
                console.log('✅ 動画結合完了 (ストリームコピー成功)');
                if (fs.existsSync(concatFilePath)) fs.unlinkSync(concatFilePath);
                resolve();
            })
            .on('error', (err) => {
                console.warn('⚠️ ストリームコピー失敗:', err.message);
                console.log('🔄 再エンコードで結合を再試行します...');

                // ストリームコピー失敗時は再エンコードで結合
                ffmpeg()
                    .input(concatFilePath)
                    .inputOptions([
                        '-f', 'concat', 
                        '-safe', '0',
                        '-protocol_whitelist', 'file,pipe'
                    ])
                    .videoCodec('libx264')
                    .audioCodec('aac')
                    .outputOptions([
                        '-preset', 'fast',
                        '-crf', '20',
                        '-r', '30', 
                        '-g', '30',
                        '-keyint_min', '30',
                        '-sc_threshold', '0',
                        '-vsync', 'cfr',
                        '-async', '1',
                        '-avoid_negative_ts', 'make_zero',
                        '-fflags', '+genpts',
                        '-movflags', 'faststart',
                        '-pix_fmt', 'yuv420p',
                        '-profile:v', 'main',
                        '-level', '3.1',
                        '-b:v', '2500k',
                        '-maxrate', '3000k',
                        '-bufsize', '5000k',
                        '-max_muxing_queue_size', '1024',
                        '-af', 'aresample=async=1:min_hard_comp=0.100000:first_pts=0'
                    ])
                    .audioChannels(2)
                    .audioFrequency(48000)
                    .audioBitrate('192k')
                    .output(outputPath)
                    .on('start', (commandLine) => {
                        console.log('🎬 動画結合開始 (再エンコード):', commandLine);
                    })
                    .on('end', () => {
                        console.log('✅ 動画結合完了 (再エンコード成功)');
                        if (fs.existsSync(concatFilePath)) fs.unlinkSync(concatFilePath);
                        resolve();
                    })
                    .on('error', (err_fallback) => {
                        console.error('❌ 動画結合エラー (再エンコードも失敗):', err_fallback.message);
                        if (fs.existsSync(concatFilePath)) fs.unlinkSync(concatFilePath);
                        reject(err_fallback);
                    })
                    .run();
            })
            .run();
    });
}

// 動画を圧縮する関数
async function compressVideo(inputPath, outputPath, originalSizeInMB) {
    return new Promise(async (resolve, reject) => {
        try {
            console.log(`🔄 動画圧縮開始: ${originalSizeInMB.toFixed(1)}MB → 目標: 10MB以下`);
            
            // 段階的圧縮設定（CRF値: 低いほど高品質、高いほど低品質）
            const compressionLevels = [
                { crf: 28, scale: '1280x720', name: '中程度圧縮' },
                { crf: 32, scale: '1280x720', name: '高圧縮' },
                { crf: 35, scale: '960x540', name: '高圧縮+解像度削減' },
                { crf: 40, scale: '854x480', name: '最大圧縮' }
            ];
            
            // 圧縮レベルを決定
            let compressionLevel;
            if (originalSizeInMB <= 20) {
                compressionLevel = compressionLevels[0]; // 中程度圧縮
            } else if (originalSizeInMB <= 50) {
                compressionLevel = compressionLevels[1]; // 高圧縮
            } else if (originalSizeInMB <= 100) {
                compressionLevel = compressionLevels[2]; // 高圧縮+解像度削減
            } else {
                compressionLevel = compressionLevels[3]; // 最大圧縮
            }
            
            console.log(`🎯 圧縮設定: ${compressionLevel.name} (CRF: ${compressionLevel.crf}, 解像度: ${compressionLevel.scale})`);
            
            ffmpeg(inputPath)
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    '-preset', 'medium',
                    '-crf', compressionLevel.crf.toString(),
                    '-vf', `scale=${compressionLevel.scale}:force_original_aspect_ratio=decrease`,
                    '-movflags', 'faststart',
                    '-avoid_negative_ts', 'make_zero',
                    '-fflags', '+genpts'
                ])
                .output(outputPath)
                .on('start', (commandLine) => {
                    console.log('🔄 圧縮処理開始:', commandLine);
                })
                .on('progress', (progress) => {
                    if (progress.percent && progress.percent <= 100) {
                        console.log(`🔄 圧縮進行状況: ${Math.round(progress.percent)}%`);
                    }
                })
                .on('end', () => {
                    // 圧縮後のファイルサイズをチェック
                    const stats = fs.statSync(outputPath);
                    const compressedSizeInMB = stats.size / (1024 * 1024);
                    
                    console.log(`✅ 圧縮完了: ${originalSizeInMB.toFixed(1)}MB → ${compressedSizeInMB.toFixed(1)}MB`);
                    console.log(`📉 圧縮率: ${((1 - compressedSizeInMB / originalSizeInMB) * 100).toFixed(1)}%`);
                    
                    resolve();
                })
                .on('error', (err) => {
                    console.error('❌ 圧縮エラー:', err);
                    reject(err);
                })
                .run();
                
        } catch (error) {
            console.error('❌ 圧縮設定エラー:', error);
            reject(error);
        }
    });
}

// 動画を圧縮する関数（超圧縮）
async function compressVideoUltra(inputPath, outputPath, originalSizeInMB) {
    return new Promise(async (resolve, reject) => {
        try {
            console.log(`🔄 超圧縮開始: ${originalSizeInMB.toFixed(1)}MB → 目標: 10MB以下`);
            
            // 超圧縮設定（より積極的な圧縮）
            const ultraSettings = {
                crf: 45,           // 非常に高い圧縮率
                scale: '640x360',  // 360p解像度
                bitrate: '500k',   // 500kbps制限
                audioBitrate: '64k' // 音声64kbps
            };
            
            console.log(`🎯 超圧縮設定: CRF ${ultraSettings.crf}, 解像度 ${ultraSettings.scale}, ビットレート ${ultraSettings.bitrate}`);
            
            ffmpeg(inputPath)
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    '-preset', 'veryslow',  // 最高圧縮率（時間がかかるが効果的）
                    '-crf', ultraSettings.crf.toString(),
                    '-maxrate', ultraSettings.bitrate,
                    '-bufsize', '1000k',
                    '-vf', `scale=${ultraSettings.scale}:force_original_aspect_ratio=decrease`,
                    '-b:a', ultraSettings.audioBitrate,
                    '-movflags', 'faststart',
                    '-avoid_negative_ts', 'make_zero',
                    '-fflags', '+genpts'
                ])
                .output(outputPath)
                .on('start', (commandLine) => {
                    console.log('🔄 超圧縮処理開始:', commandLine);
                })
                .on('progress', (progress) => {
                    if (progress.percent && progress.percent <= 100) {
                        console.log(`🔄 超圧縮進行状況: ${Math.round(progress.percent)}%`);
                    }
                })
                .on('end', () => {
                    // 超圧縮後のファイルサイズをチェック
                    const stats = fs.statSync(outputPath);
                    const ultraCompressedSizeInMB = stats.size / (1024 * 1024);
                    
                    console.log(`✅ 超圧縮完了: ${originalSizeInMB.toFixed(1)}MB → ${ultraCompressedSizeInMB.toFixed(1)}MB`);
                    console.log(`📉 超圧縮率: ${((1 - ultraCompressedSizeInMB / originalSizeInMB) * 100).toFixed(1)}%`);
                    
                    resolve();
                })
                .on('error', (err) => {
                    console.error('❌ 超圧縮エラー:', err);
                    reject(err);
                })
                .run();
                
        } catch (error) {
            console.error('❌ 超圧縮設定エラー:', error);
            reject(error);
        }
    });
}

// 動画を基準動画に合わせて正規化する関数
async function normalizeToReference(inputPath, outputPath, referenceInfo) {
    return new Promise(async (resolve, reject) => {
        try {
            console.log(`🔧 動画正規化開始: ${path.basename(inputPath)}`);
            
            const inputInfo = await getVideoInfo(inputPath);
            const inputDuration = parseFloat(inputInfo.format.duration);
            
            const refVideoStream = referenceInfo.streams.find(stream => stream.codec_type === 'video');
            const refAudioStream = referenceInfo.streams.find(stream => stream.codec_type === 'audio');
            
            let refFrameRate = 30;
            try {
                const frameRateParts = refVideoStream.r_frame_rate.split('/');
                refFrameRate = parseFloat(frameRateParts[0]) / parseFloat(frameRateParts[1]);
            } catch (e) {
                console.log('⚠️  基準動画のフレームレート解析エラー、30fpsをデフォルトとして使用');
            }
            
            console.log(`🎯 正規化目標 (仕様のみ、時間は入力動画のものを維持):`);
            console.log(`  - 解像度: ${refVideoStream.width}x${refVideoStream.height}`);
            console.log(`  - フレームレート: ${refFrameRate}fps (基準動画に依存)`);
            console.log(`  - ピクセルフォーマット: yuv420p`);
            console.log(`  - 映像コーデック: libx264 (プロファイル: main, レベル: 3.1)`);
            console.log(`  - 音声コーデック: aac (チャンネル: ${refAudioStream ? refAudioStream.channels : 2}, サンプルレート: ${refAudioStream ? refAudioStream.sample_rate : 48000}Hz)`);
            console.log(`📊 入力動画の元時間: ${inputDuration.toFixed(3)}秒 (この時間を維持します)`);
            
            const ffmpegCommand = ffmpeg(inputPath);
            
            ffmpegCommand
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    '-t', inputDuration.toFixed(3), // 入力動画の長さを明示的に指定
                    '-preset', 'fast',
                    '-crf', '20', 
                    '-r', refFrameRate.toString(),
                    '-s', `${refVideoStream.width}x${refVideoStream.height}`,
                    '-g', Math.max(1, Math.floor(refFrameRate)).toString(),
                    '-keyint_min', Math.max(1, Math.floor(refFrameRate)).toString(),
                    '-sc_threshold', '0',
                    '-movflags', 'faststart',
                    '-vsync', 'cfr', // Constant Frame Rateを強制
                    '-avoid_negative_ts', 'make_zero',
                    '-fflags', '+genpts',
                    '-pix_fmt', 'yuv420p',
                    '-profile:v', 'main', 
                    '-level', '3.1', 
                    '-b:v', '2500k', 
                    '-maxrate', '3000k',
                    '-bufsize', '5000k'
                ])
                .audioChannels(refAudioStream ? refAudioStream.channels : 2)
                .audioFrequency(refAudioStream ? refAudioStream.sample_rate : 48000) 
                .audioBitrate('192k')
                .output(outputPath)
                .on('start', (commandLine) => {
                    console.log('🔧 正規化処理開始 (時間維持, -t オプション追加):', commandLine);
                })
                .on('progress', (progress) => {
                    if (progress.percent && progress.percent <= 100) {
                        console.log(`🔧 正規化進行状況: ${Math.round(progress.percent)}%`);
                    }
                })
                .on('end', async () => {
                    try {
                        const normalizedInfo = await getVideoInfo(outputPath);
                        const normalizedDuration = parseFloat(normalizedInfo.format.duration);
                        const normalizedVideoStream = normalizedInfo.streams.find(s => s.codec_type === 'video');
                        const normalizedAudioStream = normalizedInfo.streams.find(s => s.codec_type === 'audio');
                        
                        console.log(`✅ 正規化完了: ${path.basename(outputPath)}`);
                        console.log(`  - 結果時間: ${normalizedDuration.toFixed(3)}秒`);
                        console.log(`  - 結果解像度: ${normalizedVideoStream.width}x${normalizedVideoStream.height}`);
                        console.log(`  - 音声: ${normalizedAudioStream ? `${normalizedAudioStream.codec_name} ${normalizedAudioStream.channels}ch ${normalizedAudioStream.sample_rate}Hz ${normalizedAudioStream.bit_rate ? (parseInt(normalizedAudioStream.bit_rate)/1000).toFixed(0)+'kbps' : ''}` : 'なし'}`);
                        
                        const timeDiffOriginal = Math.abs(normalizedDuration - inputDuration);
                        if (timeDiffOriginal > 0.1) { 
                            console.log(`⚠️  警告: 正規化後の時間 (${normalizedDuration.toFixed(3)}秒) が元の時間 (${inputDuration.toFixed(3)}秒) とわずかに異なります (差異: ${timeDiffOriginal.toFixed(3)}秒)`);
                        }
                        
                    } catch (verifyError) {
                        console.error('❌ 正規化後検証エラー:', verifyError);
                    }
                    resolve();
                })
                .on('error', (err) => {
                    let stderrOutput = '';
                    if (err.ffmpegProc && err.ffmpegProc.stderr) {
                        err.ffmpegProc.stderr.on('data', chunk => stderrOutput += chunk.toString());
                    }
                    err.ffmpegProc.on('exit', () => {
                        console.error('❌ 正規化エラー (FFmpeg stderr):\n', stderrOutput);
                        reject(err);
                    });
                })
                .run();
                
        } catch (error) {
            console.error('❌ 正規化準備エラー:', error);
            reject(error);
        }
    });
}

// 固定動画を事前に正規化する関数
async function normalizeFixedVideos() {
    console.log('🛠️  固定動画の事前正規化を開始...');
    const fixedVideoDir = path.join(__dirname, '../video', 'sitai');
    const referenceVideoPath = path.join(fixedVideoDir, '1.mp4'); // 基準は常に元の1.mp4

    if (!fs.existsSync(referenceVideoPath)) {
        console.error('❌ 基準動画 (1.mp4) が見つかりません。固定動画の正規化をスキップします。');
        return;
    }

    try {
        const referenceInfo = await getVideoInfo(referenceVideoPath);
        console.log('📹 基準動画情報 (1.mp4) を読み込みました。');

        const files = fs.readdirSync(fixedVideoDir);
        for (const file of files) {
            // 正規化対象は "_norm.mp4" で終わらない .mp4 ファイルのみ
            if (file.endsWith('.mp4') && !file.endsWith('_norm.mp4')) {
                const originalFilePath = path.join(fixedVideoDir, file);
                const baseName = path.parse(file).name; // "1", "2" など
                const normalizedFilePath = path.join(fixedVideoDir, `${baseName}_norm.mp4`);
                
                // 正規化済みファイルが存在し、かつ元のファイルより新しい場合はスキップ
                if (fs.existsSync(normalizedFilePath) && 
                    fs.statSync(normalizedFilePath).mtimeMs >= fs.statSync(originalFilePath).mtimeMs) {
                    console.log(`⏭️  ${file} に対する正規化済みファイル ${path.basename(normalizedFilePath)} は最新です。スキップします。`);
                    continue;
                }
                
                console.log(`⏳ ${originalFilePath} を ${normalizedFilePath} へ正規化中...`);
                await normalizeToReference(originalFilePath, normalizedFilePath, referenceInfo);
                console.log(`✅ ${file} の正規化完了 → ${path.basename(normalizedFilePath)}`);
            }
        }
        console.log('🛠️  固定動画の事前正規化が完了しました。');
    } catch (error) {
        console.error('❌ 固定動画の事前正規化中にエラーが発生しました:', error);
    }
}

// /sitaiコマンドの処理
async function handleSitaiCommand(interaction) {
    // 長時間処理のため、即座にdeferReplyを実行
    try {
        await interaction.deferReply();
    } catch (error) {
        console.error('❌ deferReply エラー:', error);
        return;
    }

    const guildId = interaction.guild.id;
    const guildName = interaction.guild.name;

    // 同時実行数の制限チェック
    if (activeSitaiCommands.size >= MAX_CONCURRENT_SITAI) {
        await interaction.editReply({
            content: `⚠️ **動画編集処理が混雑しています**\n` +
                    `現在 ${activeSitaiCommands.size} 件の動画編集が実行中です。\n` +
                    `しばらくしてから再度お試しください。`
        });
        return;
    }

    // このサーバーで既にsitaiコマンドが実行中の場合
    if (activeSitaiCommands.has(guildId)) {
        await interaction.editReply({
            content: `⚠️ **このサーバーで動画編集が実行中です**\n` +
                    `前の動画編集が完了してから再度お試しください。`
        });
        return;
    }

    // 実行開始を記録
    activeSitaiCommands.add(guildId);
    console.log(`🎬 sitaiコマンド開始: ${guildName} (同時実行数: ${activeSitaiCommands.size}/${MAX_CONCURRENT_SITAI})`);

    try {
        const materialAttachment = interaction.options.getAttachment('素材');
        const nameAttachment = interaction.options.getAttachment('名前');

        // mp4ファイルかチェック
        if (!materialAttachment.name.endsWith('.mp4') || !nameAttachment.name.endsWith('.mp4')) {
            await interaction.editReply({
                content: '❌ mp4ファイルのみ対応しています。'
            });
            return;
        }

        // ファイルサイズチェック（25MB制限）
        if (materialAttachment.size > 25 * 1024 * 1024 || nameAttachment.size > 25 * 1024 * 1024) {
            await interaction.editReply({
                content: '❌ ファイルサイズが25MBを超えています。'
            });
            return;
        }

        await interaction.editReply({
            content: '🎬 動画編集を開始しています...\n素材をダウンロード中...'
        });

        // 一時ディレクトリを作成（ギルドID + タイムスタンプ + ランダム要素で重複を確実に回避）
        const randomSuffix = Math.random().toString(36).substring(2, 8); // 6文字のランダム文字列
        const tempDir = path.join(__dirname, '../temp', `sitai_${interaction.guild.id}_${Date.now()}_${randomSuffix}`);
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        console.log(`📁 一時ディレクトリ作成: ${path.basename(tempDir)} (サーバー: ${interaction.guild.name})`);

        // ファイルをダウンロード
        const materialPath = path.join(tempDir, 'material.mp4');
        const namePath = path.join(tempDir, 'name.mp4');

        await downloadFile(materialAttachment.url, materialPath);
        await downloadFile(nameAttachment.url, namePath);

        await interaction.editReply({
            content: '🎬 動画編集を開始しています...\n素材のダウンロード完了！\n動画情報を確認中...'
        });

        // 固定動画の情報を解析（1.mp4を基準とする）
        const referenceVideoPath = path.join(__dirname, '../video', 'sitai', '1.mp4');
        let referenceInfo;
        try {
            referenceInfo = await getVideoInfo(referenceVideoPath);
            const refVideoStream = referenceInfo.streams.find(stream => stream.codec_type === 'video');
            const refAudioStream = referenceInfo.streams.find(stream => stream.codec_type === 'audio');
            
            console.log('📹 基準動画情報 (1.mp4):');
            console.log(`  - 解像度: ${refVideoStream.width}x${refVideoStream.height}`);
            console.log(`  - フレームレート: ${refVideoStream.r_frame_rate}`);
            console.log(`  - 時間: ${parseFloat(referenceInfo.format.duration).toFixed(2)}秒`);
            console.log(`  - 映像コーデック: ${refVideoStream.codec_name}`);
            console.log(`  - 音声コーデック: ${refAudioStream ? refAudioStream.codec_name : 'なし'}`);
            
        } catch (error) {
            console.error('❌ 基準動画情報取得エラー:', error);
            await interaction.editReply({
                content: '❌ 固定動画の情報取得に失敗しました。video/sitai/1.mp4を確認してください。'
            });
            cleanupTempFiles([materialPath, namePath]);
            fs.rmSync(tempDir, { recursive: true, force: true });
            return;
        }

        // 動画情報を確認
        try {
            const materialInfo = await getVideoInfo(materialPath);
            const nameInfo = await getVideoInfo(namePath);
            
            const materialDuration = parseFloat(materialInfo.format.duration || 0);
            const nameDuration = parseFloat(nameInfo.format.duration || 0);
            const referenceDuration = parseFloat(referenceInfo.format.duration || 0);
            
            console.log(`📹 素材動画: ${materialDuration.toFixed(2)}秒`);
            console.log(`📹 名前動画: ${nameDuration.toFixed(2)}秒`);
            console.log(`📹 基準時間: ${referenceDuration.toFixed(2)}秒`);
            
        } catch (infoError) {
            console.error('❌ 動画情報取得エラー:', infoError);
            // エラーでも処理を続行
        }

        await interaction.editReply({
            content: '🎬 動画編集を開始しています...\n動画情報確認完了！\n素材動画を基準動画に合わせて最適化中...'
        });

        // 素材動画と名前動画を基準動画に完全に合わせて正規化
        const normalizedMaterialPath = path.join(tempDir, 'material_fixed.mp4');
        const normalizedNamePath = path.join(tempDir, 'name_fixed.mp4');

        try {
            await normalizeToReference(materialPath, normalizedMaterialPath, referenceInfo);
            await normalizeToReference(namePath, normalizedNamePath, referenceInfo);
        } catch (fixError) {
            console.error('❌ 動画正規化エラー:', fixError);
            await interaction.editReply({
                content: '❌ アップロードされた動画の正規化に失敗しました。\n別の動画ファイルをお試しください。'
            });
            cleanupTempFiles([materialPath, namePath, normalizedMaterialPath, normalizedNamePath]);
            fs.rmSync(tempDir, { recursive: true, force: true });
            return;
        }

        await interaction.editReply({
            content: '🎬 動画編集を開始しています...\n素材動画最適化完了！\n動画を結合中...'
        });

        // 動画リストを作成（最適化された動画を使用）
        const videoList = [
            getNormalizedFixedVideoPath('1.mp4'),  // 固定 (正規化済みパス)
            normalizedMaterialPath,                // 素材（最適化済み）
            getNormalizedFixedVideoPath('2.mp4'),  // 固定 (正規化済みパス)
            normalizedMaterialPath,                // 素材（最適化済み）
            getNormalizedFixedVideoPath('3.mp4'),  // 固定 (正規化済みパス)
            normalizedMaterialPath,                // 素材（最適化済み）
            getNormalizedFixedVideoPath('4.mp4'),  // 固定 (正規化済みパス)
            normalizedMaterialPath,                // 素材（最適化済み）
            getNormalizedFixedVideoPath('5.mp4'),  // 固定 (正規化済みパス)
            normalizedMaterialPath,                // 素材（最適化済み）
            getNormalizedFixedVideoPath('6.mp4'),  // 固定 (正規化済みパス)
            normalizedNamePath,                     // 名前（最適化済み）
            getNormalizedFixedVideoPath('7.mp4')   // 固定 (正規化済みパス)
        ];

        // 動画リストの詳細情報を出力
        console.log('📋 結合対象動画リスト:');
        let totalExpectedDuration = 0;
        for (let i = 0; i < videoList.length; i++) {
            const videoPath = videoList[i];
            const videoName = path.basename(videoPath);
            const isFixed = videoPath.includes('video/sitai/');
            const videoType = isFixed ? '固定' : (videoPath.includes('material') ? '素材' : '名前');
            
            // 各動画の時間を確認
            try {
                const videoInfo = await getVideoInfo(videoPath);
                const videoDuration = parseFloat(videoInfo.format.duration);
                totalExpectedDuration += videoDuration;
                
                console.log(`  ${i + 1}. ${videoName} (${videoType}) - ${videoDuration.toFixed(3)}秒`);
                
                // 固定動画以外で時間が異常な場合は警告
                if (!isFixed && videoDuration > 20) {
                    console.log(`    ⚠️  警告: 動画が長すぎます (${videoDuration.toFixed(2)}秒)`);
                }
                
            } catch (videoInfoError) {
                console.log(`  ${i + 1}. ${videoName} (${videoType}) - 情報取得エラー`);
            }
        }
        
        console.log(`📊 予想合計時間: ${totalExpectedDuration.toFixed(3)}秒`);

        // 固定動画ファイルの存在確認
        const missingFiles = [];
        for (let i = 1; i <= 7; i++) {
            const fixedVideoPath = path.join(__dirname, '../video', 'sitai', `${i}.mp4`);
            if (!fs.existsSync(fixedVideoPath)) {
                missingFiles.push(`${i}.mp4`);
            }
        }

        if (missingFiles.length > 0) {
            await interaction.editReply({
                content: `❌ 固定動画ファイルが見つかりません: ${missingFiles.join(', ')}\n` +
                        'video/sitaiフォルダに1.mp4～7.mp4を配置してください。'
            });
            cleanupTempFiles([materialPath, namePath, normalizedMaterialPath, normalizedNamePath]);
            fs.rmSync(tempDir, { recursive: true, force: true });
            return;
        }

        // 出力ファイルパス
        const outputPath = path.join(tempDir, 'output.mp4');

        // 動画を結合
        await concatenateVideos(videoList, outputPath);

        // 結合後の動画情報を確認
        try {
            const outputInfo = await getVideoInfo(outputPath);
            const outputDuration = parseFloat(outputInfo.format.duration);
            const outputVideoStream = outputInfo.streams.find(s => s.codec_type === 'video');
            
            console.log(`📹 結合後動画情報:`);
            console.log(`  - 時間: ${outputDuration.toFixed(3)}秒`);
            console.log(`  - 予想時間: ${totalExpectedDuration.toFixed(3)}秒`);
            console.log(`  - 時間差: ${Math.abs(outputDuration - totalExpectedDuration).toFixed(3)}秒`);
            console.log(`  - 解像度: ${outputVideoStream.width}x${outputVideoStream.height}`);
            console.log(`  - フレームレート: ${outputVideoStream.r_frame_rate}`);
            
            // 時間の差異をチェック
            const timeDiff = Math.abs(outputDuration - totalExpectedDuration);
            if (timeDiff > 1.0) {
                console.log(`⚠️  警告: 結合後の動画時間が期待値と大きく異なります (差異: ${timeDiff.toFixed(3)}秒)`);
            } else {
                console.log(`✅ 時間精度: ±${timeDiff.toFixed(3)}秒（良好）`);
            }
            
        } catch (debugError) {
            console.error('❌ 結合後動画情報取得エラー:', debugError);
        }

        // ファイルサイズをチェック
        const stats = fs.statSync(outputPath);
        const fileSizeInMB = stats.size / (1024 * 1024);

        if (fileSizeInMB > 10) {
            await interaction.editReply({
                content: `📊 動画サイズ: ${fileSizeInMB.toFixed(1)}MB\n🔄 10MBを超えているため圧縮中...`
            });

            // 圧縮処理
            const compressedPath = path.join(tempDir, 'compressed_output.mp4');
            try {
                await compressVideo(outputPath, compressedPath, fileSizeInMB);
                
                // 圧縮後のサイズをチェック
                const compressedStats = fs.statSync(compressedPath);
                const compressedSizeInMB = compressedStats.size / (1024 * 1024);
                
                if (compressedSizeInMB <= 10) {
                    // 圧縮成功
                    const attachment = new AttachmentBuilder(compressedPath, { name: 'sitai_edited_compressed.mp4' });
                    
                    await interaction.editReply({
                        content: `✅ **動画編集完了！（圧縮済み）**\n` +
                                `📁 元のサイズ: ${fileSizeInMB.toFixed(1)}MB\n` +
                                `📁 圧縮後: ${compressedSizeInMB.toFixed(1)}MB\n` +
                                `📉 圧縮率: ${((1 - compressedSizeInMB / fileSizeInMB) * 100).toFixed(1)}%\n` +
                                `🎬 構成: 固定動画 × 7 + 素材動画 × 5 + 名前動画 × 1\n` +
                                `⏱️ 総動画数: 13本\n` +
                                `🔄 動画形式: 圧縮品質 AAC (音声あり)`,
                        files: [attachment]
                    });
                    
                    // 一時ファイルをクリーンアップ
                    setTimeout(() => {
                        cleanupTempFiles([
                            materialPath, 
                            namePath, 
                            normalizedMaterialPath,
                            normalizedNamePath,
                            outputPath,
                            compressedPath
                        ]);
                        fs.rmSync(tempDir, { recursive: true, force: true });
                        console.log('🗑️  一時ディレクトリを削除:', tempDir);
                        
                        // 実行完了を記録から削除
                        activeSitaiCommands.delete(guildId);
                        console.log(`✅ sitaiコマンド完了 (圧縮): ${guildName} (残り同時実行数: ${activeSitaiCommands.size})`);
                    }, 5000);
                    
                    return;
                } else {
                    // さらに強力な圧縮を試行
                    await interaction.editReply({
                        content: `📊 圧縮後サイズ: ${compressedSizeInMB.toFixed(1)}MB\n🔄 さらに強力な圧縮を試行中...`
                    });
                    
                    const ultraCompressedPath = path.join(tempDir, 'ultra_compressed_output.mp4');
                    await compressVideoUltra(compressedPath, ultraCompressedPath, compressedSizeInMB);
                    
                    // 超圧縮後のサイズをチェック
                    const ultraStats = fs.statSync(ultraCompressedPath);
                    const ultraSizeInMB = ultraStats.size / (1024 * 1024);
                    
                    if (ultraSizeInMB <= 10) {
                        // 超圧縮成功
                        const attachment = new AttachmentBuilder(ultraCompressedPath, { name: 'sitai_edited_ultra_compressed.mp4' });
                        
                        await interaction.editReply({
                            content: `✅ **動画編集完了！（超圧縮済み）**\n` +
                                    `📁 元のサイズ: ${fileSizeInMB.toFixed(1)}MB\n` +
                                    `📁 最終サイズ: ${ultraSizeInMB.toFixed(1)}MB\n` +
                                    `📉 最終圧縮率: ${((1 - ultraSizeInMB / fileSizeInMB) * 100).toFixed(1)}%\n` +
                                    `🎬 構成: 固定動画 × 7 + 素材動画 × 5 + 名前動画 × 1\n` +
                                    `⏱️ 総動画数: 13本\n` +
                                    `🔄 動画形式: 超圧縮品質 AAC (音声あり)`,
                            files: [attachment]
                        });
                        
                        // 一時ファイルをクリーンアップ
                        setTimeout(() => {
                            cleanupTempFiles([
                                materialPath, 
                                namePath, 
                                normalizedMaterialPath,
                                normalizedNamePath,
                                outputPath,
                                compressedPath,
                                ultraCompressedPath
                            ]);
                            fs.rmSync(tempDir, { recursive: true, force: true });
                            console.log('🗑️  一時ディレクトリを削除:', tempDir);
                            
                            // 実行完了を記録から削除
                            activeSitaiCommands.delete(guildId);
                            console.log(`✅ sitaiコマンド完了 (超圧縮): ${guildName} (残り同時実行数: ${activeSitaiCommands.size})`);
                        }, 5000);
                        
                        return;
                    } else {
                        // 超圧縮しても10MBを超える場合
                        await interaction.editReply({
                            content: `❌ 最大圧縮後も${ultraSizeInMB.toFixed(1)}MBでDiscordの10MB制限を超えています。\n` +
                                    `💡 より短い素材動画を使用するか、解像度の低い動画をお試しください。\n` +
                                    `📊 圧縮比較:\n` +
                                    `• 元のサイズ: ${fileSizeInMB.toFixed(1)}MB\n` +
                                    `• 1次圧縮: ${compressedSizeInMB.toFixed(1)}MB\n` +
                                    `• 2次圧縮: ${ultraSizeInMB.toFixed(1)}MB`
                        });
                        
                        cleanupTempFiles([materialPath, namePath, normalizedMaterialPath, normalizedNamePath, outputPath, compressedPath, ultraCompressedPath]);
                        fs.rmSync(tempDir, { recursive: true, force: true });
                        
                        // エラー時も実行記録をクリーンアップ
                        activeSitaiCommands.delete(guildId);
                        console.log(`❌ sitaiコマンド終了 (圧縮失敗): ${guildName} (残り同時実行数: ${activeSitaiCommands.size})`);
                        return;
                    }
                }
            } catch (compressError) {
                console.error('❌ 動画圧縮エラー:', compressError);
                await interaction.editReply({
                    content: '❌ 動画の圧縮に失敗しました。'
                });
                
                cleanupTempFiles([materialPath, namePath, normalizedMaterialPath, normalizedNamePath, outputPath]);
                fs.rmSync(tempDir, { recursive: true, force: true });
                
                // エラー時も実行記録をクリーンアップ
                activeSitaiCommands.delete(guildId);
                console.log(`❌ sitaiコマンド終了 (圧縮失敗): ${guildName} (残り同時実行数: ${activeSitaiCommands.size})`);
                return;
            }
        }

        await interaction.editReply({
            content: '✅ 動画編集完了！\nアップロード中...'
        });

        // 動画を送信（10MB以下の場合）
        const attachment = new AttachmentBuilder(outputPath, { name: 'sitai_edited.mp4' });
        
        await interaction.editReply({
            content: `✅ **動画編集完了！**\n` +
                    `📁 サイズ: ${fileSizeInMB.toFixed(1)}MB\n` +
                    `🎬 構成: 固定動画 × 7 + 素材動画 × 5 + 名前動画 × 1\n` +
                    `⏱️ 総動画数: 13本\n` +
                    `🔄 動画形式: 30fps H.264 AAC (音声あり)`,
            files: [attachment]
        });

        // 一時ファイルをクリーンアップ
        setTimeout(() => {
            cleanupTempFiles([
                materialPath, 
                namePath, 
                normalizedMaterialPath,
                normalizedNamePath,
                outputPath
            ]);
            fs.rmSync(tempDir, { recursive: true, force: true });
            console.log('🗑️  一時ディレクトリを削除:', tempDir);
            
            // 実行完了を記録から削除
            activeSitaiCommands.delete(guildId);
            console.log(`✅ sitaiコマンド完了: ${guildName} (残り同時実行数: ${activeSitaiCommands.size})`);
        }, 5000); // 5秒後にクリーンアップ

    } catch (error) {
        console.error('❌ /sitaiコマンドエラー:', error);
        
        // エラー時も実行記録をクリーンアップ
        activeSitaiCommands.delete(guildId);
        console.log(`❌ sitaiコマンドエラー終了: ${guildName} (残り同時実行数: ${activeSitaiCommands.size})`);
        
        await interaction.editReply({
            content: '❌ 動画編集中にエラーが発生しました。\n' +
                    '• 動画ファイルが破損していないか確認してください\n' +
                    '• ファイル形式がmp4であることを確認してください\n' +
                    '• しばらくしてから再度お試しください'
        });
    }
}

module.exports = {
    sitaiCommand,
    handleSitaiCommand,
    normalizeFixedVideos
}; 