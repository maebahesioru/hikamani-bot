const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');

// 設定ファイルのパス
const QUICKLEAVE_CONFIG_PATH = path.join(__dirname, '..', 'quickleave.json');

// 設定を読み込む関数
function loadQuickLeaveConfig() {
    try {
        if (fs.existsSync(QUICKLEAVE_CONFIG_PATH)) {
            const data = fs.readFileSync(QUICKLEAVE_CONFIG_PATH, 'utf-8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('即抜けRTA設定の読み込みエラー:', error);
    }
    return {};
}

// 設定を保存する関数
function saveQuickLeaveConfig(config) {
    try {
        fs.writeFileSync(QUICKLEAVE_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
        return true;
    } catch (error) {
        console.error('即抜けRTA設定の保存エラー:', error);
        return false;
    }
}

// ユーザーの参加時間を記録するMap
const userJoinTimes = new Map();



// 即抜けRTA設定コマンド
const quickLeaveCommand = new SlashCommandBuilder()
    .setName('quickleave')
    .setDescription('即抜けRTA機能の設定を管理します')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand =>
        subcommand
            .setName('channel')
            .setDescription('即抜けRTA通知チャンネルを設定します')
            .addChannelOption(option =>
                option
                    .setName('channel')
                    .setDescription('通知を送信するチャンネル')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('enable')
            .setDescription('即抜けRTA機能を有効にします')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('disable')
            .setDescription('即抜けRTA機能を無効にします')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('status')
            .setDescription('即抜けRTA機能の現在の設定を表示します')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('message')
            .setDescription('DMメッセージの内容を設定します')
            .addStringOption(option =>
                option
                    .setName('title')
                    .setDescription('DMのタイトル')
                    .setRequired(false)
                    .setMaxLength(256)
            )
            .addStringOption(option =>
                option
                    .setName('description')
                    .setDescription('DMの説明文 ({SERVER_NAME}でサーバー名を挿入)')
                    .setRequired(false)
                    .setMaxLength(1000)
            )
            .addStringOption(option =>
                option
                    .setName('footer')
                    .setDescription('DMのフッターテキスト')
                    .setRequired(false)
                    .setMaxLength(256)
            )
            .addIntegerOption(option =>
                option
                    .setName('detection_time')
                    .setDescription('即抜けRTAの検出時間（分）')
                    .setRequired(false)
                    .setMinValue(1)
                    .setMaxValue(60)
            )
    );

// 即抜けRTAコマンドハンドラー
async function handleQuickLeaveCommand(interaction) {
    try {
        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        const config = loadQuickLeaveConfig();
        
        if (!config[guildId]) {
            config[guildId] = {
                enabled: true,
                channelId: null,
                detectionTimeMinutes: 10,
                dmMessage: {
                    title: '⚡ 即抜けRTA記録通知',
                    description: '**{SERVER_NAME}** での即抜けRTA記録をお知らせします！',
                    footer: ''
                }
            };
        }
        
        // デフォルトメッセージが設定されていない場合は追加
        if (!config[guildId].dmMessage) {
            config[guildId].dmMessage = {
                title: '⚡ 即抜けRTA記録通知',
                description: '**{SERVER_NAME}** での即抜けRTA記録をお知らせします！',
                footer: ''
            };
        }
        
        // デフォルト検出時間が設定されていない場合は追加
        if (config[guildId].detectionTimeMinutes === undefined) {
            config[guildId].detectionTimeMinutes = 10;
        }
        
        switch (subcommand) {
            case 'channel':
                const channel = interaction.options.getChannel('channel');
                config[guildId].channelId = channel.id;
                
                if (saveQuickLeaveConfig(config)) {
                    const embed = new EmbedBuilder()
                        .setTitle('⚡ 即抜けRTA設定')
                        .setDescription(`通知チャンネルを ${channel} に設定しました。`)
                        .setColor(0x00ff00)
                        .setTimestamp();
                    
                    await interaction.reply({ embeds: [embed] });
                } else {
                    await interaction.reply({ content: '❌ 設定の保存に失敗しました。', ephemeral: true });
                }
                break;
                
            case 'enable':
                config[guildId].enabled = true;
                
                if (saveQuickLeaveConfig(config)) {
                    const embed = new EmbedBuilder()
                        .setTitle('⚡ 即抜けRTA設定')
                        .setDescription('即抜けRTA機能を有効にしました。')
                        .setColor(0x00ff00)
                        .setTimestamp();
                    
                    await interaction.reply({ embeds: [embed] });
                } else {
                    await interaction.reply({ content: '❌ 設定の保存に失敗しました。', ephemeral: true });
                }
                break;
                
            case 'disable':
                config[guildId].enabled = false;
                
                if (saveQuickLeaveConfig(config)) {
                    const embed = new EmbedBuilder()
                        .setTitle('⚡ 即抜けRTA設定')
                        .setDescription('即抜けRTA機能を無効にしました。')
                        .setColor(0xff0000)
                        .setTimestamp();
                    
                    await interaction.reply({ embeds: [embed] });
                } else {
                    await interaction.reply({ content: '❌ 設定の保存に失敗しました。', ephemeral: true });
                }
                break;
                
            case 'status':
                const statusEmbed = new EmbedBuilder()
                    .setTitle('⚡ 即抜けRTA設定状況')
                    .addFields(
                        {
                            name: '機能状態',
                            value: config[guildId].enabled ? '✅ 有効' : '❌ 無効',
                            inline: true
                        },
                        {
                            name: '通知チャンネル',
                            value: config[guildId].channelId ? `<#${config[guildId].channelId}>` : '未設定',
                            inline: true
                        },
                        {
                            name: '判定時間',
                            value: `${config[guildId].detectionTimeMinutes}分以内の退出`,
                            inline: true
                        },
                        {
                            name: 'DMメッセージ設定',
                            value: `**タイトル:** ${config[guildId].dmMessage.title}\n**説明:** ${config[guildId].dmMessage.description}\n**フッター:** ${config[guildId].dmMessage.footer}`,
                            inline: false
                        }
                    )
                    .setColor(config[guildId].enabled ? 0x00ff00 : 0xff0000)
                    .setTimestamp();
                
                await interaction.reply({ embeds: [statusEmbed] });
                break;
                
            case 'message':
                const title = interaction.options.getString('title');
                const description = interaction.options.getString('description');
                const footer = interaction.options.getString('footer');
                const detectionTime = interaction.options.getInteger('detection_time');
                
                if (!title && !description && !footer && !detectionTime) {
                    await interaction.reply({ content: '❌ 少なくとも1つのオプション（title、description、footer、detection_time）を指定してください。', ephemeral: true });
                    return;
                }
                
                if (title) config[guildId].dmMessage.title = title;
                if (description) config[guildId].dmMessage.description = description;
                if (footer) config[guildId].dmMessage.footer = footer;
                if (detectionTime) config[guildId].detectionTimeMinutes = detectionTime;
                
                if (saveQuickLeaveConfig(config)) {
                    const embed = new EmbedBuilder()
                        .setTitle('⚡ 即抜けRTA設定')
                        .setDescription('DMメッセージの設定を更新しました。')
                        .addFields(
                            {
                                name: '現在の設定',
                                value: `**タイトル:** ${config[guildId].dmMessage.title}\n**説明:** ${config[guildId].dmMessage.description}\n**フッター:** ${config[guildId].dmMessage.footer}\n**検出時間:** ${config[guildId].detectionTimeMinutes}分`,
                                inline: false
                            },
                            {
                                name: '使用可能な変数',
                                value: '`{SERVER_NAME}` - サーバー名に置換されます',
                                inline: false
                            }
                        )
                        .setColor(0x00ff00)
                        .setTimestamp();
                    
                    await interaction.reply({ embeds: [embed] });
                } else {
                    await interaction.reply({ content: '❌ 設定の保存に失敗しました。', ephemeral: true });
                }
                break;
        }
        
    } catch (error) {
        console.error('即抜けRTAコマンドエラー:', error);
        await interaction.reply({ content: '❌ コマンドの実行中にエラーが発生しました。', ephemeral: true });
    }
}

// ユーザー参加時の処理
function handleUserJoin(member) {
    const userId = member.user.id;
    const guildId = member.guild.id;
    const joinTime = Date.now();
    
    // 参加時間を記録
    if (!userJoinTimes.has(guildId)) {
        userJoinTimes.set(guildId, new Map());
    }
    userJoinTimes.get(guildId).set(userId, joinTime);
    
    console.log(`📥 ユーザー参加記録: ${member.user.tag} (${guildId})`);
}

// ユーザー退出時の処理
async function handleUserLeave(member) {
    const userId = member.user.id;
    const guildId = member.guild.id;
    const leaveTime = Date.now();
    
    // 設定を確認
    const config = loadQuickLeaveConfig();
    if (!config[guildId] || !config[guildId].enabled || !config[guildId].channelId) {
        return;
    }
    
    // 参加時間を確認
    const guildJoinTimes = userJoinTimes.get(guildId);
    if (!guildJoinTimes || !guildJoinTimes.has(userId)) {
        return;
    }
    
    const joinTime = guildJoinTimes.get(userId);
    const stayDuration = leaveTime - joinTime;
    const stayMinutes = Math.floor(stayDuration / 60000);
    const staySeconds = Math.floor((stayDuration % 60000) / 1000);
    
    // 設定された時間以内の退出かチェック
    const detectionTimeMs = config[guildId].detectionTimeMinutes * 60 * 1000;
    if (stayDuration <= detectionTimeMs) {
        try {
            // 通知チャンネルに送信
            const channel = member.guild.channels.cache.get(config[guildId].channelId);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle('⚡ 即抜けRTA記録！')
                    .setDescription(`${member.user.tag} が即抜けRTAを達成しました！`)
                    .addFields(
                        {
                            name: '⏱️ 滞在時間',
                            value: `${stayMinutes}分${staySeconds}秒`,
                            inline: true
                        },
                        {
                            name: '👤 ユーザー',
                            value: `${member.user.tag}\n(${member.user.id})`,
                            inline: true
                        },
                        {
                            name: '📅 退出時刻',
                            value: `<t:${Math.floor(leaveTime / 1000)}:F>`,
                            inline: true
                        }
                    )
                    .setColor(0xff6b35)
                    .setThumbnail(member.user.displayAvatarURL())
                    .setTimestamp();
                
                await channel.send({ embeds: [embed] });
            }
            
            
            // ユーザーのDMに送信
            try {
                const dmConfig = config[guildId].dmMessage;
                const dmEmbed = new EmbedBuilder()
                    .setTitle(dmConfig.title)
                    .setDescription(dmConfig.description.replace('{SERVER_NAME}', member.guild.name))
                    .addFields(
                        {
                            name: '⏱️ あなたの記録',
                            value: `${stayMinutes}分${staySeconds}秒`,
                            inline: true
                        },
                        {
                            name: '🏆 ランク',
                            value: getRankByTime(stayDuration),
                            inline: true
                        }
                    )
                    .setColor(0xff6b35)
                    .setFooter({ text: dmConfig.footer })
                    .setTimestamp();
                
                await member.user.send({ embeds: [dmEmbed] });
                console.log(`📨 即抜けRTA DM送信完了: ${member.user.tag}`);
            } catch (dmError) {
                console.log(`📨 即抜けRTA DM送信失敗: ${member.user.tag}`);
                console.log(`📨 エラー詳細: ${dmError.message}`);
                console.log(`📨 エラーコード: ${dmError.code || 'N/A'}`);
                
                // 一般的なDMエラーの原因を特定
                let errorReason = 'DMが無効';
                if (dmError.code === 50007) {
                    errorReason = 'ユーザーがDMを受信拒否している';
                } else if (dmError.code === 50013) {
                    errorReason = 'ボットに権限がない';
                } else if (dmError.code === 10013) {
                    errorReason = 'ユーザーが見つからない';
                } else if (dmError.message.includes('Cannot send messages to this user')) {
                    errorReason = 'ユーザーがDMを受信拒否している';
                } else if (dmError.message.includes('Missing Permissions')) {
                    errorReason = 'ボットに権限がない';
                }
                
                console.log(`📨 推定原因: ${errorReason}`);
            }
            
        } catch (error) {
            console.error('即抜けRTA処理エラー:', error);
        }
    }
    
    // 参加時間記録を削除
    guildJoinTimes.delete(userId);
}

// 滞在時間によるランク判定
function getRankByTime(duration) {
    const minutes = duration / 60000;
    
    if (minutes < 0.5) return '🏆 即抜けの神 (30秒未満)';
    if (minutes < 1) return '🥇 即抜けプロ (1分未満)';
    if (minutes < 2) return '🥈 即抜け上級者 (2分未満)';
    if (minutes < 5) return '🥉 即抜け中級者 (5分未満)';
    return '🏃 即抜け初心者 (5分以上)';
}



module.exports = {
    quickLeaveCommand,
    handleQuickLeaveCommand,
    handleUserJoin,
    handleUserLeave
};