const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, getVoiceConnection } = require('@discordjs/voice');
const fs = require('fs');
const { generateTTS, safeDestroyVoiceConnection } = require('../utils/helpers');

// サーバーごとのVC状態を管理
const voiceStates = new Map();

// サーバーごとの読み上げ対象ボットを管理
const allowedBots = new Map(); // key: guildId, value: Set<botUserId>

// /joinコマンドの定義
const joinCommand = new SlashCommandBuilder()
    .setName('join')
    .setDescription('ボイスチャンネルに参加して読み上げを開始します');

// /leaveコマンドの定義
const leaveCommand = new SlashCommandBuilder()
    .setName('leave')
    .setDescription('ボイスチャンネルから退出します');

// /joinsubコマンドの定義
const joinSubCommand = new SlashCommandBuilder()
    .setName('joinsub')
    .setDescription('ボイスチャンネルに参加して複数チャンネルの読み上げを開始します')
    .addChannelOption(option =>
        option.setName('channel')
            .setDescription('読み上げ対象のテキストチャンネル')
            .setRequired(true)
            .addChannelTypes(0)); // TEXT_CHANNEL

// /leavesubコマンドの定義
const leaveSubCommand = new SlashCommandBuilder()
    .setName('leavesub')
    .setDescription('指定したチャンネルの読み上げを停止します')
    .addChannelOption(option =>
        option.setName('channel')
            .setDescription('読み上げ停止対象のテキストチャンネル')
            .setRequired(true)
            .addChannelTypes(0)); // TEXT_CHANNEL

// /VCbotinviteコマンドの定義
const vcBotInviteCommand = new SlashCommandBuilder()
    .setName('vcbotinvite')
    .setDescription('特定のボットのメッセージを読み上げ対象に追加します')
    .addUserOption(option =>
        option.setName('bot')
            .setDescription('読み上げ対象に追加するボット')
            .setRequired(true));

// /VCbotreaveコマンドの定義
const vcBotLeaveCommand = new SlashCommandBuilder()
    .setName('vcbotreave')
    .setDescription('特定のボットのメッセージを読み上げ対象から削除します')
    .addUserOption(option =>
        option.setName('bot')
            .setDescription('読み上げ対象から削除するボット')
            .setRequired(true));

// /VCbotlistコマンドの定義
const vcBotListCommand = new SlashCommandBuilder()
    .setName('vcbotlist')
    .setDescription('現在読み上げ対象に登録されているボット一覧を表示します');

// /hikakinvoicemp3コマンドの定義
const hikakinVoiceMP3Command = new SlashCommandBuilder()
    .setName('hikakinvoicemp3')
    .setDescription('ヒカキンボイスでテキストを読み上げ、mp3ファイルとして送信します')
    .addStringOption(option =>
        option.setName('text')
            .setDescription('読み上げるテキスト（100文字以内）')
            .setRequired(true)
            .setMaxLength(100));

// 音声を再生する関数
async function playAudio(guildId, audioPath) {
    const voiceState = voiceStates.get(guildId);
    if (!voiceState || !voiceState.connection) {
        console.log('❌ ボイス接続が見つかりません');
        return;
    }

    try {
        const resource = createAudioResource(audioPath);
        const player = createAudioPlayer();
        
        player.play(resource);
        voiceState.connection.subscribe(player);
        
        player.on(AudioPlayerStatus.Playing, () => {
            console.log('🎵 音声再生開始');
        });
        
        player.on(AudioPlayerStatus.Idle, () => {
            console.log('🎵 音声再生終了');
            // 再生終了後にファイルを削除
            setTimeout(() => {
                if (fs.existsSync(audioPath)) {
                    fs.unlinkSync(audioPath);
                    console.log('🗑️  一時ファイルを削除:', audioPath);
                }
            }, 1000);
        });
        
        player.on('error', (error) => {
            console.error('❌ 音声再生エラー:', error);
        });
        
    } catch (error) {
        console.error('❌ 音声再生設定エラー:', error);
    }
}

