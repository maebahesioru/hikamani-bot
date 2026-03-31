const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const axios = require('axios');

// 設定ファイルを読み込み
const globalChatData = require('../globalch.json');
const globalChatRules = require('../globalchrule.json');

// グローバルチャットのメッセージキャッシュ（重複防止）
const globalChatMessageCache = new Set();

// /globalchatコマンドの定義
const globalChatCommand = new SlashCommandBuilder()
    .setName('globalchat')
    .setDescription('グローバルチャット機能を設定します（管理者のみ）')
    .addChannelOption(option =>
        option.setName('channel')
            .setDescription('グローバルチャットで使用するテキストチャンネル')
            .setRequired(true)
            .addChannelTypes(0)); // TEXT_CHANNEL

// /globalchruleコマンドの定義  
const globalChatRuleCommand = new SlashCommandBuilder()
    .setName('globalchrule')
    .setDescription('グローバルチャットの利用規約を表示します');

// グローバルチャット設定を保存する関数
function saveGlobalChatData() {
    try {
        fs.writeFileSync('./globalch.json', JSON.stringify(globalChatData, null, 2));
    } catch (error) {
        console.error('❌ グローバルチャット設定の保存に失敗:', error);
    }
}

// グローバルチャットの参加条件をチェックする関数
async function checkGlobalChatRequirements(guild) {
    const memberCount = guild.memberCount;
    
    // 参加条件チェックを無効化（誰でも参加可能）
    const requirements = globalChatData.settings;
    
    // 条件が0の場合はチェックをスキップ
    if (requirements.minMembers > 0 && memberCount < requirements.minMembers) {
        return {
            valid: false,
            error: `サーバーメンバー数が不足しています（現在: ${memberCount}人、必要: ${requirements.minMembers}人以上）`
        };
    }
    
    // 実際のユーザー数を計算（ボットを除く） - 条件が無効化されている場合は簡略化
    let userCount = 0;
    
    // 条件が無効化されている場合は簡単な推定のみ
    if (requirements.minUsers === 0) {
        // 条件チェックが無効なので簡単な推定で十分
        userCount = Math.floor(memberCount * 0.85); // 85%がユーザーと推定
        console.log(`📊 条件無効化により簡易推定: ${userCount}人`);
    } else {
        // 条件がある場合は正確な取得を試行
        try {
            // サーバーサイズに応じて取得方法を変更
            if (memberCount <= 500) {
                // 中規模サーバーまでは全メンバー取得を試行
                console.log(`📊 メンバー取得開始: ${memberCount}人のサーバー`);
                
                try {
                    const members = await guild.members.fetch({ 
                        time: 15000, // 15秒でタイムアウト
                        force: false // キャッシュを優先使用
                    });
                    userCount = members.filter(member => !member.user.bot).size;
                    console.log(`✅ 正確な取得完了: ユーザー${userCount}人、ボット${members.size - userCount}人`);
                } catch (fetchError) {
                    console.log(`⚠️ 全取得失敗、部分取得を試行:`, fetchError.message);
                    
                    // 部分取得を試行（最初の100人ずつ取得してサンプリング）
                    let sampleUsers = 0;
                    let sampleTotal = 0;
                    const batchSize = 100;
                    
                    try {
                        // 複数回に分けて取得
                        for (let i = 0; i < Math.min(3, Math.ceil(memberCount / batchSize)); i++) {
                            const batch = await guild.members.fetch({ 
                                limit: batchSize,
                                time: 5000
                            });
                            const batchUsers = batch.filter(member => !member.user.bot).size;
                            sampleUsers += batchUsers;
                            sampleTotal += batch.size;
                            
                            console.log(`📊 バッチ${i + 1}: ユーザー${batchUsers}/${batch.size}人`);
                        }
                        
                        if (sampleTotal > 0) {
                            const userRatio = sampleUsers / sampleTotal;
                            userCount = Math.floor(memberCount * userRatio);
                            console.log(`📊 サンプリング推定: ${userRatio.toFixed(2)} = ${userCount}人`);
                        } else {
                            throw new Error('サンプリング失敗');
                        }
                    } catch (samplingError) {
                        console.log(`⚠️ サンプリング失敗、キャッシュベース推定に移行`);
                        throw fetchError; // 元のエラーを再発生させてキャッシュ推定に移行
                    }
                }
            } else {
                // 大規模サーバー: キャッシュベース推定
                console.log(`📊 大規模サーバー推定: ${memberCount}人`);
                throw new Error('大規模サーバーのためキャッシュ推定を使用');
            }
        } catch (error) {
            console.log(`📊 キャッシュベース推定に移行:`, error.message);
            
            // キャッシュされたメンバーから推定
            const cachedMembers = guild.members.cache;
            if (cachedMembers.size > 10) { // 最低10人のキャッシュが必要
                const cachedUsers = cachedMembers.filter(member => !member.user.bot).size;
                const cachedBots = cachedMembers.filter(member => member.user.bot).size;
                const botRatio = cachedBots / cachedMembers.size;
                
                // より保守的な推定（ボット比率を少し高めに見積もる）
                const adjustedBotRatio = Math.min(botRatio * 1.1, 0.3); // 最大30%
                userCount = Math.floor(memberCount * (1 - adjustedBotRatio));
                
                console.log(`📊 キャッシュ推定: キャッシュ${cachedMembers.size}人中ユーザー${cachedUsers}人 → 推定${userCount}人`);
            } else {
                // キャッシュが不十分な場合は一般的な比率を使用
                userCount = Math.floor(memberCount * 0.85); // 85%がユーザー（より現実的）
                console.log(`📊 デフォルト推定: ${userCount}人（85%）`);
            }
            
            // タイムアウト等の詳細エラーログ
            if (error.code === 'GuildMembersTimeout') {
                console.log(`⏰ タイムアウトエラー: ${error.message}`);
            }
        }
    } // 条件がある場合の処理終了
    
    // ユーザー数条件もチェック（条件が0の場合はスキップ）
    if (requirements.minUsers > 0 && userCount < requirements.minUsers) {
        return {
            valid: false,
            error: `実際のユーザー数が不足しています（現在: ${userCount}人、必要: ${requirements.minUsers}人以上、ボット除く）`
        };
    }
    
    return { valid: true, memberCount, userCount };
}

