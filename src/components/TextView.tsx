import React, { useRef, useEffect, useMemo } from "react";

interface ErrorItem {
  text: string;
  error: string;
  suggestion: string;
  type: string;
}

interface TextViewProps {
  htmlContent: string;
  errors: ErrorItem[];
  highlightedError: ErrorItem | null;
}

// Hàm hỗ trợ loại bỏ hoàn toàn khoảng trắng, tab và dấu xuống dòng dư thừa ở phía cuối của các thẻ phần tử
function trimElement(element: Element) {
  let finished = false;
  while (!finished) {
    const lastChild = element.lastChild;
    if (!lastChild) {
      finished = true;
      break;
    }

    if (lastChild.nodeType === Node.TEXT_NODE) {
      const text = lastChild.textContent || "";
      // Sử dụng regex để bóc tách triệt để các khoảng trắng, tab, và các ký tự đệm chuẩn Unicode cuối dòng
      const trimmed = text.replace(/[\s\xA0\u00A0\u200B\u200C\u200D\ufeff]+$/, "");
      if (trimmed === "") {
        element.removeChild(lastChild);
      } else {
        lastChild.textContent = trimmed;
        finished = true;
      }
    } else if (lastChild.nodeType === Node.ELEMENT_NODE) {
      trimElement(lastChild as Element);
      if (lastChild.textContent === "") {
        element.removeChild(lastChild);
      } else {
        finished = true;
      }
    } else {
      element.removeChild(lastChild);
    }
  }
}

function trimTrailingWhitespacesFromHTML(html: string): string {
  if (typeof window === "undefined" || !html) return html;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    
    // Tìm các thẻ văn bản hành chính, bảng biểu, liên kết và danh sách có khả năng chứa khoảng trắng thừa cuối dòng
    const elements = doc.querySelectorAll("p, td, th, li, h1, h2, h3, h4, h5, h6");
    elements.forEach(element => {
      trimElement(element);
    });

    return doc.body.innerHTML;
  } catch (err) {
    console.error("Lỗi khi dọn dẹp khoảng trắng cuối dòng:", err);
    return html;
  }
}

