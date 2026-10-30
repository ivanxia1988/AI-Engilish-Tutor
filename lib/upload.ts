import type { BookPage } from "./types";
const MAX_PAGES = 12;
export async function readMaterials(files: File[], onProgress: (message: string) => void): Promise<BookPage[]> {
  const pages: BookPage[] = [];
  for (const file of files) {
    if (file.size > 25 * 1024 * 1024) throw new Error(`「${file.name}」超过 25 MB，请压缩后重试。`);
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      onProgress("正在打开 PDF，教材仍保存在你的设备上…");
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
      const pdf = await task.promise;
      try {
        if (pdf.numPages + pages.length > MAX_PAGES) throw new Error(`这份 PDF 有 ${pdf.numPages} 页。第一版每次支持 ${MAX_PAGES} 页，请先导出要学习的页码再上传。`);
        for (let i = 1; i <= pdf.numPages; i++) {
          onProgress(`正在整理教材 · 第 ${i} / ${pdf.numPages} 页`);
          const page = await pdf.getPage(i), view = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(1.6, 1500 / Math.max(view.width, view.height)) });
          const canvas = document.createElement("canvas"); canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
          await page.render({ canvas, viewport }).promise;
          pages.push({ id: `page-${crypto.randomUUID()}`, image: canvas.toDataURL("image/jpeg", 0.84), width: canvas.width, height: canvas.height, objects: [] });
          canvas.width = 0; canvas.height = 0; page.cleanup();
        }
      } finally { await task.destroy(); }
    } else if (/^image\/(jpeg|png|webp)$/.test(file.type)) {
      onProgress(`正在整理图片 · ${pages.length + 1}`);
      const url = URL.createObjectURL(file);
      try {
        const img = new Image(); img.src = url; await img.decode();
        const scale = Math.min(1, 1500 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas"); canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        pages.push({ id: `page-${crypto.randomUUID()}`, image: canvas.toDataURL("image/jpeg", 0.84), width: canvas.width, height: canvas.height, objects: [] });
      } finally { URL.revokeObjectURL(url); }
    } else { throw new Error(`暂不支持「${file.name}」。请选择 PDF、JPG、PNG 或 WebP。`); }
    if (pages.length > MAX_PAGES) throw new Error(`每次最多上传 ${MAX_PAGES} 页教材。`);
  }
  if (!pages.length) throw new Error("没有可用的教材页面，请重新选择文件。");
  if (pages.reduce((sum, page) => sum + page.image.length, 0) > 10_000_000) throw new Error("图片总量太大，请减少页数后重试。");
  return pages;
}
export function makeManualBook(title: string, pages: BookPage[]) {
  return { id: crypto.randomUUID(), title: title.trim() || "我的英语教材", source: "manual" as const, createdAt: new Date().toISOString(), pages, lessons: pages.filter(p => p.objects.length).map((page, i) => ({ id: `lesson-${crypto.randomUUID()}`, title: `第 ${i + 1} 课 · ${page.objects.slice(0, 2).map(o => o.chinese).join("和")}`, subtitle: "My English adventure", duration: Math.min(15, 2 + page.objects.length * 2), words: page.objects.map(o => o.label), steps: [
    { id: crypto.randomUUID(), kind: "listen" as const, pageId: page.id, targetId: null, english: "Let's learn together. Look at this page!", chinese: "看看这页教材，我们一起来学英语吧！", hint: "准备好就开始。", expected: null },
    ...page.objects.flatMap(o => [
      { id: crypto.randomUUID(), kind: "select" as const, pageId: page.id, targetId: o.id, english: `Can you circle ${o.label}?`, chinese: `请圈出「${o.chinese}」。`, hint: `Find ${o.label}. 找找${o.chinese}在哪里。`, expected: o.label },
      { id: crypto.randomUUID(), kind: "speak" as const, pageId: page.id, targetId: o.id, english: `Listen: ${o.label}. Now it's your turn!`, chinese: `跟我读：${o.label}。`, hint: `Let's say ${o.label} slowly.`, expected: o.label },
    ]),
  ] })) };
}
