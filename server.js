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
// 設定信任代理的層級，1 表示信任第一層代理
app.set('trust proxy', 1);

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
  message: '請求過於頻繁，請稍後再試',
  // 明確指定信任代理設定，避免安全警告
  trustProxy: 1,
  // 自定義 key 生成器，確保正確識別用戶
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress;
  }
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

// 學生資料模型
const studentSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  lineUserId: { type: String, unique: true, required: true },
  firstQuestionDate: { type: Date, default: Date.now },
  lastQuestionDate: { type: Date, default: Date.now },
  totalQuestions: { type: Number, default: 0 },
  subjects: [String], // 學過的科目
  topics: [String],   // 學過的主題
  createdAt: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true }
});

// 教師資料模型
const teacherSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  lineUserId: { type: String, unique: true, required: true },
  role: { type: String, enum: ['admin', 'teacher'], default: 'teacher' },
  permissions: [String], // 權限列表
  createdAt: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true }
});

// 主題資料模型
const topicSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  subject: { type: String, required: true },
  description: { type: String },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
  questionCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// 擴展數學解題資料模型
const solutionSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  question: { type: String, required: true },
  answer: { type: String, required: true },
  
  // 新增關聯欄位
  studentId: { type: String, ref: 'Student' },
  studentName: { type: String, required: true },
  subject: { type: String, required: true },
  topic: { type: String, required: true },
  
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }, // 30天後過期
  viewCount: { type: Number, default: 0 }
});

// 創建資料模型
const Student = mongoose.model('Student', studentSchema);
const Teacher = mongoose.model('Teacher', teacherSchema);
const Topic = mongoose.model('Topic', topicSchema);
const Solution = mongoose.model('Solution', solutionSchema);

// 從解題記錄的 answer 欄位中提取學生資訊
function extractStudentInfo(answer) {
  const studentMatch = answer.match(/學生名稱:\s*([^\n]+)/);
  const subjectMatch = answer.match(/學科:\s*([^\n]+)/);
  const topicMatch = answer.match(/主題:\s*([^\n]+)/);
  
  // 如果沒有找到結構化資訊，嘗試從問題內容推斷主題
  let topic = topicMatch ? topicMatch[1].trim() : '未知';
  
  if (topic === '未知' && answer) {
    // 簡單的主題推斷邏輯
    if (answer.includes('三角形') || answer.includes('勾股') || answer.includes('直角')) {
      topic = '三角形';
    } else if (answer.includes('一次函數') || answer.includes('截距') || answer.includes('mx')) {
      topic = '一次函數';
    } else if (answer.includes('二次函數') || answer.includes('拋物線') || answer.includes('頂點')) {
      topic = '二次函數';
    } else if (answer.includes('坐標') || answer.includes('平移') || answer.includes('圖形')) {
      topic = '坐標平面';
    } else if (answer.includes('機率') || answer.includes('統計')) {
      topic = '機率統計';
    }
  }
  
  return {
    studentName: studentMatch ? studentMatch[1].trim() : '匿名',
    subject: subjectMatch ? subjectMatch[1].trim() : '數學',
    topic: topic
  };
}

// 創建或更新學生記錄
async function createOrUpdateStudent(studentName, lineUserId, subject, topic) {
  try {
    let student = await Student.findOne({ lineUserId: lineUserId });
    
    if (!student) {
      // 創建新學生
      student = new Student({
        id: uuidv4(),
        name: studentName,
        lineUserId: lineUserId,
        subjects: [subject],
        topics: [topic],
        totalQuestions: 1
      });
      console.log(`創建新學生: ${studentName}`);
    } else {
      // 更新現有學生資料
      if (!student.subjects.includes(subject)) {
        student.subjects.push(subject);
      }
      if (!student.topics.includes(topic)) {
        student.topics.push(topic);
      }
      student.lastQuestionDate = new Date();
      student.totalQuestions += 1;
      console.log(`更新學生: ${studentName}, 總問題數: ${student.totalQuestions}`);
    }
    
    await student.save();
    return student;
  } catch (error) {
    console.error('創建或更新學生記錄時發生錯誤:', error);
    return null;
  }
}

