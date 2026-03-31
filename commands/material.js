const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { getAllMp4Files, searchFiles, getRandomFile, checkFileSize } = require('../utils/helpers');

// /materialコマンドの定義
const materialCommand = new SlashCommandBuilder()
    .setName('material')
    .setDescription('material フォルダからランダムなmp4ファイルを送信します')
    .addStringOption(option =>
        option.setName('folder')
            .setDescription('検索するフォルダを選択')
            .setRequired(false)
            .addChoices(
                { name: '全て', value: 'all' },
                { name: 'hikakin', value: 'hikakin' },
                { name: 'hajime', value: 'hajime' },
                { name: 'masuo', value: 'masuo' },
                { name: 'seikin', value: 'seikin' }
            ))
    .addStringOption(option =>
        option.setName('search')
            .setDescription('ファイル名で検索（部分一致・完全一致両方対応）')
            .setRequired(false));

// /automaterialコマンドの定義
const autoMaterialCommand = new SlashCommandBuilder()
    .setName('automaterial')
    .setDescription('自動素材送信の設定を管理します')
    .addSubcommand(subcommand =>
        subcommand
            .setName('probability')
            .setDescription('ボットが反応する確率を変更します（0-100%、デフォルト100%）')
            .addIntegerOption(option =>
                option.setName('probability')
                    .setDescription('反応確率（0-100の整数）')
                    .setRequired(true)
                    .setMinValue(0)
                    .setMaxValue(100)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('channel_ignore')
            .setDescription('チャンネルの無視設定を管理します')
            .addStringOption(option =>
                option.setName('action')
                    .setDescription('追加または削除')
                    .setRequired(true)
                    .addChoices(
                        { name: '追加', value: 'add' },
                        { name: '削除', value: 'remove' }
                    ))
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('対象のチャンネル')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('category_ignore')
            .setDescription('カテゴリーの無視設定を管理します')
            .addStringOption(option =>
                option.setName('action')
                    .setDescription('追加または削除')
                    .setRequired(true)
                    .addChoices(
                        { name: '追加', value: 'add' },
                        { name: '削除', value: 'remove' }
                    ))
            .addChannelOption(option =>
                option.setName('category')
                    .setDescription('対象のカテゴリー')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('whitelist_toggle')
            .setDescription('ホワイトリストモードの切り替え（無視設定を逆転）')
            .addBooleanOption(option =>
                option.setName('is_toggled')
                    .setDescription('ホワイトリストモードを有効にするかどうか')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('status')
            .setDescription('現在の自動素材送信設定を表示します'));

const fs = require('fs');
const path = require('path');

// 設定ファイルのパス
const SETTINGS_FILE = path.join(__dirname, '../automaterial_settings.json');

// 自動素材設定を管理（サーバーごと）
const autoMaterialSettings = new Map();

// デフォルト設定
function getDefaultAutoMaterialSettings() {
    return {
        probability: 100, // 0-100%
        ignoredChannels: new Set(),
        ignoredCategories: new Set(),
        whitelistMode: false
    };
}

// 設定をファイルから読み込む
function loadAutoMaterialSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
            const settings = JSON.parse(data);
            
            // 各サーバーの設定を復元
            for (const [guildId, setting] of Object.entries(settings)) {
                autoMaterialSettings.set(guildId, {
                    probability: setting.probability || 100,
                    ignoredChannels: new Set(setting.ignoredChannels || []),
                    ignoredCategories: new Set(setting.ignoredCategories || []),
                    whitelistMode: setting.whitelistMode || false
                });
            }
            
            console.log(`✅ 自動素材設定を読み込みました: ${Object.keys(settings).length}サーバー`);
        }
    } catch (error) {
        console.error('❌ 自動素材設定の読み込みエラー:', error);
    }
}

// 設定をファイルに保存する
function saveAutoMaterialSettings() {
    try {
        const settings = {};
        
        // Map形式からオブジェクト形式に変換
        for (const [guildId, setting] of autoMaterialSettings.entries()) {
            settings[guildId] = {
                probability: setting.probability,
                ignoredChannels: Array.from(setting.ignoredChannels),
                ignoredCategories: Array.from(setting.ignoredCategories),
                whitelistMode: setting.whitelistMode
            };
        }
        
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
        console.log(`💾 自動素材設定を保存しました: ${Object.keys(settings).length}サーバー`);
    } catch (error) {
        console.error('❌ 自動素材設定の保存エラー:', error);
    }
}