// テキスト処理関数
function processTextForTTS(message) {
    let text = message.content || '';
    
    // 半角カタカナを全角カタカナに変換
    text = text.replace(/[\uFF66-\uFF9F]/g, function(match) {
        const code = match.charCodeAt(0);
        // 半角カタカナの文字コード変換表
        const katakanaMap = {
            'ｱ': 'ア', 'ｲ': 'イ', 'ｳ': 'ウ', 'ｴ': 'エ', 'ｵ': 'オ',
            'ｶ': 'カ', 'ｷ': 'キ', 'ｸ': 'ク', 'ｹ': 'ケ', 'ｺ': 'コ',
            'ｻ': 'サ', 'ｼ': 'シ', 'ｽ': 'ス', 'ｾ': 'セ', 'ｿ': 'ソ',
            'ﾀ': 'タ', 'ﾁ': 'チ', 'ﾂ': 'ツ', 'ﾃ': 'テ', 'ﾄ': 'ト',
            'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ', 'ﾉ': 'ノ',
            'ﾊ': 'ハ', 'ﾋ': 'ヒ', 'ﾌ': 'フ', 'ﾍ': 'ヘ', 'ﾎ': 'ホ',
            'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ', 'ﾓ': 'モ',
            'ﾔ': 'ヤ', 'ﾕ': 'ユ', 'ﾖ': 'ヨ',
            'ﾗ': 'ラ', 'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ',
            'ﾜ': 'ワ', 'ｦ': 'ヲ', 'ﾝ': 'ン',
            'ｧ': 'ァ', 'ｨ': 'ィ', 'ｩ': 'ゥ', 'ｪ': 'ェ', 'ｫ': 'ォ',
            'ｬ': 'ャ', 'ｭ': 'ュ', 'ｮ': 'ョ', 'ｯ': 'ッ',
            'ｰ': 'ー', '｡': '。', '｢': '「', '｣': '」', '､': '、', '･': '・'
        };
        return katakanaMap[match] || match;
    });
    
    // 濁点・半濁点の処理
    text = text.replace(/ｶﾞ/g, 'ガ').replace(/ｷﾞ/g, 'ギ').replace(/ｸﾞ/g, 'グ').replace(/ｹﾞ/g, 'ゲ').replace(/ｺﾞ/g, 'ゴ');
    text = text.replace(/ｻﾞ/g, 'ザ').replace(/ｼﾞ/g, 'ジ').replace(/ｽﾞ/g, 'ズ').replace(/ｾﾞ/g, 'ゼ').replace(/ｿﾞ/g, 'ゾ');
    text = text.replace(/ﾀﾞ/g, 'ダ').replace(/ﾁﾞ/g, 'ヂ').replace(/ﾂﾞ/g, 'ヅ').replace(/ﾃﾞ/g, 'デ').replace(/ﾄﾞ/g, 'ド');
    text = text.replace(/ﾊﾞ/g, 'バ').replace(/ﾋﾞ/g, 'ビ').replace(/ﾌﾞ/g, 'ブ').replace(/ﾍﾞ/g, 'ベ').replace(/ﾎﾞ/g, 'ボ');
    text = text.replace(/ﾊﾟ/g, 'パ').replace(/ﾋﾟ/g, 'ピ').replace(/ﾌﾟ/g, 'プ').replace(/ﾍﾟ/g, 'ペ').replace(/ﾎﾟ/g, 'ポ');
    
    // スタンプ検出
    if (message.stickers && message.stickers.size > 0) {
        text += text ? ' スタンプ' : 'スタンプ';
    }
    
    // 絵文字検出（カスタム絵文字とUnicode絵文字）
    const customEmojiRegex = /<a?:[^:]+:\d+>/g;
    const unicodeEmojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
    
    // カスタム絵文字を除去して「絵文字」に置換
    const customEmojiCount = (text.match(customEmojiRegex) || []).length;
    text = text.replace(customEmojiRegex, '');
    
    // Unicode絵文字を除去して「絵文字」に置換
    const unicodeEmojiCount = (text.match(unicodeEmojiRegex) || []).length;
    text = text.replace(unicodeEmojiRegex, '');
    
    // 絵文字があった場合は「絵文字」を追加
    const totalEmojiCount = customEmojiCount + unicodeEmojiCount;
    if (totalEmojiCount > 0) {
        text += text ? ' 絵文字' : '絵文字';
    }
    
    // 添付ファイル検出
    if (message.attachments && message.attachments.size > 0) {
        const attachments = Array.from(message.attachments.values());
        const mediaTypes = [];
        
        attachments.forEach(attachment => {
            if (attachment.contentType) {
                if (attachment.contentType.startsWith('image/')) {
                    mediaTypes.push('画像');
                } else if (attachment.contentType.startsWith('video/')) {
                    mediaTypes.push('動画');
                } else if (attachment.contentType.startsWith('audio/')) {
                    mediaTypes.push('音声');
                }
            } else if (attachment.name) {
                // 拡張子から判定
                const extension = attachment.name.split('.').pop().toLowerCase();
                if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(extension)) {
                    mediaTypes.push('画像');
                } else if (['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'].includes(extension)) {
                    mediaTypes.push('動画');
                } else if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'].includes(extension)) {
                    mediaTypes.push('音声');
                }
            }
        });
        
        // 重複を除去して追加
        const uniqueMediaTypes = [...new Set(mediaTypes)];
        if (uniqueMediaTypes.length > 0) {
            text += (text ? ' ' : '') + uniqueMediaTypes.join(' ');
        }
    }
    
    return text.trim();
}