// 絵文字とスタンプを処理する関数（画像URL付きで戻り値を拡張）
function processEmojisAndStickers(message) {
    let content = message.content || '';
    const customEmojiFiles = [];
    const stickerFiles = [];
    
    // カスタム絵文字を検出して画像URL取得
    const emojiMatches = content.match(/<a?:([^:]+):(\d+)>/g);
    if (emojiMatches) {
        emojiMatches.forEach(match => {
            const emojiMatch = match.match(/<(a?):([^:]+):(\d+)>/);
            if (emojiMatch) {
                const isAnimated = emojiMatch[1] === 'a';
                const emojiName = emojiMatch[2];
                const emojiId = emojiMatch[3];
                
                // 絵文字画像URLを構築
                const extension = isAnimated ? 'gif' : 'png';
                const emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${extension}`;
                
                customEmojiFiles.push({
                    url: emojiUrl,
                    name: `${emojiName}.${extension}`,
                    originalText: match
                });
                
                // テキストから絵文字を名前に置換
                content = content.replace(match, `:${emojiName}:`);
            }
        });
    }
    
    // 不正な絵文字ID（長すぎるID）を除去
    content = content.replace(/:([a-f0-9]{32,}):/g, '');
    
    // スタンプ情報を処理して画像URL取得
    const stickers = Array.from(message.stickers.values());
    if (stickers.length > 0) {
        stickers.forEach(sticker => {
            // スタンプ画像URLを取得
            let extension = 'png';
            switch (sticker.format_type) {
                case 1: extension = 'png'; break;
                case 2: extension = 'png'; break; // APNG -> PNG
                case 3: extension = 'json'; break; // LOTTIE
                case 4: extension = 'gif'; break;
                default: extension = 'png'; break;
            }
            
            // LOTTIEスタンプは画像として表示できないのでURLのみ
            if (sticker.format_type !== 3) {
                const stickerUrl = `https://media.discordapp.net/stickers/${sticker.id}.${extension}`;
                stickerFiles.push({
                    url: stickerUrl,
                    name: `${sticker.name}.${extension}`,
                    stickerName: sticker.name
                });
            }
        });
        
        // スタンプのテキスト表示も追加
        const stickerText = stickers.map(sticker => `🎭 ${sticker.name}`).join(' ');
        if (content.trim()) {
            content = `${content}\n${stickerText}`;
        } else {
            content = stickerText;
        }
    }
    
    // 空行や余分な空白を整理
    content = content.replace(/\n\s*\n/g, '\n').trim();
    
    return {
        content,
        customEmojiFiles,
        stickerFiles
    };
}

