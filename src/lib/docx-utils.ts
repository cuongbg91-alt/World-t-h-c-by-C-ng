import { Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, BorderStyle, WidthType } from "docx";
import { saveAs } from "file-saver";
import mammoth from "mammoth";

export async function parseDocx(file: File): Promise<{ text: string; html: string }> {
  const arrayBuffer = await file.arrayBuffer();
  
  // Heuristic checking to distinguish layout tables (headers/footers with metadata side-by-side)
  // from standard grid-tables containing structured data
  function checkIsLayoutTable(table: any): boolean {
    if (!table.children || table.children.length === 0 || table.children.length > 3) {
      return false;
    }
    for (const row of table.children) {
      if (row.type !== "tableRow") return false;
      if (!row.children || row.children.length !== 2) {
        return false;
      }
    }
    return true;
  }

  // Recursive document AST traversal to detect paragraph alignment and table structures
  function transformDocument(element: any): any {
    if (element.children) {
      element.children = element.children.map(transformDocument);
    }
    
    if (element.type === "paragraph") {
      const align = element.alignment;
      if (align === "center") {
        element.styleName = element.styleName ? `${element.styleName} Centered` : "Centered";
      } else if (align === "right") {
        element.styleName = element.styleName ? `${element.styleName} Right` : "Right";
      } else if (align === "both" || align === "justify") {
        element.styleName = element.styleName ? `${element.styleName} Justify` : "Justify";
      } else if (align === "left") {
        element.styleName = element.styleName ? `${element.styleName} Left` : "Left";
      }
    } else if (element.type === "table") {
      const isLayout = checkIsLayoutTable(element);
      element.styleName = isLayout ? "LayoutTable" : "GridTable";
    }
    
    return element;
  }

  // Convert Docx to HTML using precise semantic mappings and alignments
  const result = await mammoth.convertToHtml({ arrayBuffer }, {
    transformDocument: transformDocument,
    styleMap: [
      "p[style-name='Centered'] => p.text-center:fresh",
      "p[style-name='Right'] => p.text-right:fresh",
      "p[style-name='Justify'] => p.text-justify:fresh",
      "p[style-name='Left'] => p.text-left:fresh",
      "p[style-name='Heading 1 Centered'] => h1.text-center:fresh",
      "p[style-name='Heading 1 Right'] => h1.text-right:fresh",
      "p[style-name='Heading 1'] => h1:fresh",
      "p[style-name='Heading 2 Centered'] => h2.text-center:fresh",
      "p[style-name='Heading 2 Right'] => h2.text-right:fresh",
      "p[style-name='Heading 2'] => h2:fresh",
      "p[style-name='Heading 3 Centered'] => h3.text-center:fresh",
      "p[style-name='Heading 3 Right'] => h3.text-right:fresh",
      "p[style-name='Heading 3'] => h3:fresh",
      "table[style-name='LayoutTable'] => table.layout-table:fresh",
      "table[style-name='GridTable'] => table.grid-table:fresh"
    ]
  });
  
  const textResult = await mammoth.extractRawText({ arrayBuffer });
  
  return {
    text: textResult.value,
    html: result.value
  };
}

