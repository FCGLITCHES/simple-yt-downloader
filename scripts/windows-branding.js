const fs = require("fs");
const path = require("path");
const rcedit = require("rcedit");
const { version } = require("../package.json");

const productName = "GetVideosLocally";
const windowsIconPath = path.resolve(
  __dirname,
  "..",
  "public",
  "Logo1.ico",
);

const brandWindowsExecutable = async (executablePath) => {
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Windows executable not found: ${executablePath}`);
  }

  if (!fs.existsSync(windowsIconPath)) {
    throw new Error(`Windows brand icon not found: ${windowsIconPath}`);
  }

  await rcedit(executablePath, {
    icon: windowsIconPath,
    "version-string": {
      FileDescription: "GetVideosLocally - Video Downloader",
      ProductName: productName,
      CompanyName: "FCGLITCHES",
      LegalCopyright: "© 2024-2026 FCGLITCHES",
      OriginalFilename: `${productName}.exe`,
      InternalName: productName,
    },
    "file-version": version,
    "product-version": version,
  });
};

module.exports = {
  brandWindowsExecutable,
  productName,
  windowsIconPath,
};