// グローバルチャットにメッセージを送信する関数
async function broadcastGlobalMessage(sourceGuildId, sourceChannelId, message, attachments = [], client) {
    // メッセージIDキャッシュで重複チェック
    const messageKey = `${sourceGuildId}_${message.id}`;
    if (globalChatMessageCache.has(messageKey)) {
        return; // 既に処理済み
    }
    
    globalChatMessageCache.add(messageKey);
    
    // キャッシュサイズ制限（1000件）
    if (globalChatMessageCache.size > 1000) {
        const firstKey = globalChatMessageCache.values().next().value;
        globalChatMessageCache.delete(firstKey);
    }

    const sourceGuild = client.guilds.cache.get(sourceGuildId);
    if (!sourceGuild) return;

    // 送信者情報
    const author = message.author;
    const processedMessage = processEmojisAndStickers(message);
    let content = processedMessage.content;
    
    // メッセージ長さチェック
    if (content.length > globalChatData.settings.maxMessageLength) {
        try {
            await message.reply({
                content: `❌ メッセージが長すぎます（最大: ${globalChatData.settings.maxMessageLength}文字）`,
                allowedMentions: { repliedUser: false }
            });
        } catch (error) {
            console.error('❌ エラーメッセージ送信失敗:', error);
        }
        return;
    }

    // 埋め込みメッセージを作成
    const embed = {
        color: 0x00D4FF, // 水色
        author: {
            name: `${author.displayName || author.username}`,
            icon_url: author.displayAvatarURL()
        },
        description: content || '*ファイル/スタンプ/絵文字のみのメッセージ*',
        footer: {
            text: `📡 ${sourceGuild.name}`,
            icon_url: sourceGuild.iconURL() || undefined
        },
        timestamp: message.createdAt.toISOString()
    };

    // 添付ファイルの処理
    const filesToSend = [];
    
    // 通常の添付ファイル
    if (attachments && attachments.length > 0) {
        for (const attachment of attachments) {
            // ファイルタイプとサイズチェック
            const isAllowedType = globalChatData.settings.allowedFileTypes.some(type => 
                attachment.contentType && attachment.contentType.startsWith(type.split('/')[0])
            );
            
            if (!isAllowedType) {
                continue; // 許可されていないファイルタイプはスキップ
            }
            
            if (attachment.size > globalChatData.settings.maxFileSize) {
                continue; // ファイルサイズが大きすぎる場合はスキップ
            }
            
            try {
                // ファイルをダウンロードして再アップロード
                const response = await axios({
                    method: 'get',
                    url: attachment.url,
                    responseType: 'arraybuffer',
                    timeout: 10000 // 10秒でタイムアウト
                });
                
                const buffer = Buffer.from(response.data);
                filesToSend.push(new AttachmentBuilder(buffer, { name: attachment.name }));
            } catch (error) {
                console.error('❌ ファイルダウンロードエラー:', error);
            }
        }
    }
    
    // カスタム絵文字ファイル
    for (const emojiFile of processedMessage.customEmojiFiles) {
        try {
            const response = await axios({
                method: 'get', 
                url: emojiFile.url,
                responseType: 'arraybuffer',
                timeout: 5000
            });
            
            const buffer = Buffer.from(response.data);
            filesToSend.push(new AttachmentBuilder(buffer, { name: emojiFile.name }));
        } catch (error) {
            console.error('❌ 絵文字ダウンロードエラー:', error);
        }
    }
    
    // スタンプファイル
    for (const stickerFile of processedMessage.stickerFiles) {
        try {
            const response = await axios({
                method: 'get',
                url: stickerFile.url,
                responseType: 'arraybuffer', 
                timeout: 5000
            });
            
            const buffer = Buffer.from(response.data);
            filesToSend.push(new AttachmentBuilder(buffer, { name: stickerFile.name }));
        } catch (error) {
            console.error('❌ スタンプダウンロードエラー:', error);
        }
    }
    
    // 全てのサーバーに配信
    const joinedServers = Object.keys(globalChatData.joinedServers);
    let successCount = 0;
    let errorCount = 0;
    
    for (const guildId of joinedServers) {
        // 送信元サーバーには送信しない
        if (guildId === sourceGuildId) continue;
        
        const serverInfo = globalChatData.joinedServers[guildId];
        const targetGuild = client.guilds.cache.get(guildId);
        
        if (!targetGuild) {
            console.log(`⚠️ サーバーが見つかりません: ${guildId}`);
            continue;
        }
        
        const targetChannel = targetGuild.channels.cache.get(serverInfo.channelId);
        
        if (!targetChannel) {
            console.log(`⚠️ チャンネルが見つかりません: ${targetGuild.name} > ${serverInfo.channelId}`);
            continue;
        }
        
        try {
            await targetChannel.send({
                embeds: [embed],
                files: filesToSend
            });
            successCount++;
        } catch (error) {
            console.error(`❌ メッセージ送信エラー (${targetGuild.name}):`, error.message);
            errorCount++;
        }
    }
    
    // 統計更新
    globalChatData.statistics.totalMessages++;
    saveGlobalChatData();
    
    console.log(`📡 グローバルメッセージ配信: ${sourceGuild.name} → 成功${successCount}件、失敗${errorCount}件`);
}

