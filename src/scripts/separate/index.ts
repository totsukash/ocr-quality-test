import { PDFDocument } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';

interface SeparationConfig {
  inputPath: string;
  outputBasePath: string;
  splitRatio: number; // 0から1の間の数値（例：0.4は40:60の分割）
}

async function separatePDF(config: SeparationConfig) {
  const { inputPath, outputBasePath, splitRatio } = config;

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

    // 指定された比率で分割位置を計算
    const splitPosition = width * splitRatio;
    console.log(`Splitting at: ${(splitRatio * 100).toFixed(1)}% (${splitPosition.toFixed(1)} units)`);

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
const fileName = '領収書_あさの4'
const config: SeparationConfig = {
  inputPath: path.join(__dirname, `../../../data/original/${fileName}.pdf`),
  outputBasePath: path.join(__dirname, `../../../data/original/separate/${fileName}`),
  splitRatio: 0.454,
};

separatePDF(config).catch(console.error);