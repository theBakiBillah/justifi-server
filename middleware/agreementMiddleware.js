const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Create folder recursively
function createFolderIfNotExists(folderPath) {
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
}

// Generate unique file name
function generateFileName(partyId, originalName) {
  const timestamp = Date.now();
  const ext = path.extname(originalName);
  return `${partyId}_${timestamp}${ext}`;
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let { arbitrationId, role, partyId } = req.body;

    // Clean up values
    role = role?.trim().toLowerCase();
    partyId = partyId?.trim();
    arbitrationId = arbitrationId?.trim();

    if (!arbitrationId) return cb(new Error("arbitrationId is required"));

    let uploadPath = `uploads/${arbitrationId}`;

    if (role === "admin") {
      uploadPath += "/agreement";
    } else {
      return cb(new Error("Invalid role"));
    }

    createFolderIfNotExists(uploadPath);
    cb(null, uploadPath);
  },

  filename: function (req, file, cb) {
    const { role, partyId } = req.body;
    const roleTrimmed = role?.trim().toLowerCase();
    const partyIdTrimmed = partyId?.trim();

    if (roleTrimmed === "admin") {
      cb(null, `agreement_${Date.now()}${path.extname(file.originalname)}`);
    } else {
      cb(null, generateFileName(partyIdTrimmed, file.originalname));
    }
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only PDF, JPG, PNG files are allowed"), false);
  }
};

const agreement = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter,
});

module.exports = agreement;

