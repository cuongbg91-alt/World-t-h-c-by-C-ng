import React, { useState } from "react";
import { Search, Scissors, CheckCheck, Lightbulb, Link as LinkIcon, Send } from "lucide-react";

interface ErrorItem {
  id?: string;
  text: string;
  error: string;
  suggestion: string;
  type: string;
  timestamp?: number;
}

interface ErrorViewProps {
  errors: ErrorItem[];
  onProofread: () => void;
  onProofreadSelection: () => void;
  onFixAll: () => void;
  onFixItem: (item: ErrorItem) => void;
  onLinkToItem: (item: ErrorItem) => void;
  onLearn: (content: string) => void;
  isChecking: boolean;
}

export default function ErrorView({ 
  errors, 
  onProofread, 
  onProofreadSelection,
  onFixAll, 
  onFixItem, 
  onLinkToItem, 
  onLearn,
  isChecking 
}: ErrorViewProps) {
  const [learnText, setLearnText] = useState("");

  const handleLearn = () => {
    if (learnText.trim()) {
      onLearn(learnText);
      setLearnText("");
    }
  };

  return (
    <div className="w-[450px] border-l border-brand-border bg-white flex flex-col h-full shrink-0">
      <div className="p-4 border-b border-brand-border flex items-center justify-between">
        <div className="font-semibold text-sm text-brand-text">
          Phát hiện {errors.length.toString().padStart(2, '0')} lỗi
        </div>
        <button 
          onClick={onFixAll}
          disabled={errors.length === 0}
          className="px-3 py-1 bg-white text-brand-text border border-brand-border rounded-md hover:bg-brand-bg disabled:opacity-40 transition-all text-[11px] font-semibold"
        >
          Sửa tất cả
        </button>
      </div>

      <div className="p-4 border-b border-brand-border grid grid-cols-2 gap-2 bg-brand-bg/30">
        <button 
          onClick={onProofread}
          disabled={isChecking}
          className="flex items-center justify-center px-3 py-2 bg-brand-primary text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-all text-xs font-semibold shadow-sm"
        >
          {isChecking ? "Đang soát..." : <><Search className="w-3.5 h-3.5 mr-2" /> Soát toàn bộ</>}
        </button>
        <button 
          onClick={onProofreadSelection}
          disabled={isChecking}
          className="flex items-center justify-center px-3 py-2 bg-white text-brand-text border border-brand-border rounded-md hover:bg-brand-bg transition-all text-xs font-semibold"
        >
          <Scissors className="w-3.5 h-3.5 mr-2" /> Vùng chọn
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-3 bg-brand-bg/10">
        {errors.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-brand-muted text-center">
            <Lightbulb className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-[13px] px-8 leading-relaxed italic">Chưa phát hiện lỗi. Nhấn "Soát toàn bộ" để bắt đầu rà soát theo quy chuẩn.</p>
          </div>
        ) : (
          [...errors]
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
            .map((item) => (
              <div key={item.id || `${item.text}-${item.error}`} className="bg-white border border-brand-border rounded-lg p-3.5 shadow-sm border-l-4 border-l-brand-accent hover:shadow-md transition-shadow relative group">
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-brand-accent">
                    {item.type}
                  </span>
                  <button 
                    onClick={() => onLinkToItem(item)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-brand-muted hover:text-brand-primary"
                    title="Tìm vị trí lỗi"
                  >
                    <LinkIcon className="w-3 h-3" />
                  </button>
                </div>
                
                <div className="mb-2.5">
                  <div className="text-[13px] font-medium text-brand-text mb-1 leading-snug">{item.error}</div>
                  <div className="text-[12px] text-brand-muted line-through decoration-brand-accent/30">{item.text}</div>
                </div>
                
                <div className="flex items-center gap-2">
                  <div className="flex-1 text-[12px] bg-blue-50 text-brand-primary font-medium p-2 rounded border border-blue-100 italic">
                    Gợi ý: {item.suggestion}
                  </div>
                  <button 
                    onClick={() => onFixItem(item)}
                    className="p-2 bg-brand-primary text-white rounded hover:bg-blue-700 transition-colors shadow-sm"
                    title="Áp dụng sửa lỗi"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
        )}
      </div>

      <div className="p-4 border-t border-brand-border bg-white">
        <div className="text-[11px] font-bold text-brand-muted uppercase tracking-widest mb-3">Tự học quy chuẩn mới</div>
        <div className="relative">
          <textarea
            value={learnText}
            onChange={(e) => setLearnText(e.target.value)}
            placeholder="Ví dụ: Quy định tên cơ quan mới từ 2025..."
            className="w-full h-20 p-3 pr-10 text-[13px] border border-brand-border rounded-lg focus:ring-1 focus:ring-brand-primary focus:border-brand-primary outline-none resize-none bg-brand-bg transition-all placeholder:text-slate-400"
          />
          <button 
            onClick={handleLearn}
            className="absolute bottom-3 right-3 p-1.5 bg-brand-primary text-white rounded-md hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      
      <div className="p-3 bg-white border-t border-brand-border flex items-center justify-between text-[10px] font-medium text-brand-muted px-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
          Hệ thống sẵn sàng
        </div>
        <div className="uppercase tracking-tighter opacity-60">Version 1.0</div>
      </div>
    </div>
  );
}
