import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import express from "express";
import fs from "fs/promises";
import path from "path";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

const KNOWLEDGE_PATH = path.join(process.cwd(), "knowledge.json");

async function ensureKnowledgeFile() {
  try {
    await fs.access(KNOWLEDGE_PATH);
  } catch {
    await fs.writeFile(KNOWLEDGE_PATH, JSON.stringify({ learnedRules: [] }, null, 2));
  }
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Hàm hỗ trợ gọi Gemini với cơ chế thử lại và chuyển đổi mô hình dự phòng khi gặp lỗi
async function generateContentWithRetryAndFallback(prompt: string): Promise<string> {
  const modelsToTry = [
    "gemini-2.5-flash",      // Mô hình chuẩn vàng: Cực kỳ ổn định, hỗ trợ tiếng Việt và định dạng JSON tuyệt vời
    "gemini-3.5-flash",      // Mô hình thế hệ mới
    "gemini-2.0-flash",      // Mô hình tốc độ cao và ổn định
    "gemini-flash-latest",   // Phiên bản ổn định mới nhất của dòng Flash
    "gemini-3.1-flash-lite", // Phiên bản siêu nhẹ
    "gemini-3-flash-preview"
  ];
  let lastError: any = null;

  for (const modelName of modelsToTry) {
    let retries = 3;
    let delay = 1500; // Khởi đầu 1.5 giây

    while (retries > 0) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            temperature: 0.1,
            responseMimeType: "application/json"
          }
        });

        if (response && response.text) {
          return response.text;
        }
        throw new Error("Phản hồi từ mô hình AI bị trống");
      } catch (err: any) {
        lastError = err;
        let statusCode = err.status || err.error?.code;
        
        // Kiểm tra mã lỗi từ thông điệp nếu không có thuộc tính code trực tiếp
        if (!statusCode && err.message) {
          if (err.message.includes("429") || err.message.includes("quota") || err.message.includes("RESOURCE_EXHAUSTED")) {
            statusCode = 429;
          } else if (err.message.includes("503") || err.message.includes("UNAVAILABLE")) {
            statusCode = 503;
          } else if (err.message.includes("500") || err.message.includes("INTERNAL")) {
            statusCode = 500;
          }
        }
        
        // Ghi nhận cảnh báo lỗi
        console.warn(`Lỗi khi gọi mô hình ${modelName} (Số lượt thử lại còn lại: ${retries - 1}, Mã lỗi: ${statusCode}):`, err.message || err);

        // Đối với lỗi 500 (INTERNAL) hoặc 503 (UNAVAILABLE/High Demand): Thường là sự cố hạ tầng cố định 
        // hoặc quá tải cục bộ của từng dòng mô hình, việc cố thử lại liên tiếp chỉ làm chậm hệ thống.
        // Lập tức break để chuyển sang mô hình dự phòng tiếp theo nhằm bảo đảm trải nghiệm mượt mà.
        if (statusCode === 500 || statusCode === 503) {
          console.warn(`Gặp lỗi ${statusCode} (quá tải hoặc lỗi hệ thống) tại mô hình ${modelName}. Chuyển hướng lập tức sang mô hình dự phòng kế tiếp...`);
          break;
        }

        // Thử lại nếu gặp lỗi 429 (Quota)
        if (statusCode === 429) {
          retries--;
          if (retries > 0) {
            console.log(`Đang đợi ${delay}ms trước khi thử lại mô hình ${modelName}...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= 2; // Tăng dần thời gian chờ luỹ tiến
            continue;
          }
        }
        
        // Với các lỗi định cấu hình khác hoặc khi đã hết lượt thử của mô hình hiện tại, chuyển sang model kế tiếp
        break;
      }
    }
  }

  // Giữ nguyên lỗi cuối cùng nếu có để ném ra ngoài
  const finalError = new Error(lastError?.message || "Tất cả các mô hình AI đều không phản hồi") as any;
  if (lastError?.status) finalError.status = lastError.status;
  throw finalError;
}

app.post("/api/proofread", async (req, res) => {
  try {
    const { text, mode, learnedContext } = req.body;
    if (!text) return res.json({ errors: [] });

    // Đọc kiến thức đã học
    const knowledgeData = JSON.parse(await fs.readFile(KNOWLEDGE_PATH, "utf-8"));
    const knowledgeString = knowledgeData.learnedRules.join("\n");

    // Hàm xử lý từng đoạn văn bản
    const processChunk = async (chunkText: string) => {
      const prompt = `
        Bạn là một chuyên gia rà soát lỗi văn bản hành chính Việt Nam và văn bản Đảng cấp cao.
        Công cụ: "Word tự học by Cường".
        
        NHIỆM VỤ: Rà soát văn bản và trả về JSON Array các lỗi.
        
        QUY ĐỊNH:
        - Chế độ: ${mode} (NĐ 30: Nghị định 30/2020/NĐ-CP; HD 36: Hướng dẫn 36-HD/VPTW).
        - Chính tả/Ngữ pháp: Sửa lỗi chính tả, viết hoa.
        - Văn phong: Trang trọng, hành chính công vụ.
        - Kiến thức tự học: ${knowledgeString}
        - Lỗi Logic/Quy chuẩn: Sai cấp bậc (Bỏ huyện từ 01/7/2025).

        ĐẦU RA (JSON Array): [{"text": "...", "error": "...", "suggestion": "...", "type": "..."}]

        VĂN BẢN CẦN SOÁT:
        """
        ${chunkText}
        """
      `;

      const responseText = await generateContentWithRetryAndFallback(prompt);

      try {
        return JSON.parse(responseText);
      } catch (e) {
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      }
    };

    // Chia nhỏ văn bản thành các đoạn lớn (khoảng 15000 ký tự) để giảm số lượng request
    const chunkSize = 15000;
    const chunks: string[] = [];
    let currentPos = 0;

    while (currentPos < text.length) {
      let nextPos = currentPos + chunkSize;
      if (nextPos < text.length) {
        // Tìm điểm ngắt đoạn gần nhất để không ngắt giữa câu
        const lastNewline = text.lastIndexOf("\n", nextPos);
        if (lastNewline > currentPos) {
          nextPos = lastNewline;
        } else {
          const lastPeriod = text.lastIndexOf(". ", nextPos);
          if (lastPeriod > currentPos) nextPos = lastPeriod + 1;
        }
      }
      chunks.push(text.substring(currentPos, nextPos).trim());
      currentPos = nextPos;
    }

    // Xử lý tuần tự thay vì song song để tránh lỗi 429
    const errors = [];
    let lastChunkError: any = null;
    for (const chunk of chunks) {
      try {
        const result = await processChunk(chunk);
        if (Array.isArray(result)) {
          errors.push(...result);
        }
      } catch (chunkError: any) {
        console.error("Error processing chunk:", chunkError);
        lastChunkError = chunkError;
        if (chunkError.status === 429) {
          return res.status(429).json({ 
            errors, 
            warning: "Văn bản quá dài và đã chạm giới hạn API." 
          });
        }
        // Tiếp tục các đoạn khác nếu lỗi không phải do giới hạn
      }
    }

    if (errors.length === 0 && lastChunkError) {
      throw lastChunkError;
    }
    
    return res.json({ errors });
  } catch (error: any) {
    console.error("Error proofreading:", error);
    if (error.status === 429) {
       return res.status(429).json({ error: "Giới hạn yêu cầu đã hết. Vui lòng đợi một lát rồi thử lại." });
    }
    res.status(error.status || 500).json({ error: error.message || "Lỗi hệ thống khi rà soát văn bản" });
  }
});

app.post("/api/learn", async (req, res) => {
  try {
    const { content } = req.body;
    const data = JSON.parse(await fs.readFile(KNOWLEDGE_PATH, "utf-8"));
    data.learnedRules.push(content);
    await fs.writeFile(KNOWLEDGE_PATH, JSON.stringify(data, null, 2));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Learning failed" });
  }
});

// Thiết lập Error Handler toàn cục bảo đảm KHÔNG bao giờ trả về HTML cho các yêu cầu API
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Global Express Error Handler:", err);
  if (res.headersSent) {
    return next(err);
  }
  if (req.path.startsWith("/api/")) {
    return res.status(err.status || 500).json({
      error: err.message || "Đã xảy ra lỗi không xác định từ máy chủ rà soát lỗi"
    });
  }
  next(err);
});

async function startServer() {
  await ensureKnowledgeFile();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
