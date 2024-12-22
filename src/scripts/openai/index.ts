import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import OpenAI from 'openai';
import { journalPrompt } from "./prompt";

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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

interface InternalReceiptData extends ReceiptData {
  file_name: string;
}

async function encodeImage(imagePath: string): Promise<string> {
  const imageBuffer = await fs.readFile(imagePath);
  return imageBuffer.toString('base64');
}

async function inferenceByOpenAI(filePath: string, prompt: string, temperature: number = 1): Promise<string> {
  try {
    const base64Image = await encodeImage(filePath);

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            }
          ]
        }
      ],
      max_tokens: 500,
      temperature: temperature
    });

    return response.choices[0].message.content || '';
  } catch (error) {
    console.error('Error in OpenAI inference:', error);
    throw error;
  }
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

async function saveReceiptToJson(receipt: InternalReceiptData, outputDir: string): Promise<void> {
  try {
    await fs.mkdir(outputDir, { recursive: true });

    const fileNumber = path.basename(receipt.file_name, '.pdf');
    const outputPath = path.join(outputDir, `${fileNumber}.json`);

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

async function processFilesBatch(
  fileNames: string[],
  outputDir: string,
  prompt: string
): Promise<InternalReceiptData[]> {
  const batchResults = await Promise.allSettled(
    fileNames.map(async fileName => {
      try {
        console.log(`Processing file: ${fileName}`);
        const jsonContent = await inferenceByOpenAI(fileName, prompt);
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

function chunk<T>(array: T[], size: number): T[][] {
  return Array.from(
    { length: Math.ceil(array.length / size) },
    (_, i) => array.slice(i * size, i * size + size)
  );
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function analyzeReceipts(
  dirPath: string,
  outputDir: string,
  prompt: string,
  maxFiles: number = 100,
  batchSize: number = 50,
  rateLimitWindow: number = 60000
): Promise<ReceiptData[]> {
  const fileNames = Array.from(
    { length: maxFiles },
    (_, i) => path.join(dirPath, `${i + 1}.pdf`)
  );

  const batches = chunk(fileNames, batchSize);
  const allResults: InternalReceiptData[] = [];

  console.log(`Starting processing ${fileNames.length} files in ${batches.length} batches...`);

  for (let i = 0; i < batches.length; i++) {
    console.log(`Processing batch ${i + 1}/${batches.length}`);
    const startTime = Date.now();

    const batchResults = await processFilesBatch(batches[i], outputDir, prompt);
    allResults.push(...batchResults);

    const elapsedTime = Date.now() - startTime;
    if (elapsedTime < rateLimitWindow && i < batches.length - 1) {
      const waitTime = rateLimitWindow - elapsedTime;
      console.log(`Waiting ${waitTime}ms before next batch...`);
      await wait(waitTime);
    }
  }

  return allResults.map(({ file_name, ...rest }) => rest);
}

// Usage example
const prompt = journalPrompt;
const dirPath = "/Users/totsuka/github.com/totsukash/ocr-quality-test/data/original/separate/領収書_ZON3/receipt";
const outputDir = "/Users/totsuka/github.com/totsukash/ocr-quality-test/data/outputs/ocr/領収書_ZON3";

analyzeReceipts(dirPath, outputDir, prompt)
  .then(results => {
    console.log('All processing completed!');
    console.log('Total processed files:', results.length);
  })
  .catch(error => {
    console.error('Fatal error:', error);
  });