// 創建預設教師
async function createDefaultTeacher() {
  try {
    const teacherLineId = process.env.TEACHER_LINE_ID;
    if (!teacherLineId) {
      console.log('未設定 TEACHER_LINE_ID，跳過創建預設教師');
      return;
    }
    
    const existingTeacher = await Teacher.findOne({ lineUserId: teacherLineId });
    
    if (!existingTeacher) {
      const teacher = new Teacher({
        id: uuidv4(),
        name: '定軒老師',
        lineUserId: teacherLineId,
        role: 'admin',
        permissions: ['view_all', 'manage_students', 'view_dashboard']
      });
      
      await teacher.save();
      console.log('預設教師已創建');
    } else {
      console.log('教師已存在');
    }
  } catch (error) {
    console.error('創建預設教師時發生錯誤:', error);
  }
}

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

// 教師身份驗證中介軟體
const validateTeacherAuth = async (req, res, next) => {
  try {
    const teacherId = req.headers['x-teacher-id'] || req.query.teacherId;
    
    if (!teacherId) {
      return res.status(401).json({ 
        error: '未授權的請求',
        message: '請提供教師 ID' 
      });
    }
    
    const teacher = await Teacher.findOne({ lineUserId: teacherId, isActive: true });
    
    if (!teacher) {
      return res.status(403).json({ 
        error: '權限不足',
        message: '教師身份驗證失敗' 
      });
    }
    
    req.teacher = teacher;
    next();
  } catch (error) {
    console.error('教師身份驗證時發生錯誤:', error);
    res.status(500).json({ 
      error: '伺服器內部錯誤',
      message: '身份驗證失敗' 
    });
  }
};

