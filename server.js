const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 信任代理設定（用於部署在 Zeabur、Railway 等代理環境）
app.set('trust proxy', true);

// 安全中介軟體
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS 配置
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? [process.env.WEB_DOMAIN] 
    : ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true
}));

// 速率限制
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分鐘
  max: 100, // 限制每個 IP 15 分鐘內最多 100 個請求
  message: '請求過於頻繁，請稍後再試'
});
app.use('/api/', limiter);

// 解析 JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 連接資料庫
const connectDB = async () => {
  try {
    if (process.env.MONGODB_URI) {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('MongoDB 連接成功');
    } else if (process.env.DATABASE_URL) {
      await mongoose.connect(process.env.DATABASE_URL);
      console.log('PostgreSQL 連接成功');
    } else {
      console.warn('⚠️  未設定資料庫連接字串，將使用記憶體模式（不持久化）');
      // 使用記憶體資料庫作為備用方案
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const mongod = await MongoMemoryServer.create();
      const uri = mongod.getUri();
      await mongoose.connect(uri);
      console.log('使用記憶體 MongoDB 連接成功');
    }
  } catch (error) {
    console.error('資料庫連接失敗:', error);
    console.error('服務將繼續運行，但資料不會持久化');
  }
};

// 數學解題資料模型
const solutionSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  question: { type: String, required: true },
  answer: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }, // 30天後過期
  viewCount: { type: Number, default: 0 }
});

const Solution = mongoose.model('Solution', solutionSchema);

// 清理過期資料的中間件
const cleanupExpiredSolutions = async () => {
  try {
    const result = await Solution.deleteMany({ expiresAt: { $lt: new Date() } });
    if (result.deletedCount > 0) {
      console.log(`清理了 ${result.deletedCount} 個過期的解題記錄`);
    }
  } catch (error) {
    console.error('清理過期資料時發生錯誤:', error);
  }
};

// 每小時清理一次過期資料
setInterval(cleanupExpiredSolutions, 60 * 60 * 1000);

// API 中介軟體 - 驗證 API Key
const validateApiKey = (req, res, next) => {
  // 如果沒有設定 API_KEY，則跳過驗證（用於測試）
  if (!process.env.API_KEY) {
    console.warn('⚠️  未設定 API_KEY，跳過 API 驗證');
    return next();
  }
  
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ 
      error: '未授權的請求',
      message: '請提供有效的 API Key' 
    });
  }
  
  next();
};

// 路由：創建新的數學解題網頁
app.post('/api/create-solution', validateApiKey, async (req, res) => {
  try {
    const { question, answer } = req.body;
    
    if (!question || !answer) {
      return res.status(400).json({
        error: '缺少必要參數',
        message: '請提供 question 和 answer 參數'
      });
    }
    
    // 生成唯一 ID
    const solutionId = uuidv4();
    
    // 儲存到資料庫
    const solution = new Solution({
      id: solutionId,
      question: question.trim(),
      answer: answer.trim()
    });
    
    await solution.save();
    
    // 生成網頁 URL
    const webUrl = `${process.env.WEB_DOMAIN}/display/${solutionId}`;
    
    res.json({
      success: true,
      id: solutionId,
      url: webUrl,
      message: '數學解題網頁創建成功'
    });
    
  } catch (error) {
    console.error('創建解題網頁時發生錯誤:', error);
    res.status(500).json({
      error: '伺服器內部錯誤',
      message: '創建解題網頁失敗，請稍後再試'
    });
  }
});

