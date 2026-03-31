const { SlashCommandBuilder, EmbedBuilder, ApplicationCommandType, ContextMenuCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// レート制限管理
const rateLimits = new Map();
const RATE_LIMIT_RPM_DURATION = 60000; // 1分
const RATE_LIMIT_RPD_DURATION = 24 * 60 * 60 * 1000; // 24時間
const MAX_REQUESTS_PER_MINUTE = 5;
const MAX_REQUESTS_PER_DAY = 20;

// OpenRouter API設定
const OPENROUTER_API_KEY = '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';
const MODEL = 'deepseek/deepseek-chat-v3-0324:free';

// 対話コーパスファイルのパス
const CORPUS_PATH = path.join(__dirname, '..', '対話コーパス.txt');

// 対話コーパスを読み込む関数
function loadCorpus() {
    try {
        const content = fs.readFileSync(CORPUS_PATH, 'utf-8');
        return content;
    } catch (error) {
        console.error('対話コーパスの読み込みに失敗しました:', error);
        return null;
    }
}

// レート制限チェック関数
function checkRateLimit(guildId) {
    const now = Date.now();
    const guildLimits = rateLimits.get(guildId) || {
        rpm: { count: 0, resetTime: now + RATE_LIMIT_RPM_DURATION },
        rpd: { count: 0, resetTime: now + RATE_LIMIT_RPD_DURATION }
    };
    
    // RPM（1分あたりのリクエスト数）チェック
    if (now > guildLimits.rpm.resetTime) {
        guildLimits.rpm.count = 0;
        guildLimits.rpm.resetTime = now + RATE_LIMIT_RPM_DURATION;
    }
    
    // RPD（1日あたりのリクエスト数）チェック
    if (now > guildLimits.rpd.resetTime) {
        guildLimits.rpd.count = 0;
        guildLimits.rpd.resetTime = now + RATE_LIMIT_RPD_DURATION;
    }
    
    // RPMまたはRPDの制限に達している場合
    if (guildLimits.rpm.count >= MAX_REQUESTS_PER_MINUTE || guildLimits.rpd.count >= MAX_REQUESTS_PER_DAY) {
        const result = {
            allowed: false,
            rpmExceeded: guildLimits.rpm.count >= MAX_REQUESTS_PER_MINUTE,
            rpdExceeded: guildLimits.rpd.count >= MAX_REQUESTS_PER_DAY,
            rpmResetTime: guildLimits.rpm.resetTime,
            rpdResetTime: guildLimits.rpd.resetTime,
            rpmRemaining: Math.max(0, MAX_REQUESTS_PER_MINUTE - guildLimits.rpm.count),
            rpdRemaining: Math.max(0, MAX_REQUESTS_PER_DAY - guildLimits.rpd.count)
        };
        return result;
    }
    
    // カウントを増加
    guildLimits.rpm.count++;
    guildLimits.rpd.count++;
    rateLimits.set(guildId, guildLimits);
    
    return {
        allowed: true,
        rpmExceeded: false,
        rpdExceeded: false,
        rpmResetTime: guildLimits.rpm.resetTime,
        rpdResetTime: guildLimits.rpd.resetTime,
        rpmRemaining: Math.max(0, MAX_REQUESTS_PER_MINUTE - guildLimits.rpm.count),
        rpdRemaining: Math.max(0, MAX_REQUESTS_PER_DAY - guildLimits.rpd.count)
    };
}

// OpenRouter APIを呼び出す関数
async function callOpenRouterAPI(text, corpus) {
    const model = MODEL;
    
    const prompt = `以下の対話コーパスを参考に、標準的な日本語をヒカマニ語録に翻訳してください。

対話コーパス:
${corpus}

翻訳する文:
${text}

重要な指示:
- 導入文・締めの文は絶対に出力しない
- 「標準的な日本語：」「ヒカマニ語録：」といった識別子は出力しない
- 翻訳結果のテキストのみを出力する
- 可能な限り標準的な日本語からヒカマニ語録に翻訳する`;
    
    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://discord.com',
                'X-Title': 'Discord Bot Translate'
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 500,
                temperature: 0.7
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API Error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
        }
        
        const data = await response.json();
        return data.choices[0].message.content.trim();
    } catch (error) {
        console.error('OpenRouter API呼び出しエラー:', error);
        throw error;
    }
}

