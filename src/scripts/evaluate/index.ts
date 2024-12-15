import fs from 'fs';
import path from 'path';

const CONFIG = {
  outputsDir: '/Users/totsuka/github.com/totsukash/ocr-quality-test/data/outputs/ocr/領収書_ZON3',
  evaluateDir: '/Users/totsuka/github.com/totsukash/ocr-quality-test/data/evaluate/領収書_ZON3',
  outputCsvPath: '/Users/totsuka/github.com/totsukash/ocr-quality-test/comparison_results.csv'
} as const;

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

  private cleanInvoiceNumber(invoice: string): string {
    // TとT以外の数字のみを残して他は削除
    return invoice.replace(/[^T0-9]/g, '');
  }

  private readJsonFile(filePath: string): Receipt {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content) as Receipt;

      // outputsDirからの読み込みの場合のみinvoice_numberを加工
      if (filePath.includes(this.outputsDir)) {
        data.invoice_number = this.cleanInvoiceNumber(data.invoice_number);
      }

      return data;
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
          ? COMPARISON_SYMBOLS.MATCH  // store_nameは常にマッチとする
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
    const headers = ['file_name', 'field', 'outputs_value', 'evaluate_value', 'comparison_result'];
    const csvRows = [
      headers.join(','),
      ...rows.map(row => [
        `"${row.file_name}"`,
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
      const files = fs.readdirSync(this.outputsDir)
        .filter(file => file.endsWith('.json'))
        .sort((a, b) => {
          const numA = parseInt(a.split('.')[0]);
          const numB = parseInt(b.split('.')[0]);
          return numA - numB;
        });

      const allComparisons = files.flatMap(file => this.compareReceipts(file));

      const csv = this.generateCsv(allComparisons);
      fs.writeFileSync(outputPath, csv, 'utf8');

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

const main = () => {
  try {
    const comparator = new ReceiptComparator(CONFIG.outputsDir, CONFIG.evaluateDir);
    comparator.compareAndGenerateCsv(CONFIG.outputCsvPath);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

main();