export async function generateDocx(html: string, fileName: string) {
  if (typeof window === "undefined" || !html) return;

  const parser = new DOMParser();
  const docElement = parser.parseFromString(html, "text/html");
  // The .word-render div contains the processed document HTML
  const contentNode = docElement.querySelector(".word-render") || docElement.querySelector("#word-content") || docElement.body;
  
  const docxChildren: any[] = [];
  
  // Helper to parse alignment from styles/classes
  function getAlignment(element: HTMLElement): any {
    const className = element.className || "";
    if (className.includes("text-center")) {
      return AlignmentType.CENTER;
    } else if (className.includes("text-right")) {
      return AlignmentType.RIGHT;
    } else if (className.includes("text-justify")) {
      return AlignmentType.JUSTIFIED;
    } else if (className.includes("text-left")) {
      return AlignmentType.LEFT;
    }
    
    const styleAlign = element.style.textAlign;
    if (styleAlign === "center") return AlignmentType.CENTER;
    if (styleAlign === "right") return AlignmentType.RIGHT;
    if (styleAlign === "justify") return AlignmentType.JUSTIFIED;
    return AlignmentType.LEFT;
  }

  // Helper to convert colors to hex
  function parseColorToHex(colorStr: string): string | undefined {
    if (!colorStr) return undefined;
    const col = colorStr.trim().toLowerCase();
    if (col.startsWith("#")) {
      return col.replace("#", "").toUpperCase();
    }
    if (col.startsWith("rgb")) {
      const match = col.match(/\d+/g);
      if (match && match.length >= 3) {
        const r = parseInt(match[0], 10).toString(16).padStart(2, "0");
        const g = parseInt(match[1], 10).toString(16).padStart(2, "0");
        const b = parseInt(match[2], 10).toString(16).padStart(2, "0");
        return `${r}${g}${b}`.toUpperCase();
      }
    }
    return undefined;
  }

  interface StyleState {
    bold?: boolean;
    italics?: boolean;
    underline?: boolean;
    strike?: boolean;
    color?: string;
    highlight?: string;
  }

  // Recursive inline processor
  function processInlineNode(node: Node, style: StyleState, runs: TextRun[], fontSize?: number) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (text) {
        runs.push(new TextRun({
          text: text,
          bold: style.bold,
          italics: style.italics,
          underline: style.underline ? {} : undefined,
          strike: style.strike,
          color: style.color,
          highlight: style.highlight as any,
          font: "Times New Roman",
          size: fontSize || 28, // 14.5pt is approx size 29, but let's use standard default size 28 (14pt)
        }));
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tagName = el.tagName.toLowerCase();
      const localStyle: StyleState = { ...style };
      
      if (tagName === "b" || tagName === "strong") {
        localStyle.bold = true;
      } else if (tagName === "i" || tagName === "em") {
        localStyle.italics = true;
      } else if (tagName === "u" || tagName === "ins") {
        localStyle.underline = true;
      } else if (tagName === "s" || tagName === "strike" || tagName === "del") {
        localStyle.strike = true;
      }
      
      const classList = el.className || "";
      if (classList.includes("bg-red-50") || classList.includes("text-brand-accent") || classList.includes("border-dashed")) {
        localStyle.color = "DC2626"; // Màu đỏ cho lỗi phát hiện
        localStyle.bold = true;
        localStyle.underline = true;
      } else if (classList.includes("bg-green-50") || classList.includes("corrected-term") || classList.includes("text-emerald-600")) {
        localStyle.color = "16A34A"; // Màu xanh cho lỗi đã sửa
        localStyle.bold = true;
      } else if (classList.includes("bg-yellow-100")) {
        localStyle.highlight = "yellow";
      }
      
      if (el.style.color) {
        const hex = parseColorToHex(el.style.color);
        if (hex) localStyle.color = hex;
      }
      
      if (tagName === "br") {
        runs.push(new TextRun({ text: "", break: 1 }));
      } else {
        const childNodes = Array.from(el.childNodes);
        for (const child of childNodes) {
          processInlineNode(child, localStyle, runs, fontSize);
        }
      }
    }
  }

  // Paragraph parser
  function parseParagraph(element: HTMLElement): Paragraph | null {
    const runs: TextRun[] = [];
    const tagName = element.tagName.toLowerCase();
    
    let defaultSize = 28; // 14pt (size in half-points is 28)
    if (tagName === "h1") defaultSize = 38; // 19pt
    else if (tagName === "h2") defaultSize = 34; // 17pt
    else if (tagName === "h3") defaultSize = 31; // 15.5pt
    
    for (const child of Array.from(element.childNodes)) {
      processInlineNode(child, {}, runs, defaultSize);
    }
    
    if (runs.length === 0) {
      runs.push(new TextRun(""));
    }

    const alignment = getAlignment(element);
    
    // Thụt lề đầu dòng (first-line indent) 1.25cm tương đương 720 dxa trong Word
    // Không áp dụng cho bảng biểu, hàng danh sách hoặc các văn bản căn giữa/phải khác
    const indent = (tagName === "p" && 
                    !element.className.includes("text-center") && 
                    !element.className.includes("text-right") && 
                    !element.className.includes("text-left") &&
                    !element.closest("table") && 
                    !element.closest("li"))
      ? { firstLine: 720 }
      : undefined;

    return new Paragraph({
      children: runs,
      alignment: alignment,
      indent: indent,
      spacing: {
        line: 396, // 1.65 line spacing (396/240 = 1.65)
        lineRule: "auto",
        after: 170, // 8.5pt after (170/20 = 8.5)
      }
    });
  }

  // List parser (ul, ol)
  function parseList(listElement: HTMLElement): Paragraph[] {
    const paragraphs: Paragraph[] = [];
    const items = Array.from(listElement.querySelectorAll("li"));
    const tagName = listElement.tagName.toLowerCase();
    
    let index = 1;
    for (const item of items) {
      const runs: TextRun[] = [];
      const prefix = tagName === "ul" ? "•  " : `${index}.  `;
      
      runs.push(new TextRun({
        text: prefix,
        bold: true,
        font: "Times New Roman",
        size: 28,
      }));
      
      for (const child of Array.from(item.childNodes)) {
        processInlineNode(child, {}, runs);
      }
      
      paragraphs.push(new Paragraph({
        children: runs,
        alignment: AlignmentType.LEFT,
        spacing: {
          after: 100,
          line: 396,
          lineRule: "auto",
        }
      }));
      index++;
    }
    return paragraphs;
  }

  // Table parser
  function parseTable(tableElement: HTMLElement): Table | null {
    const isLayout = tableElement.className.includes("layout-table") || tableElement.getAttribute("style-name") === "LayoutTable";
    
    const borders = isLayout ? {
      top: { style: BorderStyle.NONE, size: 0, color: "auto" },
      bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
      left: { style: BorderStyle.NONE, size: 0, color: "auto" },
      right: { style: BorderStyle.NONE, size: 0, color: "auto" },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
    } : {
      top: { style: BorderStyle.SINGLE, size: 12, color: "111111" },
      bottom: { style: BorderStyle.SINGLE, size: 12, color: "111111" },
      left: { style: BorderStyle.SINGLE, size: 12, color: "111111" },
      right: { style: BorderStyle.SINGLE, size: 12, color: "111111" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 6, color: "222222" },
      insideVertical: { style: BorderStyle.SINGLE, size: 6, color: "222222" },
    };
    
    const rows: TableRow[] = [];
    const trElements = Array.from(tableElement.querySelectorAll("tr"));
    
    for (const trEl of trElements) {
      const cells: TableCell[] = [];
      const tdElements = Array.from(trEl.childNodes).filter(node => node.nodeName.toLowerCase() === "td" || node.nodeName.toLowerCase() === "th") as HTMLElement[];
      
      for (const tdEl of tdElements) {
        const cellParagraphs: Paragraph[] = [];
        const childNodes = Array.from(tdEl.childNodes);
        let pendingRuns: TextRun[] = [];
        
        for (const node of childNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            if (text) {
              pendingRuns.push(new TextRun({ text, font: "Times New Roman", size: 27 }));
            }
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            const subTagName = el.tagName.toLowerCase();
            
            if (subTagName === "p") {
              if (pendingRuns.length > 0) {
                cellParagraphs.push(new Paragraph({
                  children: pendingRuns,
                  alignment: AlignmentType.LEFT,
                  spacing: { line: 360, after: 0 },
                }));
                pendingRuns = [];
              }
              const pParsed = parseParagraph(el);
              if (pParsed) cellParagraphs.push(pParsed);
            } else {
              const subRuns: TextRun[] = [];
              processInlineNode(el, {}, subRuns);
              pendingRuns.push(...subRuns);
            }
          }
        }
        
        if (pendingRuns.length > 0 || cellParagraphs.length === 0) {
          cellParagraphs.push(new Paragraph({
            children: pendingRuns.length > 0 ? pendingRuns : [new TextRun("")],
            alignment: AlignmentType.LEFT,
            spacing: { line: 360, after: 0, before: 0 },
          }));
        }
        
        // Calculate cell widths (percentage or direct dxa value mapping)
        let cellWidth = undefined;
        const widthAttr = tdEl.getAttribute("width") || tdEl.style.width;
        if (widthAttr) {
          const numeric = parseInt(widthAttr, 10);
          if (!isNaN(numeric)) {
            cellWidth = {
              size: widthAttr.includes("%") ? numeric : numeric * 15, // Simple dxa mapping
              type: widthAttr.includes("%") ? WidthType.PERCENTAGE : WidthType.DXA,
            };
          }
        }
        
        cells.push(new TableCell({
          children: cellParagraphs,
          verticalAlign: "center",
          width: cellWidth,
        }));
      }
      
      if (cells.length > 0) {
        rows.push(new TableRow({ children: cells }));
      }
    }
    
    if (rows.length === 0) return null;
    
    return new Table({
      rows: rows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: borders,
    });
  }

  // Parse direct structural nodes
  const rootChildren = Array.from(contentNode.childNodes);
  for (const node of rootChildren) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      if (text.trim() !== "") {
        docxChildren.push(new Paragraph({
          children: [new TextRun({ text, font: "Times New Roman", size: 28 })],
          alignment: AlignmentType.LEFT,
        }));
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tagName = el.tagName.toLowerCase();
      
      if (tagName === "p" || tagName === "h1" || tagName === "h2" || tagName === "h3" || tagName === "h4" || tagName === "h5" || tagName === "h6") {
        const paragraph = parseParagraph(el);
        if (paragraph) docxChildren.push(paragraph);
      } else if (tagName === "table") {
        const table = parseTable(el);
        if (table) docxChildren.push(table);
      } else if (tagName === "ul" || tagName === "ol") {
        const pList = parseList(el);
        docxChildren.push(...pList);
      } else if (tagName === "hr") {
        // Line separator helper
        docxChildren.push(new Paragraph({
          children: [new TextRun({ text: "____________________________________________________", font: "Times New Roman", color: "222222" })],
          alignment: AlignmentType.CENTER,
        }));
      }
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: docxChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, fileName || "van-ban-da-suat.docx");
}