// 翻訳コマンドのハンドラー
async function handleTranslateCommand(interaction) {
    try {
        // 翻訳対象のテキストを取得
        let originalText;
        if (interaction.isMessageContextMenuCommand()) {
            originalText = interaction.targetMessage.content;
        } else {
            originalText = interaction.options.getString('message');
        }

        // 処理中メッセージを送信
        await interaction.deferReply();
        
        // テキストの有効性をチェック
        if (!originalText || originalText.trim() === '') {
            await interaction.editReply({
                content: '❌ 翻訳対象のメッセージが見つかりませんでした。\n' +
                         '以下のいずれかの方法で翻訳してください。\n' +
                         '1. `/translate`コマンドの`message`オプションに翻訳したい文章を入力する。\n' +
                         '2. 翻訳したいメッセージを右クリックし、「アプリ」 > 「翻訳」を選択する。'
            });
            return;
        }
        
        // レート制限チェック
        const rateLimitResult = checkRateLimit(interaction.guildId);

        if (!rateLimitResult.allowed) {
            let statusText = '';
            if (rateLimitResult.rpmExceeded) {
                const rpmResetMinutes = Math.ceil((rateLimitResult.rpmResetTime - Date.now()) / 60000);
                statusText += `RPM制限: ${rpmResetMinutes}分後にリセット\n`;
            }
            if (rateLimitResult.rpdExceeded) {
                const rpdResetHours = Math.ceil((rateLimitResult.rpdResetTime - Date.now()) / 3600000);
                statusText += `RPD制限: ${rpdResetHours}時間後にリセット`;
            }
            
            await interaction.editReply({
                content: `❌ レート制限に達しました。\n${statusText}`
            });
            return;
        }
        
        // 対話コーパスを読み込み
        const corpus = loadCorpus();
        if (!corpus) {
            return await interaction.reply({
                content: '❌ 対話コーパスの読み込みに失敗しました。',
                flags: 64
            });
        }
        
        try {
            // 翻訳実行
            const translatedText = await callOpenRouterAPI(originalText, corpus);
            
            // 結果を埋め込みメッセージで送信
            const embed = new EmbedBuilder()
                .setTitle('🔄 ヒカマニ語録翻訳')
                .addFields(
                    { name: '🎭 ヒカマニ語録', value: translatedText.length > 1024 ? translatedText.substring(0, 1021) + '...' : translatedText }
                )
                .setColor(0x00AE86)
                .setFooter({ 
                    text: `翻訳者: ${interaction.user.username}`,
                    iconURL: interaction.user.displayAvatarURL()
                })
                .setTimestamp();
            
            // レート制限情報をフィールドに追加
            embed.addFields({
                name: '📊 使用状況',
                value: `RPM: ${MAX_REQUESTS_PER_MINUTE - rateLimitResult.rpmRemaining}/${MAX_REQUESTS_PER_MINUTE}\nRPD: ${MAX_REQUESTS_PER_DAY - rateLimitResult.rpdRemaining}/${MAX_REQUESTS_PER_DAY}`,
                inline: true
            });
            
            await interaction.editReply({ embeds: [embed] });
            
        } catch (apiError) {
            console.error('翻訳API呼び出しエラー:', apiError);
            const errorMessage = '❌ 翻訳に失敗しました。しばらく時間をおいてから再度お試しください。';
            await interaction.editReply({ content: errorMessage });
        }
        
    } catch (error) {
        console.error('翻訳コマンドエラー:', error);
        
        try {
            const errorMessage = '❌ コマンドの実行中にエラーが発生しました。';
            
            if (interaction.deferred) {
                await interaction.editReply({ content: errorMessage });
            } else if (interaction.replied) {
                await interaction.followUp({ content: errorMessage });
            } else {
                await interaction.reply({
                    content: errorMessage,
                    flags: 64
                });
            }
        } catch (replyError) {
            console.error('エラーレスポンス送信失敗:', replyError);
        }
    }
}

const translateSlashCommand = new SlashCommandBuilder()
    .setName('translate')
    .setDescription('入力されたテキストをヒカマニ語録に翻訳します。')
    .addStringOption(option =>
        option.setName('message')
            .setDescription('翻訳したいテキスト')
            .setRequired(false) // コンテキストメニューからの実行を考慮してfalseに
    );

const translateContextMenuCommand = new ContextMenuCommandBuilder()
    .setName('翻訳')
    .setType(ApplicationCommandType.Message);

module.exports = {
    translateSlashCommand,
    translateContextMenuCommand,
    handleTranslateCommand
};