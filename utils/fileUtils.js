const fs = require("fs");
const path = require("path");

function createFolderIfNotExists(folderPath) {
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true }); // recursive:true makes all parent folders
  }
}

function generateFileName(partyId, originalName) {
  const timestamp = Date.now();
  const ext = path.extname(originalName);
  return `${partyId}_${timestamp}${ext}`;
}

module.exports = { createFolderIfNotExists, generateFileName };