// 自動素材設定を取得（存在しない場合はデフォルトを作成）
function getAutoMaterialSettings(guildId) {
    if (!autoMaterialSettings.has(guildId)) {
        autoMaterialSettings.set(guildId, getDefaultAutoMaterialSettings());
        // 新しい設定を作成したら保存
        saveAutoMaterialSettings();
    }
    return autoMaterialSettings.get(guildId);
}

// 起動時に設定を読み込む
loadAutoMaterialSettings();

// /materialコマンドの処理
async function handleMaterialCommand(interaction) {
    await interaction.deferReply();

    try {
        const folder = interaction.options.getString('folder') || 'all';
        const searchTerm = interaction.options.getString('search');

        // ファイルを取得
        let files = getAllMp4Files(folder);

        if (files.length === 0) {
            await interaction.editReply({
                content: `❌ ${folder === 'all' ? '全フォルダ' : folder + 'フォルダ'}にmp4ファイルが見つかりませんでした。`
            });
            return;
        }

        // 検索があれば検索を実行
        if (searchTerm) {
            files = searchFiles(files, searchTerm);
            
            if (files.length === 0) {
                await interaction.editReply({
                    content: `❌ 検索キーワード「${searchTerm}」に一致するファイルが見つかりませんでした。`
                });
                return;
            }

            // 検索結果が複数ある場合は見つかった件数を表示
            if (files.length > 1) {
                await interaction.editReply({
                    content: `🔍 「${searchTerm}」で${files.length}件見つかりました。ランダムに1つ選択します...`
                });
            }
        }

        // ランダムにファイルを選択
        const selectedFile = getRandomFile(files);

        if (!selectedFile) {
            await interaction.editReply({
                content: '❌ ファイルの選択に失敗しました。'
            });
            return;
        }

        // ファイルサイズをチェック
        if (!checkFileSize(selectedFile.path)) {
            await interaction.editReply({
                content: `❌ ファイル「${selectedFile.name}」のサイズが10MBを超えているため送信できません。`
            });
            return;
        }

        // ファイルを送信
        const attachment = new AttachmentBuilder(selectedFile.path);
        
        const infoMessage = searchTerm 
            ? `🎯 検索結果: 「${searchTerm}」\n📁 フォルダ: ${selectedFile.folder}\n🎲 ファイル: ${selectedFile.name}`
            : `📁 フォルダ: ${selectedFile.folder}\n🎲 ランダム選択: ${selectedFile.name}`;

        await interaction.editReply({
            content: infoMessage,
            files: [attachment]
        });

    } catch (error) {
        console.error('エラーが発生しました:', error);
        await interaction.editReply({
            content: '❌ ファイルの送信中にエラーが発生しました。'
        });
    }
}

