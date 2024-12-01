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

async function processOCR(inputPath: string): Promise<ReceiptData[]> {
  // この関数内でOCR処理を実装
  // 仮実装としてダミーデータを返す
  return [];
}

async function saveOCRResults(results: ReceiptData[]): Promise<void> {
  // 日付と時刻を別々に取得
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

  // Save individual JSON files for each receipt
  await Promise.all(
    results.map(async (result, index) => {
      const fileName = `${index + 1}.json`;
      const filePath = path.join(outputDir, fileName);
      await fs.promises.writeFile(
        filePath,
        JSON.stringify(result, null, 2),
        'utf-8'
      );
    })
  );

  // Save consolidated results
  const consolidatedPath = path.join(outputDir, 'all_results.json');
  await fs.promises.writeFile(
    consolidatedPath,
    JSON.stringify(results, null, 2),
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