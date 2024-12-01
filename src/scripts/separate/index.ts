import { PDFDocument, rgb, PDFArray, PDFDict, PDFName, PDFNumber, PDFObject, PDFRef } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';

interface SeparationConfig {
  inputPath: string;
  outputBasePath: string;
}

async function findBlankBoundaryUsingAnnotations(pdfDoc: PDFDocument, pageIndex: number): Promise<number> {
  const page = pdfDoc.getPages()[pageIndex];
  const { width } = page.getSize();

  // アノテーションまたは他の要素からテキスト位置を取得
  const annotsKey = PDFName.of('Annots');
  const annotationsRef = page.node.get(annotsKey) as PDFRef | undefined;
  if (!annotationsRef) {
    return width / 2; // アノテーションがない場合は中央を返す
  }

  const annotations = page.node.context.lookup(annotationsRef, PDFArray) as PDFArray | undefined;
  if (!annotations) {
    return width / 2;
  }

  let minX = width;
  let maxX = 0;

  for (let i = 0; i < annotations.size(); i++) {
    const annotationRef = annotations.get(i) as PDFRef;
    const annotationDict = page.node.context.lookup(annotationRef, PDFDict) as PDFDict;
    if (annotationDict) {
      const rectKey = PDFName.of('Rect');
      const rect = annotationDict.lookup(rectKey, PDFArray) as PDFArray;
      if (rect) {
        const x1 = rect.lookup(0, PDFNumber).asNumber();
        const x2 = rect.lookup(2, PDFNumber).asNumber();
        if (x1 < minX) minX = x1;
        if (x2 > maxX) maxX = x2;
      }
    }
  }

  // 左側と右側の空白の中心を分割位置として返す
  return (minX + maxX) / 2;
}

async function separatePDF(config: SeparationConfig) {
  const { inputPath, outputBasePath } = config;

  // 出力ディレクトリの作成
  const receiptDir = path.join(outputBasePath, 'receipt');
  const truthDir = path.join(outputBasePath, 'ground_truth');

  [receiptDir, truthDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // 入力PDFの読み込み
  console.log('Reading input PDF...');
  const inputBytes = fs.readFileSync(inputPath);
  const inputPdf = await PDFDocument.load(inputBytes);
  const pageCount = inputPdf.getPageCount();
  console.log(`Found ${pageCount} pages`);

  // 各ページを処理
  for (let i = 0; i < pageCount; i++) {
    console.log(`Processing page ${i + 1}...`);

    const page = inputPdf.getPages()[i];
    const { width, height } = page.getSize();

    // 空白の境界をアノテーションを基に検出
    const splitPosition = await findBlankBoundaryUsingAnnotations(inputPdf, i);
    console.log(`Found blank boundary at: ${(splitPosition / width * 100).toFixed(1)}%`);

    // レシート（左側）のPDF生成
    const receiptPdf = await PDFDocument.create();
    const [receiptEmbedPage] = await receiptPdf.embedPages([page], [{
      left: 0,
      right: splitPosition,
      top: height,
      bottom: 0,
    }]);

    const receiptPage = receiptPdf.addPage([splitPosition, height]);
    receiptPage.drawPage(receiptEmbedPage);

    // Ground Truth（右側）のPDF生成
    const truthStartX = splitPosition;
    const truthPdf = await PDFDocument.create();
    const [truthEmbedPage] = await truthPdf.embedPages([page], [{
      left: truthStartX,
      right: width,
      top: height,
      bottom: 0,
    }]);

    const truthPage = truthPdf.addPage([width - truthStartX, height]);
    truthPage.drawPage(truthEmbedPage);

    // PDFを保存
    const receiptBytes = await receiptPdf.save();
    const truthBytes = await truthPdf.save();

    const pageNum = i + 1;
    fs.writeFileSync(path.join(receiptDir, `${pageNum}.pdf`), receiptBytes);
    fs.writeFileSync(path.join(truthDir, `${pageNum}.pdf`), truthBytes);

    console.log(`Saved page ${pageNum}`);
  }

  console.log('PDF separation completed successfully!');
}

// 使用例
const config: SeparationConfig = {
  inputPath: path.join(__dirname, '../../../data/original/1129_receipt_100.pdf'),
  outputBasePath: path.join(__dirname, '../../../data/outputs/1129_receipt_100'),
};

separatePDF(config).catch(console.error);
