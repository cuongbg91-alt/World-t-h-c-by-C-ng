import React, { useState, useEffect } from "react";
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

interface HistoryItem {
  id: string;
  fileName: string;
  originalText: string;
  htmlContent: string;
  errors: ErrorItem[];
  orientation: "portrait" | "landscape";
  mode: string;
  timestamp: number;
}

function replaceTextInHtml(html: string, searchText: string, replacementHtml: string): string {
  if (typeof window === "undefined" || !html || !searchText) return html;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
    const container = doc.body.firstChild as HTMLElement;
    if (!container) return html;

    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }

    const escapedSearch = searchText.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\s+/g, '\\s+');
    const regex = new RegExp(escapedSearch, 'g');

    // Quét ngược lại để việc thay đổi cấu trúc không ảnh hưởng tới indices của các node phía trước
    for (let i = textNodes.length - 1; i >= 0; i--) {
      const node = textNodes[i];
      const text = node.textContent || "";
      if (regex.test(text)) {
        const parent = node.parentNode;
        if (!parent) continue;

        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
          // Thêm phần chữ trước khớp
          const before = text.substring(lastIndex, match.index);
          if (before) {
            fragment.appendChild(document.createTextNode(before));
          }
          // Thêm phần thay thế cho đoạn chữ khớp
          const temp = document.createElement("div");
          temp.innerHTML = replacementHtml;
          while (temp.firstChild) {
            fragment.appendChild(temp.firstChild);
          }
          lastIndex = regex.lastIndex;
        }
        // Thêm phần chữ còn lại sau khớp cuối cùng
        const after = text.substring(lastIndex);
        if (after) {
          fragment.appendChild(document.createTextNode(after));
        }
        parent.replaceChild(fragment, node);
      }
    }

    return container.innerHTML;
  } catch (err) {
    console.error("Lỗi khi thay thế text trong HTML:", err);
    // Fallback bảo vệ bằng Regex an toàn không can thiệp bên trong thẻ HTML <>
    const escapedSearch = searchText.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(?![^<]*>)(${escapedSearch})`, 'g');
    return html.replace(regex, replacementHtml);
  }
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

  // State hỗ trợ Lịch sử sử dụng và Xử lý lỗi nâng cao
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "warning" | "error" | "info"; message: string } | null>(null);

  const showToast = (type: "success" | "warning" | "error" | "info", message: string) => {
    setToast({ type, message });
    // Tự động biến mất sau 6 giây
    const timer = setTimeout(() => {
      setToast(prev => prev && prev.message === message ? null : prev);
    }, 6000);
    return () => clearTimeout(timer);
  };

  // Tải lịch sử khi khởi chạy ứng dụng
  useEffect(() => {
    try {
      const saved = localStorage.getItem("office_proofread_history");
      if (saved) {
        setHistory(JSON.parse(saved));
      }
    } catch (err) {
      console.error("Lỗi khi tải lịch sử:", err);
    }
  }, []);

  const saveHistoryToStorage = (items: HistoryItem[]) => {
    localStorage.setItem("office_proofread_history", JSON.stringify(items));
  };

  const updateHistoryAndState = (nextText: string, nextHtml: string, nextErrors: ErrorItem[]) => {
    setOriginalText(nextText);
    setHtmlContent(nextHtml);
    setErrors(nextErrors);
    
    if (activeHistoryId) {
      setHistory(prev => {
        const updated = prev.map(item => {
          if (item.id === activeHistoryId) {
            return {
              ...item,
              originalText: nextText,
              htmlContent: nextHtml,
              errors: nextErrors,
              timestamp: Date.now()
            };
          }
          return item;
        });
        saveHistoryToStorage(updated);
        return updated;
      });
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    try {
      const { text, html, orientation: detectedOrientation } = await parseDocx(file);
      const newId = Math.random().toString(36).substring(2, 9);
      setActiveHistoryId(newId);
      
      setOriginalText(text);
      setHtmlContent(html);
      setOrientation(detectedOrientation);
      setErrors([]);

      // Tạo một bản ghi trong cơ sở lịch sử mới
      const newItem: HistoryItem = {
        id: newId,
        fileName: file.name,
        originalText: text,
        htmlContent: html,
        errors: [],
        orientation: detectedOrientation,
        mode,
        timestamp: Date.now()
      };
      
      setHistory(prev => {
        const nextHistory = [newItem, ...prev.filter(item => item.fileName !== file.name || item.originalText !== text)];
        saveHistoryToStorage(nextHistory);
        return nextHistory;
      });
      showToast("success", `Đã tải tệp lên thành công: ${file.name}`);
    } catch (error) {
      console.error("Failed to parse docx:", error);
      showToast("error", "Không thể bóc tách nội dung của file docx này. Vui lòng chắc chắn file không bị lỗi.");
    }
  };

  const handleDownload = async () => {
    if (!htmlContent) {
      showToast("warning", "Không có nội dung để xuất tệp tin.");
      return;
    }
    try {
      const htmlToSave = document.getElementById('word-content')?.innerHTML || htmlContent;
      const outputName = fileName
        ? (fileName.endsWith('.docx') ? fileName.replace('.docx', '_da_soat.docx') : fileName + '_da_soat.docx')
        : 'van_ban_da_soat.docx';
      await generateDocx(htmlToSave, outputName, orientation);
      showToast("success", "Xuất file DOCX rà duyệt hoàn chỉnh thành công!");
    } catch (error) {
      console.error("Failed to download docx:", error);
      showToast("error", "Có lỗi xảy ra khi tạo dựng tệp Word đã sửa.");
    }
  };

  const handleOrientationChange = (nextOrientation: "portrait" | "landscape") => {
    setOrientation(nextOrientation);
    if (activeHistoryId) {
      setHistory(prev => {
        const u = prev.map(item => {
          if (item.id === activeHistoryId) {
            return { ...item, orientation: nextOrientation };
          }
          return item;
        });
        saveHistoryToStorage(u);
        return u;
      });
    }
  };

  const handlePasteConfirm = (text: string) => {
    if (!text.trim()) {
      showToast("warning", "Vui lòng dán hoặc soạn nội dung văn bản hành chính vào ô nhập liệu.");
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

    const newId = Math.random().toString(36).substring(2, 9);
    setActiveHistoryId(newId);

    setOriginalText(text);
    setHtmlContent(html);
    const customName = `Văn bản dán (${new Date().toLocaleTimeString("vi-VN", { hour: '2-digit', minute: '2-digit' })})`;
    setFileName(customName);
    setErrors([]);
    setOrientation("portrait");
    setIsPasteModalOpen(false);
    setPastedText("");

    const newItem: HistoryItem = {
      id: newId,
      fileName: customName,
      originalText: text,
      htmlContent: html,
      errors: [],
      orientation: "portrait",
      mode,
      timestamp: Date.now()
    };
    setHistory(prev => {
      const nextHistory = [newItem, ...prev];
      saveHistoryToStorage(nextHistory);
      return nextHistory;
    });
    
    showToast("success", "Đã nạp văn bản tự soạn thảo từ clipboard.");
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setPastedText(text);
      showToast("success", "Đã dán nhanh văn bản từ bộ nhớ tạm thành công!");
    } catch (err) {
      console.warn("Không thể truy cập Clipboard:", err);
      showToast("info", "Bạn hãy sử dụng tổ hợp phím tắt Ctrl + V (hoặc Cmd + V) để dán trực tiếp vào khung soạn thảo.");
    }
  };

  const proofread = async (targetText?: string) => {
    const textToProcess = targetText || originalText;
    if (!textToProcess) {
      showToast("warning", "Vui lòng tải tệp docx lên hoặc dán nội dung văn bản rà soát.");
      return;
    }

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
                    const updatedErrors = [...prev, ...uniqueNew];
                    
                    // Đồng bộ đồng thời vào bản ghi lưu lịch sử
                    if (activeHistoryId) {
                      setHistory(hPrev => {
                        const uHistory = hPrev.map(item => {
                          if (item.id === activeHistoryId) {
                            return { ...item, errors: updatedErrors };
                          }
                          return item;
                        });
                        saveHistoryToStorage(uHistory);
                        return uHistory;
                      });
                    }
                    return updatedErrors;
                  });
                }
              } else if (data.type === "warning") {
                showToast("warning", data.message);
              } else if (data.type === "error") {
                showToast("error", `Lỗi phân tích: ${data.error}`);
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
              const updatedErrors = [...prev, ...uniqueNew];
              
              if (activeHistoryId) {
                setHistory(hPrev => {
                  const uHistory = hPrev.map(item => {
                    if (item.id === activeHistoryId) {
                      return { ...item, errors: updatedErrors };
                    }
                    return item;
                  });
                  saveHistoryToStorage(uHistory);
                  return uHistory;
                });
              }
              return updatedErrors;
            });
          } else if (data.type === "error") {
            showToast("error", `Lỗi từ AI: ${data.error}`);
          }
        } catch (_) {}
      }

      showToast("success", "Đã hệ thống hóa và rà soát thành công văn bản hành chính!");
    } catch (error: any) {
      console.error("Error proofreading:", error);
      showToast("error", error.message || "Không thể kết nối với khối máy chủ xử lý tác vụ AI. Vui lòng kiểm tra dường truyền.");
    } finally {
      setIsChecking(false);
    }
  };

  const proofreadSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      showToast("info", "Đang rà soát cho phân đoạn bôi xanh chọn...");
      proofread(selection.toString());
    } else {
      showToast("warning", "Quý khách vui lòng bôi xanh vùng văn bản hành chính cụ thể cần quét rà soát.");
    }
  };

  const fixItem = (index: number) => {
    const error = errors[index];
    const escapedText = error.text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(escapedText, 'g');
    
    const correctedHtml = `<span class="corrected-term bg-green-50 text-emerald-600 font-bold border-b border-solid border-emerald-600" title="Đã sửa từ lỗi '${error.text}': ${error.error}">${error.suggestion}</span>`;
    
    const nextHtml = replaceTextInHtml(htmlContent, error.text, correctedHtml);
    const nextText = originalText.replace(regex, error.suggestion);
    const nextErrors = errors.filter((_, i) => i !== index);

    updateHistoryAndState(nextText, nextHtml, nextErrors);
  };

  const fixAll = () => {
    let newHtml = htmlContent;
    let newText = originalText;
    
    const sortedErrors = [...errors].sort((a, b) => b.text.length - a.text.length);

    sortedErrors.forEach(error => {
      const escapedText = error.text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(escapedText, 'g');
      const correctedHtml = `<span class="corrected-term bg-green-50 text-emerald-600 font-bold border-b border-solid border-emerald-600" title="Đã sửa từ lỗi '${error.text}': ${error.error}">${error.suggestion}</span>`;
      
      newHtml = replaceTextInHtml(newHtml, error.text, correctedHtml);
      newText = newText.replace(regex, error.suggestion);
    });

    updateHistoryAndState(newText, newHtml, []);
    showToast("success", "Đã sửa đổi áp dụng tự động toàn bộ lỗi được đề xuất!");
  };

  const loadHistoryItem = (item: HistoryItem) => {
    setActiveHistoryId(item.id);
    setFileName(item.fileName);
    setOriginalText(item.originalText);
    setHtmlContent(item.htmlContent);
    setErrors(item.errors);
    setOrientation(item.orientation);
    setMode(item.mode);
    setIsHistoryOpen(false);
    showToast("success", `Khôi phục thành công phiên soát: ${item.fileName}`);
  };

  const deleteHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = history.filter(item => item.id !== id);
    setHistory(updated);
    saveHistoryToStorage(updated);
    
    if (activeHistoryId === id) {
      setActiveHistoryId(null);
    }
    showToast("info", "Đã xóa bản ghi được chọn khỏi lịch sử.");
  };

  const clearAllHistory = () => {
    if (window.confirm("Bạn có tin tưởng chắc chắn muốn xóa sạch toàn bộ lịch sử rà soát hay không?")) {
      setHistory([]);
      saveHistoryToStorage([]);
      setActiveHistoryId(null);
      showToast("info", "Đã dọn dẹp sạch sẽ toàn bộ kho dữ liệu lịch sử sử dụng.");
    }
  };

  const handleLearn = async (content: string) => {
    try {
      await fetch("/api/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      showToast("success", "Đã cập nhật quy định tự học lên hệ thống AI!");
    } catch (error) {
      console.error("Learning failed:", error);
      showToast("error", "Lỗi gửi quy chuẩn học tập.");
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans relative overflow-hidden">
      <Toolbar 
        onUpload={handleUpload} 
        onDownload={handleDownload} 
        onSetMode={setMode} 
        currentMode={mode} 
        onPasteClick={() => setIsPasteModalOpen(true)}
        onHistoryClick={() => setIsHistoryOpen(true)}
        historyCount={history.length}
      />
      <div className="flex flex-1 overflow-hidden">
        <TextView 
          htmlContent={htmlContent} 
          errors={errors} 
          highlightedError={highlightedError}
          orientation={orientation}
          onOrientationChange={handleOrientationChange}
        />
        <ErrorView 
          errors={errors} 
          onProofread={() => proofread()} 
          onProofreadSelection={proofreadSelection}
          onFixAll={fixAll} 
          onFixItem={fixItem}
          onLinkToItem={(item) => setHighlightedError({ ...item, id: Math.random() })}
          onLearn={handleLearn}
          isChecking={isChecking}
        />
      </div>

      {/* Thông báo dạng Toast tinh tế góc dưới cùng tay phải */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-slate-900 text-white px-4 py-3.5 rounded-xl shadow-2xl border border-slate-700/60 max-w-sm animate-fade-in animate-slide-up duration-300">
          <div className="text-base shrink-0 select-none">
            {toast.type === "success" && "🟢"}
            {toast.type === "warning" && "🟡"}
            {toast.type === "error" && "🔴"}
            {toast.type === "info" && "🔵"}
          </div>
          <div className="flex-1 text-[12px] font-medium leading-relaxed">
            {toast.message}
          </div>
          <button 
            onClick={() => setToast(null)} 
            className="text-slate-400 hover:text-white transition-colors text-base font-bold pl-2 outline-none select-none"
          >
            &times;
          </button>
        </div>
      )}

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

      {/* Modal Lịch sử sử dụng */}
      {isHistoryOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40 animate-fade-in animate-duration-150">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-[750px] max-w-[95vw] border border-brand-border flex flex-col max-h-[85vh] transition-all">
            <div className="flex items-center justify-between pb-3 border-b border-brand-border mb-4">
              <h3 className="text-[15px] font-bold text-slate-800 flex items-center gap-2">
                <span className="text-lg">⏳</span> Lịch sử rà soát văn bản
              </h3>
              <div className="flex items-center gap-4">
                {history.length > 0 && (
                  <button
                    onClick={clearAllHistory}
                    className="text-xs text-red-500 hover:text-red-700 font-semibold transition-colors hover:underline"
                  >
                    Xóa tất cả
                  </button>
                )}
                <button 
                  onClick={() => setIsHistoryOpen(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 text-2xl leading-none transition-all outline-none select-none"
                >
                  &times;
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto min-h-0 py-2 space-y-3">
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                  <span className="text-5xl opacity-40 mb-4 select-none">🕒</span>
                  <p className="text-[13px] font-semibold text-slate-500">Chưa ghi nhận lịch sử nào</p>
                  <p className="text-xs text-slate-400/80 mt-1 max-w-[360px] text-center leading-relaxed font-normal">
                    Các tệp tin bạn tải lên hoặc soạn thảo trực tiếp sẽ tự động được đồng bộ lưu trữ tại đây để bạn khôi phục và tiếp tục sửa lỗi bất kỳ lúc nào.
                  </p>
                </div>
              ) : (
                history.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => loadHistoryItem(item)}
                    className={`group border rounded-xl p-4 cursor-pointer transition-all flex items-center justify-between text-left ${
                      activeHistoryId === item.id
                        ? "bg-blue-50/60 border-blue-200 shadow-sm"
                        : "bg-white border-slate-100 hover:border-slate-300 hover:bg-slate-50/50"
                    }`}
                  >
                    <div className="flex-1 min-w-0 pr-4">
                      <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
                        <span className="text-sm shrink-0 select-none">
                          {item.fileName.endsWith(".docx") ? "📄" : "📝"}
                        </span>
                        <span className="font-bold text-[13px] text-slate-700 truncate max-w-[350px]">
                          {item.fileName}
                        </span>
                        {activeHistoryId === item.id && (
                          <span className="bg-emerald-100 text-emerald-700 text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 select-none uppercase tracking-wider">
                            Đang mở
                          </span>
                        )}
                        <span className="bg-slate-100 text-slate-600 text-[9px] font-semibold px-2 py-0.5 rounded shrink-0 select-none">
                          {item.mode === "nd30-report" ? "NĐ 30 Báo cáo" : item.mode === "nd30-decision" ? "NĐ 30 Quyết định" : "HD 36"}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-3 text-xs text-slate-400 font-medium">
                        <span>
                          {new Date(item.timestamp).toLocaleDateString("vi-VN")} {new Date(item.timestamp).toLocaleTimeString("vi-VN", { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                        <span>
                          Khổ: {item.orientation === "landscape" ? "Ngang" : "Đứng"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <div className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                          item.errors.length > 0 
                            ? "text-red-600 bg-red-50 border border-red-100" 
                            : "text-emerald-700 bg-emerald-50 border border-emerald-100"
                        }`}>
                          {item.errors.length > 0 ? `${item.errors.length} lỗi` : "Sạch lỗi"}
                        </div>
                      </div>
                      <button
                        onClick={(e) => deleteHistoryItem(item.id, e)}
                        className="opacity-0 group-hover:opacity-100 hover:bg-red-50 p-2 rounded-lg text-slate-400 hover:text-red-500 transition-all cursor-pointer select-none font-bold"
                        title="Xóa khỏi lịch sử"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end border-t border-brand-border pt-4 mt-2 shrink-0">
              <button
                onClick={() => setIsHistoryOpen(false)}
                className="px-5 py-2 bg-slate-100 hover:bg-slate-200 rounded-md transition-all text-xs font-semibold text-slate-600 outline-none"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