// メッセージを読み上げる関数
async function speakMessage(message, client) {
    // 基本的な存在確認
    if (!message.guild || !message.channel || !message.author) return;
    
    const guildId = message.guild.id;
    const voiceState = voiceStates.get(guildId);
    
    if (!voiceState || !voiceState.connection) {
        return; // VC接続していない
    }
    
    // 複数チャンネル対応のチェック
    const isTargetChannel = voiceState.textChannelIds 
        ? voiceState.textChannelIds.has(message.channel.id)
        : voiceState.textChannelId === message.channel.id;
    
    if (!isTargetChannel) {
        return; // 読み上げ対象チャンネルではない
    }
    
    // ボットメッセージの処理
    if (message.author.bot) {
        // 自分自身のメッセージは読み上げしない
        if (message.author.id === client.user.id) {
            return;
        }
        
        // 許可されたボットかチェック
        const guildAllowedBots = allowedBots.get(guildId);
        if (!guildAllowedBots || !guildAllowedBots.has(message.author.id)) {
            return; // 許可されていないボット
        }
    }
    
    // テキスト処理
    const processedText = processTextForTTS(message);
    
    // 空のメッセージは読み上げしない
    if (!processedText) {
        return;
    }
    
    console.log(`📢 読み上げ対象: ${message.author.displayName}: ${processedText}`);
    
    // TTS音声を生成して再生
    const audioPath = await generateTTS(processedText, guildId);
    
    if (audioPath === 'TEXT_TOO_LONG') {
        // テキストが長すぎる場合のエラーメッセージ
        try {
            await message.reply({
                content: '⚠️ **テキストが長すぎます！**\n' +
                        '📝 読み上げ可能な文字数: **100文字以内**\n' +
                        '💡 短いメッセージで再度お試しください。',
                allowedMentions: { repliedUser: false }
            });
        } catch (error) {
            console.error('❌ エラーメッセージの送信に失敗:', error);
        }
    } else if (audioPath) {
        await playAudio(guildId, audioPath);
    }
}

// VC内にユーザーがいないかチェックして、いない場合は退室する関数
function checkAndLeaveIfEmpty(guildId, client) {
    try {
        const voiceState = voiceStates.get(guildId);
        if (!voiceState || !voiceState.connection || !voiceState.voiceChannelId) {
            return;
        }
        
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;
        
        const voiceChannel = guild.channels.cache.get(voiceState.voiceChannelId);
        if (!voiceChannel) return;
        
        // VC内のメンバーを取得（ボットを除く）
        const humanMembers = voiceChannel.members.filter(member => !member.user.bot);
        
        console.log(`🔍 ${guild.name}のVC内ユーザー数: ${humanMembers.size}人`);
        
        // ユーザーが0人の場合は退室
        if (humanMembers.size === 0) {
            console.log(`👋 ${guild.name}のVCにユーザーがいないため自動退室します`);
            
            // 退室メッセージを再生してから退室
            setTimeout(async () => {
                try {
                    const leaveMessage = '誰もいなくなったので退室します';
                    const audioPath = await generateTTS(leaveMessage, guildId);
                    if (audioPath && audioPath !== 'TEXT_TOO_LONG') {
                        await playAudio(guildId, audioPath);
                        
                        // 音声再生後に退室
                        setTimeout(() => {
                            const currentVoiceState = voiceStates.get(guildId);
                            if (currentVoiceState && currentVoiceState.connection) {
                                const success = safeDestroyVoiceConnection(currentVoiceState.connection, guild.name);
                                if (success) {
                                    voiceStates.delete(guildId);
                                    console.log(`✅ ${guild.name}から自動退室完了`);
                                }
                            }
                        }, 3000); // 3秒後に退室（音声再生の完了を待つ）
                    } else {
                        // 音声再生に失敗した場合はすぐに退室
                        const currentVoiceState = voiceStates.get(guildId);
                        if (currentVoiceState && currentVoiceState.connection) {
                            const success = safeDestroyVoiceConnection(currentVoiceState.connection, guild.name);
                            if (success) {
                                voiceStates.delete(guildId);
                                console.log(`✅ ${guild.name}から自動退室完了`);
                            }
                        }
                    }
                } catch (error) {
                    console.error('❌ 自動退室処理エラー:', error);
                    // エラーが発生した場合もとりあえず退室を試行
                    const currentVoiceState = voiceStates.get(guildId);
                    if (currentVoiceState && currentVoiceState.connection) {
                        safeDestroyVoiceConnection(currentVoiceState.connection, guild.name);
                        voiceStates.delete(guildId);
                    }
                }
            }, 500); // 0.5秒後に退室処理開始
        }
    } catch (error) {
        console.error('❌ VC人数チェックエラー:', error);
    }
}