// /automaterialコマンドの処理
async function handleAutoMaterialCommand(interaction) {
    // 管理者権限チェック（deferReplyの前に実行）
    try {
        const hasAdminPermission = interaction.memberPermissions && interaction.memberPermissions.has('Administrator') ||
                                  interaction.member && interaction.member.permissions && interaction.member.permissions.has('Administrator');
        
        if (!hasAdminPermission) {
            await interaction.reply({
                content: '❌ **このコマンドは管理者のみ使用できます**\n' +
                        '🔒 管理者権限が必要です。\n' +
                        '💡 サーバー管理者にお問い合わせください。',
                flags: 64
            });
            return;
        }
    } catch (permissionError) {
        console.error('❌ 権限チェックエラー:', permissionError);
        await interaction.reply({
            content: '❌ 権限の確認中にエラーが発生しました。再度お試しください。',
            flags: 64
        });
        return;
    }

    await interaction.deferReply();

    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const guildName = interaction.guild.name;
    const settings = getAutoMaterialSettings(guildId);

    try {
        switch (subcommand) {
            case 'probability':
                const probability = interaction.options.getInteger('probability');
                settings.probability = probability;
                saveAutoMaterialSettings(); // 設定を保存
                
                let probabilityMessage = `🎯 **反応確率を ${probability}% に設定しました**\n`;
                if (probability === 0) {
                    probabilityMessage += '😢 悲しいですが、ボットが発言しなくなります。';
                } else if (probability === 100) {
                    probabilityMessage += '🎊 最高確率です！（ただし、すべての発言に反応するわけではありません）';
                } else {
                    probabilityMessage += `📊 約 ${probability}% の確率で素材を送信します。`;
                }
                
                await interaction.editReply({ content: probabilityMessage });
                console.log(`⚙️  ${guildName}: 自動素材確率を ${probability}% に設定`);
                break;

            case 'channel_ignore':
                const action = interaction.options.getString('action');
                const channel = interaction.options.getChannel('channel');
                
                if (action === 'add') {
                    settings.ignoredChannels.add(channel.id);
                    saveAutoMaterialSettings(); // 設定を保存
                    await interaction.editReply({
                        content: `🚫 **チャンネル無視設定を追加しました**\n` +
                                `📍 チャンネル: ${channel}\n` +
                                `💡 このチャンネルでは自動素材送信が${settings.whitelistMode ? '有効' : '無効'}になります。`
                    });
                    console.log(`⚙️  ${guildName}: チャンネル無視追加 #${channel.name}`);
                } else if (action === 'remove') {
                    settings.ignoredChannels.delete(channel.id);
                    saveAutoMaterialSettings(); // 設定を保存
                    await interaction.editReply({
                        content: `✅ **チャンネル無視設定を削除しました**\n` +
                                `📍 チャンネル: ${channel}\n` +
                                `💡 このチャンネルで再度自動素材送信が${settings.whitelistMode ? '無効' : '有効'}になります。`
                    });
                    console.log(`⚙️  ${guildName}: チャンネル無視削除 #${channel.name}`);
                }
                break;

            case 'category_ignore':
                const categoryAction = interaction.options.getString('action');
                const category = interaction.options.getChannel('category');
                
                // カテゴリかどうかチェック
                if (category.type !== 4) { // CategoryChannel
                    await interaction.editReply({
                        content: '❌ 指定されたチャンネルはカテゴリではありません。カテゴリを選択してください。'
                    });
                    break;
                }
                
                if (categoryAction === 'add') {
                    settings.ignoredCategories.add(category.id);
                    saveAutoMaterialSettings(); // 設定を保存
                    await interaction.editReply({
                        content: `🚫 **カテゴリ無視設定を追加しました**\n` +
                                `📁 カテゴリ: ${category.name}\n` +
                                `💡 このカテゴリ内のすべてのチャンネルで自動素材送信が${settings.whitelistMode ? '有効' : '無効'}になります。`
                    });
                    console.log(`⚙️  ${guildName}: カテゴリ無視追加 ${category.name}`);
                } else if (categoryAction === 'remove') {
                    settings.ignoredCategories.delete(category.id);
                    saveAutoMaterialSettings(); // 設定を保存
                    await interaction.editReply({
                        content: `✅ **カテゴリ無視設定を削除しました**\n` +
                                `📁 カテゴリ: ${category.name}\n` +
                                `💡 このカテゴリ内のチャンネルで再度自動素材送信が${settings.whitelistMode ? '無効' : '有効'}になります。`
                    });
                    console.log(`⚙️  ${guildName}: カテゴリ無視削除 ${category.name}`);
                }
                break;

            case 'whitelist_toggle':
                const isToggled = interaction.options.getBoolean('is_toggled');
                settings.whitelistMode = isToggled;
                saveAutoMaterialSettings(); // 設定を保存
                
                let toggleMessage = `🔄 **ホワイトリストモードを ${isToggled ? 'オン' : 'オフ'} にしました**\n\n`;
                
                if (isToggled) {
                    toggleMessage += '🎯 **ホワイトリストモード（オン）**\n' +
                                   '• 無視設定されたチャンネル/カテゴリで**のみ**素材を送信します\n' +
                                   '• 通常のチャンネルでは素材を送信しません\n' +
                                   '• 無視設定の効果が逆転します';
                } else {
                    toggleMessage += '📋 **通常モード（オフ）**\n' +
                                   '• 無視設定されたチャンネル/カテゴリでは素材を送信しません\n' +
                                   '• 通常のチャンネルでは素材を送信します\n' +
                                   '• 標準的な動作です';
                }
                
                await interaction.editReply({ content: toggleMessage });
                console.log(`⚙️  ${guildName}: ホワイトリストモード ${isToggled ? 'オン' : 'オフ'}`);
                break;

            case 'status':
                const ignoredChannelList = Array.from(settings.ignoredChannels)
                    .map(channelId => {
                        const channel = interaction.guild.channels.cache.get(channelId);
                        return channel ? `<#${channelId}>` : `不明なチャンネル (${channelId})`;
                    })
                    .join('\n');
                
                const ignoredCategoryList = Array.from(settings.ignoredCategories)
                    .map(categoryId => {
                        const category = interaction.guild.channels.cache.get(categoryId);
                        return category ? `📁 ${category.name}` : `不明なカテゴリ (${categoryId})`;
                    })
                    .join('\n');
                
                const statusMessage = `📊 **自動素材送信の現在設定**\n\n` +
                    `🎯 **反応確率**: ${settings.probability}%\n` +
                    `🔄 **ホワイトリストモード**: ${settings.whitelistMode ? 'オン' : 'オフ'}\n\n` +
                    `🚫 **無視チャンネル** (${settings.ignoredChannels.size}個):\n` +
                    `${ignoredChannelList || '設定なし'}\n\n` +
                    `🚫 **無視カテゴリ** (${settings.ignoredCategories.size}個):\n` +
                    `${ignoredCategoryList || '設定なし'}\n\n` +
                    `💡 **動作説明**:\n` +
                    (settings.whitelistMode 
                        ? '• 無視設定されたチャンネル/カテゴリ**でのみ**素材を送信\n• 他のチャンネルでは送信しません'
                        : '• 無視設定されたチャンネル/カテゴリ**以外**で素材を送信\n• 通常のチャンネルで送信します'
                    );
                
                await interaction.editReply({ content: statusMessage });
                break;

            default:
                await interaction.editReply({
                    content: '❌ 不明なサブコマンドです。'
                });
                break;
        }
    } catch (error) {
        console.error('❌ /automaterialコマンドエラー:', error);
        await interaction.editReply({
            content: '❌ 設定の変更中にエラーが発生しました。'
        });
    }
}

