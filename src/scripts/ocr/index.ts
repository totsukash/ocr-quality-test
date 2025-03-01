import path from 'path';
import { SchemaType } from "@google/generative-ai";
import dotenv from 'dotenv';
import { journalPrompt } from "./prompt";
import fs from 'fs/promises';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const { VertexAI } = require('@google-cloud/vertexai');

const project = 'omni-workspace-develop';
const location = 'us-central1';
const textModel = "gemini-1.5-pro-002";
const bucketName = "test-taxbiz-ocr";
const name = "領収書_ZON3";
const dirName = `${name}/receipt`;
const outputDir = `/Users/totsuka/github.com/totsukash/ocr-quality-test/data/outputs/ocr/${name}`;
const maxFiles = 100;
const BATCH_SIZE = 40;
const RATE_LIMIT_WINDOW = 70000;

const vertexAI = new VertexAI({ project: project, location: location });

interface JournalEntry {
  "取引日": string;
  "借方勘定科目": string;
  "貸方勘定科目": string;
  "借方税区分": string;
  "貸方税区分": string;
  "借方金額": string;
  "貸方金額": string;
  "摘要": string;
  "取引先": string;
  "登録番号": string;
  "8%対象金額": string;
  "10%対象金額": string;
  "非課税額": string;
}

// JSONとして出力される形式
interface ReceiptData {
  date: string;
  store_name: string;
  total_amount: number;
  tax_8_amount: number;
  tax_10_amount: number;
  invoice_number: string;
}

// 内部処理用の拡張インターフェース
interface InternalReceiptData extends ReceiptData {
  file_name: string;
}

function chunk<T>(array: T[], size: number): T[][] {
  return Array.from(
    { length: Math.ceil(array.length / size) },
    (_, i) => array.slice(i * size, i * size + size)
  );
}

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
            "取引日": {
              type: SchemaType.STRING,
              description: "日付"
            },
            "借方勘定科目": {
              type: SchemaType.STRING,
              description: "借方勘定科目"
            },
            "貸方勘定科目": {
              type: SchemaType.STRING,
              description: "貸方勘定科目"
            },
            "借方税区分": {
              type: SchemaType.STRING,
              description: "借方税区分"
            },
            "貸方税区分": {
              type: SchemaType.STRING,
              description: "貸方税区分"
            },
            "借方金額": {
              type: SchemaType.STRING,
              description: "借方金額"
            },
            "貸方金額": {
              type: SchemaType.STRING,
              description: "貸方金額"
            },
            "摘要": {
              type: SchemaType.STRING,
              description: "摘要"
            },
            "取引先": {
              type: SchemaType.STRING,
              description: "取引先"
            },
            "登録番号": {
              type: SchemaType.STRING,
              description: "登録番号(必ずTから始まる番号)"
            },
            "8%対象金額": {
              type: SchemaType.STRING,
              description: "8%対象金額"
            },
            "10%対象金額": {
              type: SchemaType.STRING,
              description: "10%対象金額"
            },
            "非課税楽": {
              type: SchemaType.STRING,
              description: "非課税額"
            },
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

function correctInvoiceNumber(invoiceNumber: string): string {
  // 空文字列やundefinedの場合はそのまま返す
  if (!invoiceNumber) {
    return invoiceNumber;
  }

  // 先頭が1で始まる場合、1をTに置換
  if (invoiceNumber.startsWith('1')) {
    invoiceNumber = 'T' + invoiceNumber.slice(1);
  }

  // "T1" で始まり、かつ残りの数字が13桁以上ある場合、T直後の1を除去
  if (invoiceNumber.startsWith('T1')) {
    const remainingDigits = invoiceNumber.slice(2).replace(/\D/g, '');
    if (remainingDigits.length >= 13) {
      invoiceNumber = 'T' + invoiceNumber.slice(2);
    }
  }

  return invoiceNumber;
}

function transformToReceiptData(jsonContent: string, fileName: string): InternalReceiptData {
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

    // 登録番号の修正を適用
    const correctedInvoiceNumber = correctInvoiceNumber(entry.登録番号);

    return {
      date: formattedDate,
      store_name: entry.取引先,
      total_amount: totalAmount,
      tax_8_amount: tax8Amount,
      tax_10_amount: tax10Amount,
      invoice_number: correctedInvoiceNumber,
      file_name: fileName
    };
  } catch (error) {
    console.error('Error transforming JSON to ReceiptData:', error);
    throw error;
  }
}

async function saveReceiptToJson(receipt: InternalReceiptData, outputDir: string): Promise<void> {
  try {
    await fs.mkdir(outputDir, { recursive: true });

    const fileNumber = path.basename(receipt.file_name, '.pdf');
    const outputPath = path.join(outputDir, `${fileNumber}.json`);

    // file_nameを除外したデータを保存
    const { file_name, ...receiptDataWithoutFileName } = receipt;

    await fs.writeFile(
      outputPath,
      JSON.stringify(receiptDataWithoutFileName, null, 2),
      'utf-8'
    );
    console.log(`Receipt data saved to: ${outputPath}`);
  } catch (error) {
    console.error(`Error saving receipt to JSON (${receipt.file_name}):`, error);
    throw error;
  }
}

async function processFilesBatch(fileNames: string[], outputDir: string): Promise<InternalReceiptData[]> {
  const batchResults = await Promise.allSettled(
    fileNames.map(async fileName => {
      try {
        console.log(`Processing file: ${fileName}`);
        const jsonContent = await inferenceByGemini(fileName);
        const receiptData = transformToReceiptData(jsonContent, fileName);

        await saveReceiptToJson(receiptData, outputDir);

        console.log(`Successfully processed: ${fileName}`);
        return receiptData;
      } catch (error) {
        console.error(`Error processing ${fileName}:`, error);
        throw error;
      }
    })
  );

  return batchResults
    .filter((result): result is PromiseFulfilledResult<InternalReceiptData> => result.status === 'fulfilled')
    .map(result => result.value);
}

export const analyzeReceipts = async (outputDir: string): Promise<ReceiptData[]> => {
  const fileNames = Array.from(
    { length: maxFiles },
    (_, i) => `${dirName}/${i + 1}.pdf`
  );

  const batches = chunk(fileNames, BATCH_SIZE);
  const allResults: InternalReceiptData[] = [];

  console.log(`Starting processing ${fileNames.length} files in ${batches.length} batches...`);

  for (let i = 0; i < batches.length; i++) {
    console.log(`Processing batch ${i + 1}/${batches.length}`);
    const startTime = Date.now();

    const batchResults = await processFilesBatch(batches[i], outputDir);
    allResults.push(...batchResults);

    const elapsedTime = Date.now() - startTime;
    if (elapsedTime < RATE_LIMIT_WINDOW && i < batches.length - 1) {
      const waitTime = RATE_LIMIT_WINDOW - elapsedTime;
      console.log(`Waiting ${waitTime}ms before next batch...`);
      await wait(waitTime);
    }
  }

  // 最終的な結果からfile_nameを除外して返す
  return allResults.map(({ file_name, ...rest }) => rest);
}

analyzeReceipts(outputDir)
  .then(results => {
    console.log('All processing completed!');
    console.log('Total processed files:', results.length);
  })
  .catch(error => {
    console.error('Fatal error:', error);
  });