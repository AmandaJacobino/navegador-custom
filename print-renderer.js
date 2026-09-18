const outputPath = document.getElementById('output-path');
const browseBtn = document.getElementById('browse-btn');
const printBtn = document.getElementById('print-btn');
const cancelBtn = document.getElementById('cancel-btn');

window.printAPI.getDefaultPath().then((defaultPath) => {
  outputPath.value = defaultPath;
});

browseBtn.addEventListener('click', async () => {
  const chosen = await window.printAPI.browse(outputPath.value);
  if (chosen) outputPath.value = chosen;
});

printBtn.addEventListener('click', () => {
  printBtn.disabled = true;
  window.printAPI.print(outputPath.value);
});

cancelBtn.addEventListener('click', () => window.printAPI.cancel());
