const express = require("express");
const router = express.Router();
const { client } = require("../config/db");
const verifyToken = require("../middleware/verifyToken");
const verifyAdmin = require("../middleware/verifyAdmin");
const upload = require("../middleware/ArbitrationUploadMiddleware");
const agreement = require("../middleware/agreementMiddleware");
const fs = require("fs");
const path = require("path");
const { ObjectId } = require("mongodb");
const { encrypt, decrypt } = require("../middleware/encryption");

const arbitration_filesCollection = client.db("justiFi").collection("arbitration_files");
const userCollection = client.db("justiFi").collection("users");
const arbitrationCollection = client.db("justiFi").collection("arbitrations");

// GET all files
router.get("/allArbitrationFile", async (req, res) => {
  try {
    const cursor = arbitration_filesCollection.find();
    const result = await cursor.toArray();
    res.send(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload agreement file by admin (mehedi)
router.post("/agreementStore", agreement.single("file"), async (req, res) => {
  try {
    console.log("=== /agreementStore hit ===");
    console.log("req.body:", req.body);
    console.log(
      "req.file:",
      req.file ? `${req.file.originalname} (${req.file.size} bytes)` : "UNDEFINED"
    );

    let { role, caseId } = req.body;

    role = role?.trim().toLowerCase();
    caseId = caseId?.trim();

    const arbitrationData = await arbitrationCollection.findOne({ caseId });
    if (!arbitrationData) {
      return res.status(404).json({ message: "Arbitration not found for this caseId" });
    }
    const arbitrationId = arbitrationData.arbitrationId;
    console.log("paisiiii mamaaa", arbitrationId);
    if (!req.file) {
      console.log("ERROR: No file in request");
      return res.status(400).json({ message: "No file uploaded" });
    }
    if (!arbitrationId) {
      return res.status(400).json({ message: "arbitrationId is required" });
    }
    if (role !== "admin") {
      return res.status(403).json({ message: "Only admin can upload agreement" });
    }

    const uploadDir = path.join("uploads", arbitrationId, "agreement");
    fs.mkdirSync(uploadDir, { recursive: true });

    const ext = path.extname(req.file.originalname) || ".pdf";
    const fileName = `agreement_${Date.now()}${ext}`;
    const filePath = path.join(uploadDir, fileName);

    // 🔒 Encrypt the file buffer
    const { iv, encryptedData } = encrypt(req.file.buffer);
    fs.writeFileSync(filePath, encryptedData);
    console.log("File saved to (encrypted):", filePath);

    const fileData = {
      fileTitle: req.file.originalname,
      fileName: fileName,
      filePath: filePath,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      uploadedAt: new Date(),
      encryptionIV: iv, // ← store IV
    };

    let arbitration = await arbitration_filesCollection.findOne({ arbitrationId });

    if (!arbitration) {
      await arbitration_filesCollection.insertOne({
        arbitrationId,
        caseId,
        agreementFiles: [],
        plaintiffDocuments: [],
        defendantDocuments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      arbitration = await arbitration_filesCollection.findOne({ arbitrationId });
    }

    await arbitration_filesCollection.updateOne(
      { arbitrationId },
      {
        $push: {
          agreementFiles: { ...fileData, version: (arbitration.agreementFiles?.length || 0) + 1 },
        },
        $set: { updatedAt: new Date() },
      }
    );

    console.log("DB updated successfully");
    res.status(200).json({ message: "File uploaded and saved to DB", fileData });
  } catch (error) {
    console.error("agreementStore error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Agreement Delete By Admin only
router.delete("/delete/agreement/:arbitrationId/:fileName", verifyToken, async (req, res) => {
  try {
    const { arbitrationId, fileName } = req.params;
    const email = req.user.email;

    const user = await userCollection.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role !== "admin") {
      return res.status(403).json({ message: "Only admin can delete agreement" });
    }

    const arbitration = await arbitration_filesCollection.findOne({ arbitrationId });
    if (!arbitration) {
      return res.status(404).json({ message: "Arbitration not found" });
    }

    const agreementFile = arbitration.agreementFiles?.find((f) => f.fileName === fileName);
    if (!agreementFile) {
      return res.status(404).json({ message: "Agreement file not found" });
    }

    if (fs.existsSync(agreementFile.filePath)) {
      fs.unlinkSync(agreementFile.filePath);
    }

    await arbitration_filesCollection.updateOne(
      { arbitrationId },
      {
        $pull: {
          agreementFiles: { fileName },
        },
      }
    );

    res.json({ message: "Agreement deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// View the agreement (with decryption)
router.get("/agreement/file/:arbitrationId", async (req, res) => {
  try {
    const { arbitrationId } = req.params;
    let { email } = req.query;

    if (email === "undefined" || !email || email.trim() === "") {
      return res.status(400).json({ message: "Valid email is required" });
    }
    email = email.trim();

    const arbitration = await arbitration_filesCollection.findOne({ arbitrationId });
    if (!arbitration) {
      return res.status(404).json({ message: "Arbitration not found" });
    }

    const agreementFile = arbitration.agreementFiles?.sort(
      (a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)
    )[0];

    if (!agreementFile) {
      return res.status(404).json({ message: "Agreement file not found" });
    }

    const fullPath = path.resolve(agreementFile.filePath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ message: "File not found on server" });
    }

    const encryptedBuffer = fs.readFileSync(fullPath);
    let fileBuffer;
    if (agreementFile.encryptionIV) {
      try {
        fileBuffer = decrypt(encryptedBuffer, agreementFile.encryptionIV);
      } catch (err) {
        console.error("Decryption failed:", err);
        return res.status(500).json({ message: "File decryption error" });
      }
    } else {
      fileBuffer = encryptedBuffer; // legacy plaintext
    }

    res.setHeader("Content-Type", agreementFile.mimeType || "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${agreementFile.fileName}"`);
    res.send(fileBuffer);
  } catch (error) {
    console.error("Error in /agreement/file/:arbitrationId:", error);
    res.status(500).json({ error: error.message });
  }
});

// Download the agreement (with decryption)
router.get("/agreement/download/:arbitrationId", verifyToken, async (req, res) => {
  try {
    const { arbitrationId } = req.params;
    const email = req.user.email;

    const arbitration = await arbitration_filesCollection.findOne({ arbitrationId });
    if (!arbitration) return res.status(404).json({ message: "Not found" });

    const user = await userCollection.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const agreementFile = arbitration.agreementFiles?.[0];
    if (!agreementFile) return res.status(404).json({ message: "No agreement file" });

    const fullPath = path.resolve(agreementFile.filePath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ message: "File not found on server" });
    }

    const encryptedBuffer = fs.readFileSync(fullPath);
    let fileBuffer;
    if (agreementFile.encryptionIV) {
      try {
        fileBuffer = decrypt(encryptedBuffer, agreementFile.encryptionIV);
      } catch (err) {
        console.error("Decryption failed:", err);
        return res.status(500).json({ message: "File decryption error" });
      }
    } else {
      fileBuffer = encryptedBuffer;
    }

    res.setHeader("Content-Type", agreementFile.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${agreementFile.fileTitle}"`);
    res.send(fileBuffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// User upload their own arbitration file (with encryption)
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { arbitrationId, email } = req.body;
    console.log(req.body);
    if (!arbitrationId || !email) {
      return res.status(400).json({ message: "arbitrationId and email required" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "File required" });
    }

    const arbitration = await arbitrationCollection.findOne({ arbitrationId });
    if (!arbitration) {
      return res.status(404).json({ message: "Arbitration not found" });
    }

    let role, partyId, name;
    const plaintiff = arbitration.plaintiffs?.find((p) => p.email === email);
    if (plaintiff) {
      role = "plaintiff";
      partyId = plaintiff.id;
      name = plaintiff.name;
    } else {
      const defendant = arbitration.defendants?.find((d) => d.email === email);
      if (defendant) {
        role = "defendant";
        partyId = defendant.id;
        name = defendant.name;
      }
    }

    if (!role) {
      return res.status(403).json({ message: "User not part of this arbitration" });
    }

    const basePath = path.join("uploads", arbitrationId, role, partyId);
    fs.mkdirSync(basePath, { recursive: true });

    const ext = path.extname(req.file.originalname);
    const fileName = `${partyId}_${Date.now()}${ext}`;
    const fullPath = path.join(basePath, fileName);

    // 🔒 Encrypt the file buffer
    const { iv, encryptedData } = encrypt(req.file.buffer);
    fs.writeFileSync(fullPath, encryptedData);

    const fileData = {
      fileTitle: req.file.originalname,
      fileName,
      filePath: fullPath,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      uploadedAt: new Date(),
      encryptionIV: iv,
    };

    let doc = await arbitration_filesCollection.findOne({ arbitrationId });
    if (!doc) {
      await arbitration_filesCollection.insertOne({
        arbitrationId,
        caseId: arbitration.caseId,
        agreementFiles: [],
        plaintiffDocuments: [],
        defendantDocuments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      doc = await arbitration_filesCollection.findOne({ arbitrationId });
    }

    if (role === "plaintiff") {
      const existingParty = doc.plaintiffDocuments?.find((p) => p.partyId === partyId);
      if (!existingParty) {
        await arbitration_filesCollection.updateOne(
          { arbitrationId },
          {
            $push: {
              plaintiffDocuments: {
                partyId,
                name,
                files: [fileData],
              },
            },
            $set: { updatedAt: new Date() },
          }
        );
      } else {
        await arbitration_filesCollection.updateOne(
          { arbitrationId, "plaintiffDocuments.partyId": partyId },
          {
            $push: { "plaintiffDocuments.$.files": fileData },
            $set: { updatedAt: new Date() },
          }
        );
      }
    }

    if (role === "defendant") {
      const existingParty = doc.defendantDocuments?.find((d) => d.partyId === partyId);
      if (!existingParty) {
        await arbitration_filesCollection.updateOne(
          { arbitrationId },
          {
            $push: {
              defendantDocuments: {
                partyId,
                name,
                files: [fileData],
              },
            },
            $set: { updatedAt: new Date() },
          }
        );
      } else {
        await arbitration_filesCollection.updateOne(
          { arbitrationId, "defendantDocuments.partyId": partyId },
          {
            $push: { "defendantDocuments.$.files": fileData },
            $set: { updatedAt: new Date() },
          }
        );
      }
    }

    res.status(200).json({
      message: "File uploaded successfully",
      filePath: fullPath,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// User get own arbitration file list
router.get("/files", async (req, res) => {
  try {
    const { arbitrationId, email } = req.query;
    if (!arbitrationId || !email) {
      return res.status(400).json({ message: "arbitrationId and email required" });
    }

    const arbitration = await arbitrationCollection.findOne({ arbitrationId });
    if (!arbitration) {
      return res.status(404).json({ message: "Arbitration not found" });
    }

    let role, partyId;
    const plaintiff = arbitration.plaintiffs?.find((p) => p.email === email);
    if (plaintiff) {
      role = "plaintiff";
      partyId = plaintiff.id;
    } else {
      const defendant = arbitration.defendants?.find((d) => d.email === email);
      if (defendant) {
        role = "defendant";
        partyId = defendant.id;
      }
    }

    if (!role) {
      return res.status(403).json({ message: "User not part of this arbitration" });
    }

    const filesDoc = await arbitration_filesCollection.findOne({ arbitrationId });
    if (!filesDoc) {
      return res.status(404).json({ message: "No files found" });
    }

    let userFiles = [];
    if (role === "plaintiff") {
      const party = filesDoc.plaintiffDocuments?.find((p) => p.partyId === partyId);
      if (party && Array.isArray(party.files)) {
        userFiles = party.files;
      }
    } else if (role === "defendant") {
      const party = filesDoc.defendantDocuments?.find((d) => d.partyId === partyId);
      if (party && Array.isArray(party.files)) {
        userFiles = party.files;
      }
    }

    res.status(200).json({
      role,
      totalFiles: userFiles.length,
      files: userFiles,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

// Plaintiff or defendant delete own arbitration file
router.delete("/deleteFile", async (req, res) => {
  try {
    const { arbitrationId, email, fileName } = req.body;
    if (!arbitrationId || !email || !fileName) {
      return res
        .status(400)
        .json({ message: "arbitrationId, email and fileName are required" });
    }

    const arbitration = await arbitrationCollection.findOne({ arbitrationId });
    if (!arbitration) {
      return res.status(404).json({ message: "Arbitration not found" });
    }

    let role, partyId;
    const plaintiff = arbitration.plaintiffs?.find((p) => p.email === email);
    if (plaintiff) {
      role = "plaintiff";
      partyId = plaintiff.id;
    } else {
      const defendant = arbitration.defendants?.find((d) => d.email === email);
      if (defendant) {
        role = "defendant";
        partyId = defendant.id;
      }
    }

    if (!role) {
      return res.status(403).json({ message: "User not authorized for this arbitration" });
    }

    const filesDoc = await arbitration_filesCollection.findOne({ arbitrationId });
    if (!filesDoc) {
      return res.status(404).json({ message: "No file record found for this arbitration" });
    }

    let party;
    if (role === "plaintiff") {
      party = filesDoc.plaintiffDocuments?.find((p) => p.partyId === partyId);
    } else {
      party = filesDoc.defendantDocuments?.find((d) => d.partyId === partyId);
    }

    if (!party) {
      return res.status(404).json({ message: "Party document record not found" });
    }

    const fileIndex = party.files.findIndex((f) => f.fileName === fileName);
    if (fileIndex === -1) {
      return res.status(404).json({ message: "File not found in database" });
    }

    const filePath = path.join(process.cwd(), "uploads", arbitrationId, role, partyId, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File not found in local storage" });
    }

    await fs.promises.unlink(filePath);

    party.files.splice(fileIndex, 1);
    await arbitration_filesCollection.updateOne({ arbitrationId }, { $set: filesDoc });

    return res.status(200).json({
      message: "File deleted successfully",
      deletedFile: fileName,
    });
  } catch (error) {
    console.error("Delete error:", error);
    return res.status(500).json({ message: error.message });
  }
});

// User view own arbitration file (with decryption)
router.get("/viewFile", async (req, res) => {
  try {
    const { arbitrationId, email, fileName } = req.query;
    if (!arbitrationId || !email || !fileName) {
      return res
        .status(400)
        .json({ message: "arbitrationId, email and fileName are required" });
    }

    const arbitration = await arbitrationCollection.findOne({ arbitrationId });
    if (!arbitration) {
      return res.status(404).json({ message: "Arbitration not found" });
    }

    let role, partyId;
    const plaintiff = arbitration.plaintiffs?.find((p) => p.email === email);
    if (plaintiff) {
      role = "plaintiff";
      partyId = plaintiff.id;
    } else {
      const defendant = arbitration.defendants?.find((d) => d.email === email);
      if (defendant) {
        role = "defendant";
        partyId = defendant.id;
      }
    }

    if (!role) {
      return res.status(403).json({ message: "User not authorized" });
    }

    const filesDoc = await arbitration_filesCollection.findOne({ arbitrationId });
    if (!filesDoc) {
      return res.status(404).json({ message: "File record not found" });
    }

    let party;
    if (role === "plaintiff") {
      party = filesDoc.plaintiffDocuments?.find((p) => p.partyId === partyId);
    } else {
      party = filesDoc.defendantDocuments?.find((d) => d.partyId === partyId);
    }

    if (!party) {
      return res.status(404).json({ message: "Party not found" });
    }

    const fileRecord = party.files.find((f) => f.fileName === fileName);
    if (!fileRecord) {
      return res.status(404).json({ message: "File not found in database" });
    }

    const filePath = path.join(process.cwd(), "uploads", arbitrationId, role, partyId, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File not found in local storage" });
    }

    const encryptedBuffer = fs.readFileSync(filePath);
    let fileBuffer;
    if (fileRecord.encryptionIV) {
      try {
        fileBuffer = decrypt(encryptedBuffer, fileRecord.encryptionIV);
      } catch (err) {
        console.error("Decryption failed:", err);
        return res.status(500).json({ message: "File decryption error" });
      }
    } else {
      fileBuffer = encryptedBuffer;
    }

    res.setHeader("Content-Type", fileRecord.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
    res.send(fileBuffer);
  } catch (error) {
    console.error("View error:", error);
    return res.status(500).json({ message: error.message });
  }
});

// User download own arbitration file (with decryption)
router.get("/downloadFile", async (req, res) => {
  try {
    const { arbitrationId, email, fileName } = req.query;
    if (!arbitrationId || !email || !fileName) {
      return res
        .status(400)
        .json({ message: "arbitrationId, email and fileName are required" });
    }

    const arbitration = await arbitrationCollection.findOne({ arbitrationId });
    if (!arbitration) {
      return res.status(404).json({ message: "Arbitration not found" });
    }

    let role, partyId;
    const plaintiff = arbitration.plaintiffs?.find((p) => p.email === email);
    if (plaintiff) {
      role = "plaintiff";
      partyId = plaintiff.id;
    } else {
      const defendant = arbitration.defendants?.find((d) => d.email === email);
      if (defendant) {
        role = "defendant";
        partyId = defendant.id;
      }
    }

    if (!role) {
      return res.status(403).json({ message: "User not authorized" });
    }

    const filesDoc = await arbitration_filesCollection.findOne({ arbitrationId });
    if (!filesDoc) {
      return res.status(404).json({ message: "File record not found" });
    }

    let party;
    if (role === "plaintiff") {
      party = filesDoc.plaintiffDocuments?.find((p) => p.partyId === partyId);
    } else {
      party = filesDoc.defendantDocuments?.find((d) => d.partyId === partyId);
    }

    if (!party) {
      return res.status(404).json({ message: "Party not found" });
    }

    const fileRecord = party.files.find((f) => f.fileName === fileName);
    if (!fileRecord) {
      return res.status(404).json({ message: "File not found in database" });
    }

    const filePath = path.join(process.cwd(), "uploads", arbitrationId, role, partyId, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File not found in local storage" });
    }

    const encryptedBuffer = fs.readFileSync(filePath);
    let fileBuffer;
    if (fileRecord.encryptionIV) {
      try {
        fileBuffer = decrypt(encryptedBuffer, fileRecord.encryptionIV);
      } catch (err) {
        console.error("Decryption failed:", err);
        return res.status(500).json({ message: "File decryption error" });
      }
    } else {
      fileBuffer = encryptedBuffer;
    }

    res.setHeader("Content-Type", fileRecord.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(fileBuffer);
  } catch (error) {
    console.error("Download error:", error);
    return res.status(500).json({ message: error.message });
  }
});

module.exports = router;