import path from 'path';
import { SchemaType } from "@google/generative-ai";
import dotenv from 'dotenv';
import { journalPrompt } from "./prompt";

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const { VertexAI } = require('@google-cloud/vertexai');

const project = 'omni-workspace-develop';
const location = 'us-central1';
const textModel = "gemini-1.5-pro-002";
export const bucketName = "test-taxbiz-ocr";

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
}

const inferenceByGemini = async (): Promise<string> => {
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

  const destFileName = "領収書_ZON3/receipt/1.pdf";
  const gsUrl = `gs://${bucketName}/${destFileName}`;

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

function transformToReceiptData(jsonContent: string): ReceiptData {
  try {
    const journalEntries: JournalEntry[] = JSON.parse(jsonContent);

    if (!journalEntries || journalEntries.length === 0) {
      throw new Error('Invalid or empty journal entries');
    }

    const entry = journalEntries[0];
    const tax8Amount = parseFloat(entry["8%対象金額"]) || 0;
    const totalAmount = parseFloat(entry.借方金額) || 0;
    const tax10Amount = totalAmount - tax8Amount;

    // 日付のフォーマット変換（スラッシュからハイフンへ）
    const formattedDate = entry.取引日.replace(/\//g, '-');

    return {
      date: formattedDate,
      store_name: entry.取引先,
      total_amount: totalAmount,
      tax_8_amount: tax8Amount,
      tax_10_amount: tax10Amount,
      invoice_number: entry.登録番号
    };
  } catch (error) {
    console.error('Error transforming JSON to ReceiptData:', error);
    throw error;
  }
}

export const analyzeReceipt = async (): Promise<ReceiptData> => {
  try {
    const jsonContent = await inferenceByGemini();
    return transformToReceiptData(jsonContent);
  } catch (error) {
    console.error('Error analyzing receipt:', error);
    throw error;
  }
}

analyzeReceipt().then(console.log).catch(console.error);
