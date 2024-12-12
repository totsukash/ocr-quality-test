import path from 'path';
import { SchemaType } from "@google/generative-ai";
import dotenv from 'dotenv';
import { journalPrompt } from "./prompt";

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const { VertexAI } = require('@google-cloud/vertexai');

const project = 'omni-workspace-develop';
const location = 'us-central1';
// const textModel = "gemini-2.0-flash-exp";
const textModel = "gemini-1.5-pro-002";
const bucketName = "test-taxbiz-ocr";
const dirName = "領収書_ZON3/receipt";
const maxFiles = 100;  // 処理する最大ファイル数
const BATCH_SIZE = 50;  // 1バッチあたりの処理数
const RATE_LIMIT_WINDOW = 60000;  // レートリミットのウィンドウ (1分 = 60000ms)

const vertexAI = new VertexAI({ project: project, location: location });

interface JournalEntry {
  取引日: string;
  借方勘定科目: string;
  貸方勘定科目: string;
  借方税区分: string;
  貸方税区分: string;
  借方金額: string;
  貸方金額: string;
  摘要: string;
  取引先: string;
  登録番号: string;
  "8%対象金額": string;
}

interface ReceiptData {
  date: string;
  store_name: string;
  total_amount: number;
  tax_8_amount: number;
  tax_10_amount: number;
  invoice_number: string;
  file_name: string;
}

// 配列をチャンクに分割するヘルパー関数
function chunk<T>(array: T[], size: number): T[][] {
  return Array.from(
    { length: Math.ceil(array.length / size) },
    (_, i) => array.slice(i * size, i * size + size)
  );
}

// 指定時間待機する関数
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const inferenceByGemini = async (fileName: string): Promise<string> => {
  const generativeModel = vertexAI.getGenerativeModel({
    model: textModel,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            取引日: { type: SchemaType.STRING },
            借方勘定科目: { type: SchemaType.STRING },
            貸方勘定科目: { type: SchemaType.STRING },
            借方税区分: { type: SchemaType.STRING },
            貸方税区分: { type: SchemaType.STRING },
            借方金額: { type: SchemaType.STRING },
            貸方金額: { type: SchemaType.STRING },
            摘要: { type: SchemaType.STRING },
            取引先: { type: SchemaType.STRING },
            登録番号: { type: SchemaType.STRING },
            "8%対象金額": { type: SchemaType.STRING },
          },
          required: ["取引日", "借方勘定科目", "貸方勘定科目", "借方税区分", "貸方税区分", "借方金額", "貸方金額", "摘要", "登録番号", "8%対象金額"],
        },
      },
    },
  });

  const gsUrl = `gs://${bucketName}/${fileName}`;

  const textPart = {
    text: journalPrompt,
  };
  const filePart = {
    fileData: {
      fileUri: gsUrl,
      mimeType: "application/pdf",
    },
  };

  const request = {
    contents: [{
      role: "user",
      parts: [filePart, textPart],
    }],
  };

  const result = await generativeModel.generateContent(request);
  return result.response.candidates![0].content.parts[0].text;
}

function transformToReceiptData(jsonContent: string, fileName: string): ReceiptData {
  try {
    const journalEntries: JournalEntry[] = JSON.parse(jsonContent);

    if (!journalEntries || journalEntries.length === 0) {
      throw new Error('Invalid or empty journal entries');
    }

    const entry = journalEntries[0];
    const tax8Amount = parseFloat(entry["8%対象金額"]) || 0;
    const totalAmount = parseFloat(entry.借方金額) || 0;
    const tax10Amount = totalAmount - tax8Amount;

    const formattedDate = entry.取引日.replace(/\//g, '-');

    return {
      date: formattedDate,
      store_name: entry.取引先,
      total_amount: totalAmount,
      tax_8_amount: tax8Amount,
      tax_10_amount: tax10Amount,
      invoice_number: entry.登録番号,
      file_name: fileName
    };
  } catch (error) {
    console.error('Error transforming JSON to ReceiptData:', error);
    throw error;
  }
}

async function processFilesBatch(fileNames: string[]): Promise<ReceiptData[]> {
  const batchResults = await Promise.allSettled(
    fileNames.map(async fileName => {
      try {
        console.log(`Processing file: ${fileName}`);
        const jsonContent = await inferenceByGemini(fileName);
        const receiptData = transformToReceiptData(jsonContent, fileName);
        console.log(`Successfully processed: ${fileName}`);
        return receiptData;
      } catch (error) {
        console.error(`Error processing ${fileName}:`, error);
        throw error;
      }
    })
  );

  // 成功した結果のみを返す
  return batchResults
    .filter((result): result is PromiseFulfilledResult<ReceiptData> => result.status === 'fulfilled')
    .map(result => result.value);
}

export const analyzeReceipts = async (): Promise<ReceiptData[]> => {
  // ファイル名の配列を生成
  const fileNames = Array.from(
    { length: maxFiles },
    (_, i) => `${dirName}/${i + 1}.pdf`
  );

  // ファイル名をバッチサイズで分割
  const batches = chunk(fileNames, BATCH_SIZE);
  const allResults: ReceiptData[] = [];

  console.log(`Starting processing ${fileNames.length} files in ${batches.length} batches...`);

  for (let i = 0; i < batches.length; i++) {
    console.log(`Processing batch ${i + 1}/${batches.length}`);
    const startTime = Date.now();

    const batchResults = await processFilesBatch(batches[i]);
    allResults.push(...batchResults);

    // バッチ間でレートリミットを適用
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime < RATE_LIMIT_WINDOW && i < batches.length - 1) {
      const waitTime = RATE_LIMIT_WINDOW - elapsedTime;
      console.log(`Waiting ${waitTime}ms before next batch...`);
      await wait(waitTime);
    }
  }

  return allResults;
}

// メイン実行部分
analyzeReceipts()
  .then(results => {
    console.log('All processing completed!');
    console.log('Total processed files:', results.length);
    console.log('Results:', JSON.stringify(results, null, 2));
  })
  .catch(error => {
    console.error('Fatal error:', error);
  });