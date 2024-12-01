import fs from 'fs';
import path from 'path';

interface ReceiptData {
  date: string;
  store_name: string;
  total_amount: number;
  tax_8_amount: number;
  tax_10_amount: number;
  invoice_number: string;
}

// ダミーデータを生成する関数
function createDummyData(): ReceiptData {
  return {
    date: "2024-12-01",
    store_name: "サンプル株式会社",
    total_amount: 5500,
    tax_8_amount: 1080,
    tax_10_amount: 3000,
    invoice_number: "T1234567890123"
  };
}

async function processOCR(inputPath: string): Promise<Map<string, ReceiptData>> {
  const results = new Map<string, ReceiptData>();

  try {
    // ディレクトリ内のファイル一覧を取得
    const files = await fs.promises.readdir(inputPath);

    // PDF または PNG ファイルをフィルタリング
    const targetFiles = files.filter(file =>
      file.toLowerCase().endsWith('.pdf') || file.toLowerCase().endsWith('.png')
    );

    // 各ファイルに対してOCR処理を実行
    for (const file of targetFiles) {
      const originalName = path.parse(file).name; // 拡張子を除いたファイル名

      // ここで実際のOCR処理を行う代わりに、ダミーデータを使用
      const ocrResult = createDummyData();

      // ファイル名をキーとしてマップに保存
      results.set(originalName, ocrResult);

      console.log(`Processed file: ${file}`);
    }

  } catch (error) {
    console.error('Error processing files:', error);
    throw error;
  }

  return results;
}

async function saveOCRResults(results: Map<string, ReceiptData>): Promise<void> {
  const formatDate = (date: Date): string => {
    return date.toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      day: '2-digit',
      month: '2-digit'
    }).replace(/[\/]/g, '');
  };

  const formatTime = (date: Date): string => {
    return date.toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).replace(/[:]/g, '');
  };

  const now = new Date();
  const date = formatDate(now);
  const time = formatTime(now);
  const timestamp = `${date}_${time}`;

  const outputDir = path.join(__dirname, '..', '..', '..', 'data', 'outputs', 'ocr', timestamp);

  // Create output directory if it doesn't exist
  await fs.promises.mkdir(outputDir, { recursive: true });

  // Save individual JSON files
  for (const [fileName, data] of results.entries()) {
    const outputPath = path.join(outputDir, `${fileName}.json`);
    await fs.promises.writeFile(
      outputPath,
      JSON.stringify(data, null, 2),
      'utf-8'
    );
  }

  // Save consolidated results
  const consolidatedPath = path.join(outputDir, 'all_results.json');
  await fs.promises.writeFile(
    consolidatedPath,
    JSON.stringify(Object.fromEntries(results), null, 2),
    'utf-8'
  );
}

async function main() {
  try {
    const inputDir = path.join(__dirname, '..', '..', '..', 'data', 'original', 'separate', '1129_receipt_100', 'receipt');

    // Process OCR
    const results = await processOCR(inputDir);

    // Save results
    await saveOCRResults(results);

    console.log('OCR processing completed successfully');
  } catch (error) {
    console.error('Error during OCR processing:', error);
    process.exit(1);
  }
}

// Execute the script
if (require.main === module) {
  main();
}

export { processOCR, saveOCRResults, ReceiptData };