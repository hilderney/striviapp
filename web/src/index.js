const path = require('path');
const { PdfSummarizerBuilder } = require('./pipeline/PdfSummarizerBuilder');

async function main() {
  const args = process.argv.slice(2);
  const inputDir = args[0] || process.env.PDF_INPUT_DIR;

  if (!inputDir) {
    console.error('Usage: npm start -- <pdf-directory> [output-dir]');
    console.error('Example: npm start -- ./pdfs ./output');
    process.exit(1);
  }

  const outputDir = args[1] || './output';
  const pipeline = PdfSummarizerBuilder.create()
    .fromDirectory(path.resolve(inputDir))
    .outputTo(path.resolve(outputDir))
    .withLogs('./logs')
    .recursive(false)
    .exportFormats(['csv', 'xlsx'])
    .serveLinks(4000)
    .build();

  try {
    const summary = await pipeline.run();

    console.log('\nStriviapp — Fase 1');
    console.log('------------------------');
    console.log(`PDFs encontrados:  ${summary.scanned}`);
    console.log(`Extrações OK:      ${summary.extracted}`);
    console.log(`Falhas:            ${summary.failed}`);
    console.log(`Log:               ${summary.logFile}`);

    for (const csv of summary.exports.csv) {
      console.log(`CSV:               ${csv.filePath}`);
    }
    for (const xlsx of summary.exports.xlsx) {
      console.log(`Excel:             ${xlsx.filePath}`);
    }
    if (summary.serverUrl) {
      console.log(`Links:             ${summary.serverUrl}/files`);
      console.log('\nServidor ativo. Pressione Ctrl+C para encerrar.');
    } else {
      await pipeline.close();
    }

    if (summary.serverUrl) {
      process.on('SIGINT', async () => {
        await pipeline.close();
        process.exit(0);
      });
      process.on('SIGTERM', async () => {
        await pipeline.close();
        process.exit(0);
      });
    }
  } catch (error) {
    console.error('Erro:', error.message);
    await pipeline.close();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