// グローバルチャットメッセージを処理する関数
async function handleGlobalChatMessage(message, client) {
    // ボットメッセージは無視
    if (!message || !message.author || message.author.bot) return;
    
    // DMは無視
    if (!message.guild) return;
    
    // チャンネル情報の存在確認
    if (!message.channel) return;
    
    const guildId = message.guild.id;
    const channelId = message.channel.id;
    
    // このサーバーがグローバルチャットに参加しているかチェック
    if (!globalChatData.joinedServers[guildId]) return;
    
    // BANサーバーかチェック
    if (globalChatData.bannedServers[guildId]) return;
    
    const serverInfo = globalChatData.joinedServers[guildId];
    
    // 指定されたグローバルチャットチャンネルかチェック
    if (channelId !== serverInfo.channelId) return;
    
    // 空のメッセージかつ添付ファイルもスタンプもない場合は無視
    if (!message.content.trim() && message.attachments.size === 0 && message.stickers.size === 0) return;
    
    // グローバルチャットにメッセージを配信
    const attachments = Array.from(message.attachments.values());
    await broadcastGlobalMessage(guildId, channelId, message, attachments, client);
}

// /globalchatコマンドの処理
async function handleGlobalChatCommand(interaction, client) {
    // 管理者権限チェック
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

    try {
        const channel = interaction.options.getChannel('channel');
        const guild = interaction.guild;
        
        if (!guild) {
            await interaction.editReply({
                content: '❌ サーバー情報を取得できませんでした。'
            });
            return;
        }
        
        if (!channel) {
            await interaction.editReply({
                content: '❌ 指定されたチャンネルが見つかりません。'
            });
            return;
        }
        
        const guildId = guild.id;

        // BANされているサーバーかチェック
        if (globalChatData.bannedServers[guildId]) {
            await interaction.editReply({
                content: '❌ **このサーバーはグローバルチャットから除名されています**\n' +
                        '📞 解除については開発者までお問い合わせください。\n' +
                        `🐦 Twitter: ${globalChatRules.contact.developer}\n` +
                        `🆘 サポートサーバー: ${globalChatRules.contact.supportServer}`
            });
            return;
        }

        // 参加条件をチェック
        const requirementCheck = await checkGlobalChatRequirements(guild);
        
        if (!requirementCheck.valid) {
            try {
                await interaction.editReply({
                    content: `❌ **グローバルチャット参加条件を満たしていません**\n\n` +
                            `🚫 ${requirementCheck.error}\n\n` +
                            `📋 **参加条件**:\n` +
                            `• サーバーメンバー数: ${globalChatData.settings.minMembers}人以上\n` +
                            `• 実際のユーザー数: ${globalChatData.settings.minUsers}人以上（ボットを除く）\n\n` +
                            `💡 条件を満たしてから再度お試しください。`
                });
            } catch (replyError) {
                console.error('❌ インタラクション応答エラー:', replyError);
                // フォローアップで再試行
                try {
                    await interaction.followUp({
                        content: `❌ **グローバルチャット参加条件を満たしていません**\n\n` +
                                `🚫 ${requirementCheck.error}\n\n` +
                                `📋 **参加条件**:\n` +
                                `• サーバーメンバー数: ${globalChatData.settings.minMembers}人以上\n` +
                                `• 実際のユーザー数: ${globalChatData.settings.minUsers}人以上（ボットを除く）\n\n` +
                                `💡 条件を満たしてから再度お試しください。`,
                        flags: 64
                    });
                } catch (followUpError) {
                    console.error('❌ フォローアップ応答エラー:', followUpError);
                }
            }
            return;
        }

        // チャンネルタイプをチェック
        if (channel.type !== 0) { // TEXT_CHANNEL
            await interaction.editReply({
                content: '❌ テキストチャンネルを指定してください。'
            });
            return;
        }

        // 既に参加しているかチェック
        if (globalChatData.joinedServers[guildId]) {
            const currentServerInfo = globalChatData.joinedServers[guildId];
            const currentChannel = guild.channels.cache.get(currentServerInfo.channelId);
            
            await interaction.editReply({
                content: `⚠️ **このサーバーは既にグローバルチャットに参加しています**\n` +
                        `📍 現在のチャンネル: ${currentChannel || '不明なチャンネル'}\n` +
                        `📅 参加日時: ${new Date(currentServerInfo.joinedAt).toLocaleString('ja-JP')}\n\n` +
                        `💡 チャンネルを変更する場合は、このコマンドで新しいチャンネルを指定してください。`
            });
            
            // チャンネル変更の場合
            if (channel.id !== currentServerInfo.channelId) {
                globalChatData.joinedServers[guildId].channelId = channel.id;
                globalChatData.joinedServers[guildId].updatedAt = new Date().toISOString();
                saveGlobalChatData();
                
                await interaction.followUp({
                    content: `✅ **グローバルチャットチャンネルを変更しました**\n` +
                            `📍 新しいチャンネル: ${channel}\n` +
                            `🎉 これからこのチャンネルでグローバルチャットが利用できます！`
                });
                
                console.log(`📡 グローバルチャットチャンネル変更: ${guild.name} > #${channel.name}`);
            }
            return;
        }

        // サーバー情報を登録
        globalChatData.joinedServers[guildId] = {
            guildName: guild.name,
            guildId: guildId,
            channelId: channel.id,
            channelName: channel.name,
            memberCount: requirementCheck.memberCount,
            userCount: requirementCheck.userCount,
            joinedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // 統計更新
        globalChatData.statistics.totalServers = Object.keys(globalChatData.joinedServers).length;
        if (!globalChatData.statistics.createdAt) {
            globalChatData.statistics.createdAt = new Date().toISOString();
        }

        saveGlobalChatData();

        // 成功メッセージ
        await interaction.editReply({
            content: `🎉 **グローバルチャットへの参加が完了しました！**\n\n` +
                    `📍 **指定チャンネル**: ${channel}\n` +
                    `👥 **サーバー情報**: ${requirementCheck.memberCount}人（実ユーザー: ${requirementCheck.userCount}人）\n` +
                    `🌐 **参加サーバー数**: ${globalChatData.statistics.totalServers}サーバー\n\n` +
                    `✨ **これからこのチャンネルで他のサーバーとメッセージを共有できます！**\n` +
                    `📋 利用規約は \`/globalchrule\` で確認できます。\n\n` +
                    `🎊 グローバルチャットをお楽しみください！`
        });

        // グローバルチャットに参加通知を送信
        try {
            await channel.send({
                embeds: [{
                    color: 0x00FF00, // 緑色
                    title: '🎉 グローバルチャット参加完了！',
                    description: `このチャンネルがグローバルチャットに接続されました。\n` +
                               `他のサーバーとメッセージを共有できます！`,
                    fields: [
                        {
                            name: '📋 利用規約',
                            value: '`/globalchrule` で確認してください',
                            inline: true
                        },
                        {
                            name: '🌐 参加サーバー数',
                            value: `${globalChatData.statistics.totalServers}サーバー`,
                            inline: true
                        }
                    ],
                    footer: {
                        text: '健全な利用をお願いします！',
                        icon_url: client.user.displayAvatarURL()
                    },
                    timestamp: new Date().toISOString()
                }]
            });
        } catch (error) {
            console.error('❌ グローバルチャット通知送信エラー:', error);
        }

        console.log(`📡 グローバルチャット新規参加: ${guild.name} (#${channel.name}) | 総参加数: ${globalChatData.statistics.totalServers}`);

    } catch (error) {
        console.error('❌ /globalchatコマンドエラー:', error);
        try {
            await interaction.editReply({
                content: '❌ グローバルチャットの設定中にエラーが発生しました。'
            });
        } catch (replyError) {
            console.error('❌ エラー応答失敗:', replyError);
            try {
                await interaction.followUp({
                    content: '❌ グローバルチャットの設定中にエラーが発生しました。',
                    flags: 64
                });
            } catch (followUpError) {
                console.error('❌ フォローアップエラー応答失敗:', followUpError);
            }
        }
    }
}

// /globalchruleコマンドの処理
async function handleGlobalChatRuleCommand(interaction) {
    await interaction.deferReply();

    try {
        // 現在のサーバーの参加状況をチェック
        const guildId = interaction.guild.id;
        const isJoined = globalChatData.joinedServers[guildId];
        const isBanned = globalChatData.bannedServers[guildId];

        // ルール埋め込みメッセージを作成
        const rulesEmbed = {
            color: 0xFF6B35, // オレンジ色
            title: globalChatRules.title,
            description: globalChatRules.description,
            fields: [],
            footer: {
                text: '健全なグローバルチャット運営にご協力ください',
                icon_url: interaction.client.user.displayAvatarURL()
            },
            timestamp: new Date().toISOString()
        };

        // ルール一覧を追加
        globalChatRules.rules.forEach(rule => {
            rulesEmbed.fields.push({
                name: `📝 ${rule.number}. ${rule.title}`,
                value: rule.content,
                inline: false
            });
        });

        // 参加条件を追加
        rulesEmbed.fields.push({
            name: globalChatRules.requirements.title,
            value: globalChatRules.requirements.conditions.map(condition => `• ${condition}`).join('\n'),
            inline: false
        });

        // コマンド一覧を追加
        rulesEmbed.fields.push({
            name: globalChatRules.commands.title,
            value: globalChatRules.commands.list.map(cmd => 
                `**${cmd.command}**\n${cmd.description}`
            ).join('\n\n'),
            inline: false
        });

        // 現在のサーバー状況を追加
        let statusText = '';
        if (isBanned) {
            statusText = '🚫 **このサーバーはBANされています**';
        } else if (isJoined) {
            const serverInfo = globalChatData.joinedServers[guildId];
            const channel = interaction.guild.channels.cache.get(serverInfo.channelId);
            statusText = `✅ **参加中** (${channel || '不明なチャンネル'})`;
        } else {
            statusText = '⭕ **未参加**';
        }

        rulesEmbed.fields.push({
            name: '📊 このサーバーの状況',
            value: statusText,
            inline: true
        });

        // 統計情報を追加
        rulesEmbed.fields.push({
            name: '📈 グローバルチャット統計',
            value: `🌐 参加サーバー: ${globalChatData.statistics.totalServers}個\n` +
                   `💬 総メッセージ数: ${globalChatData.statistics.totalMessages.toLocaleString()}件`,
            inline: true
        });

        // お問い合わせ情報を追加
        rulesEmbed.fields.push({
            name: globalChatRules.contact.title,
            value: `${globalChatRules.contact.description}\n` +
                   `🆘 [${globalChatRules.contact.supportServerName}](${globalChatRules.contact.supportServer})\n` +
                   `🐦 Twitter: ${globalChatRules.contact.developer}`,
            inline: false
        });

        // ボタンコンポーネントを作成
        const row = {
            type: 1, // ACTION_ROW
            components: [
                {
                    type: 2, // BUTTON
                    style: 5, // LINK
                    label: 'サポートサーバー',
                    url: globalChatRules.contact.supportServer,
                    emoji: { name: '🆘' }
                },
                {
                    type: 2, // BUTTON
                    style: 5, // LINK
                    label: '開発者Twitter',
                    url: `https://twitter.com/${globalChatRules.contact.developer.replace('@', '')}`,
                    emoji: { name: '🐦' }
                }
            ]
        };

        await interaction.editReply({
            embeds: [rulesEmbed],
            components: [row]
        });

        console.log(`📋 グローバルチャットルール表示: ${interaction.guild.name} > ${interaction.user.tag}`);

    } catch (error) {
        console.error('❌ /globalchruleコマンドエラー:', error);
        await interaction.editReply({
            content: '❌ ルールの表示中にエラーが発生しました。'
        });
    }
}

// サーバー退出時の設定クリア
function clearGlobalChatSettings(guildId) {
    if (globalChatData.joinedServers[guildId]) {
        delete globalChatData.joinedServers[guildId];
        globalChatData.statistics.totalServers = Object.keys(globalChatData.joinedServers).length;
        saveGlobalChatData();
        console.log(`📡 グローバルチャット設定を削除: ${guildId}`);
    }
}

module.exports = {
    globalChatCommand,
    globalChatRuleCommand,
    handleGlobalChatCommand,
    handleGlobalChatRuleCommand,
    handleGlobalChatMessage,
    clearGlobalChatSettings
};