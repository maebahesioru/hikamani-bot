const { SlashCommandBuilder } = require('discord.js');

// UTCコマンドの定義
const utcCommand = new SlashCommandBuilder()
    .setName('utc')
    .setDescription('UTC-12からUTC+14までの現在時刻を表示します');

// UTC時間を計算する関数
function getUTCTimes() {
    const now = new Date();
    
    const timeZones = [];
    
    // UTC-12からUTC+14まで
    for (let offset = -12; offset <= 14; offset++) {
        // 現在のUTC時間を基準に各タイムゾーンの時刻を計算
        const utcHours = now.getUTCHours();
        const utcMinutes = now.getUTCMinutes();
        const utcSeconds = now.getUTCSeconds();
        
        // オフセットを適用した時刻を計算
        const targetDate = new Date(now.getTime());
        targetDate.setUTCHours(utcHours + offset, utcMinutes, utcSeconds, 0);
        
        const timeString = targetDate.toISOString().substr(11, 8); // HH:MM:SS形式
        const dateString = targetDate.toISOString().substr(0, 10); // YYYY-MM-DD形式
        
        // オフセットの表示形式を正しく整える
        const offsetString = offset >= 0 ? 
            `+${offset.toString().padStart(2, '0')}` : 
            `-${Math.abs(offset).toString().padStart(2, '0')}`;
        
        timeZones.push({
            offset: offsetString,
            time: timeString,
            date: dateString,
            zone: `UTC${offsetString}`
        });
    }
    
    return timeZones;
}

// 地域名を取得する関数
function getRegionName(offset) {
    const regions = {
        '-12': '🏝️ ベーカー島',
        '-11': '🌺 ハワイ・アリューシャン',
        '-10': '🌴 ハワイ',
        '-09': '🐻 アラスカ',
        '-08': '🌉 太平洋標準時',
        '-07': '🏔️ 山岳標準時',
        '-06': '🌾 中部標準時',
        '-05': '🏙️ 東部標準時',
        '-04': '🍁 大西洋標準時',
        '-03': '🇧🇷 ブラジル',
        '-02': '🌊 中部大西洋',
        '-01': '🇨🇻 カーボベルデ',
        '+00': '🇬🇧 グリニッジ標準時',
        '+01': '🇪🇺 中央ヨーロッパ',
        '+02': '🇪🇬 東ヨーロッパ',
        '+03': '🇷🇺 モスクワ',
        '+04': '🇦🇪 湾岸標準時',
        '+05': '🇵🇰 パキスタン',
        '+06': '🇧🇩 バングラデシュ',
        '+07': '🇹🇭 インドシナ',
        '+08': '🇨🇳 中国標準時',
        '+09': '🇯🇵 日本標準時',
        '+10': '🇦🇺 東オーストラリア',
        '+11': '🇸🇧 ソロモン諸島',
        '+12': '🇫🇯 フィジー',
        '+13': '🇹🇴 トンガ',
        '+14': '🇰🇮 キリバス'
    };
    
    // デバッグ用ログ
    // console.log(`Looking for region: "${offset}" -> ${regions[offset] || '🌍 その他'}`);
    
    return regions[offset] || '🌍 その他';
}

// UTCコマンドハンドラー
async function handleUtcCommand(interaction) {
    try {
        await interaction.deferReply();

        const timeZones = getUTCTimes();
        const currentTime = new Date();
        
        // 埋め込みメッセージを作成
        const embed = {
            color: 0x0099ff,
            title: '🌍 世界のUTC時間',
            description: '現在の世界各地のUTC時間を表示しています',
            thumbnail: {
                url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/World_Time_Zones_Map.png/1200px-World_Time_Zones_Map.png'
            },
            fields: [],
            footer: {
                text: `更新時刻: ${currentTime.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} (JST)`,
                icon_url: interaction.client.user.displayAvatarURL()
            },
            timestamp: new Date().toISOString()
        };

        // 時間を3つのグループに分けて表示
        const group1 = timeZones.slice(0, 9);   // UTC-12 to UTC-4
        const group2 = timeZones.slice(9, 18);  // UTC-3 to UTC+5
        const group3 = timeZones.slice(18, 27); // UTC+6 to UTC+14

        // グループ1: UTC-12 to UTC-4
        let field1Value = '';
        group1.forEach(tz => {
            const region = getRegionName(tz.offset);
            field1Value += `**${tz.zone}** \`${tz.time}\` ${region}\n`;
        });

        // グループ2: UTC-3 to UTC+5  
        let field2Value = '';
        group2.forEach(tz => {
            const region = getRegionName(tz.offset);
            field2Value += `**${tz.zone}** \`${tz.time}\` ${region}\n`;
        });

        // グループ3: UTC+6 to UTC+14
        let field3Value = '';
        group3.forEach(tz => {
            const region = getRegionName(tz.offset);
            field3Value += `**${tz.zone}** \`${tz.time}\` ${region}\n`;
        });

        embed.fields = [
            {
                name: '🌅 西半球・大西洋 (UTC-12 ~ UTC-4)',
                value: field1Value,
                inline: true
            },
            {
                name: '🌍 ヨーロッパ・アフリカ・中東 (UTC-3 ~ UTC+5)',
                value: field2Value,
                inline: true
            },
            {
                name: '🌏 アジア・太平洋 (UTC+6 ~ UTC+14)',
                value: field3Value,
                inline: true
            }
        ];

        // 現在のJST時間を強調表示として追加
        const jstTime = timeZones.find(tz => tz.offset === '+09');
        if (jstTime) {
            embed.fields.push({
                name: '🇯🇵 現在の日本時間 (JST)',
                value: `**${jstTime.date} ${jstTime.time}**`,
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });

        console.log(`⏰ UTC時間表示: ${interaction.guild.name} > ${interaction.user.tag}`);

    } catch (error) {
        console.error('❌ /utcコマンドエラー:', error);
        await interaction.editReply({
            content: '❌ UTC時間の取得中にエラーが発生しました。'
        }).catch(() => {});
    }
}

// コンパクト表示版（オプション）
async function handleUtcCommandCompact(interaction) {
    try {
        await interaction.deferReply();

        const timeZones = getUTCTimes();
        
        // コンパクトな文字列形式で表示
        let timeDisplay = '```\n🌍 世界のUTC時間\n\n';
        
        timeZones.forEach(tz => {
            const region = getRegionName(tz.offset);
            timeDisplay += `${tz.zone.padEnd(7)} ${tz.time} ${region}\n`;
        });
        
        timeDisplay += '```';

        await interaction.editReply({
            content: timeDisplay
        });

        console.log(`⏰ UTC時間表示(コンパクト): ${interaction.guild.name} > ${interaction.user.tag}`);

    } catch (error) {
        console.error('❌ /utcコマンドエラー:', error);
        await interaction.editReply({
            content: '❌ UTC時間の取得中にエラーが発生しました。'
        }).catch(() => {});
    }
}

module.exports = {
    utcCommand,
    handleUtcCommand,
    handleUtcCommandCompact,
    getUTCTimes,
    getRegionName
}; 