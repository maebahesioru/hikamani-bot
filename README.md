# ヒカマニ bot（material-bot）

Discord 上で素材 mp4 のランダム送信、TikTok 風 TTS、動画編集、グローバルチャットなどを行うボットです。

## 必要環境

- Node.js 18 以上（推奨）
- [FFmpeg](https://ffmpeg.org/)（`ffmpeg-static` で同梱バイナリを利用する場合は追加インストール不要なことが多いです）
- 画像合成（`utils/image_composer.py`）を使う場合: Python 3 と `requirements.txt` の依存関係

## セットアップ

```bash
git clone https://github.com/maebahesioru/hikamani-bot.git
cd hikamani-bot
npm ci
```

ルートに `.env` を作成します（`.env.example` をコピーして編集）。

```bash
copy .env.example .env
```

## 環境変数

| 変数 | 必須 | 説明 |
|------|------|------|
| `DISCORD_TOKEN` | はい | [Discord Developer Portal](https://discord.com/developers/applications) で発行したボットトークン |
| `TIKTOK_SESSION_ID` | いいえ | TikTok TTS 系機能を使う場合 |

## 素材フォルダ

`material/` 配下に `hikakin`, `hajime`, `masuo`, `seikin` などのサブフォルダを置き、その中に `.mp4` を配置します（詳細は `utils/helpers.js` の定義に合わせてください）。

## 実行

```bash
npm start
```

## ライセンス

[MIT](LICENSE)

## 注意

- `.env` やトークンをリポジトリに含めないでください。
- 本リポジトリに含まれる設定 JSON は公開用のテンプレートです。運用中のサーバー固有データは各自で管理してください。
