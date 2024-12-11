import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import dotenv from 'dotenv';
import pLimit from 'p-limit';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const MODEL_NAME = 'gemini-1.5-pro-002';

// const MODEL_NAME = 'gemini-exp-1206';

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

// 画像→テキスト抽出用プロンプト
const textExtractionPrompt = `
この画像は領収書/レシートです。画像を読み取って、領収書に記載された全てのテキスト情報を出力してください。
読み取れた情報を正確にテキスト化してください。

テキストの出力は改行を含めるなど、今後あなたが最も理解しやすい形式で出力してください。

最終的には以下の情報を取得したいです。
この辺の情報は注意深く読み取ってください。

手書きの領収書の場合、金額の前に「¥」が付いていることがあります。金額の前に「¥」がある場合は削除して、数値のみを抽出してください。
「¥」を数字の7や9と誤認識しないように注意してください。

以下のような表記は全て和暦の「令和」として扱ってください。
- 6年 のような1桁の年数
- R6 のようなR+1桁の年数(数字の9と勘違いしないでください。96年のような表記はありません)
- R和6 のようなR和+1桁の年数

- data: 日付（YYYY-MM-DD形式、"6年"などは令和6年の日付として扱う）
- store_name: 店舗名、会社名: なるべく正確に。店舗名と会社名の両方ある場合は、店舗名を優先してください。
- total_amount: 合計金額
- tax_8_amount: 8%税率対象額（数値）
- tax_10_amount: 10%税率対象額（数値）
- invoice_number: インボイス登録番号(Tから始まる英数字)
`;

// テキスト→JSON生成用プロンプト関数
const jsonConversionPrompt = (extractedText: string) => `
以下は領収書から抽出したテキストです。
このテキストを元に、以下の情報を指定したJSON形式で抽出してください。

- data: 日付（YYYY-MM-DD形式、"6年","R6"などは令和6年の日付として扱う）
  - 令和1年(令和元年): 2019年
  - 令和2年: 2020年
  - 令和3年: 2021年
  - 令和4年: 2022年
  - 令和5年: 2023年
  - 令和6年: 2024年
  - 令和7年: 2025年
  - 令和8年: 2026年
  - 令和9年: 2027年
  - 令和10年: 2028年
- store_name: 店舗名、会社名: なるべく正確に。店舗名と会社名の両方ある場合は、店舗名を優先してください。
- total_amount: 合計金額（数値、カンマ・単位(円)なし・「¥」などの記号なし）
- tax_8_amount: 8%税率対象額（数値）
- tax_10_amount: 10%税率対象額（数値）
- invoice_number: インボイス登録番号(Tから始まる英数字, ハイフンなし。Tと数字のみ。スペースなし)

抽出結果を必ずスキーマに従いJSONで出力してください。読み取れない項目は空文字にしてください。

抽出元テキスト:
${extractedText}
`;

async function extractTextFromImage(filePath: string): Promise<string> {
  const buffer = await fs.promises.readFile(filePath);
  const base64Image = buffer.toString('base64');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      temperature: 0,
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
    { text: textExtractionPrompt }
  ]);

  const extractedText = result.response.text();
  console.log('Extracted text:', extractedText);
  return extractedText;
}

async function convertTextToJSON(extractedText: string): Promise<ReceiptData> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });

  const prompt = jsonConversionPrompt(extractedText);

  const result = await model.generateContent([
    { text: prompt }
  ]);
  const responseText = result.response.text();
  const parsedData = JSON.parse(responseText);
  return parsedData.receipt;
}

async function analyzeImage(filePath: string): Promise<ReceiptData> {
  try {
    // 1: 画像からテキスト抽出
    const extractedText = await extractTextFromImage(filePath);
    // 2: テキストからJSON生成
    return await convertTextToJSON(extractedText);
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
    console.log(`Processing ${filesToProcess.length} files in directory: ${inputPath}`);

    // 50件ずつのチャンクに分けて処理
    const chunks = [];
    for (let i = 0; i < filesToProcess.length; i += 50) {
      chunks.push(filesToProcess.slice(i, i + 50));
    }

    // チャンクごとに処理
    const rateLimiter = pLimit(1); // chunk単位で1回ずつ処理
    for (const [index, chunk] of chunks.entries()) {
      console.log(`Processing chunk ${index + 1} of ${chunks.length} in directory: ${inputPath}`);

      const chunkLimit = pLimit(50); // chunk内50並列
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

      // chunk完了待機
      await rateLimiter(() => Promise.all(chunkPromises));

      // 次のchunk前に1分待つ
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

async function saveOCRResults(results: Map<string, ReceiptData>, dirName: string): Promise<void> {
  const outputDir = path.join(__dirname, '..', '..', '..', 'data', 'outputs', 'ocr', dirName);
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
    const directories = [
      '領収書_SEED1',
    ];

    for (const dirName of directories) {
      const inputDir = path.join(__dirname, '..', '..', '..', 'data', 'original', 'separate', dirName, 'receipt');
      const results = await processOCR(inputDir, 100);
      await saveOCRResults(results, dirName);
      console.log(`OCR processing completed successfully for directory: ${dirName}`);
    }

  } catch (error) {
    console.error('Error during OCR processing:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().then();
}

export { processOCR, saveOCRResults, ReceiptData };