// 各コマンドハンドラー
async function handleJoinCommand(interaction) {
    await interaction.deferReply();

    // メンバー情報の存在確認
    if (!interaction.member) {
        await interaction.editReply({
            content: '❌ メンバー情報を取得できませんでした。'
        });
        return;
    }

    const member = interaction.member;
    
    // ボイス状態の存在確認
    if (!member.voice) {
        await interaction.editReply({
            content: '❌ ボイス状態を取得できませんでした。再度お試しください。'
        });
        return;
    }

    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
        await interaction.editReply({
            content: '❌ ボイスチャンネルに参加してからコマンドを使用してください。'
        });
        return;
    }

    try {
        const guildId = interaction.guild.id;
        
        // 既にVCに接続している場合は切断
        const existingConnection = getVoiceConnection(guildId);
        if (existingConnection) {
            safeDestroyVoiceConnection(existingConnection, interaction.guild.name);
        }

        // VC接続
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guildId,
            adapterCreator: interaction.guild.voiceAdapterCreator,
        });

        // 接続状態を保存
        voiceStates.set(guildId, {
            connection: connection,
            textChannelId: interaction.channel.id,
            voiceChannelId: voiceChannel.id
        });

        // 接続状態の監視
        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log(`✅ ${interaction.guild.name}のVCに接続しました`);
            
            // 「接続しました」の音声を再生
            setTimeout(async () => {
                try {
                    const welcomeAudio = await generateTTS('接続しました', guildId);
                    if (welcomeAudio) {
                        await playAudio(guildId, welcomeAudio);
                    }
                } catch (error) {
                    console.error('❌ 接続音声の再生に失敗:', error);
                }
            }, 1000); // 1秒後に再生（接続の安定化を待つ）
        });

        connection.on(VoiceConnectionStatus.Disconnected, () => {
            console.log(`🔌 ${interaction.guild.name}のVCから切断されました`);
            voiceStates.delete(guildId);
        });

        await interaction.editReply({
            content: `🎤 ${voiceChannel.name}に参加しました！\nこのチャンネルでのメッセージをヒカキンボイスで読み上げします。`
        });

    } catch (error) {
        console.error('❌ VC参加エラー:', error);
        await interaction.editReply({
            content: '❌ ボイスチャンネルへの参加に失敗しました。'
        });
    }
}

async function handleLeaveCommand(interaction) {
    await interaction.deferReply();

    const guildId = interaction.guild.id;
    const voiceState = voiceStates.get(guildId);

    if (!voiceState || !voiceState.connection) {
        await interaction.editReply({
            content: '❌ ボットはボイスチャンネルに参加していません。'
        });
        return;
    }

    try {
        // VC切断
        const success = safeDestroyVoiceConnection(voiceState.connection, interaction.guild.name);
        if (success) {
            voiceStates.delete(guildId);
            await interaction.editReply({
                content: '👋 ボイスチャンネルから退出しました。'
            });
        } else {
            await interaction.editReply({
                content: '⚠️ ボイスチャンネルからの退出処理に問題が発生しましたが、状態はリセットされました。'
            });
            voiceStates.delete(guildId); // 状態をクリア
        }

    } catch (error) {
        console.error('❌ VC退出エラー:', error);
        await interaction.editReply({
            content: '❌ ボイスチャンネルからの退出に失敗しました。'
        });
    }
}