export default function TextView({ htmlContent, errors, highlightedError }: TextViewProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlightedError && contentRef.current) {
      const walker = document.createTreeWalker(contentRef.current, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent?.includes(highlightedError.text)) {
          const parent = node.parentElement as HTMLElement;
          if (parent) {
            parent.scrollIntoView({ behavior: 'smooth', block: 'center' });
            parent.classList.add('bg-yellow-100');
            setTimeout(() => {
               parent.classList.remove('bg-yellow-100');
            }, 2000);
          }
          break;
        }
      }
    }
  }, [highlightedError]);

  const processedHtml = useMemo(() => {
    if (!htmlContent) return "";
    
    // Loại bỏ triệt để khoảng trắng hoặc tab ở cuối các đoạn văn bản, bảng biểu, danh sách trước khi hiển thị/đánh dấu lỗi
    const cleanHtml = trimTrailingWhitespacesFromHTML(htmlContent);
    let processed = cleanHtml;
    
    // Sắp xếp lỗi theo độ dài giảm dần để tránh việc lỗi ngắn ghi đè lên lỗi dài chứa nó
    const sortedErrors = [...errors].sort((a, b) => b.text.length - a.text.length);

    sortedErrors.forEach(err => {
      // Escape ký tự đặc biệt và xử lý khoảng trắng linh hoạt
      const safeText = err.text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\s+/g, '\\s+');
      
      try {
        // Sử dụng regex để chỉ tìm văn bản nằm ngoài các thẻ HTML
        const regex = new RegExp(`(?![^<]*>)(${safeText})`, 'g');
        processed = processed.replace(regex, `<span class="bg-red-50 text-brand-accent border-b border-dashed border-brand-accent cursor-help" title="${err.error}">$1</span>`);
      } catch (e) {
        console.error("Highlight error:", err.text, e);
      }
    });
    return processed;
  }, [htmlContent, errors]);

  return (
    <div className="flex-1 bg-[#cbd5e1] overflow-auto p-12 flex justify-center shadow-inner animate-fade-in">
      <div className="w-[210mm] min-h-[297mm] bg-white shadow-2xl p-[25mm] font-['Times_New_Roman',serif] text-[#111111] leading-[1.6] relative transition-all" id="word-content">
        {!htmlContent ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 mt-40">
            <div className="w-24 h-24 border-2 border-dashed border-slate-300 rounded-2xl flex items-center justify-center mb-6 bg-slate-50">
              <span className="text-5xl opacity-40">📄</span>
            </div>
            <p className="text-sm font-medium">Tải tệp tin DOCX để rà soát</p>
          </div>
        ) : (
          <div 
            ref={contentRef}
            dangerouslySetInnerHTML={{ __html: processedHtml }} 
            className="word-render"
          />
        )}
      </div>
      
      <style>{`
        /* Đồng nhất màu sắc, định dạng, tab size và font chữ cho toàn bộ văn bản */
        .word-render, .word-render * {
          font-family: 'Times New Roman', Times, serif !important;
          color: #111111 !important;
          tab-size: 4 !important;
          -moz-tab-size: 4 !important;
        }
        
        /* Đảm bảo giữ nguyên các khoảng trắng phức tạp, dấu cách kề nhau, tab từ Word */
        .word-render p, 
        .word-render span, 
        .word-render td, 
        .word-render th, 
        .word-render li,
        .word-render h1,
        .word-render h2,
        .word-render h3,
        .word-render h4,
        .word-render h5,
        .word-render h6,
        .word-render b,
        .word-render strong,
        .word-render i,
        .word-render em,
        .word-render u,
        .word-render s {
          white-space: pre-wrap !important;
          word-break: break-word !important;
        }

        /* Định dạng đường kẻ ngang (nếu xuất hiện từ Word) */
        .word-render hr {
          border: 0 !important;
          border-top: 1.5px solid #111111 !important;
          margin: 1.25rem 0 !important;
          height: 0 !important;
          width: 100% !important;
          display: block !important;
        }

        /* Thể hiện rõ ràng gạch chân, giữ đúng độ dày và cách giãn cho u/ins/text-decoration */
        .word-render u, 
        .word-render ins,
        .word-render [style*="underline"] {
          text-decoration: underline !important;
          text-decoration-style: solid !important;
          text-underline-offset: 2.5px !important;
          text-decoration-thickness: auto !important;
          display: inline !important;
        }

        /* Bảo toàn định dạng gạch ngang cho tất cả các đối tượng */
        .word-render s,
        .word-render strike,
        .word-render del,
        .word-render [style*="line-through"] {
          text-decoration: line-through !important;
          display: inline !important;
        }
        
        /* Cấu hình đoạn văn bản mặc định (văn bản hành chính) */
        .word-render p {
          text-align: justify;
          margin-bottom: 0.85rem;
          font-size: 14.5px;
          line-height: 1.65 !important;
          text-indent: 1.25cm; /* Thụt lề đầu dòng chuẩn văn bản hành chính */
        }
        
        /* Đối với các đoạn văn bản chứa bảng biểu hoặc danh sách, bỏ thụt lề để tránh lệch dòng */
        .word-render table p, .word-render li p {
          text-indent: 0 !important;
          margin-bottom: 0 !important;
          font-size: inherit !important;
        }

        /* Định nghĩa chi tiết các kiểu căn lề, đảm bảo ghi đè chính xác và xoá thụt lề khi không cần thiết */
        .word-render .text-center, .word-render .text-center * {
          text-align: center !important;
          text-indent: 0 !important;
        }
        
        .word-render .text-right, .word-render .text-right * {
          text-align: right !important;
          text-indent: 0 !important;
        }
        
        .word-render .text-justify, .word-render .text-justify * {
          text-align: justify !important;
        }
        
        .word-render .text-left, .word-render .text-left * {
          text-align: left !important;
          text-indent: 0 !important;
        }
        
        .word-render h1, .word-render h2, .word-render h3, .word-render h4, .word-render h5, .word-render h6 {
          font-weight: bold !important;
          margin-top: 1.25rem;
          margin-bottom: 0.5rem;
          line-height: 1.4 !important;
          text-align: left;
          text-indent: 0 !important;
        }
        
        /* Hỗ trợ trường hợp tiêu đề được căn giữa */
        .word-render h1.text-center, .word-render h2.text-center, .word-render h3.text-center {
          text-align: center !important;
          text-indent: 0 !important;
        }
        
        .word-render h1 { font-size: 19px !important; }
        .word-render h2 { font-size: 17px !important; }
        .word-render h3 { font-size: 15.5px !important; }
        
        .word-render b, .word-render strong {
          font-weight: bold !important;
        }
        
        /* Bảng hiển thị thông tin dạng Grid chuẩn */
        .word-render table.grid-table {
          width: 100% !important;
          border-collapse: collapse !important;
          margin: 1.5rem 0 !important;
        }
        
        .word-render table.grid-table td, .word-render table.grid-table th {
          border: 1px solid #111111 !important; /* Đường viền grid rõ ràng như bản gốc */
          padding: 8px 12px !important;
          font-size: 13.5px !important;
          vertical-align: middle !important;
          text-indent: 0 !important;
        }

        /* Bảng căn lề vị trí layout (Không viền mặc định rộng rãi, giữ nguyên các nét kẻ viền chi tiết nếu có) */
        .word-render table.layout-table {
          width: 100% !important;
          border-collapse: collapse !important;
          margin: 1rem 0 !important;
          border: none !important;
        }
        
        .word-render table.layout-table td, .word-render table.layout-table th {
          border: none; /* Tháo bỏ !important để bảo lưu mọi đường kẻ viền tuỳ biến */
          padding: 4px 12px !important;
          font-size: 14px !important;
          vertical-align: top !important;
          text-indent: 0 !important;
        }
        
        /* Dự phòng cho các bảng chưa được phân loại, hiển thị đúng các đường kẻ */
        .word-render table {
          width: 100%;
          border-collapse: collapse;
          margin: 1.25rem 0;
        }
        
        .word-render table:not(.layout-table) td, 
        .word-render table:not(.layout-table) th {
          border: 1px solid #111111 !important;
        }
        
        .word-render td, .word-render th {
          padding: 6px 10px;
          vertical-align: middle;
          text-indent: 0 !important;
        }
        
        .word-render ul, .word-render ol {
          padding-left: 2.5rem;
          margin-bottom: 0.85rem;
          text-indent: 0 !important;
        }
        
        .word-render ul {
          list-style-type: disc !important;
        }
        
        .word-render ol {
          list-style-type: decimal !important;
        }
        
        .word-render li {
          margin-bottom: 0.35rem;
          font-size: 14px;
          line-height: 1.6 !important;
          text-indent: 0 !important;
        }

        /* Định dạng đồng nhất cho vùng hiển thị lỗi rà soát */
        .word-render .bg-red-50 {
          background-color: #fef2f2 !important; /* Màu đỏ nhạt nền tương thích */
          color: #dc2626 !important; /* Chữ đỏ cảnh báo rõ ràng */
          border-bottom: 2px dashed #dc2626 !important; /* Gạch chân lượn sóng/đứt quãng */
          border-radius: 2px;
          padding: 1px 3px !important;
          cursor: help !important;
          display: inline !important;
          font-weight: inherit !important;
        }

        .word-render .bg-green-50, .word-render .corrected-term {
          background-color: #f0fdf4 !important; /* Màu xanh lá nhạt dịu mát */
          color: #16a34a !important; /* Chữ màu ngọc lục bảo bền bỉ, uy tín */
          border-bottom: 2px solid #16a34a !important; /* Nét liền màu xanh vững chãi */
          border-radius: 2px;
          padding: 1px 3px !important;
          cursor: help !important;
          display: inline !important;
          font-weight: bold !important;
        }
        
        .word-render .bg-yellow-100 {
          background-color: #fef08a !important; /* Màu highlight vàng */
          color: #1a1a1a !important;
          border-radius: 2px;
          padding: 1px 3px !important;
          display: inline !important;
        }
      `}</style>
    </div>
  );
}
