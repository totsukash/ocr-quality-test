import fs from 'fs';
import path from 'path';

const dirNames = [
  // '領収書_SEED1',
  '領収書_SEED2',
  '領収書_SEED3',
  '領収書_ZON2',
  // '領収書_ZON3',
  // '領収書_ZON4',
  // '領収書_あさの1',
  // '領収書_あさの2',
  // '領収書_あさの3',
  // '領収書_あさの4',
  // '領収書_えびす1',
  // '領収書_えびす2',
  // '領収書_おもてなし1',
  // '領収書_おもてなし2',
  // '領収書_おもてなし3',
  // '領収書_アジョブ1',
  // '領収書_アジョブ2',
  // '領収書_アレックス2',
];

const CONFIG = {
  outputsBaseDir: `/Users/totsuka/github.com/totsukash/ocr-quality-test/data/outputs/ocr`,
  evaluateBaseDir: `/Users/totsuka/github.com/totsukash/ocr-quality-test/data/evaluate`,
  outputBaseDir: `/Users/totsuka/github.com/totsukash/ocr-quality-test/data/compare_results`,
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
  memo: string;
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
    return invoice.replace(/[^T0-9]/g, '');
  }

  private readJsonFile(filePath: string): Receipt {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content) as Receipt;

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
          ? COMPARISON_SYMBOLS.MATCH
          : String(outputsData[field]) === String(evaluateData[field])
            ? COMPARISON_SYMBOLS.MATCH
            : COMPARISON_SYMBOLS.MISMATCH,
        memo: ''
      }));
    } catch (error) {
      console.error(`Error comparing ${fileName}:`, error);
      return [];
    }
  }

  private generateCsv(rows: ComparisonRow[]): string {
    const headers = ['file_name', 'field', 'outputs_value', 'evaluate_value', 'comparison_result', 'memo'];
    const csvRows = [
      headers.join(','),
      ...rows.map(row => [
        `"${row.file_name}"`,
        `"${row.field}"`,
        `"${row.outputs_value}"`,
        `"${row.evaluate_value}"`,
        `"${row.comparison_result}"`,
        `"${row.memo}"`
      ].join(','))
    ];
    return csvRows.join('\n');
  }

  public compareAndGenerateCsv(outputBaseDir: string, dirName: string): void {
    try {
      const files = fs.readdirSync(this.outputsDir)
        .filter(file => file.endsWith('.json'))
        .sort((a, b) => {
          const numA = parseInt(a.split('.')[0]);
          const numB = parseInt(b.split('.')[0]);
          return numA - numB;
        });


      const allComparisons = files.flatMap(file => this.compareReceipts(file));
      const matchCount = allComparisons.filter(row => row.comparison_result === COMPARISON_SYMBOLS.MATCH).length;
      const totalCount = allComparisons.length;
      const percentage = totalCount > 0 ? ((matchCount / totalCount) * 100).toFixed(2) : '0.00';

      const timestamp = new Date().toLocaleString('ja-JP', {
        year: '2-digit',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).replace(/\//g, '').replace(/ /g, '').replace(/:/g, '');

      const outputDir = path.join(outputBaseDir, dirName);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const outputPath = path.join(outputDir, `${timestamp}_${percentage}_${dirName}.csv`);

      const csv = this.generateCsv(allComparisons);
      fs.writeFileSync(outputPath, csv, 'utf8');

      const mismatchCount = allComparisons.filter(
        row => row.comparison_result === COMPARISON_SYMBOLS.MISMATCH
      ).length;

      console.log(`Comparison complete for ${dirName}. CSV file written to: ${outputPath}`);
      console.log(`Total files processed: ${files.length}`);
      console.log(`Total differences found: ${mismatchCount}`);
      console.log(`Match percentage: ${percentage}%`);
    } catch (error) {
      console.error(`Error during comparison for ${dirName}:`, error);
      throw error;
    }
  }
}

const main = () => {
  try {
    dirNames.forEach(dirName => {
      const outputsDir = path.join(CONFIG.outputsBaseDir, dirName);
      const evaluateDir = path.join(CONFIG.evaluateBaseDir, dirName);
      const comparator = new ReceiptComparator(outputsDir, evaluateDir);
      comparator.compareAndGenerateCsv(CONFIG.outputBaseDir, dirName);
    });
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};


main();