// 他のコマンドハンドラーも同様に作成...
async function handleJoinSubCommand(interaction) {
    // joinsubコマンドの処理...
    // （既存のコードをここに移動）
}

async function handleLeaveSubCommand(interaction) {
    // leavesubコマンドの処理...
    // （既存のコードをここに移動）
}

async function handleVcBotInviteCommand(interaction, client) {
    await interaction.deferReply();

    try {
        const bot = interaction.options.getUser('bot');
        const guildId = interaction.guild.id;

        // ボットかどうかチェック
        if (!bot.bot) {
            await interaction.editReply({
                content: '❌ 指定されたユーザーはボットではありません。ボットを選択してください。'
            });
            return;
        }

        // 自分自身は追加できない
        if (bot.id === client.user.id) {
            await interaction.editReply({
                content: '❌ 自分自身を読み上げ対象に追加することはできません。'
            });
            return;
        }

        // 許可リストに追加
        if (!allowedBots.has(guildId)) {
            allowedBots.set(guildId, new Set());
        }

        const guildAllowedBots = allowedBots.get(guildId);

        if (guildAllowedBots.has(bot.id)) {
            await interaction.editReply({
                content: `⚠️ ${bot.displayName || bot.username} は既に読み上げ対象に追加されています。`
            });
            return;
        }

        guildAllowedBots.add(bot.id);

        await interaction.editReply({
            content: `✅ **読み上げ対象ボットを追加しました**\n` +
                    `🤖 ボット: ${bot.displayName || bot.username}\n` +
                    `📋 現在の読み上げ対象ボット数: ${guildAllowedBots.size}体\n\n` +
                    `💡 このボットのメッセージが読み上げされるようになりました。`
        });

        console.log(`🤖 読み上げ対象ボット追加: ${interaction.guild.name} > ${bot.username} (${bot.id})`);

    } catch (error) {
        console.error('❌ /vcbotinviteコマンドエラー:', error);
        await interaction.editReply({
            content: '❌ ボットの追加中にエラーが発生しました。'
        });
    }
}

async function handleVcBotLeaveCommand(interaction) {
    await interaction.deferReply();

    try {
        const bot = interaction.options.getUser('bot');
        const guildId = interaction.guild.id;

        // ボットかどうかチェック
        if (!bot.bot) {
            await interaction.editReply({
                content: '❌ 指定されたユーザーはボットではありません。ボットを選択してください。'
            });
            return;
        }

        // 許可リストから削除
        const guildAllowedBots = allowedBots.get(guildId);

        if (!guildAllowedBots || !guildAllowedBots.has(bot.id)) {
            await interaction.editReply({
                content: `⚠️ ${bot.displayName || bot.username} は読み上げ対象に登録されていません。`
            });
            return;
        }

        guildAllowedBots.delete(bot.id);

        // リストが空になった場合はMapから削除
        if (guildAllowedBots.size === 0) {
            allowedBots.delete(guildId);
        }

        await interaction.editReply({
            content: `✅ **読み上げ対象ボットを削除しました**\n` +
                    `🤖 ボット: ${bot.displayName || bot.username}\n` +
                    `📋 現在の読み上げ対象ボット数: ${guildAllowedBots.size}体\n\n` +
                    `💡 このボットのメッセージは読み上げされなくなりました。`
        });

        console.log(`🤖 読み上げ対象ボット削除: ${interaction.guild.name} > ${bot.username} (${bot.id})`);

    } catch (error) {
        console.error('❌ /vcbotreaveコマンドエラー:', error);
        await interaction.editReply({
            content: '❌ ボットの削除中にエラーが発生しました。'
        });
    }
}

async function handleVcBotListCommand(interaction, client) {
    await interaction.deferReply();

    try {
        const guildId = interaction.guild.id;
        const guildAllowedBots = allowedBots.get(guildId);

        if (!guildAllowedBots || guildAllowedBots.size === 0) {
            await interaction.editReply({
                content: '📋 **現在このサーバーでは読み上げ対象ボットが登録されていません**\n\n' +
                        '💡 `/vcbotinvite` コマンドでボットを追加できます。'
            });
            return;
        }

        const botListPromises = Array.from(guildAllowedBots).map(async (botId) => {
            try {
                const bot = await client.users.fetch(botId);
                return `🤖 **${bot.displayName || bot.username}**\n` +
                       `   ID: ${bot.id}`;
            } catch (error) {
                return `❓ **不明なボット**\n` +
                       `   ID: ${botId}`;
            }
        });

        const botList = await Promise.all(botListPromises);

        await interaction.editReply({
            content: `📋 **読み上げ対象ボット一覧** (${guildAllowedBots.size}体)\n\n` +
                    `${botList.join('\n\n')}\n\n` +
                    `💡 \`/vcbotreave\` で削除、\`/vcbotinvite\` で追加できます。`
        });

        console.log(`📋 読み上げ対象ボット一覧表示: ${interaction.guild.name} > ${interaction.user.tag}`);

    } catch (error) {
        console.error('❌ /vcbotlistコマンドエラー:', error);
        await interaction.editReply({
            content: '❌ ボット一覧の取得中にエラーが発生しました。'
        });
    }
}

