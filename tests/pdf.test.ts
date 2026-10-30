import test from "node:test";
import assert from "node:assert/strict";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";

function samplePDF() {
  const content = "BT /F1 32 Tf 40 230 Td (Apple and banana) Tj ET\n0.87 0.44 0.32 rg 80 70 90 100 re f\n0.36 0.53 0.34 rg 120 170 16 35 re f";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let document = "%PDF-1.4\n", offsets = [0];
  for (let i=0;i<objects.length;i++) { offsets.push(document.length); document += `${i+1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = document.length;
  document += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10,"0")} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(document);
}
test("real PDF engine reads text and rasterizes a textbook page", async () => {
  const task = getDocument({ data: samplePDF(), useSystemFonts:true });
  try {
    const pdf = await task.promise; assert.equal(pdf.numPages,1);
    const page = await pdf.getPage(1), text = await page.getTextContent();
    assert(text.items.some(item => "str" in item && item.str === "Apple and banana"));
    const viewport = page.getViewport({scale:2}), canvas = createCanvas(viewport.width, viewport.height);
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
    const pixel = canvas.getContext("2d").getImageData(200,300,1,1).data;
    assert(pixel[0] > 150 && pixel[1] < 150, "page art must actually render, not just return a white image");
    assert(canvas.toDataURL("image/jpeg").startsWith("data:image/jpeg;base64,"));
  } finally { await task.destroy(); }
});
