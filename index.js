const { Client, GatewayIntentBits, Collection, ActivityType, SlashCommandBuilder } = require('discord.js');
const { config } = require('tiktok-tts');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const helpData = require('./help.json');
require('dotenv').config();

// FFmpegのパスを設定
ffmpeg.setFfmpegPath(ffmpegStatic);

// 各モジュールを読み込み
const materialModule = require('./commands/material');
const voiceModule = require('./commands/voice');
const videoModule = require('./commands/video');
const globalChatModule = require('./commands/globalchat');
// const imageModule = require('./commands/image'); // 削除済み
const utilityModule = require('./commands/utility');
const { translateSlashCommand, translateContextMenuCommand, handleTranslateCommand } = require('./commands/translate');
const { quickLeaveCommand, handleQuickLeaveCommand, handleUserJoin, handleUserLeave } = require('./commands/quickleave');
const { getAllMp4Count } = require('./utils/helpers');

// デバッグ: 環境変数の確認
console.log('🔍 環境変数の確認:');
console.log('DISCORD_TOKEN が設定されているか:', !!process.env.DISCORD_TOKEN);
console.log('トークンの長さ:', process.env.DISCORD_TOKEN ? process.env.DISCORD_TOKEN.length : 0);
console.log('トークンの最初の10文字:', process.env.DISCORD_TOKEN ? process.env.DISCORD_TOKEN.substring(0, 10) : 'なし');
console.log('トークンの最後の10文字:', process.env.DISCORD_TOKEN ? process.env.DISCORD_TOKEN.substring(process.env.DISCORD_TOKEN.length - 10) : 'なし');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers // メンバー取得を安定させるため追加
    ]
});

// TikTok TTSの設定（sessionidが必要）
if (process.env.TIKTOK_SESSION_ID) {
    config(process.env.TIKTOK_SESSION_ID);
    console.log('✅ TikTok TTS設定完了');
} else {
    console.log('⚠️  TIKTOK_SESSION_IDが設定されていません。TTS機能は無効になります。');
}

// コマンドの登録
const commands = new Collection();

// /helpコマンドの定義
const helpCommand = new SlashCommandBuilder()
    .setName('help')
    .setDescription('ボットの使用方法とコマンド一覧を表示します');

// 各モジュールのコマンドを登録
commands.set(materialModule.materialCommand.name, materialModule.materialCommand);
commands.set(materialModule.autoMaterialCommand.name, materialModule.autoMaterialCommand);
commands.set(voiceModule.joinCommand.name, voiceModule.joinCommand);
commands.set(voiceModule.leaveCommand.name, voiceModule.leaveCommand);
commands.set(voiceModule.joinSubCommand.name, voiceModule.joinSubCommand);
commands.set(voiceModule.leaveSubCommand.name, voiceModule.leaveSubCommand);
commands.set(voiceModule.vcBotInviteCommand.name, voiceModule.vcBotInviteCommand);
commands.set(voiceModule.vcBotLeaveCommand.name, voiceModule.vcBotLeaveCommand);
commands.set(voiceModule.vcBotListCommand.name, voiceModule.vcBotListCommand);
commands.set(voiceModule.hikakinVoiceMP3Command.name, voiceModule.hikakinVoiceMP3Command);
commands.set(videoModule.sitaiCommand.name, videoModule.sitaiCommand);
commands.set(globalChatModule.globalChatCommand.name, globalChatModule.globalChatCommand);
commands.set(globalChatModule.globalChatRuleCommand.name, globalChatModule.globalChatRuleCommand);
// commands.set(imageModule.data.name, imageModule.data); // 削除済み
commands.set(utilityModule.utcCommand.name, utilityModule.utcCommand);
// translate.js からエクスポートされたコマンドを登録
commands.set(translateSlashCommand.name, translateSlashCommand);
commands.set(translateContextMenuCommand.name, translateContextMenuCommand);
// quickleave.js からエクスポートされたコマンドを登録
commands.set(quickLeaveCommand.name, quickLeaveCommand);
commands.set(helpCommand.name, helpCommand);

