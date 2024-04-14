module.exports = {
  semi: false, // 尽可能不要分号
  singleQuote: true, // 尽可能使用单引号
  trailingComma: "all", // 尽可能使用尾随逗号
  endOfLine: "lf", // endOfLine: "<lf|crlf|cr|auto>" 行尾换行符,默认是lf,
  htmlWhitespaceSensitivity: "ignore", // 根据显示样式决定 html 要不要折行
  bracketSameLine: true, // 控制对象文字中的大括号是否应该与行内的代码保持在同一行

  printWidth: 200, // 一行代码的最大字符数，默认是80(printWidth: <int>)
  // tabWidth: 4, // tab宽度为4空格(tabWidth: <int>)
  useTabs: false, // 是否使用tab来缩进，我们使用空格(useTabs: <bool>)
  quoteProps: "consistent", // object对象中key值是否加引号（quoteProps: "<as-needed|consistent|preserve>"）as-needed只有在需求要的情况下加引号，consistent是有一个需要引号就统一加，preserve是保留用户输入的引号
  bracketSpacing: true, // object对象里面的key和value值和括号间的空格(bracketSpacing: <bool>)
  arrowParens: "always", // 箭头函数单个参数的情况是否省略括号，默认always是总是带括号（arrowParens: "<always|avoid>"）
  vueIndentScriptAndStyle: false, // vue script和style标签中是否缩进,开启可能会破坏编辑器的代码折叠
  singleAttributePerLine: true,
};
