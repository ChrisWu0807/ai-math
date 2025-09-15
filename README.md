# 康軒AI數學通 - 網頁解題服務

這是一個為 LINE 機器人設計的數學解題網頁生成服務，可以將 OpenAI 生成的數學解題內容轉換成美觀的網頁並回傳連結。

## 功能特色

- 🧮 自動生成數學解題網頁
- 📱 響應式設計，支援手機和桌面
- 🔐 API 安全驗證
- 📊 查看統計和過期管理
- 🚀 高效能和高可用性
- 🎨 美觀的 UI 設計

## 系統架構

```
LINE 用戶 → LINE 機器人 → n8n → OpenAI API → 網頁生成服務 → 回傳網址
```

## 快速開始

### 1. 環境設定

複製環境變數範例檔案：
```bash
cp env.example .env
```

編輯 `.env` 檔案，設定必要的環境變數：

```env
# 資料庫配置
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/math-solutions

# API 安全配置
API_KEY=your-secure-api-key-here

# 服務配置
PORT=3000
NODE_ENV=production
WEB_DOMAIN=https://your-domain.com
```

### 2. 安裝依賴

```bash
npm install
```

### 3. 啟動服務

開發模式：
```bash
npm run dev
```

生產模式：
```bash
npm start
```

### 4. 使用 Docker 部署

```bash
# 建構映像
docker build -t math-solution-web .

# 執行容器
docker run -p 3000:3000 --env-file .env math-solution-web
```

## API 使用說明

### 創建解題網頁

**POST** `/api/create-solution`

Headers:
```
Content-Type: application/json
x-api-key: your-api-key
```

Request Body:
```json
{
  "question": "數學題目內容",
  "answer": "詳細的解題過程和答案"
}
```

Response:
```json
{
  "success": true,
  "id": "761c3940-d221-494a-8b07-034082eecc56",
  "url": "https://your-domain.com/display/761c3940-d221-494a-8b07-034082eecc56",
  "message": "數學解題網頁創建成功"
}
```

### 查看解題內容

**GET** `/display/{id}`

直接在瀏覽器中開啟回傳的 URL 即可查看解題內容。

## n8n 整合範例

在您的 n8n 工作流程中，可以在 OpenAI 節點後添加 HTTP Request 節點：

```javascript
// HTTP Request 節點配置
Method: POST
URL: https://your-domain.com/api/create-solution
Headers: {
  "Content-Type": "application/json",
  "x-api-key": "your-api-key"
}
Body: {
  "question": "{{ $json.question }}",
  "answer": "{{ $json.answer }}"
}
```

然後在 LINE 回覆節點中使用：
```javascript
// LINE 回覆內容
{
  "type": "text",
  "text": "{{ $json.url }}"
}
```

## 部署選項

### 1. Google Cloud Run

```bash
# 建構並推送映像
gcloud builds submit --tag gcr.io/PROJECT-ID/math-solution-web

# 部署到 Cloud Run
gcloud run deploy math-solution-web \
  --image gcr.io/PROJECT-ID/math-solution-web \
  --platform managed \
  --region asia-east1 \
  --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production,MONGODB_URI=your-mongodb-uri,API_KEY=your-api-key,WEB_DOMAIN=https://math-show-web-627353710801.asia-east1.run.app"
```

### 2. Vercel

```bash
# 安裝 Vercel CLI
npm i -g vercel

# 部署
vercel --prod
```

### 3. Railway

```bash
# 安裝 Railway CLI
npm install -g @railway/cli

# 登入並部署
railway login
railway init
railway up
```

## 環境變數說明

| 變數名 | 必填 | 說明 | 範例 |
|--------|------|------|------|
| `MONGODB_URI` | 是 | MongoDB 連接字串 | `mongodb+srv://user:pass@cluster.mongodb.net/db` |
| `API_KEY` | 是 | API 安全驗證金鑰 | `your-secure-api-key` |
| `PORT` | 否 | 服務端口 (預設: 3000) | `3000` |
| `NODE_ENV` | 否 | 環境模式 | `production` |
| `WEB_DOMAIN` | 是 | 網頁服務域名 | `https://your-domain.com` |
| `JWT_SECRET` | 否 | JWT 簽章密鑰 | `your-jwt-secret` |

## 安全考量

- ✅ API Key 驗證
- ✅ 速率限制 (每 15 分鐘 100 次請求)
- ✅ CORS 保護
- ✅ Helmet 安全標頭
- ✅ 輸入驗證和清理
- ✅ 自動清理過期資料

## 監控和維護

### 健康檢查
```
GET /health
```

### 清理過期資料
系統會自動每小時清理 30 天前的解題記錄。

### 查看統計
每個解題頁面會顯示：
- 創建時間
- 查看次數

## 故障排除

### 常見問題

1. **資料庫連接失敗**
   - 檢查 MongoDB URI 是否正確
   - 確認網路連接和防火牆設定

2. **API Key 驗證失敗**
   - 確認 n8n 中設定的 API Key 與環境變數一致
   - 檢查請求標頭格式

3. **網頁無法顯示**
   - 確認 WEB_DOMAIN 設定正確
   - 檢查 CORS 設定

## 授權

MIT License

## 技術支援

如有問題，請聯繫技術支援團隊。