// ボットステータスを更新する関数
function updateBotStatus() {
    try {
        const guildCount = client.guilds.cache.size;
        const mp4Count = getAllMp4Count();
        
        client.user.setActivity(
            `${guildCount}サーバー | 素材${mp4Count}本 | /help`, 
            { type: ActivityType.Playing }
        );
        
        console.log(`📊 ボットステータス更新: ${guildCount}サーバー, 素材${mp4Count}本`);
    } catch (error) {
        console.error('❌ ステータス更新エラー:', error);
    }
}

// ボット起動時の処理
client.once('ready', async () => {
    console.log(`🤖 ${client.user.tag} が起動しました！`);
    console.log(`📊 サーバー数: ${client.guilds.cache.size}`);
    console.log(`📊 ユーザー数: ${client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0)}`);
    console.log(`📂 mp4ファイル数: ${getAllMp4Count()}本`);
    
    // ボットのステータスを設定
    updateBotStatus();
    
    // コマンドをグローバルに登録
    try {
        console.log('🔄 コマンドを登録中...');
        await client.application.commands.set([
            materialModule.materialCommand.toJSON(),
            materialModule.autoMaterialCommand.toJSON(),
            voiceModule.joinCommand.toJSON(),
            voiceModule.leaveCommand.toJSON(),
            voiceModule.joinSubCommand.toJSON(),
            voiceModule.leaveSubCommand.toJSON(),
            voiceModule.vcBotInviteCommand.toJSON(),
            voiceModule.vcBotLeaveCommand.toJSON(),
            voiceModule.vcBotListCommand.toJSON(),
            voiceModule.hikakinVoiceMP3Command.toJSON(),
            videoModule.sitaiCommand.toJSON(),
            globalChatModule.globalChatCommand.toJSON(),
            globalChatModule.globalChatRuleCommand.toJSON(),
            // imageModule.data.toJSON(), // 削除済み
            utilityModule.utcCommand.toJSON(),
            translateSlashCommand.toJSON(),
            translateContextMenuCommand.toJSON(),
            quickLeaveCommand.toJSON(),
            helpCommand.toJSON()
        ]);
        console.log('✅ コマンド登録完了');
    } catch (error) {
        console.error('❌ コマンド登録エラー:', error);
    }
    
    // 固定動画の事前正規化を実行
    await videoModule.normalizeFixedVideos();
});

// ギルド（サーバー）に参加・離脱した時もステータスを更新
client.on('guildCreate', (guild) => {
    console.log(`✅ 新しいサーバーに参加: ${guild.name} (ID: ${guild.id})`);
    console.log(`👥 メンバー数: ${guild.memberCount}`);
    updateBotStatus();
});

client.on('guildDelete', (guild) => {
    console.log(`❌ サーバーから退出: ${guild.name} (ID: ${guild.id})`);
    
    // 各モジュールの設定をクリア
    materialModule.clearAutoMaterialSettings(guild.id);
    voiceModule.clearVoiceStates(guild.id);
    globalChatModule.clearGlobalChatSettings(guild.id);
    
    updateBotStatus();
});

// メッセージイベント（読み上げ用 + 自動素材送信用 + グローバルチャット用）
client.on('messageCreate', (message) => {
    // 読み上げ機能
    voiceModule.speakMessage(message, client);
    
    // 自動素材送信機能
    materialModule.handleAutoMaterial(message);
    
    // グローバルチャット機能
    globalChatModule.handleGlobalChatMessage(message, client);
});

// ボイスステート変更イベント（VC退室チェック用）
client.on('voiceStateUpdate', (oldState, newState) => {
    const guildId = newState.guild.id;
    
    // メンバーがVCから退室した場合
    if (oldState.channel && !newState.channel) {
        // しばらく待ってからVC内の人数をチェック
        setTimeout(() => {
            voiceModule.checkAndLeaveIfEmpty(guildId, client);
        }, 2000); // 2秒後にチェック
    }
});

