module.exports = {
  logger: require('./loggerAdapter'),
  pdfParser: require('./pdfParserAdapter'),
  csvWriter: require('./csvWriterAdapter'),
  excelWriter: require('./excelWriterAdapter'),
  tableParser: require('./tableParserAdapter'),
  crypto: require('./cryptoAdapter'),
  persistence: require('./persistenceAdapter'),
  fileReader: require('./fileReaderAdapter'),
  llm: require('./llmAdapter'),
  ollama: require('./ollamaAdapter'),
  openRouter: require('./openRouterAdapter'),
};
