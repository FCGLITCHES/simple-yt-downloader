const path = require("path");
const { brandWindowsExecutable, productName } = require("./windows-branding");

module.exports = async (packContext) => {
  if (packContext.electronPlatformName !== "win32") {
    return;
  }

  const executablePath = path.join(packContext.appOutDir, `${productName}.exe`);

  await brandWindowsExecutable(executablePath);
};
