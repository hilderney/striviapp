#!/usr/bin/env node
require('./loadEnv');

const path = require('path');
const { SpreadsheetSummarizerBuilder } = require('./pipeline/SpreadsheetSummarizerBuilder');

async function main() {
  const args = process.argv.slice(2);
  const sourceFile = args[0];
  const outputDir = args[1] || process.env.OUTPUT_DIR || './output';

  if (!sourceFile) {
    console.error('Usage: npm run start:spreadsheet -- <planilha> [pasta-saida]');
    process.exit(1);
  }

  const inputDir = path.isAbsolute(sourceFile)
    ? path.dirname(sourceFile)
    : process.env.INPUT_DIR || './input';

  const pipeline = SpreadsheetSummarizerBuilder.create()
    .fromSpreadsheet(path.basename(sourceFile))
    .outputTo(outputDir)
    .withLogs('./logs')
    .overwrite(true)
    .exportFormats(['csv', 'xlsx'])
    .serveLinks(4000)
    .build();

  if (path.isAbsolute(sourceFile)) {
    pipeline.config.inputDir = path.dirname(sourceFile);
    pipeline.config.sourceFile = path.basename(sourceFile);
  } else {
    pipeline.config.inputDir = inputDir;
  }

  try {
    const summary = await pipeline.run();
    console.log(JSON.stringify(summary, null, 2));
    if (summary.serverUrl) {
      console.log(`Links: ${summary.serverUrl}/files`);
    }
  } finally {
    await pipeline.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