// ユーザー参加イベント（即抜けRTA用）
client.on('guildMemberAdd', (member) => {
    handleUserJoin(member);
});

// ユーザー退出イベント（即抜けRTA用）
client.on('guildMemberRemove', (member) => {
    handleUserLeave(member);
});

// インタラクション（スラッシュコマンド）イベント
client.on('interactionCreate', async interaction => {
    // オートコンプリート処理
    if (interaction.isAutocomplete()) {
        return;
    }
    
    if (!interaction.isChatInputCommand() && !interaction.isContextMenuCommand()) return;

    const commandName = interaction.commandName;

    try {
        // 各モジュールのコマンドハンドラーを呼び出し
        switch (commandName) {
            case 'material':
                await materialModule.handleMaterialCommand(interaction);
                break;
                
            case 'automaterial':
                await materialModule.handleAutoMaterialCommand(interaction);
                break;
                
            case 'join':
                await voiceModule.handleJoinCommand(interaction);
                break;
                
            case 'leave':
                await voiceModule.handleLeaveCommand(interaction);
                break;
                
            case 'joinsub':
                await voiceModule.handleJoinSubCommand(interaction);
                break;
                
            case 'leavesub':
                await voiceModule.handleLeaveSubCommand(interaction);
                break;
                
            case 'vcbotinvite':
                await voiceModule.handleVcBotInviteCommand(interaction, client);
                break;
                
            case 'vcbotreave':
                await voiceModule.handleVcBotLeaveCommand(interaction);
                break;
                
            case 'vcbotlist':
                await voiceModule.handleVcBotListCommand(interaction, client);
                break;
                
            case 'hikakinvoicemp3':
                await voiceModule.handleHikakinVoiceMP3Command(interaction);
                break;
                
            case 'sitai':
                await videoModule.handleSitaiCommand(interaction);
                break;
                
            case 'globalchat':
                await globalChatModule.handleGlobalChatCommand(interaction, client);
                break;
                
            case 'globalchrule':
                await globalChatModule.handleGlobalChatRuleCommand(interaction);
                break;
                
            // case 'mudantensai': // 削除済み
            //     await imageModule.execute(interaction);
            //     break;
                
            case 'utc':
                await utilityModule.handleUtcCommand(interaction);
                break;
                
            case 'translate':
            case '翻訳':
                await handleTranslateCommand(interaction);
                break;
                
            case 'quickleave':
                await handleQuickLeaveCommand(interaction);
                break;
                

                
            case 'help':
                await handleHelpCommand(interaction);
                break;
                
            default:
                await interaction.reply({
                    content: '❌ 不明なコマンドです。',
                    flags: 64
                });
                break;
        }
    } catch (error) {
        console.error(`❌ コマンドエラー (${commandName}):`, error);
        
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({
                    content: '❌ コマンドの実行中にエラーが発生しました。',
                    flags: 64
                });
            } else {
                await interaction.reply({
                    content: '❌ コマンドの実行中にエラーが発生しました。',
                    flags: 64
                });
            }
        } catch (replyError) {
            console.error('❌ エラーレスポンス送信失敗:', replyError);
        }
    }
});

