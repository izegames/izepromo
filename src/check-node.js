// Precisa ser o primeiro import: confere a versão do Node antes de carregar o SQLite embutido (node:sqlite).
const [major, minor] = process.versions.node.split('.').map(Number);
const ok = major >= 24 || (major === 23 && minor >= 4) || (major === 22 && minor >= 13);

if (!ok) {
  console.error(
    `\n❌ O IzePromo precisa do Node.js 22.13 ou mais novo (você está com ${process.versions.node}).\n` +
      '   Baixe a versão LTS em https://nodejs.org, instale, abra um terminal novo e rode "npm install" de novo.\n',
  );
  process.exit(1);
}

// O SQLite do Node ainda imprime um aviso de "experimental"; ele só assustaria quem usa o painel.
const emit = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const type = typeof args[0] === 'string' ? args[0] : args[0]?.type;
  if (type === 'ExperimentalWarning' && /sqlite/i.test(String(warning))) return;
  return emit.call(this, warning, ...args);
};
