import React, { useState } from "react";
import Toolbar from "./components/Toolbar";
import TextView from "./components/TextView";
import ErrorView from "./components/ErrorView";
import { parseDocx, generateDocx } from "./lib/docx-utils";

interface ErrorItem {
  text: string;
  error: string;
  suggestion: string;
  type: string;
}

export default function App() {
  const [originalText, setOriginalText] = useState("");
  const [htmlContent, setHtmlContent] = useState("");
  const [errors, setErrors] = useState<ErrorItem[]>([]);
  const [highlightedError, setHighlightedError] = useState<ErrorItem | null>(null);
  const [mode, setMode] = useState("nd30-report");
  const [isChecking, setIsChecking] = useState(false);
  const [fileName, setFileName] = useState("");
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    try {
      const { text, html, orientation: detectedOrientation } = await parseDocx(file);
      setOriginalText(text);
      setHtmlContent(html);
      setOrientation(detectedOrientation);
      setErrors([]);
    } catch (error) {
      console.error("Failed to parse docx:", error);
    }
  };

  const handleDownload = async () => {
    if (!htmlContent) return;
    const htmlToSave = document.getElementById('word-content')?.innerHTML || htmlContent;
    const outputName = fileName
      ? (fileName.endsWith('.docx') ? fileName.replace('.docx', '_da_soat.docx') : fileName + '_da_soat.docx')
      : 'van_ban_da_soat.docx';
    await generateDocx(htmlToSave, outputName, orientation);
  };

  const handlePasteConfirm = (text: string) => {
    if (!text.trim()) {
      alert("Vui lòng nhập hoặc dán văn bản vào ô dưới.");
      return;
    }
    
    // Tạo HTML content đơn giản từ text dán
    const html = text.split('\n').map(line => {
      const escaped = line
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<p class="text-justify">${escaped}</p>`;
    }).join('\n');

    setOriginalText(text);
    setHtmlContent(html);
    setFileName("van_ban_dan_truc_tiep.docx");
    setErrors([]);
    setOrientation("portrait");
    setIsPasteModalOpen(false);
    setPastedText("");
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setPastedText(text);
    } catch (err) {
      console.warn("Không thể truy cập Clipboard:", err);
      alert("Trình duyệt không cho phép tự động đọc clipboard. Hãy nhấn tổ hợp phím Ctrl + V (hoặc Cmd + V trên Mac) trực tiếp vào ô soạn thảo bên dưới.");
    }
  };

  const proofread = async (targetText?: string) => {
    const textToProcess = targetText || originalText;
    if (!textToProcess) return;

    setIsChecking(true);
    if (!targetText) setErrors([]);

    try {
      const response = await fetch("/api/proofread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textToProcess, mode }),
      });

      if (!response.body) {
        throw new Error("Trình duyệt không hỗ trợ đọc luồng dữ liệu.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const block = buffer.substring(0, boundary).trim();
          buffer = buffer.substring(boundary + 2);
          boundary = buffer.indexOf("\n\n");

          if (!block) continue;
          
          if (block.startsWith("data:")) {
            const jsonText = block.substring(5).trim();
            try {
              const data = JSON.parse(jsonText);
              
              if (data.type === "chunk_result") {
                if (data.errors && data.errors.length > 0) {
                  setErrors(prev => {
                    const existingKeys = new Set(prev.map(e => `${e.text}-${e.error}-${e.suggestion}`));
                    const uniqueNew = data.errors.filter((e: any) => !existingKeys.has(`${e.text}-${e.error}-${e.suggestion}`));
                    return [...prev, ...uniqueNew];
                  });
                }
              } else if (data.type === "warning") {
                alert(`Cảnh báo: ${data.message}`);
              } else if (data.type === "error") {
                alert(`Lỗi rà soát: ${data.error}`);
              }
            } catch (jsonErr) {
              console.error("Lỗi phân tích cú pháp sự kiện luồng dữ liệu:", jsonErr, jsonText);
            }
          }
        }
      }

      // Xử lý nốt dữ liệu sót trong buffer nếu có
      if (buffer.trim() && buffer.startsWith("data:")) {
        const jsonText = buffer.substring(5).trim();
        try {
          const data = JSON.parse(jsonText);
          if (data.type === "chunk_result" && data.errors && data.errors.length > 0) {
            setErrors(prev => {
              const existingKeys = new Set(prev.map(e => `${e.text}-${e.error}-${e.suggestion}`));
              const uniqueNew = data.errors.filter((e: any) => !existingKeys.has(`${e.text}-${e.error}-${e.suggestion}`));
              return [...prev, ...uniqueNew];
            });
          } else if (data.type === "error") {
             alert(`Lỗi rà soát: ${data.error}`);
          }
        } catch (_) {}
      }
    } catch (error) {
      console.error("Error proofreading:", error);
      alert("Đã xảy ra lỗi khi kết nối với máy chủ AI.");
    } finally {
      setIsChecking(false);
    }
  };

  const proofreadSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.toString()) {
      proofread(selection.toString());
    } else {
      alert("Vui lòng bôi đen vùng văn bản cần rà soát.");
    }
  };

  const fixItem = (index: number) => {
    const error = errors[index];
    // Sử dụng Regex để thay thế chính xác cụm từ lỗi
    const escapedText = error.text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(escapedText, 'g');
    
    const correctedHtml = `<span class="corrected-term bg-green-50 text-emerald-600 font-bold border-b border-solid border-emerald-600" title="Đã sửa từ lỗi '${error.text}': ${error.error}">${error.suggestion}</span>`;
    
    setHtmlContent(prev => prev.replace(regex, correctedHtml));
    setOriginalText(prev => prev.replace(regex, error.suggestion));
    setErrors(prev => prev.filter((_, i) => i !== index));
  };

  const fixAll = () => {
    let newHtml = htmlContent;
    let newText = originalText;
    
    // Sắp xếp lỗi từ dài nhất đến ngắn nhất để tránh thay thế chồng chéo
    const sortedErrors = [...errors].sort((a, b) => b.text.length - a.text.length);

    sortedErrors.forEach(error => {
      const escapedText = error.text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(escapedText, 'g');
      const correctedHtml = `<span class="corrected-term bg-green-50 text-emerald-600 font-bold border-b border-solid border-emerald-600" title="Đã sửa từ lỗi '${error.text}': ${error.error}">${error.suggestion}</span>`;
      
      newHtml = newHtml.replace(regex, correctedHtml);
      newText = newText.replace(regex, error.suggestion);
    });

    setHtmlContent(newHtml);
    setOriginalText(newText);
    setErrors([]);
  };

  const handleLearn = async (content: string) => {
    try {
      await fetch("/api/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
    } catch (error) {
      console.error("Learning failed:", error);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
      <Toolbar 
        onUpload={handleUpload} 
        onDownload={handleDownload} 
        onSetMode={setMode} 
        currentMode={mode} 
        onPasteClick={() => setIsPasteModalOpen(true)}
      />
      <div className="flex flex-1 overflow-hidden">
        <TextView 
          htmlContent={htmlContent} 
          errors={errors} 
          highlightedError={highlightedError}
          orientation={orientation}
          onOrientationChange={setOrientation}
        />
        <ErrorView 
          errors={errors} 
          onProofread={() => proofread()} 
          onProofreadSelection={proofreadSelection}
          onFixAll={fixAll} 
          onFixItem={fixItem}
          onLinkToItem={setHighlightedError}
          onLearn={handleLearn}
          isChecking={isChecking}
        />
      </div>

      {/* Modal dán đoạn văn bản trực tiếp từ clipboard */}
      {isPasteModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in animate-duration-200">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-[650px] max-w-[95vw] border border-brand-border flex flex-col max-h-[85vh] transition-all">
            <div className="flex items-center justify-between pb-3 border-b border-brand-border mb-4">
              <h3 className="text-[15px] font-bold text-slate-800 flex items-center gap-2">
                <span className="text-lg">📋</span> Dán văn bản rà soát lỗi
              </h3>
              <button 
                onClick={() => { setIsPasteModalOpen(false); setPastedText(""); }}
                className="text-slate-400 hover:text-slate-600 p-1 text-2xl leading-none transition-all"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 min-h-0 flex flex-col mb-4">
              <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                Nhập văn bản của bạn dưới đây. AI sẽ rà soát và đánh dấu trực quan các lỗi về chính tả, cách viết hoa, văn phong, quy chuẩn Nghị định 30 hoặc Hướng dẫn 36 ngay lập tức.
              </p>
              
              <div className="flex justify-end mb-2">
                <button
                  type="button"
                  onClick={handlePasteFromClipboard}
                  className="flex items-center text-xs text-brand-primary hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg font-semibold transition-all shadow-sm border border-blue-100"
                >
                  <span className="mr-1.5">📋</span> Dán nhanh từ bộ nhớ tạm
                </button>
              </div>

              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Dán (Ctrl + V) hoặc nhập nội dung văn bản hành chính cần rà soát tại đây..."
                className="w-full h-80 flex-1 border border-brand-border rounded-lg p-4 font-sans text-[13px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-primary/25 focus:border-brand-primary resize-none placeholder-slate-400 text-slate-700"
                autoFocus
              />
            </div>

            <div className="flex gap-3 justify-end items-center border-t border-brand-border pt-4">
              <button
                onClick={() => { setIsPasteModalOpen(false); setPastedText(""); }}
                className="px-4 py-2 border border-slate-200 rounded-md hover:bg-slate-50 transition-all text-xs font-semibold text-slate-600"
              >
                Hủy bỏ
              </button>
              <button
                onClick={() => handlePasteConfirm(pastedText)}
                className="px-5 py-2 bg-brand-primary text-white hover:bg-blue-700 rounded-md transition-all text-xs font-semibold shadow-sm"
              >
                Xác nhận rà soát
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

