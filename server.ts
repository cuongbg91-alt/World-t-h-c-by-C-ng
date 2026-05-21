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
  if (!process.env.GEMINI_API_KEY) {
    const keyError = new Error(
      "Cơ sở dữ liệu đang thiếu cấu hình khoá bảo mật (GEMINI_API_KEY). Quý khách hãy thiết lập API Key trong phần Settings (góc trên cùng bên phải giao diện ứng dụng) để tiếp tục."
    ) as any;
    keyError.status = 401;
    throw keyError;
  }

  const modelsToTry = [
    "gemini-3.5-flash",      // Mô hình thế hệ mới nhất, thông minh vượt trội, cực kỳ ổn định và ưu việt cho rà soát JSON
    "gemini-3.1-flash-lite", // Bản siêu nhẹ, độ trễ cực thấp, hạn mức (Quota) rất lớn, dự phòng chống nghẽn lý tưởng
    "gemini-2.5-flash",      // Mô hình thế hệ mới, bổ sung phương án dự phòng hiệu năng cao
    "gemini-flash-latest",   // Phiên bản Flash ổn định kinh điển, dự phòng an toàn cuối cùng
  ];
  let lastError: any = null;

  for (const modelName of modelsToTry) {
    let retries = 2; // Giảm xuống 2 để chuyển đổi mô hình nhanh hơn nếu gặp lỗi
    let delay = 1000;

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
        
        // Ghi nhận cảnh báo lỗi nhẹ nhàng, không in toàn bộ stack trace JSON cồng kềnh
        const shortMsg = err.message ? (err.message.substring(0, 150) + "...") : err;
        console.warn(`[Gemini Fallback Window] Gọi mô hình ${modelName} gặp sự cố (Mã lỗi: ${statusCode || "unknown"}). Chi tiết: ${shortMsg}`);

        // Đối với lỗi 500 hoặc 503 hoặc 429 quá tải: chuyển ngay sang mô hình dự phòng tiếp theo
        if (statusCode === 500 || statusCode === 503) {
          break;
        }

        if (statusCode === 429) {
          const isModelQuotaExceeded = err.message && (
            err.message.toLowerCase().includes("quota") || 
            err.message.toLowerCase().includes("resource_exhausted") || 
            err.message.toLowerCase().includes("limit") ||
            err.message.toLowerCase().includes("exceeded")
          );

          if (isModelQuotaExceeded) {
            console.warn(`Mô hình ${modelName} hết hạn mức (Quota). Chuyển sang mô hình tiếp theo ngay lập tức...`);
            break; 
          }

          retries--;
          if (retries > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= 1.5;
            continue;
          }
        }
        
        break;
      }
    }
  }

  if (lastError) {
    const errorMsg = (lastError.message || String(lastError)).toLowerCase();
    if (errorMsg.includes("api_key_invalid") || errorMsg.includes("invalid api key") || errorMsg.includes("key is invalid") || errorMsg.includes("key_invalid")) {
      const authError = new Error(
        "Khóa bảo mật GEMINI_API_KEY không chính xác hoặc đã hết hiệu lực. Quý khách vui lòng kiểm tra lại cấu hình API Key trong mục Settings."
      ) as any;
      authError.status = 401;
      throw authError;
    }
  }

  // Thay vì trả về lỗi JSON thô kệch, trả về thông báo tiếng Việt lịch sự và dễ hiểu cho người dùng
  const finalError = new Error(
    "Hệ thống rà soát hiện đang bận hoặc đạt giới hạn lưu lượng dùng thử (API Quota Limit). Vui lòng đợi khoảng 1 phút rồi nhấn rà soát lại văn bản."
  ) as any;
  finalError.status = 429;
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
    const knowledgeRulesList = (knowledgeData.learnedRules || []).map((rule: any) => {
      if (typeof rule === "string") {
        return rule;
      }
      return `[Nguồn: ${rule.source || "Thủ công"}] Thể loại: ${rule.category || "Chung"}. Quy tắc định dạng hoặc ngữ pháp: ${rule.content}`;
    });
    const knowledgeString = knowledgeRulesList.slice(0, 50).join("\n");

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
    } else if (insideString && char === '\t') {
      result += " "; // Thay thế tab thực tế bằng khoảng trắng để tránh lỗi cú pháp JSON
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

async function generateContentForLearning(prompt: string): Promise<string> {
  if (!process.env.GEMINI_API_KEY) {
    const keyError = new Error("Cơ sở dữ liệu đang thiếu cấu hình khoá bảo mật (GEMINI_API_KEY).") as any;
    keyError.status = 401;
    throw keyError;
  }

  const modelsToTry = [
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
    "gemini-flash-latest"
  ];
  let lastError: any = null;

  for (const modelName of modelsToTry) {
    let retries = 2;
    while (retries > 0) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  category: {
                    type: Type.STRING,
                    description: "Thể loại quy tắc (ví dụ: Định dạng, Chính tả & Ngữ pháp, Văn phong, Logic)."
                  },
                  content: {
                    type: Type.STRING,
                    description: "Nội dung chi tiết súc tích, thực tiễn nhất của quy tắc học được từ nguồn."
                  }
                },
                required: ["category", "content"]
              }
            }
          }
        });

        if (response && response.text) {
          return response.text;
        }
        throw new Error("Phản hồi tự học bị trống");
      } catch (err: any) {
        lastError = err;
        retries--;
        if (retries > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }
  }

  throw lastError || new Error("Không thể gọi thư viện AI để học quy chuẩn.");
}