// 路由：顯示數學解題內容
app.get('/display/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const solution = await Solution.findOne({ id });
    
    if (!solution) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="zh-TW">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>找不到解題內容 - 定軒AI數學通</title>
          <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet">
          <style>
            body { 
              font-family: 'Noto Sans TC', sans-serif; 
              margin: 0; 
              padding: 40px 20px; 
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .container { 
              background: white; 
              padding: 40px; 
              border-radius: 20px; 
              box-shadow: 0 20px 40px rgba(0,0,0,0.1);
              text-align: center;
              max-width: 500px;
              width: 100%;
            }
            .error-icon {
              font-size: 64px;
              margin-bottom: 20px;
              color: #ff6b6b;
            }
            h1 { color: #333; margin-bottom: 20px; }
            p { color: #666; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="error-icon">📚</div>
            <h1>找不到解題內容</h1>
            <p>抱歉，您要查看的數學解題內容不存在或已過期。</p>
            <p>請確認連結是否正確，或重新詢問數學問題。</p>
          </div>
        </body>
        </html>
      `);
    }
    
    // 增加查看次數
    solution.viewCount += 1;
    await solution.save();
    
    // 生成 HTML 頁面
    const html = generateSolutionPage(solution);
    res.send(html);
    
  } catch (error) {
    console.error('顯示解題內容時發生錯誤:', error);
    res.status(500).send('伺服器錯誤，請稍後再試');
  }
});

// 生成解題頁面 HTML
function generateSolutionPage(solution) {
  const formattedQuestion = solution.question.replace(/\n/g, '<br>');
  
  // 處理解題過程的格式，將 \n 轉換為 <br>，並美化結構
  let formattedAnswer = solution.answer
    .replace(/\\n/g, '<br>')  // 處理 \n 字面意思
    .replace(/\n/g, '<br>')   // 處理真正的換行
    .replace(/學生名稱:\s*([^<]+)/gi, '<strong>👤 學生：</strong>$1<br>')
    .replace(/學科:\s*([^<]+)/gi, '<strong>📚 學科：</strong>$1<br>')
    .replace(/主題:\s*([^<]+)/gi, '<strong>📖 主題：</strong>$1<br>')
    .replace(/問題:\s*([^<]+)/gi, '')  // 移除問題顯示
    .replace(/回覆:\s*([^<]+)/gi, '<strong>💡 解答：</strong>$1<br>');
  
  return `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>數學解題內容 - 定軒AI數學通</title>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body { 
          font-family: 'Noto Sans TC', sans-serif; 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          padding: 20px;
          line-height: 1.6;
        }
        
        .container { 
          max-width: 800px; 
          margin: 0 auto; 
          background: white; 
          border-radius: 20px; 
          box-shadow: 0 20px 40px rgba(0,0,0,0.1);
          overflow: hidden;
        }
        
        .header {
          background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
          color: white;
          padding: 30px;
          text-align: center;
        }
        
        .header h1 {
          font-size: 28px;
          font-weight: 700;
          margin-bottom: 10px;
        }
        
        .header p {
          font-size: 16px;
          opacity: 0.9;
        }
        
        .content {
          padding: 40px;
        }
        
        .question-section {
          background: #f8f9ff;
          padding: 25px;
          border-radius: 15px;
          margin-bottom: 30px;
          border-left: 5px solid #4facfe;
        }
        
        .question-section h2 {
          color: #333;
          margin-bottom: 15px;
          font-size: 20px;
        }
        
        .question-text {
          color: #555;
          font-size: 16px;
          line-height: 1.8;
        }
        
        .answer-section {
          background: #fff;
          padding: 25px;
          border-radius: 15px;
          border: 2px solid #e9ecef;
        }
        
        .answer-section h2 {
          color: #333;
          margin-bottom: 20px;
          font-size: 20px;
          display: flex;
          align-items: center;
        }
        
        .answer-section h2::before {
          content: "💡";
          margin-right: 10px;
          font-size: 24px;
        }
        
        .answer-text {
          color: #444;
          font-size: 16px;
          line-height: 1.8;
        }
        
        .answer-text strong {
          color: #2c3e50;
          font-weight: 600;
          display: inline-block;
          margin-top: 15px;
          margin-bottom: 5px;
        }
        
        .answer-text strong:first-child {
          margin-top: 0;
        }
        
        .footer {
          background: #f8f9fa;
          padding: 20px;
          text-align: center;
          color: #666;
          font-size: 14px;
          border-top: 1px solid #e9ecef;
        }
        
        .stats {
          display: flex;
          justify-content: center;
          gap: 30px;
          margin-top: 15px;
          font-size: 12px;
        }
        
        .stat-item {
          display: flex;
          align-items: center;
          gap: 5px;
        }
        
        @media (max-width: 768px) {
          body { padding: 10px; }
          .content { padding: 20px; }
          .header { padding: 20px; }
          .header h1 { font-size: 24px; }
          .stats { flex-direction: column; gap: 10px; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🧮 定軒AI數學通</h1>
          <p>專業數學解題服務</p>
        </div>
        
        <div class="content">
          <div class="question-section">
            <h2>📝 題目內容</h2>
            <div class="question-text">${formattedQuestion}</div>
          </div>
          
          <div class="answer-section">
            <h2>解題過程</h2>
            <div class="answer-text">${formattedAnswer}</div>
          </div>
        </div>
        
        <div class="footer">
          <p>感謝使用定軒AI數學通！如有其他數學問題，歡迎隨時詢問。</p>
          <div class="stats">
            <div class="stat-item">
              <span>📅</span>
              <span>創建時間：${new Date(solution.createdAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</span>
            </div>
            <div class="stat-item">
              <span>👀</span>
              <span>查看次數：${solution.viewCount}</span>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// 健康檢查端點
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 404 處理
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: '找不到頁面',
    message: '請檢查 URL 是否正確' 
  });
});

// 錯誤處理中介軟體
app.use((error, req, res, next) => {
  console.error('未處理的錯誤:', error);
  res.status(500).json({
    error: '伺服器內部錯誤',
    message: '請稍後再試或聯繫技術支援'
  });
});

// 啟動伺服器
const startServer = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`🚀 數學解題網頁服務已啟動`);
    console.log(`📡 服務運行在端口: ${PORT}`);
    console.log(`🌐 網域: ${process.env.WEB_DOMAIN || 'http://localhost:' + PORT}`);
    console.log(`⏰ 啟動時間: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
  });
};

// 優雅關閉
process.on('SIGTERM', () => {
  console.log('收到 SIGTERM 信號，正在關閉伺服器...');
  mongoose.connection.close(() => {
    console.log('資料庫連接已關閉');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('收到 SIGINT 信號，正在關閉伺服器...');
  mongoose.connection.close(() => {
    console.log('資料庫連接已關閉');
    process.exit(0);
  });
});

startServer().catch(console.error);