// 路由：創建新的數學解題網頁
app.post('/api/create-solution', validateApiKey, async (req, res) => {
  try {
    const { question, answer, lineUserId } = req.body;
    
    if (!question || !answer) {
      return res.status(400).json({
        error: '缺少必要參數',
        message: '請提供 question 和 answer 參數'
      });
    }
    
    // 從 answer 中提取學生資訊
    const { studentName, subject, topic } = extractStudentInfo(answer);
    
    // 生成唯一 ID
    const solutionId = uuidv4();
    
    // 儲存到資料庫
    const solution = new Solution({
      id: solutionId,
      question: question.trim(),
      answer: answer.trim(),
      studentName: studentName,
      subject: subject,
      topic: topic
    });
    
    await solution.save();
    
    // 如果有 lineUserId，創建或更新學生記錄
    if (lineUserId) {
      await createOrUpdateStudent(studentName, lineUserId, subject, topic);
      
      // 更新 solution 的 studentId
      const student = await Student.findOne({ lineUserId: lineUserId });
      if (student) {
        solution.studentId = student.id;
        await solution.save();
      }
    }
    
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

// 生成教師 Dashboard 頁面
function generateTeacherDashboard(date, teacherId) {
  return `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>教師 Dashboard - 定軒AI數學通</title>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet">
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body { 
          font-family: 'Noto Sans TC', sans-serif; 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          padding: 20px;
          line-height: 1.6;
        }
        
        .dashboard-container { 
          max-width: 1200px; 
          margin: 0 auto; 
          background: white; 
          border-radius: 20px; 
          box-shadow: 0 20px 40px rgba(0,0,0,0.1);
          overflow: hidden;
        }
        
        .dashboard-header {
          background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
          color: white;
          padding: 30px;
          text-align: center;
        }
        
        .dashboard-header h1 {
          font-size: 28px;
          font-weight: 700;
          margin-bottom: 10px;
        }
        
        .date-selector {
          margin-top: 20px;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 10px;
        }
        
        .date-selector input {
          padding: 8px 12px;
          border: none;
          border-radius: 8px;
          font-size: 16px;
        }
        
        .date-selector button {
          padding: 8px 16px;
          background: rgba(255,255,255,0.2);
          color: white;
          border: 1px solid rgba(255,255,255,0.3);
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
        }
        
        .dashboard-content {
          padding: 30px;
        }
        
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        
        .stat-card {
          background: #f8f9ff;
          padding: 20px;
          border-radius: 15px;
          border-left: 5px solid #4facfe;
        }
        
        .stat-card h3 {
          color: #333;
          margin-bottom: 15px;
          font-size: 18px;
        }
        
        .stat-item {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
          color: #555;
        }
        
        .chart-card {
          background: white;
          padding: 20px;
          border-radius: 15px;
          border: 2px solid #e9ecef;
          text-align: center;
        }
        
        .chart-card h3 {
          color: #333;
          margin-bottom: 20px;
          font-size: 18px;
        }
        
        .students-section {
          margin-top: 30px;
        }
        
        .students-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 15px;
          margin-top: 20px;
        }
        
        .student-card {
          background: #f8f9fa;
          padding: 15px;
          border-radius: 10px;
          border: 1px solid #e9ecef;
          cursor: pointer;
          transition: all 0.3s ease;
        }
        
        .student-card:hover {
          background: #e9ecef;
          transform: translateY(-2px);
        }
        
        .student-name {
          font-weight: 600;
          color: #333;
          margin-bottom: 5px;
        }
        
        .student-count {
          color: #4facfe;
          font-size: 14px;
          margin-bottom: 5px;
        }
        
        .student-topics {
          color: #666;
          font-size: 12px;
        }
        
        .loading {
          text-align: center;
          padding: 40px;
          color: #666;
        }
        
        .modal {
          display: none;
          position: fixed;
          z-index: 1000;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0,0,0,0.5);
        }
        
        .modal-content {
          background-color: white;
          margin: 5% auto;
          padding: 20px;
          border-radius: 15px;
          width: 90%;
          max-width: 800px;
          max-height: 80vh;
          overflow-y: auto;
        }
        
        .close {
          color: #aaa;
          float: right;
          font-size: 28px;
          font-weight: bold;
          cursor: pointer;
        }
        
        .close:hover {
          color: black;
        }
        
        @media (max-width: 768px) {
          .dashboard-content { padding: 20px; }
          .stats-grid { grid-template-columns: 1fr; }
          .students-grid { grid-template-columns: 1fr; }
        }
      </style>
    </head>
    <body>
      <div class="dashboard-container">
        <div class="dashboard-header">
          <h1>🎓 定軒AI數學通 - 教師版</h1>
          <p>📊 學習統計 Dashboard</p>
          <div class="date-selector">
            <input type="date" id="datePicker" value="${date}">
            <button onclick="loadDashboard()">更新數據</button>
          </div>
        </div>
        
        <div class="dashboard-content">
          <div id="loading" class="loading">
            <p>🔄 載入中...</p>
          </div>
          
          <div id="dashboard" style="display: none;">
            <div class="stats-grid">
              <div class="stat-card">
                <h3>📊 基本統計</h3>
                <div class="stat-item">
                  <span>總提問數：</span>
                  <span id="totalQuestions">0</span>
                </div>
                <div class="stat-item">
                  <span>活躍學生：</span>
                  <span id="activeStudents">0</span>
                </div>
                <div class="stat-item">
                  <span>平均/小時：</span>
                  <span id="averagePerHour">0</span>
                </div>
              </div>
              
              <div class="chart-card">
                <h3>🥧 主題分布</h3>
                <canvas id="topicChart" width="300" height="300"></canvas>
              </div>
            </div>
            
            <div class="students-section">
              <h3>👥 學生活躍度</h3>
              <div id="studentsGrid" class="students-grid"></div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 學生詳細模態框 -->
      <div id="studentModal" class="modal">
        <div class="modal-content">
          <span class="close" onclick="closeModal()">&times;</span>
          <div id="modalContent"></div>
        </div>
      </div>
      
      <script>
        let topicChart = null;
        const teacherId = '${teacherId}';
        
        // 載入 Dashboard 數據
        async function loadDashboard() {
          const date = document.getElementById('datePicker').value;
          document.getElementById('loading').style.display = 'block';
          document.getElementById('dashboard').style.display = 'none';
          
          try {
            const response = await fetch(\`/api/teacher/dashboard/\${date}\`, {
              headers: { 'x-teacher-id': teacherId }
            });
            
            if (!response.ok) {
              throw new Error('載入失敗');
            }
            
            const data = await response.json();
            updateDashboard(data);
            
            document.getElementById('loading').style.display = 'none';
            document.getElementById('dashboard').style.display = 'block';
          } catch (error) {
            console.error('載入數據失敗:', error);
            document.getElementById('loading').innerHTML = '<p>❌ 載入失敗，請稍後再試</p>';
          }
        }
        
        // 更新 Dashboard 顯示
        function updateDashboard(data) {
          const stats = data.statistics;
          
          // 更新基本統計
          document.getElementById('totalQuestions').textContent = stats.totalQuestions;
          document.getElementById('activeStudents').textContent = stats.activeStudents;
          document.getElementById('averagePerHour').textContent = stats.averagePerHour;
          
          // 更新圓餅圖
          updateTopicChart(stats.topics);
          
          // 更新學生列表
          updateStudentsList(stats.students);
        }
        
        // 更新主題圓餅圖
        function updateTopicChart(topics) {
          const ctx = document.getElementById('topicChart').getContext('2d');
          
          if (topicChart) {
            topicChart.destroy();
          }
          
          const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'];
          
          topicChart = new Chart(ctx, {
            type: 'pie',
            data: {
              labels: topics.map(t => t.name),
              datasets: [{
                data: topics.map(t => t.count),
                backgroundColor: colors.slice(0, topics.length),
                borderWidth: 2,
                borderColor: '#fff'
              }]
            },
            options: {
              responsive: true,
              plugins: {
                legend: {
                  position: 'bottom',
                  labels: {
                    padding: 20,
                    usePointStyle: true
                  }
                }
              },
              onClick: (event, elements) => {
                if (elements.length > 0) {
                  const topicIndex = elements[0].index;
                  const topicName = topics[topicIndex].name;
                  showTopicDetails(topicName, topics[topicIndex]);
                }
              }
            }
          });
        }
        
        // 更新學生列表
        function updateStudentsList(students) {
          const grid = document.getElementById('studentsGrid');
          grid.innerHTML = students.map(student => \`
            <div class="student-card" onclick="showStudentDetails('\${student.name}')">
              <div class="student-name">\${student.name}</div>
              <div class="student-count">\${student.count} 題</div>
              <div class="student-topics">\${student.topics.join(', ')}</div>
            </div>
          \`).join('');
        }
        
        // 顯示學生詳細
        async function showStudentDetails(studentName) {
          const date = document.getElementById('datePicker').value;
          
          try {
            const response = await fetch(\`/api/teacher/student/\${encodeURIComponent(studentName)}/\${date}\`, {
              headers: { 'x-teacher-id': teacherId }
            });
            
            if (!response.ok) {
              throw new Error('載入失敗');
            }
            
            const data = await response.json();
            showStudentModal(data);
          } catch (error) {
            console.error('載入學生詳情失敗:', error);
            alert('載入學生詳情失敗');
          }
        }
        
        // 顯示學生模態框
        function showStudentModal(data) {
          const modal = document.getElementById('studentModal');
          const content = document.getElementById('modalContent');
          
          content.innerHTML = \`
            <h3>👤 \${data.studentName} - \${data.date}</h3>
            <div style="margin-top: 20px;">
              \${data.questions.map(q => \`
                <div style="margin-bottom: 15px; padding: 10px; background: #f8f9fa; border-radius: 8px;">
                  <div style="font-weight: 600; color: #333; margin-bottom: 5px;">
                    📚 \${q.topic} - \${new Date(q.time).toLocaleString('zh-TW')}
                  </div>
                  <div style="color: #666; margin-bottom: 5px;">\${q.question}</div>
                  <a href="\${q.url}" target="_blank" style="color: #4facfe; text-decoration: none;">查看解題內容 →</a>
                </div>
              \`).join('')}
            </div>
          \`;
          
          modal.style.display = 'block';
        }
        
        // 顯示主題詳情
        function showTopicDetails(topicName, topicData) {
          const modal = document.getElementById('studentModal');
          const content = document.getElementById('modalContent');
          
          content.innerHTML = \`
            <h3>📚 \${topicName}</h3>
            <div style="margin-top: 20px;">
              <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                <div style="font-weight: 600; color: #333;">📊 統計資訊</div>
                <div style="color: #666; margin-top: 5px;">
                  問題數量: \${topicData.count} 題<br>
                  占比: \${topicData.percentage}%
                </div>
              </div>
              <p style="color: #666;">點擊下方學生卡片可查看該主題的具體問題</p>
            </div>
          \`;
          
          modal.style.display = 'block';
        }
        
        // 關閉模態框
        function closeModal() {
          document.getElementById('studentModal').style.display = 'none';
        }
        
        // 點擊模態框外部關閉
        window.onclick = function(event) {
          const modal = document.getElementById('studentModal');
          if (event.target == modal) {
            modal.style.display = 'none';
          }
        }
        
        // 頁面載入時自動載入數據
        window.onload = function() {
          loadDashboard();
        };
        
        // 每30秒自動刷新數據
        setInterval(() => {
          loadDashboard();
        }, 30000);
      </script>
    </body>
    </html>
  `;
}

// 教師 Dashboard API - 今日統計
app.get('/api/teacher/dashboard/:date', validateTeacherAuth, async (req, res) => {
  try {
    const { date } = req.params;
    const startOfDay = new Date(date + 'T00:00:00+08:00');
    const endOfDay = new Date(date + 'T23:59:59+08:00');
    
    // 查詢今日解題記錄
    const solutions = await Solution.find({
      createdAt: {
        $gte: startOfDay,
        $lte: endOfDay
      }
    }).sort({ createdAt: -1 });
    
    // 統計主題分布
    const topicStats = {};
    const studentStats = {};
    const hourlyStats = {};
    
    solutions.forEach(solution => {
      // 從 answer 中提取或推斷學生資訊
      const { studentName, subject, topic } = extractStudentInfo(solution.answer);
      
      // 主題統計
      topicStats[topic] = (topicStats[topic] || 0) + 1;
      
      // 學生統計
      if (!studentStats[studentName]) {
        studentStats[studentName] = {
          name: studentName,
          count: 0,
          topics: new Set(),
          questions: []
        };
      }
      studentStats[studentName].count++;
      studentStats[studentName].topics.add(topic);
      studentStats[studentName].questions.push({
        question: solution.question,
        topic: topic,
        time: solution.createdAt,
        url: `${process.env.WEB_DOMAIN}/display/${solution.id}`
      });
      
      // 小時統計
      const hour = solution.createdAt.getHours();
      const hourKey = `${hour.toString().padStart(2, '0')}:00`;
      hourlyStats[hourKey] = (hourlyStats[hourKey] || 0) + 1;
    });
    
    // 格式化主題統計
    const topicList = Object.entries(topicStats)
      .map(([name, count]) => ({
        name,
        count,
        percentage: ((count / solutions.length) * 100).toFixed(1)
      }))
      .sort((a, b) => b.count - a.count);
    
    // 格式化學生統計
    const studentList = Object.values(studentStats)
      .map(student => ({
        name: student.name,
        count: student.count,
        topics: Array.from(student.topics),
        questions: student.questions
      }))
      .sort((a, b) => b.count - a.count);
    
    // 格式化小時統計
    const hourlyList = Object.entries(hourlyStats)
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour.localeCompare(b.hour));
    
    const totalQuestions = solutions.length;
    const activeStudents = Object.keys(studentStats).length;
    const averagePerHour = totalQuestions > 0 ? (totalQuestions / 24).toFixed(1) : 0;
    
    res.json({
      success: true,
      date: date,
      statistics: {
        totalQuestions,
        activeStudents,
        averagePerHour,
        topics: topicList,
        students: studentList,
        hourlyDistribution: hourlyList
      }
    });
    
  } catch (error) {
    console.error('查詢今日統計時發生錯誤:', error);
    res.status(500).json({
      error: '伺服器內部錯誤',
      message: '查詢失敗，請稍後再試'
    });
  }
});

// 教師 Dashboard API - 學生詳細查詢
app.get('/api/teacher/student/:studentName/:date', validateTeacherAuth, async (req, res) => {
  try {
    const { studentName, date } = req.params;
    const startOfDay = new Date(date + 'T00:00:00+08:00');
    const endOfDay = new Date(date + 'T23:59:59+08:00');
    
    const solutions = await Solution.find({
      studentName: studentName,
      createdAt: {
        $gte: startOfDay,
        $lte: endOfDay
      }
    }).sort({ createdAt: -1 });
    
    const studentQuestions = solutions.map(solution => ({
      question: solution.question,
      topic: solution.topic,
      subject: solution.subject,
      time: solution.createdAt,
      url: `${process.env.WEB_DOMAIN}/display/${solution.id}`
    }));
    
    res.json({
      success: true,
      studentName: studentName,
      date: date,
      questions: studentQuestions
    });
    
  } catch (error) {
    console.error('查詢學生詳情時發生錯誤:', error);
    res.status(500).json({
      error: '伺服器內部錯誤',
      message: '查詢失敗，請稍後再試'
    });
  }
});

// 教師 Dashboard 頁面
app.get('/teacher/dashboard/today/:teacherId', async (req, res) => {
  try {
    const { teacherId } = req.params;
    const today = new Date().toISOString().split('T')[0];
    
    // 查找或創建教師記錄
    let teacher = await Teacher.findOne({ lineUserId: teacherId, isActive: true });
    
    if (!teacher) {
      // 自動創建教師記錄
      try {
        teacher = new Teacher({
          id: uuidv4(),
          name: '教師',
          lineUserId: teacherId,
          role: 'teacher',
          permissions: ['view_dashboard', 'view_students']
        });
        
        await teacher.save();
        console.log(`自動創建教師記錄: ${teacherId}`);
      } catch (createError) {
        console.error('創建教師記錄失敗:', createError);
        return res.status(403).send(`
          <!DOCTYPE html>
          <html lang="zh-TW">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>權限不足 - 定軒AI數學通</title>
            <style>
              body { font-family: 'Noto Sans TC', sans-serif; text-align: center; padding: 50px; }
              .error { color: #e74c3c; font-size: 24px; margin-bottom: 20px; }
            </style>
          </head>
          <body>
            <div class="error">❌ 權限不足</div>
            <p>您沒有權限訪問教師 Dashboard</p>
          </body>
          </html>
        `);
      }
    }
    
    // 生成教師 Dashboard 頁面
    const dashboardHtml = generateTeacherDashboard(today, teacherId);
    res.send(dashboardHtml);
    
  } catch (error) {
    console.error('生成教師 Dashboard 時發生錯誤:', error);
    res.status(500).send('伺服器錯誤，請稍後再試');
  }
});

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
  await createDefaultTeacher();
  
  app.listen(PORT, () => {
    console.log(`🚀 數學解題網頁服務已啟動`);
    console.log(`📡 服務運行在端口: ${PORT}`);
    console.log(`🌐 網域: ${process.env.WEB_DOMAIN || 'http://localhost:' + PORT}`);
    console.log(`⏰ 啟動時間: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
    console.log(`🎓 教師系統已就緒`);
  });
};

// 優雅關閉
process.on('SIGTERM', async () => {
  console.log('收到 SIGTERM 信號，正在關閉伺服器...');
  try {
    await mongoose.connection.close();
    console.log('資料庫連接已關閉');
    process.exit(0);
  } catch (error) {
    console.error('關閉資料庫連接時發生錯誤:', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  console.log('收到 SIGINT 信號，正在關閉伺服器...');
  try {
    await mongoose.connection.close();
    console.log('資料庫連接已關閉');
    process.exit(0);
  } catch (error) {
    console.error('關閉資料庫連接時發生錯誤:', error);
    process.exit(1);
  }
});

startServer().catch(console.error);
