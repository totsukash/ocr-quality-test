import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import dotenv from 'dotenv';
import pLimit from 'p-limit';

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
      required: [
        'date',
        'store_name',
        'total_amount',
        'tax_8_amount',
        'tax_10_amount',
        'invoice_number',
      ],
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
    const targetFiles = files
      .filter(file => file.toLowerCase().endsWith('.pdf') || file.toLowerCase().endsWith('.png'))
      .sort((a, b) => {
        const numA = parseInt(path.parse(a).name);
        const numB = parseInt(path.parse(b).name);
        return numA - numB;
      });

    const filesToProcess = limit ? targetFiles.slice(0, limit) : targetFiles;
    console.log(`Processing ${filesToProcess.length} files...`);

    // Create chunks of 50 files
    const chunks = [];
    for (let i = 0; i < filesToProcess.length; i += 50) {
      chunks.push(filesToProcess.slice(i, i + 50));
    }

    // Process chunks with rate limiting
    const rateLimiter = pLimit(1); // Only process one chunk at a time
    for (const [index, chunk] of chunks.entries()) {
      console.log(`Processing chunk ${index + 1} of ${chunks.length}`);

      // Process files within chunk in parallel
      const chunkLimit = pLimit(50); // Process up to 50 files simultaneously within chunk
      const chunkPromises = chunk.map(file => {
        const originalName = path.parse(file).name;
        const filePath = path.join(inputPath, file);

        return chunkLimit(() => analyzeImage(filePath)
          .then(result => {
            results.set(originalName, result);
            console.log(`Processed file: ${file}`);
          })
          .catch(error => {
            console.error(`Error processing ${file}:`, error);
          }));
      });

      // Wait for current chunk to complete
      await rateLimiter(() => Promise.all(chunkPromises));

      // Wait for 1 minute before processing next chunk
      if (index < chunks.length - 1) {
        console.log('Waiting 1 minute before processing next chunk...');
        await new Promise(resolve => setTimeout(resolve, 60000));
      }
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
  const timestamp = `${formatDate(now)}_${formatTime(now)}`;
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
    const inputDir = path.join(__dirname, '..', '..', '..', 'data', 'original', 'separate', '領収書_あさの4', 'receipt');
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
