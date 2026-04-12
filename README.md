# Aide — あなた専属のAI秘書

Gemini API + Firebase + LINE Bot で動く、本格パーソナル秘書アプリ。
**LINEのトーク画面がそのまま秘書に**。写真→メモ、予定→Googleカレンダー、毎朝天気通知まで全自動。

![Aide](icon.svg)

## ✨ 機能一覧

### 📱 LINE Bot（メイン）
| 機能 | 使い方 |
|---|---|
| 💬 何でも相談 | テキストを送るだけ。最新情報はWeb検索込み |
| 📸 写真→メモ | 画像を送信 → AI解析 → 自動でメモ保存（名刺・レシート・手書きもOK） |
| 🎙 音声→議事録 | 音声を送信 → 文字起こし → 議事録形式に自動整理 |
| 📄 ファイル→要約 | PDF・テキスト送信 → 要約してメモ保存 |
| ✅ タスク自動化 | 「来週水曜14時に歯医者」→ 自動でタスク登録 |
| 📅 カレンダー連携 | 予定を伝える → 確認ボタン → Googleカレンダーに追加 |
| 🌤 毎朝天気通知 | 毎朝7時に天気・予定・タスクをまとめて通知 |
| 🗺 ルート案内 | 「渋谷から成田」→ Google Mapsリンク付きで回答 |
| 🍽 店探し | 「恵比寿で個室寿司」→ 食べログリンク付き |

### 🖥 Webアプリ（補助）
- ブラウザから会話・タスク・資料庫を確認
- PCからも操作可能
- PWA対応（ホーム画面追加でアプリ化）

---

## 🚀 セットアップ（合計25分）

### ステップ1: Gemini APIキー取得（無料・3分）

1. https://aistudio.google.com/apikey にアクセス
2. Googleアカウントでログイン
3. **「Create API key」** → コピー

### ステップ2: LINE Bot 作成（10分）

1. **LINE Developers にアクセス**: https://developers.line.biz/
2. LINEアカウントでログイン
3. **「プロバイダー」作成**（名前は何でもOK、例: `自分用`）
4. **「Messaging API」チャンネル作成**:
   - チャンネル名: `Aide秘書`（好きな名前）
   - 説明: `AI秘書bot`
   - カテゴリ: `ウェブサービス` → `ウェブサービス（個人）`
5. 作成後、**「Messaging API設定」タブ**:
   - **チャンネルアクセストークン**: 「発行」をクリック → コピー
   - **応答メッセージ**: 無効にする（重要！）
   - **あいさつメッセージ**: 無効にする
6. **「チャンネル基本設定」タブ**:
   - **チャンネルシークレット**: コピー

### ステップ3: Firebase セットアップ（5分）

1. https://console.firebase.google.com/ → 「プロジェクトを作成」
2. プロジェクト名: `my-aide` → アナリティクス無効でOK
3. **Firestore Database** → 「データベースの作成」→ 本番モード → ロケーション選択
4. Firestore の「ルール」タブで以下に置き換え → **公開**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /lineUsers/{uid}/{document=**} {
      allow read, write: if true;
    }
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

5. **サービスアカウント鍵を取得**:
   - プロジェクト設定 → **「サービスアカウント」タブ**
   - 「新しい秘密鍵の生成」→ JSONファイルがダウンロードされる
   - このJSONの中身をまるごとコピー（後でVercelに貼り付け）

### ステップ4: Vercel にデプロイ（5分）

```bash
cd /Users/ashizawashunsuke/Documents/Claude/secretary-app

# 依存パッケージインストール
npm install

# Vercel にデプロイ
npx vercel
```

初回はメール認証 → Enter連打 → デプロイ完了。

**環境変数を設定**（Vercelダッシュボード → Settings → Environment Variables）:

| 変数名 | 値 |
|---|---|
| `GEMINI_API_KEY` | ステップ1で取得したキー |
| `GEMINI_MODEL` | `gemini-2.0-flash`（任意） |
| `LINE_CHANNEL_SECRET` | ステップ2で取得 |
| `LINE_CHANNEL_ACCESS_TOKEN` | ステップ2で取得 |
| `FIREBASE_SERVICE_ACCOUNT` | ステップ3のJSON（丸ごと貼り付け） |
| `CRON_SECRET` | 適当なランダム文字列（天気cron認証用） |

設定後、**再デプロイ**:
```bash
npx vercel --prod
```

### ステップ5: LINE Webhook 設定

1. LINE Developers → 作ったチャンネル → **Messaging API設定**
2. **Webhook URL** に以下を入力:
   ```
   https://あなたのアプリ.vercel.app/api/webhook
   ```
3. **Webhookの利用**: ONにする
4. **「検証」ボタン** → 「成功」と表示されればOK！

### ステップ6: LINE で友だち追加して使い始める！

1. Messaging API設定タブの **QRコード** をスマホで読み取る
2. 友だち追加 → 自動であいさつメッセージが届く
3. 何でも話しかけてみましょう！

---

## 📅 Googleカレンダー設定（任意・5分）

