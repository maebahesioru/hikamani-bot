const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const { createAudioFromText } = require('tiktok-tts');

// ファイル取得関数
function getAllMp4Files(folderName = 'all') {
    const materialPath = path.join(__dirname, '../material');
    let allFiles = [];

    if (folderName === 'all') {
        // 全フォルダから取得
        const folders = ['hikakin', 'hajime', 'masuo', 'seikin'];
        folders.forEach(folder => {
            const folderPath = path.join(materialPath, folder);
            if (fs.existsSync(folderPath)) {
                const files = fs.readdirSync(folderPath)
                    .filter(file => file.endsWith('.mp4'))
                    .map(file => ({
                        name: file,
                        path: path.join(folderPath, file),
                        folder: folder
                    }));
                allFiles = allFiles.concat(files);
            }
        });
    } else {
        // 指定されたフォルダから取得
        const folderPath = path.join(materialPath, folderName);
        if (fs.existsSync(folderPath)) {
            const files = fs.readdirSync(folderPath)
                .filter(file => file.endsWith('.mp4'))
                .map(file => ({
                    name: file,
                    path: path.join(folderPath, file),
                    folder: folderName
                }));
            allFiles = files;
        }
    }

    return allFiles;
}

// 検索関数
function searchFiles(files, searchTerm) {
    if (!searchTerm) return files;

    return files.filter(file => {
        const fileName = file.name.toLowerCase();
        const search = searchTerm.toLowerCase();
        
        // 完全一致チェック
        if (fileName === search) return true;
        
        // 部分一致チェック
        if (fileName.includes(search)) return true;
        
        // 拡張子を除いたファイル名での完全一致チェック
        const nameWithoutExt = fileName.replace('.mp4', '');
        if (nameWithoutExt === search) return true;
        
        return false;
    });
}

// ランダム選択関数
function getRandomFile(files) {
    if (files.length === 0) return null;
    return files[Math.floor(Math.random() * files.length)];
}

// ファイルサイズチェック関数（Discordの10MB制限）
function checkFileSize(filePath) {
    const stats = fs.statSync(filePath);
    const fileSizeInMB = stats.size / (1024 * 1024);
    return fileSizeInMB <= 10;
}

// 全mp4ファイル数を取得する関数
function getAllMp4Count() {
    try {
        const materialPath = path.join(__dirname, '../material');
        const folders = ['hikakin', 'hajime', 'masuo', 'seikin'];
        let totalCount = 0;

        folders.forEach(folder => {
            const folderPath = path.join(materialPath, folder);
            if (fs.existsSync(folderPath)) {
                const files = fs.readdirSync(folderPath).filter(file => file.endsWith('.mp4'));
                totalCount += files.length;
            }
        });

        return totalCount;
    } catch (error) {
        console.error('mp4ファイル数の取得エラー:', error);
        return 0;
    }
}

// TTS音声を生成する関数
async function generateTTS(text, guildId) {
    try {
        if (!process.env.TIKTOK_SESSION_ID) {
            console.log('❌ TikTok Session IDが設定されていません');
            return null;
        }

        // URLを「URL省略」に置き換え
        let processedText = text
            .replace(/https?:\/\/[^\s]+/g, 'URL省略') // http://またはhttps://で始まるURL
            .replace(/www\.[^\s]+/g, 'URL省略') // www.で始まるURL
            .replace(/[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[^\s]*/g, 'URL省略'); // ドメイン形式のURL

        // 読み上げテキストを制限（TikTok TTSの制限に合わせて短く）
        const maxLength = 100; // 200文字から100文字に短縮
        const truncatedText = processedText.length > maxLength ? processedText.substring(0, maxLength) + '...' : processedText;
        
        // 特殊文字や絵文字を除去
        const cleanText = truncatedText
            .replace(/[^\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\u0020-\u007F]/g, '') // ひらがな、カタカナ、漢字、英数字のみ
            .trim();

        if (!cleanText) {
            console.log('⚠️  読み上げ可能なテキストがありません');
            return null;
        }

        console.log(`🎤 TTS生成中: "${cleanText}"`);
        
        const fileName = `tts_${guildId}_${Date.now()}`;
        const filePath = path.join(__dirname, '../audio', fileName);
        
        // HikakinボイスでTTS生成
        await createAudioFromText(cleanText, filePath, 'jp_male_hikakin');
        
        const fullPath = `${filePath}.mp3`;
        if (fs.existsSync(fullPath)) {
            console.log(`✅ TTS生成完了: ${fullPath}`);
            return fullPath;
        } else {
            console.log('❌ TTSファイルの生成に失敗しました');
            return null;
        }
    } catch (error) {
        console.error('❌ TTS生成エラー:', error);
        
        // エラーの種類によってメッセージを変更
        if (error.message && error.message.includes('too long')) {
            return 'TEXT_TOO_LONG'; // 特別なエラーコード
        }
        
        return null;
    }
}

// ファイルをダウンロードする関数
async function downloadFile(url, filepath) {
    const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream'
    });
    
    return new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(filepath);
        response.data.pipe(writer);
        
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

// 動画情報を取得する関数
async function getVideoInfo(videoPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) {
                reject(err);
            } else {
                resolve(metadata);
            }
        });
    });
}

// 一時ファイルをクリーンアップする関数
function cleanupTempFiles(files) {
    files.forEach(file => {
        if (fs.existsSync(file)) {
            fs.unlinkSync(file);
            console.log(`🗑️  一時ファイルを削除: ${file}`);
        }
    });
}

// VoiceConnectionを安全に破棄する関数
function safeDestroyVoiceConnection(connection, guildName = '不明') {
    try {
        if (!connection) {
            console.log(`⚠️  接続が既にnullです: ${guildName}`);
            return false;
        }
        
        // VoiceConnectionの状態をチェック
        if (connection.state && connection.state.status === 'destroyed') {
            console.log(`⚠️  接続は既に破棄されています: ${guildName}`);
            return false;
        }
        
        // destroyメソッドが存在するかチェック
        if (typeof connection.destroy !== 'function') {
            console.log(`⚠️  destroy メソッドが存在しません: ${guildName}`);
            return false;
        }
        
        console.log(`🔌 VC接続を安全に破棄中: ${guildName}`);
        connection.destroy();
        console.log(`✅ VC接続破棄完了: ${guildName}`);
        return true;
        
    } catch (error) {
        console.error(`❌ VC接続破棄エラー (${guildName}):`, error.message);
        return false;
    }
}

module.exports = {
    getAllMp4Files,
    searchFiles,
    getRandomFile,
    checkFileSize,
    getAllMp4Count,
    generateTTS,
    downloadFile,
    getVideoInfo,
    cleanupTempFiles,
    safeDestroyVoiceConnection
}; 