app.post("/api/learn", async (req, res) => {
  try {
    const { content } = req.body;
    const data = JSON.parse(await fs.readFile(KNOWLEDGE_PATH, "utf-8"));
    const newRule = {
      id: `${Math.random().toString(36).substring(2, 9)}-${Date.now()}`,
      category: "Quy chuẩn",
      source: "Xử lý thủ công",
      content,
      createdAt: new Date().toISOString()
    };
    data.learnedRules.push(newRule);
    await fs.writeFile(KNOWLEDGE_PATH, JSON.stringify(data, null, 2));
    res.json({ success: true, rule: newRule });
  } catch (error) {
    res.status(500).json({ error: "Learning failed" });
  }
});

app.get("/api/learned-rules", async (req, res) => {
  try {
    const data = JSON.parse(await fs.readFile(KNOWLEDGE_PATH, "utf-8"));
    const list = data.learnedRules || [];
    
    // Bảo vệ & chuẩn hóa dữ liệu cũ (nếu có chuỗi thường) sang đối tượng có cấu trúc
    let modified = false;
    const structuredList = list.map((item: any) => {
      if (typeof item === "string") {
        modified = true;
        return {
          id: `${Math.random().toString(36).substring(2, 9)}-${Date.now()}`,
          category: "Quy chuẩn",
          source: "Thủ công",
          content: item,
          createdAt: new Date().toISOString()
        };
      }
      if (!item.id) {
        modified = true;
        item.id = `${Math.random().toString(36).substring(2, 9)}-${Date.now()}`;
      }
      return item;
    });

    if (modified) {
      data.learnedRules = structuredList;
      await fs.writeFile(KNOWLEDGE_PATH, JSON.stringify(data, null, 2));
    }

    res.json({ success: true, learnedRules: structuredList });
  } catch (error) {
    res.status(500).json({ error: "Không thể lấy danh sách kiến thức đã học." });
  }
});

app.post("/api/learned-rules", async (req, res) => {
  try {
    const { content, category, source } = req.body;
    if (!content) {
      return res.status(400).json({ error: "Nội dung quy định không được để trống." });
    }

    const data = JSON.parse(await fs.readFile(KNOWLEDGE_PATH, "utf-8"));
    if (!data.learnedRules) {
      data.learnedRules = [];
    }

    const newRule = {
      id: `${Math.random().toString(36).substring(2, 9)}-${Date.now()}`,
      category: category || "Quy chuẩn",
      source: source || "Thủ công",
      content,
      createdAt: new Date().toISOString()
    };

    data.learnedRules.push(newRule);
    await fs.writeFile(KNOWLEDGE_PATH, JSON.stringify(data, null, 2));
    res.json({ success: true, rule: newRule });
  } catch (error) {
    res.status(500).json({ error: "Không thể thêm quy trình tự học mới." });
  }
});