// 自動素材送信を処理する関数
async function handleAutoMaterial(message) {
    // ボットメッセージは無視
    if (message.author.bot) return;
    
    // DMは無視
    if (!message.guild) return;
    
    // チャンネル情報の存在確認
    if (!message.channel) return;
    
    // 空のメッセージは無視
    if (!message.content || message.content.trim().length === 0) return;
    
    const guildId = message.guild.id;
    const settings = getAutoMaterialSettings(guildId);
    
    // 確率チェック
    if (settings.probability <= 0) return;
    
    const randomValue = Math.random() * 100;
    if (randomValue > settings.probability) return;
    
    // チャンネル・カテゴリ無視設定をチェック
    const channelId = message.channel.id;
    const categoryId = message.channel.parentId;
    
    const isChannelIgnored = settings.ignoredChannels.has(channelId);
    const isCategoryIgnored = categoryId && settings.ignoredCategories.has(categoryId);
    const isIgnored = isChannelIgnored || isCategoryIgnored;
    
    // ホワイトリストモードの場合は逆転
    if (settings.whitelistMode) {
        if (!isIgnored) return; // 無視設定されていないチャンネルでは送信しない
    } else {
        if (isIgnored) return; // 無視設定されているチャンネルでは送信しない
    }
    
    // さらなるランダム性を追加（メッセージ頻度調整）
    const additionalRandomness = Math.random();
    if (additionalRandomness < 0.05) { // 5%の確率でさらに送信
        await sendAutoMaterial(message);
    }
}

// 自動素材を送信する関数
async function sendAutoMaterial(message) {
    try {
        // ランダムにフォルダを選択
        const folders = ['all', 'hikakin', 'hajime', 'masuo', 'seikin'];
        const randomFolder = folders[Math.floor(Math.random() * folders.length)];
        
        // ファイルを取得
        let files = getAllMp4Files(randomFolder);
        
        if (files.length === 0) return;
        
        // ランダムにファイルを選択
        const selectedFile = getRandomFile(files);
        if (!selectedFile) return;
        
        // ファイルサイズをチェック
        if (!checkFileSize(selectedFile.path)) return;
        
        // ファイルを送信
        const attachment = new AttachmentBuilder(selectedFile.path);
        
        // 10%の確率でフォルダ情報を表示
        const showInfo = Math.random() < 0.1;
        const content = showInfo 
            ? `🎲 ${selectedFile.folder}フォルダから: ${selectedFile.name}`
            : null;
        
        await message.channel.send({
            content: content,
            files: [attachment]
        });
        
        console.log(`🤖 自動素材送信: ${message.guild.name} > #${message.channel.name} | ${selectedFile.folder}/${selectedFile.name}`);
        
    } catch (error) {
        console.error('❌ 自動素材送信エラー:', error);
    }
}

// サーバー退出時の設定クリア
function clearAutoMaterialSettings(guildId) {
    autoMaterialSettings.delete(guildId);
    saveAutoMaterialSettings(); // ファイルからも削除
    console.log(`🗑️  自動素材設定を削除: ${guildId}`);
}

module.exports = {
    materialCommand,
    autoMaterialCommand,
    handleMaterialCommand,
    handleAutoMaterialCommand,
    handleAutoMaterial,
    clearAutoMaterialSettings
};