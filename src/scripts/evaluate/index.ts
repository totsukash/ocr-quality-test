import * as fs from 'fs';
import * as path from 'path';

interface ReceiptData {
  date: string;
  invoice_number: string;
  store_name: string;
  tax_10_amount: number;
  tax_8_amount: number;
  total_amount: number;
}

// 比較対象のフィールド名一覧
const FIELDS: (keyof ReceiptData)[] = [
  'date',
  'invoice_number',
  'store_name',
  'tax_10_amount',
  'tax_8_amount',
  'total_amount'
];

// 複数のディレクトリをここで指定
const dirs = [
  '領収書_SEED1',
  '領収書_SEED2',
  '領収書_SEED3',
  '領収書_ZON2',
  '領収書_ZON3',
  '領収書_ZON4',
  '領収書_あさの1',
  // 必要に応じて追加
];

async function main() {
  // 全ディレクトリを通した合計値
  let globalMatchedCount = 0; // 全ファイル・全ディレクトリで一致したフィールド数
  let globalTotalFieldCount = 0; // 全ファイル・全ディレクトリでの総フィールド数
  let globalFileCount = 0; // 全ディレクトリでの合計ファイル数

  for (const dir of dirs) {
    const evaluateDir = path.join(__dirname, '../../../data/evaluate', dir);
    const outputsDir = path.join(__dirname, '../../../data/outputs/ocr', dir);

    if (!fs.existsSync(evaluateDir)) {
      console.error(`評価用ディレクトリが見つかりませんでした: ${evaluateDir}`);
      continue; // 見つからない場合はスキップ
    }
    if (!fs.existsSync(outputsDir)) {
      console.error(`出力用ディレクトリが見つかりませんでした: ${outputsDir}`);
      continue; // 見つからない場合はスキップ
    }

    const evaluateFiles = fs.readdirSync(evaluateDir).filter(file => file.endsWith('.json'));
    const outputFiles = fs.readdirSync(outputsDir).filter(file => file.endsWith('.json'));

    // ファイル名でペアリング
    const commonFiles = evaluateFiles.filter(file => outputFiles.includes(file));

    if (commonFiles.length === 0) {
      console.log(`評価対象「${dir}」で対応するファイルが見つかりませんでした。`);
      continue;
    }

    let totalMatchScore = 0;
    let localFileCount = 0;

    console.log(`\nディレクトリ「${dir}」の結果:`);

    for (const fileName of commonFiles) {
      const evaluatePath = path.join(evaluateDir, fileName);
      const outputPath = path.join(outputsDir, fileName);

      const evaluateContent = JSON.parse(fs.readFileSync(evaluatePath, 'utf8')) as ReceiptData;
      const outputContent = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as ReceiptData;

      let matchCount = 0;
      let totalFields = FIELDS.length;

      // 各フィールドごとの比較
      for (const field of FIELDS) {
        const evalValue = evaluateContent[field];
        const outValue = outputContent[field];
        // 厳密等価比較
        if (evalValue === outValue) {
          matchCount++;
        }
      }

      const matchRate = (matchCount / totalFields) * 100;
      totalMatchScore += matchRate;
      localFileCount++;

      // グローバルなカウントにも反映
      globalMatchedCount += matchCount;
      globalTotalFieldCount += totalFields;
      globalFileCount++;

      console.log(`${fileName}: ${matchCount}/${totalFields}項目一致 (${matchRate.toFixed(2)}%)`);
    }

    const averageMatchRate = totalMatchScore / localFileCount;
    console.log(`\n「${dir}」の平均一致率: ${averageMatchRate.toFixed(2)}%`);
  }

  if (globalFileCount > 0) {
    // 全データセット合計の平均一致率(全フィールド数に対する全一致数)
    const globalMatchRate = (globalMatchedCount / globalTotalFieldCount) * 100;
    console.log(`\nすべての指定ディレクトリを合計した平均一致率: ${globalMatchRate.toFixed(2)}%`);
  } else {
    console.log('\n指定されたディレクトリには有効な評価結果がありませんでした。');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
