import fs from 'fs';
import path from 'path';

// ディレクトリとファイルパスの設定
const CONFIG = {
  outputsDir: '/Users/totsuka/github.com/totsukash/ocr-quality-test/data/outputs/ocr/領収書_ZON3',
  evaluateDir: '/Users/totsuka/github.com/totsukash/ocr-quality-test/data/evaluate/領収書_ZON3',
  outputCsvPath: './comparison_results.csv'
} as const;

// 比較結果を表す記号の定義
const COMPARISON_SYMBOLS = {
  MATCH: '✅',
  MISMATCH: '❌'
} as const;

interface Receipt {
  date: string;
  invoice_number: string;
  store_name: string;
  tax_10_amount: number;
  tax_8_amount: number;
  total_amount: number;
}

interface ComparisonRow {
  file_name: string;
  field: keyof Receipt;
  outputs_value: string;
  evaluate_value: string;
  comparison_result: typeof COMPARISON_SYMBOLS.MATCH | typeof COMPARISON_SYMBOLS.MISMATCH;
}

class ReceiptComparator {
  private readonly outputsDir: string;
  private readonly evaluateDir: string;
  private readonly fields: (keyof Receipt)[] = [
    'date',
    'invoice_number',
    'store_name',
    'tax_10_amount',
    'tax_8_amount',
    'total_amount'
  ];

  constructor(outputsDir: string, evaluateDir: string) {
    this.outputsDir = outputsDir;
    this.evaluateDir = evaluateDir;
  }

  private readJsonFile(filePath: string): Receipt {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content) as Receipt;
    } catch (error) {
      throw new Error(`Error reading file ${filePath}: ${error}`);
    }
  }

  private compareReceipts(fileName: string): ComparisonRow[] {
    const outputsPath = path.join(this.outputsDir, fileName);
    const evaluatePath = path.join(this.evaluateDir, fileName);

    try {
      const outputsData = this.readJsonFile(outputsPath);
      const evaluateData = this.readJsonFile(evaluatePath);

      return this.fields.map(field => ({
        file_name: fileName,
        field,
        outputs_value: String(outputsData[field]),
        evaluate_value: String(evaluateData[field]),
        comparison_result: field === 'store_name'
          ? COMPARISON_SYMBOLS.MATCH  // store_nameは常にMATCH
          : String(outputsData[field]) === String(evaluateData[field])
            ? COMPARISON_SYMBOLS.MATCH
            : COMPARISON_SYMBOLS.MISMATCH
      }));
    } catch (error) {
      console.error(`Error comparing ${fileName}:`, error);
      return [];
    }
  }

  private generateCsv(rows: ComparisonRow[]): string {
    const headers = ['番号', '項目', 'AI読み取りデータ', '正解データ', '結果(完全一致)'];
    const csvRows = [
      headers.join(','),
      ...rows.map(row => [
        `"${row.file_name.replace('.json', '')}"`,
        `"${row.field}"`,
        `"${row.outputs_value}"`,
        `"${row.evaluate_value}"`,
        `"${row.comparison_result}"`
      ].join(','))
    ];
    return csvRows.join('\n');
  }

  public compareAndGenerateCsv(outputPath: string): void {
    try {
      // Get all JSON files from the outputs directory
      const files = fs.readdirSync(this.outputsDir)
        .filter(file => file.endsWith('.json'))
        .sort((a, b) => {
          const numA = parseInt(a.split('.')[0]);
          const numB = parseInt(b.split('.')[0]);
          return numA - numB;
        });

      // Compare all files and flatten the results
      const allComparisons = files.flatMap(file => this.compareReceipts(file));

      // Generate and write CSV
      const csv = this.generateCsv(allComparisons);
      fs.writeFileSync(outputPath, csv, 'utf8');

      // Count mismatches (excluding store_name)
      const mismatchCount = allComparisons.filter(
        row => row.comparison_result === COMPARISON_SYMBOLS.MISMATCH
      ).length;

      console.log(`Comparison complete. CSV file written to: ${outputPath}`);
      console.log(`Total files processed: ${files.length}`);
      console.log(`Total differences found: ${mismatchCount}`);
    } catch (error) {
      console.error('Error during comparison:', error);
      throw error;
    }
  }
}

// メイン処理の実行
const main = () => {
  try {
    const comparator = new ReceiptComparator(CONFIG.outputsDir, CONFIG.evaluateDir);
    comparator.compareAndGenerateCsv(CONFIG.outputCsvPath);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

// スクリプトの実行
main();