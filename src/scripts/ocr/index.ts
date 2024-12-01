import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import dotenv from 'dotenv';

// プロジェクトルートの.envを読み込む
dotenv.config({ path: path.join(__dirname, '../../../.env') });

interface ReceiptData {
  date: string;
  store_name: string;
  total_amount: number;
  tax_8_amount: number;
  tax_10_amount: number;
  invoice_number: string;
}

const schema = {
  type: SchemaType.OBJECT,
  properties: {
    receipt: {
      type: SchemaType.OBJECT,
      properties: {
        date: {
          type: SchemaType.STRING,
          description: '領収書の日付',
        },
        store_name: {
          type: SchemaType.STRING,
          description: '店舗名または会社名',
        },
        total_amount: {
          type: SchemaType.NUMBER,
          description: '合計金額',
        },
        tax_8_amount: {
          type: SchemaType.NUMBER,
          description: '8%税率対象額',
        },
        tax_10_amount: {
          type: SchemaType.NUMBER,
          description: '10%税率対象額',
        },
        invoice_number: {
          type: SchemaType.STRING,
          description: 'インボイス登録番号',
        },
      },
      required: ['date', 'store_name', 'total_amount', 'tax_8_amount', 'tax_10_amount', 'invoice_number'],
    },
  },
  required: ['receipt'],
};

const prompt = `
この画像は領収書です。領収書から以下の情報を抽出してください：

- 日付
- 店舗名、会社名
- 合計金額
- 8%税率対象額
- 10%税率対象額
- インボイス登録番号

# 以下のルールは厳守してください
- 絶対に読み取りミスをせず、正しく読み取ってください。
- 読み取れないものは空欄にしてください。
- 金額は数値で返してください（カンマや円マークは不要です）。
- 日付は YYYY-MM-DD 形式で返してください。
  - 例: 2022-01-01
  - "6年"などの表記は令和6年の日付として扱ってください。
`;

async function analyzeImage(filePath: string): Promise<ReceiptData> {
  try {
    const buffer = await fs.promises.readFile(filePath);
    const base64Image = buffer.toString('base64');

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-pro-002",
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });

    const mimeType = filePath.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/png';

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: mimeType,
          data: base64Image
        }
      },
      { text: prompt },
    ]);

    const responseText = await result.response.text();
    const parsedData = JSON.parse(responseText);
    return parsedData.receipt;
  } catch (error) {
    console.error('Image analysis error:', error);
    throw new Error(`領収書の解析中にエラーが発生しました: ${error}`);
  }
}

async function processOCR(inputPath: string, limit?: number): Promise<Map<string, ReceiptData>> {
  const results = new Map<string, ReceiptData>();

  try {
    const files = await fs.promises.readdir(inputPath);

    // PDF または PNG ファイルをフィルタリングしてソート
    const targetFiles = files
      .filter(file => file.toLowerCase().endsWith('.pdf') || file.toLowerCase().endsWith('.png'))
      .sort((a, b) => {
        const numA = parseInt(path.parse(a).name);
        const numB = parseInt(path.parse(b).name);
        return numA - numB;
      });

    // 処理件数を制限（指定がある場合）
    const filesToProcess = limit ? targetFiles.slice(0, limit) : targetFiles;

    console.log(`Processing ${filesToProcess.length} files...`);

    // 各ファイルに対してOCR処理を実行
    for (const file of filesToProcess) {
      const originalName = path.parse(file).name;
      const filePath = path.join(inputPath, file);

      console.log(`Processing file: ${file}`);
      const ocrResult = await analyzeImage(filePath);
      results.set(originalName, ocrResult);
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

  await fs.promises.mkdir(outputDir, { recursive: true });

  for (const [fileName, data] of results.entries()) {
    const outputPath = path.join(outputDir, `${fileName}.json`);
    await fs.promises.writeFile(
      outputPath,
      JSON.stringify(data, null, 2),
      'utf-8'
    );
  }

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

    // 実行する件数はここで指定
    const results = await processOCR(inputDir, 100);

    await saveOCRResults(results);

    console.log('OCR processing completed successfully');
  } catch (error) {
    console.error('Error during OCR processing:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { processOCR, saveOCRResults, ReceiptData };