// /helpコマンドの処理
async function handleHelpCommand(interaction) {
    await interaction.deferReply();

    try {
        // ヘルプ埋め込みメッセージを作成
        const helpEmbed = {
            color: 0x7289DA, // Discord紫
            title: `🤖 ${helpData.botInfo.name} ${helpData.botInfo.version}`,
            description: helpData.botInfo.description,
            thumbnail: {
                url: client.user.displayAvatarURL()
            },
            fields: [
                {
                    name: '🎲 **素材配布**',
                    value: `**${helpData.commands.material.name}** / **${helpData.commands.automaterial.name}**\n` +
                           `ランダムmp4ファイル送信\n` +
                           `🎯 検索・フォルダ指定対応\n` +
                           `🔒 ${helpData.commands.automaterial.permission}`,
                    inline: true
                },
                {
                    name: '🎤 **読み上げ**',
                    value: `**${helpData.commands.join.name}** / **${helpData.commands.leave.name}** など\n` +
                           `ヒカキンボイスTTS読み上げ\n` +
                           `🎵 VC参加・複数チャンネル対応\n` +
                           `🤖 ボット読み上げ管理`,
                    inline: true
                },
                {
                    name: '🎬 **動画編集**',
                    value: `**${helpData.commands.sitai.name}**\n` +
                           `自動動画結合・圧縮\n` +
                           `📹 素材+固定動画パターン\n` +
                           `⚡ 高速処理・品質最適化`,
                    inline: true
                },
                {
                    name: '🔧 **自動化**',
                    value: `**${helpData.commands.automaterial.name}**\n` +
                           `確率ベース自動素材送信\n` +
                           `🎯 チャンネル・カテゴリ制御\n` +
                           `🔒 ${helpData.commands.automaterial.permission}`,
                    inline: true
                },
                {
                    name: '📡 **グローバルチャット**',
                    value: `**${helpData.commands.globalchat.name}** / **${helpData.commands.globalchrule.name}**\n` +
                           `異なるサーバー間でメッセージ共有\n` +
                           `🌐 画像・動画・音声対応\n` +
                           `🔒 管理者権限が必要`,
                    inline: true
                },
                {
                    name: '🎨 **自動画像作成**',
                    value: `**${helpData.commands.mudantensai.name}**\n` +
                           `アップロード画像を4レイヤー合成\n` +
                           `🖼️ PNG/JPG/JPEG対応\n` +
                           `✨ 自動最適化・中央配置`,
                    inline: true
                },
                {
                    name: '🌍 **世界時計**',
                    value: `**${helpData.commands.utc.name}**\n` +
                           `UTC-12からUTC+14まで時刻表示\n` +
                           `⏰ 27タイムゾーン対応\n` +
                           `🗺️ 地域名・国旗絵文字付き`,
                    inline: true
                },
                {
                    name: '📝 **詳細なヘルプ**',
                    value: `各コマンドの詳細な使い方は下のボタンから確認できます`,
                    inline: false
                },
                {
                    name: '👨‍💻 **開発者情報**',
                    value: `**開発者**: ${helpData.developer.name}\n` +
                           `**Twitter**: [${helpData.developer.twitterName}](${helpData.developer.twitter})\n` +
                           `**サポートサーバー**: [${helpData.developer.supportServerName}](${helpData.developer.supportServer})\n` +
                           `${helpData.developer.contact}`,
                    inline: false
                }
            ],
            footer: {
                text: `${helpData.botInfo.name} ${helpData.botInfo.version} | 今後もコマンドが追加予定です！`,
                icon_url: client.user.displayAvatarURL()
            },
            timestamp: new Date().toISOString()
        };

        // ボタンコンポーネントを作成
        const row = {
            type: 1, // ACTION_ROW
            components: [
                {
                    type: 2, // BUTTON
                    style: 5, // LINK
                    label: 'サポートサーバー',
                    url: helpData.developer.supportServer,
                    emoji: { name: '🆘' }
                },
                {
                    type: 2, // BUTTON
                    style: 5, // LINK
                    label: '開発者Twitter',
                    url: helpData.developer.twitter,
                    emoji: { name: '🐦' }
                }
            ]
        };

        await interaction.editReply({
            embeds: [helpEmbed],
            components: [row]
        });

        console.log(`📖 ヘルプ表示: ${interaction.guild.name} > ${interaction.user.tag}`);

    } catch (error) {
        console.error('❌ /helpコマンドエラー:', error);
        await interaction.editReply({
            content: '❌ ヘルプの表示中にエラーが発生しました。'
        });
    }
}

// エラーハンドリング
client.on('error', (error) => {
    console.error('❌ クライアントエラー:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ 未処理のPromise拒否:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ 未処理の例外:', error);
    process.exit(1);
});

// ボットをログイン
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKENが設定されていません。.envファイルを確認してください。');
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('❌ Discord ログインエラー:', error);
    process.exit(1);
});

console.log('🚀 ボットを起動中...');