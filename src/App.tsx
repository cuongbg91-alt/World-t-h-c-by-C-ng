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

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    try {
      const { text, html } = await parseDocx(file);
      setOriginalText(text);
      setHtmlContent(html);
      setErrors([]);
    } catch (error) {
      console.error("Failed to parse docx:", error);
    }
  };

  const handleDownload = async () => {
    if (!htmlContent) return;
    const htmlToSave = document.getElementById('word-content')?.innerHTML || htmlContent;
    await generateDocx(htmlToSave, fileName.replace('.docx', '_da_soat.docx'));
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

      const contentType = response.headers.get("content-type");
      if (!response.ok || !contentType || !contentType.includes("application/json")) {
        let textError = "";
        try {
          textError = await response.text();
        } catch (_) {}
        console.error("Phản hồi không hợp lệ từ máy chủ:", response.status, textError);
        alert(`Máy chủ rà soát lỗi phản hồi không thành công (Trạng thái: ${response.status}). Vui lòng kiểm tra kết nối mạng hoặc thử lại sau.`);
        return;
      }

      const data = await response.json();
      if (data.errors) {
        if (targetText) {
          setErrors(prev => [...prev, ...data.errors]);
        } else {
          setErrors(data.errors);
        }
        
        if (data.warning) {
          alert(`Cảnh báo: ${data.warning}`);
        }
      } else if (data.error) {
        if (data.errors && data.errors.length > 0) {
           setErrors(data.errors);
           alert(`Thông báo: ${data.error} (Đã hiển thị các lỗi tìm thấy trước đó)`);
        } else {
          alert(data.error);
        }
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
      />
      <div className="flex flex-1 overflow-hidden">
        <TextView 
          htmlContent={htmlContent} 
          errors={errors} 
          highlightedError={highlightedError}
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
    </div>
  );
}