予定をGoogleカレンダーに自動追加したい場合のみ。

1. https://console.cloud.google.com/ → 同じプロジェクトを選択
2. **APIとサービス** → **ライブラリ** → `Google Calendar API` を検索 → **有効化**
3. **APIとサービス** → **認証情報** → **認証情報を作成** → **OAuth クライアント ID**
   - アプリの種類: **デスクトップアプリ**
   - 名前: `Aide Calendar`
4. 作成後、**クライアントID** と **クライアントシークレット** をコピー
5. Vercelの環境変数に追加:
   - `GOOGLE_CLIENT_ID`: コピーしたID
   - `GOOGLE_CLIENT_SECRET`: コピーしたシークレット
6. 再デプロイ後、ブラウザで以下にアクセス:
   ```
   https://あなたのアプリ.vercel.app/api/setup-calendar
   ```
7. 画面の指示に従ってGoogleログイン → 認証コードを取得
8. `?code=取得したコード` をURLに追加してアクセス → `refresh_token` が表示される
9. `GOOGLE_REFRESH_TOKEN` として Vercel 環境変数に追加 → 再デプロイ

---

## 💡 LINE での使い方

### テキスト
| やりたいこと | 送るメッセージ |
|---|---|
| ルート検索 | `渋谷から成田空港 最速ルート` |
| 店探し | `恵比寿で個室寿司 2万円以内` |
| タスク登録 | `来週水曜14時に歯医者` → 自動タスク化 |
| 予定追加 | `明日15時から打ち合わせ 渋谷オフィス` → カレンダー確認ボタン |
| メモ | `メモ 田中さんの電話番号 090-xxxx-xxxx` |
| タスク確認 | `タスク一覧` |
| メモ確認 | `メモ一覧` |
| 今日の予定 | `今日の予定` |
| プロフィール | `プロフィール設定: 東京在住、辛いもの苦手、予算2万` |
| 居住地 | `居住地設定: 大阪` → 天気通知の地域が変わる |

### 画像・音声・ファイル
| 送るもの | 何が起きる |
|---|---|
| 📸 写真 | AIが内容を解析 → メモに自動保存（名刺→連絡先、レシート→金額、メニュー→テキスト化） |
| 🎙 音声メッセージ | 文字起こし → 議事録形式に整理 → メモ保存 |
| 📄 PDF/テキスト | 要約 → メモ保存 |

### 毎朝の自動通知
毎朝7時に自動で届きます：
- 🌤 今日の天気・気温・傘の要否
- 👔 服装アドバイス
- 📅 今日の予定一覧
- 📋 未完了タスク
- 💡 AIからのひとことアドバイス

---

## 🔒 セキュリティ

- LINE → Vercel → Gemini API の経路のみ。第三者サーバーなし
- LINEの署名検証でなりすまし防止
- データは自分のFirebaseプロジェクトにのみ保存
- Firestoreルールでユーザー別にアクセス制限

---

## 🛠 ファイル構成

```
secretary-app/
├── index.html              # Webアプリ UI
├── styles.css              # モダンテーマ
├── app.js                  # Webアプリ ロジック
├── sw.js                   # Service Worker
├── manifest.json           # PWAマニフェスト
├── icon.svg                # アイコン
├── package.json            # 依存パッケージ
├── vercel.json             # Vercel設定 + cron
├── api/
│   ├── webhook.js          # LINE Bot webhook
│   ├── setup-calendar.js   # Googleカレンダー OAuth設定
│   └── cron/
│       └── weather.js      # 毎朝天気通知
├── lib/
│   ├── line.js             # LINE API ヘルパー
│   ├── gemini.js           # Gemini API ヘルパー
│   ├── calendar.js         # Google Calendar ヘルパー
│   └── store.js            # Firebase Firestore ストレージ
└── README.md
```

## 🆘 トラブルシューティング

| 症状 | 対処 |
|---|---|
| Webhook検証で失敗 | URL末尾が `/api/webhook` か確認。環境変数 `LINE_CHANNEL_SECRET` が正しいか |
| Botが無反応 | Vercel Functions のログ確認。`LINE_CHANNEL_ACCESS_TOKEN` が正しいか |
| 画像解析されない | 画像のダウンロードに `LINE_CHANNEL_ACCESS_TOKEN` が必要。再確認 |
| カレンダーに追加されない | `/api/setup-calendar` で OAuth 設定したか。`GOOGLE_REFRESH_TOKEN` があるか |
| 天気通知が来ない | `CRON_SECRET` を設定したか。Vercel Pro プランが必要（無料は1日1 cron） |
| `429 Quota exceeded` | Gemini無料枠超過。1分待つ or モデルを `gemini-2.0-flash` に |

## 🎯 今後の拡張アイデア

- 🔔 タスク期限のリマインダー通知
- 📊 支出管理（レシート写真から自動集計）
- 🌙 ダークモード（Webアプリ）
- 📍 位置情報から周辺の店を提案
- 🤝 家族・チームとの共有メモ
- 🗓 週間ダイジェスト通知（毎週月曜朝）