async function handleHikakinVoiceMP3Command(interaction) {
    await interaction.deferReply();

    try {
        const text = interaction.options.getString('text');

        if (!text || text.trim().length === 0) {
            await interaction.editReply({
                content: '❌ テキストが空です。読み上げるテキストを入力してください。'
            });
            return;
        }

        if (!process.env.TIKTOK_SESSION_ID) {
            await interaction.editReply({
                content: '❌ TikTok TTS機能が設定されていません。管理者にお問い合わせください。'
            });
            return;
        }

        await interaction.editReply({
            content: '🎤 ヒカキンボイスで音声を生成中...'
        });

        const audioPath = await generateTTS(text, interaction.guild.id);

        if (audioPath === 'TEXT_TOO_LONG') {
            await interaction.editReply({
                content: '❌ **テキストが長すぎます！**\n' +
                        '📝 読み上げ可能な文字数: **100文字以内**\n' +
                        '💡 短いテキストで再度お試しください。'
            });
            return;
        }

        if (!audioPath || !fs.existsSync(audioPath)) {
            await interaction.editReply({
                content: '❌ 音声ファイルの生成に失敗しました。\n' +
                        '💡 TikTok TTSサービスに一時的な問題がある可能性があります。\n' +
                        '🔄 しばらくしてから再度お試しください。'
            });
            return;
        }

        // ファイルサイズを正しく計算
        const stats = fs.statSync(audioPath);
        const fileSizeInKB = stats.size / 1024;

        const attachment = new AttachmentBuilder(audioPath, { name: 'hikakin_voice.mp3' });

        await interaction.editReply({
            content: `✅ **ヒカキンボイスで読み上げ完了！**\n` +
                    `📝 テキスト: "${text}"\n` +
                    `📁 ファイルサイズ: ${fileSizeInKB.toFixed(1)}KB\n` +
                    `🎵 形式: MP3 (ヒカキンボイス)\n` +
                    `💡 VCに入らずに音声ファイルが生成されました！`,
            files: [attachment]
        });

        // 5秒後にファイルをクリーンアップ
        setTimeout(() => {
            if (fs.existsSync(audioPath)) {
                fs.unlinkSync(audioPath);
                console.log(`🗑️  TTSファイルをクリーンアップ: ${audioPath}`);
            }
        }, 5000);

        console.log(`🎤 ヒカキンボイスMP3生成: ${interaction.guild.name} > ${interaction.user.tag} | "${text}"`);

    } catch (error) {
        console.error('❌ /hikakinvoicemp3コマンドエラー:', error);
        await interaction.editReply({
            content: '❌ 音声ファイルの生成中にエラーが発生しました。\n' +
                    '💡 ネットワークの問題やTTSサービスの一時的な問題の可能性があります。\n' +
                    '🔄 しばらくしてから再度お試しください。'
        });
    }
}

// 状態クリア関数
function clearVoiceStates(guildId) {
    voiceStates.delete(guildId);
    allowedBots.delete(guildId);
}

// voiceStatesへのアクセサ
function getVoiceStates() {
    return voiceStates;
}

module.exports = {
    joinCommand,
    leaveCommand,
    joinSubCommand,
    leaveSubCommand,
    vcBotInviteCommand,
    vcBotLeaveCommand,
    vcBotListCommand,
    hikakinVoiceMP3Command,
    handleJoinCommand,
    handleLeaveCommand,
    handleJoinSubCommand,
    handleLeaveSubCommand,
    handleVcBotInviteCommand,
    handleVcBotLeaveCommand,
    handleVcBotListCommand,
    handleHikakinVoiceMP3Command,
    speakMessage,
    checkAndLeaveIfEmpty,
    clearVoiceStates,
    getVoiceStates
}; 