import { GoogleGenAI, Type } from "@google/genai";
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
    "gemini-2.5-flash",      // Mô hình chuẩn thế hệ mới: cực kỳ ổn định, hỗ trợ tiếng Việt tuyệt vời
    "gemini-2.0-flash",      // Mô hình thế hệ mới tốc độ siêu nhanh
    "gemini-1.5-flash",      // Mô hình dòng 1.5 cực kì ổn định
    "gemini-3.5-flash",      // Mô hình 3.5 mới
    "gemini-flash-latest",   // Phiên bản ổn định mới nhất của dòng Flash
    "gemini-3.1-flash-lite", // Phiên bản siêu nhẹ, độ trễ cực thấp
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
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: {
                    type: Type.STRING,
                    description: "Từ hoặc cụm từ bị lỗi gốc trong văn bản."
                  },
                  error: {
                    type: Type.STRING,
                    description: "Mô tả lý do hoặc lỗi sai quy chuẩn/chính tả."
                  },
                  suggestion: {
                    type: Type.STRING,
                    description: "Đề xuất sửa lại cho chính xác quy chuẩn."
                  },
                  type: {
                    type: Type.STRING,
                    description: "Loại lỗi (ví dụ: chính tả, viết hoa, văn phong, nghị định 30, hướng dẫn 36, quy chuẩn)."
                  }
                },
                required: ["text", "error", "suggestion", "type"]
              }
            }
          }
        });

        if (response && response.text) {
          return response.text;
        }
        throw new Error("Phản hồi từ mô hình AI bị trống");
      } catch (err: any) {
        lastError = err;
        let statusCode = err.status || err.statusCode || err.error?.code;
        
        // Thử trích xuất mã số lỗi từ chuỗi JSON hoặc thông điệp lỗi nếu không có trực tiếp
        if (!statusCode && err.message) {
          try {
            const matches = err.message.match(/"code"\s*:\s*(\d+)/) || err.message.match(/status\s*code\s*(\d+)/i);
            if (matches) {
              statusCode = parseInt(matches[1], 10);
            }
          } catch (_) {}
          
          if (!statusCode) {
            if (err.message.includes("429") || err.message.includes("quota") || err.message.includes("RESOURCE_EXHAUSTED") || err.message.includes("limit") || err.message.includes("exceeded")) {
              statusCode = 429;
            } else if (err.message.includes("503") || err.message.includes("UNAVAILABLE")) {
              statusCode = 503;
            } else if (err.message.includes("500") || err.message.includes("INTERNAL")) {
              statusCode = 500;
            }
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
          // Nếu thông điệp lỗi chứa dấu hiệu cạn kiệt hạn mức/Quota Exceeded, việc thử lại mô hình này là vô ích.
          // Chúng ta lập tức chuyển đổi sang mô hình dự phòng tiếp theo để tối ưu hóa thời gian phản hồi.
          const isModelQuotaExceeded = err.message && (
            err.message.toLowerCase().includes("quota") || 
            err.message.toLowerCase().includes("resource_exhausted") || 
            err.message.toLowerCase().includes("limit") ||
            err.message.toLowerCase().includes("exceeded")
          );

          if (isModelQuotaExceeded) {
            console.warn(`Đã cạn kiệt Quota của mô hình ${modelName}. Chuyển hướng lập tức sang cấu hình dự phòng tiếp theo...`);
            break; 
          }

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
    if (!text) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.write(`data: ${JSON.stringify({ type: "chunk_result", errors: [] })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      return res.end();
    }

    // Đọc kiến thức đã học
    const knowledgeData = JSON.parse(await fs.readFile(KNOWLEDGE_PATH, "utf-8"));
    const knowledgeString = knowledgeData.learnedRules.join("\n");

function cleanJsonNewlines(jsonStr: string): string {
  let insideString = false;
  let result = "";
  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];
    if (char === '"' && (i === 0 || jsonStr[i - 1] !== '\\')) {
      insideString = !insideString;
      result += char;
    } else if (insideString && (char === '\n' || char === '\r')) {
      result += " "; // Thay thế xuống dòng thực tế bằng khoảng trắng để tránh lỗi cú pháp JSON
    } else {
      result += char;
    }
  }
  return result;
}

function parseRobustJsonArray(text: string): any[] {
  let cleaned = text.trim();
  
  // Loại bỏ Markdown codeblock nếu có
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  // 1. Thử parse nguyên bản sau khi đã dọn dẹp ký tự xuống dòng thực tế
  try {
    const cleanStr = cleanJsonNewlines(cleaned);
    const parsed = JSON.parse(cleanStr);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
  } catch (err) {
    console.warn("JSON.parse trực tiếp thất bại, đang chuyển sang các bộ lọc phục hồi...", err);
  }

  // 2. Trích xuất tất cả các khối {...} bằng Regex nhiều dòng
  const objectRegex = /\{[\s\S]*?\}/g;
  const matches = cleaned.match(objectRegex);
  if (matches && matches.length > 0) {
    const list: any[] = [];
    for (const match of matches) {
      try {
        const cleanItemStr = cleanJsonNewlines(match);
        const item = JSON.parse(cleanItemStr);
        if (item && item.text) {
          list.push(item);
        }
      } catch (e) {
        // Thử dọn dẹp thêm các lỗi sai cấu trúc nhỏ khác nếu có thể
        try {
          let fixedMatch = match.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
          fixedMatch = cleanJsonNewlines(fixedMatch);
          const item = JSON.parse(fixedMatch);
          if (item && item.text) {
            list.push(item);
          }
        } catch (_) {}
      }
    }
    if (list.length > 0) {
      return list;
    }
  }

  // 3. Thử sửa chữa ngoặc dở dang theo thuật toán đếm ngoặc
  let repaired = cleaned;
  try {
    if (repaired.endsWith(",")) {
      repaired = repaired.substring(0, repaired.length - 1);
    }
    let openBraces = (repaired.match(/\{/g) || []).length;
    let closeBraces = (repaired.match(/\}/g) || []).length;
    let openBrackets = (repaired.match(/\[/g) || []).length;
    let closeBrackets = (repaired.match(/\]/g) || []).length;

    while (openBraces > closeBraces) {
      repaired += "}";
      closeBraces++;
    }
    while (openBrackets > closeBrackets) {
      repaired += "]";
      closeBrackets++;
    }
    
    const parsed = JSON.parse(cleanJsonNewlines(repaired));
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
  } catch (e) {
    // Thất bại
  }

  // 4. Giải pháp cuối cùng: Quét lấy tất cả các cặp thuộc tính bằng Regex
  const errors: any[] = [];
  try {
    const itemPattern = /"text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*,\s*"error"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*,\s*"suggestion"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*,\s*"type"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
    let match;
    while ((match = itemPattern.exec(cleaned)) !== null) {
      errors.push({
        text: match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
        error: match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
        suggestion: match[3].replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
        type: match[4].replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
      });
    }
  } catch (_) {}

  return errors;
}

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

      return parseRobustJsonArray(responseText);
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

    // Thiết lập headers trả về dưới dạng sự kiện truyền phát thời gian thực (SSE)
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // Xử lý tuần tự thay vì song song để tránh lỗi 429
    let totalErrorsCount = 0;
    let lastChunkError: any = null;
    for (const chunk of chunks) {
      try {
        const result = await processChunk(chunk);
        if (Array.isArray(result)) {
          totalErrorsCount += result.length;
          res.write(`data: ${JSON.stringify({ type: "chunk_result", errors: result })}\n\n`);
        }
      } catch (chunkError: any) {
        console.error("Error processing chunk:", chunkError);
        lastChunkError = chunkError;
        
        const statusCode = chunkError.status || chunkError.statusCode || chunkError.error?.code;
        if (statusCode === 429) {
          res.write(`data: ${JSON.stringify({ 
            type: "warning", 
            message: "Giới hạn yêu cầu đã hết (API Quota limit). Vui lòng đợi một lát rồi thử rà soát lại một lần nữa." 
          })}\n\n`);
          break; // Đổ bể do hết quota, không xử lý tiếp để tránh quá tải
        }
        
        res.write(`data: ${JSON.stringify({ 
          type: "warning", 
          message: `Lỗi khi xử lý một phần văn bản: ${chunkError.message || "Đã xảy ra lỗi không xác định"}` 
        })}\n\n`);
      }
    }

    if (totalErrorsCount === 0 && lastChunkError) {
      throw lastChunkError;
    }
    
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error("Error proofreading:", error);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: "error", error: error.message || "Lỗi hệ thống khi rà soát văn bản" })}\n\n`);
      return res.end();
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ type: "error", error: error.message || "Lỗi hệ thống khi rà soát văn bản" })}\n\n`);
    res.end();
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