app.put("/api/learned-rules/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { content, category, source } = req.body;
    
    const data = JSON.parse(await fs.readFile(KNOWLEDGE_PATH, "utf-8"));
    const list = data.learnedRules || [];
    
    const index = list.findIndex((r: any) => r && r.id === id);
    if (index === -1) {
      return res.status(404).json({ error: "Không tìm thấy quy tắc cần cập nhật." });
    }

    list[index] = {
      ...list[index],
      content: content !== undefined ? content : list[index].content,
      category: category !== undefined ? category : list[index].category,
      source: source !== undefined ? source : list[index].source,
      updatedAt: new Date().toISOString()
    };

    data.learnedRules = list;
    await fs.writeFile(KNOWLEDGE_PATH, JSON.stringify(data, null, 2));
    res.json({ success: true, rule: list[index] });
  } catch (error) {
    res.status(500).json({ error: "Cập nhật quy tắc thất bại." });
  }
});

app.delete("/api/learned-rules/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const data = JSON.parse(await fs.readFile(KNOWLEDGE_PATH, "utf-8"));
    const list = data.learnedRules || [];
    
    const filtered = list.filter((r: any) => r && r.id !== id);
    data.learnedRules = filtered;
    
    await fs.writeFile(KNOWLEDGE_PATH, JSON.stringify(data, null, 2));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Xóa quy tắc thất bại." });
  }
});

app.post("/api/analyze-and-learn", async (req, res) => {
  try {
    const { source } = req.body;
    if (!source) {
      return res.status(400).json({ error: "Thiếu thông tin nguồn tài liệu học." });
    }

    const prompt = `
      Bạn là một AI chuyên gia huấn luyện hành chính công vụ Việt Nam chuyên sâu về Hướng dẫn 36, Nghị định 30, chinhphu.vn, dienbien.gov.vn.
      Hãy phân tích nguồn quy chuẩn tài liệu: "${source}"
      Hãy đúc kết ra đúng 2 đến 3 quy tắc thiết thực về mặt Định dạng (font chữ Times New Roman, độ thụt đầu dòng lề lùi dòng indentation, giãn dòng giãn khoảng cách spacing, cách gõ phím tab) hoặc chính tả quy định viết hoa, cách dùng từ hành chính địa phương Việt Nam đặc thù của nguồn này.
      Các quy luật cần rất súc tích, thực tiễn có tính áp dụng cực kỳ cao để rà soát văn bản bằng AI ở các lần sau.

      YÊU CẦU ĐẦU RA:
      Trả về danh sách 2-3 đối tượng quy tắc dưới dạng JSON Array (chỉ chứa mảng các quy tắc, tuân theo lược đồ mẫu).
    `;

    // Gọi Gemini để học từ nguồn tài liệu này
    const responseText = await generateContentForLearning(prompt);
    const parsedRules = JSON.parse(responseText);

    const data = JSON.parse(await fs.readFile(KNOWLEDGE_PATH, "utf-8"));
    if (!data.learnedRules) {
      data.learnedRules = [];
    }

    const addedRules: any[] = [];
    if (Array.isArray(parsedRules)) {
      for (const rule of parsedRules) {
        const newRule = {
          id: `${Math.random().toString(36).substring(2, 9)}-${Date.now()}`,
          category: rule.category || "Quy chuẩn",
          source: source,
          content: rule.content || "",
          createdAt: new Date().toISOString()
        };
        data.learnedRules.push(newRule);
        addedRules.push(newRule);
      }
    }

    await fs.writeFile(KNOWLEDGE_PATH, JSON.stringify(data, null, 2));
    res.json({ success: true, addedRules });
  } catch (error: any) {
    console.error("Analysis learning failed:", error);
    res.status(500).json({ error: error.message || "Quá trình AI tự học từ nguồn này gặp sự cố." });
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
      server: { middlewareMode: true, hmr: false },
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
