const express = require("express");
const router = express.Router();
const { client } = require("../config/db");
const verifyToken = require("../middleware/verifyToken");
const verifyAdmin = require("../middleware/verifyAdmin");
const upload = require("../middleware/ArbitrationUploadMiddleware");
const agreement=require("../middleware/agreementMiddleware"); 
const fs = require("fs");
const path = require('path');
const { ObjectId } = require('mongodb');

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

// Upload agreement file by admin
router.post("/agreementStore", agreement.single("file"), async (req, res) => {
  try {
    let { arbitrationId, role, caseId } = req.body;

    // Clean up
    role = role?.trim().toLowerCase();
    arbitrationId = arbitrationId?.trim();
    caseId = caseId?.trim();

    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const fileData = {
      fileTitle: req.file.originalname,
      fileName: req.file.filename,
      filePath: req.file.path,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      uploadedAt: new Date(),
    };

    // Check existing arbitration document
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

    // Admin upload
    if (role === "admin") {
      await arbitration_filesCollection.updateOne(
        { arbitrationId },
        {
          $push: { agreementFiles: { ...fileData, version: (arbitration.agreementFiles?.length || 0) + 1 } },
          $set: { updatedAt: new Date() },
        }
      );
    }

    res.status(200).json({ message: "File uploaded and saved to DB", fileData });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});


// //Agreement Delete By Admin only
// router.delete("/delete/agreement/:arbitrationId/:fileName", verifyToken, async (req, res) => {
//   try {
//     const { arbitrationId, fileName } = req.params;
//     const email = req.user.email;

//     // ✅ 1. Check user
//     const user = await userCollection.findOne({ email });
//     if (!user) {
//       return res.status(404).json({ message: "User not found" });
//     }

//     // ✅ 2. Check admin role
//     if (user.role !== "admin") {
//       return res.status(403).json({ message: "Only admin can delete agreement" });
//     }

//     // ✅ 3. Check arbitration exist
//     const arbitration = await arbitration_filesCollection.findOne({ arbitrationId });
//     if (!arbitration) {
//       return res.status(404).json({ message: "Arbitration not found" });
//     }

//     // ✅ 4. Find agreement file
//     const agreementFile = arbitration.agreementFiles?.find(
//       f => f.fileName === fileName
//     );

//     if (!agreementFile) {
//       return res.status(404).json({ message: "Agreement file not found" });
//     }

//     // ✅ 5. Delete from local folder
//     if (fs.existsSync(agreementFile.filePath)) {
//       fs.unlinkSync(agreementFile.filePath);
//     }

//     // ✅ 6. Remove from DB
//     await arbitration_filesCollection.updateOne(
//       { arbitrationId },
//       {
//         $pull: {
//           agreementFiles: { fileName }
//         }
//       }
//     );

//     res.json({ message: "Agreement deleted successfully" });

//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });


// view the agreement 
router.get("/agreement/file/:arbitrationId", async (req, res) => {
  try {
    console.log("Params:", req.params); 
    console.log("Query:", req.query); 
    
    const { arbitrationId } = req.params;
    let { email } = req.query;

    // Clean up email - remove 'undefined' string and trim
    if (email === 'undefined' || !email || email.trim() === '') {
      return res.status(400).json({ message: "Valid email is required" });
    }
    
    email = email.trim();
    console.log("Processed email:", email);

    // 1️⃣ Arbitration exist check
    const arbitration = await arbitration_filesCollection.findOne({ arbitrationId });
    if (!arbitration) {
      console.log("Arbitration not found:", arbitrationId);
      return res.status(404).json({ message: "Arbitration not found" });
    }
    console.log("Arbitration found:", arbitrationId);

    // 2️⃣ User check
    const user = await userCollection.findOne({ email });
    if (!user) {
      console.log("User not found:", email);
      return res.status(404).json({ message: "User not found" });
    }
    console.log("User found:", email, "Role:", user.role);

    // 3️⃣ Agreement exist check (get the latest agreement file)
    console.log("Agreement files:", arbitration.agreementFiles?.length || 0);
    const agreementFile = arbitration.agreementFiles?.sort((a, b) => 
      new Date(b.uploadedAt) - new Date(a.uploadedAt)
    )[0];
    
    if (!agreementFile) {
      console.log("Agreement file not found for arbitration:", arbitrationId);
      return res.status(404).json({ message: "Agreement file not found" });
    }
    
    console.log("Agreement file found:", agreementFile.fileName);
    console.log("File path:", agreementFile.filePath);

    // 4️⃣ Access check (admin / plaintiff / defendant)
    const isPlaintiff = arbitration.plaintiffDocuments?.some(p => p.email === email);
    const isDefendant = arbitration.defendantDocuments?.some(d => d.email === email);
    
    console.log("Access check - isPlaintiff:", isPlaintiff, "isDefendant:", isDefendant, "isAdmin:", user.role === "admin");

    if (user.role !== "admin" && !isPlaintiff && !isDefendant) {
      console.log("Unauthorized access attempt by:", email);
      return res.status(403).json({ message: "Unauthorized: You don't have permission to view this agreement" });
    }

    // Check if file exists on disk
    const fs = require('fs');
    const fullPath = path.resolve(agreementFile.filePath);
    console.log("Checking if file exists at:", fullPath);
    
    if (!fs.existsSync(fullPath)) {
      console.log("File does not exist on disk:", fullPath);
      return res.status(404).json({ message: "File not found on server" });
    }
    
    console.log("File exists, sending file...");
    
    // Set proper headers
    res.setHeader('Content-Type', agreementFile.mimeType || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${agreementFile.fileName}"`);
    
    // Send the file
    res.sendFile(fullPath);
    
  } catch (error) {
    console.error("Error in /agreement/file/:arbitrationId:", error);
    res.status(500).json({ error: error.message });
  }
});

//download the agreement
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

    res.download(agreementFile.filePath);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


//user upload their own arbitration file 
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { arbitrationId, email } = req.body;

    if (!arbitrationId || !email) {
      return res.status(400).json({ message: "arbitrationId and email required" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "File required" });
    }

    // 1️⃣ Check arbitration exists
    const arbitration = await arbitrationCollection.findOne({ arbitrationId });
    if (!arbitration) {
      return res.status(404).json({ message: "Arbitration not found" });
    }

    // 2️⃣ Detect role & partyId
    let role, partyId, name;

    const plaintiff = arbitration.plaintiffs?.find(p => p.email === email);
    if (plaintiff) {
      role = "plaintiff";
      partyId = plaintiff.id;
      name = plaintiff.name;
    } else {
      const defendant = arbitration.defendants?.find(d => d.email === email);
      if (defendant) {
        role = "defendant";
        partyId = defendant.id;
        name = defendant.name;
      }
    }

    if (!role) {
      return res.status(403).json({ message: "User not part of this arbitration" });
    }

    // 3️⃣ Create exact folder structure
    const basePath = path.join("uploads", arbitrationId, role, partyId);
    fs.mkdirSync(basePath, { recursive: true });

    // 4️⃣ Generate file name
    const ext = path.extname(req.file.originalname);
    const fileName = `${partyId}_${Date.now()}${ext}`;
    const fullPath = path.join(basePath, fileName);

    // 5️⃣ Save file manually
    fs.writeFileSync(fullPath, req.file.buffer);

    // 6️⃣ Prepare fileData for DB
    const fileData = {
      fileTitle: req.file.originalname,
      fileName,
      filePath: fullPath,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      uploadedAt: new Date(),
    };

    // 7️⃣ Save to arbitration_filesCollection (same logic as before)
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
      await arbitration_filesCollection.updateOne(
        { arbitrationId, "plaintiffDocuments.partyId": partyId },
        {
          $push: { "plaintiffDocuments.$.files": fileData },
          $set: { updatedAt: new Date() }
        }
      );
    }

    if (role === "defendant") {
      await arbitration_filesCollection.updateOne(
        { arbitrationId, "defendantDocuments.partyId": partyId },
        {
          $push: { "defendantDocuments.$.files": fileData },
          $set: { updatedAt: new Date() }
        }
      );
    }

    res.status(200).json({
      message: "File uploaded successfully",
      filePath: fullPath
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

//user get own arbitration file 
router.get("/files", async (req, res) => {
  try {
    const { arbitrationId, email } = req.query;

    if (!arbitrationId || !email) {
      return res.status(400).json({ message: "arbitrationId and email required" });
    }

    // 1️⃣ Check arbitration exists
    const arbitration = await arbitrationCollection.findOne({ arbitrationId });
    if (!arbitration) {
      return res.status(404).json({ message: "Arbitration not found" });
    }

    // 2️⃣ Detect role & partyId
    let role, partyId;

    const plaintiff = arbitration.plaintiffs?.find(p => p.email === email);
    if (plaintiff) {
      role = "plaintiff";
      partyId = plaintiff.id;
    } else {
      const defendant = arbitration.defendants?.find(d => d.email === email);
      if (defendant) {
        role = "defendant";
        partyId = defendant.id;
      }
    }

    if (!role) {
      return res.status(403).json({ message: "User not part of this arbitration" });
    }

    // 3️⃣ Fetch file document
    const filesDoc = await arbitration_filesCollection.findOne({ arbitrationId });
    if (!filesDoc) {
      return res.status(404).json({ message: "No files found" });
    }

    let userFiles = [];

    if (role === "plaintiff") {
      const party = filesDoc.plaintiffDocuments?.find(p => p.partyId === partyId);
      if (party && Array.isArray(party.files)) {
        userFiles = party.files;
      }
    }

    if (role === "defendant") {
      const party = filesDoc.defendantDocuments?.find(d => d.partyId === partyId);
      if (party && Array.isArray(party.files)) {
        userFiles = party.files;
      }
    }

    res.status(200).json({
      role,
      totalFiles: userFiles.length,
      files: userFiles
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});


//Plaintiff or defendant delete own arbitration file 
const uploadsFolder = path.join(process.cwd(), "uploads");
router.delete("/deleteFile", async (req, res) => {
  try {
    const { arbitrationId, email, fileName } = req.body;

    if (!arbitrationId || !email || !fileName) {
      return res.status(400).json({ message: "arbitrationId, email and fileName are required" });
    }

    // 1️⃣ Check arbitration exists
    const arbitration = await arbitrationCollection.findOne({ arbitrationId });
    if (!arbitration) {
      return res.status(404).json({ message: "Arbitration not found" });
    }

    // 2️⃣ Detect role and partyId
    let role, partyId;

    const plaintiff = arbitration.plaintiffs?.find(p => p.email === email);
    if (plaintiff) {
      role = "plaintiff";
      partyId = plaintiff.id;
    } else {
      const defendant = arbitration.defendants?.find(d => d.email === email);
      if (defendant) {
        role = "defendant";
        partyId = defendant.id;
      }
    }

    if (!role) {
      return res.status(403).json({ message: "User not authorized for this arbitration" });
    }

    // 3️⃣ Fetch file collection doc
    const filesDoc = await arbitration_filesCollection.findOne({ arbitrationId });
    if (!filesDoc) {
      return res.status(404).json({ message: "No file record found for this arbitration" });
    }

    let party;

    if (role === "plaintiff") {
      party = filesDoc.plaintiffDocuments?.find(p => p.partyId === partyId);
    } else {
      party = filesDoc.defendantDocuments?.find(d => d.partyId === partyId);
    }

    if (!party) {
      return res.status(404).json({ message: "Party document record not found" });
    }

    // 4️⃣ Check file exists in DB
    const fileIndex = party.files.findIndex(f => f.fileName === fileName);

    if (fileIndex === -1) {
      return res.status(404).json({ message: "File not found in database" });
    }

    // 🔥 Build correct nested path
    const filePath = path.join(
      process.cwd(),
      "uploads",
      arbitrationId,
      role,
      partyId,
      fileName
    );

    console.log("Trying to delete local file at:", filePath);

    // 5️⃣ Check file exists in local storage
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File not found in local storage" });
    }

    // 6️⃣ Delete local file
    await fs.promises.unlink(filePath);
    console.log("Local file deleted:", filePath);

    // 7️⃣ Remove from DB array
    party.files.splice(fileIndex, 1);

    await arbitration_filesCollection.updateOne(
      { arbitrationId },
      { $set: filesDoc }
    );

    return res.status(200).json({
      message: "File deleted successfully",
      deletedFile: fileName
    });

  } catch (error) {
    console.error("Delete error:", error);
    return res.status(500).json({ message: error.message });
  }
});

//User Download own arbitration file
router.get("/viewFile", async (req, res) => {
  try {
    const { arbitrationId, email, fileName } = req.query;

    if (!arbitrationId || !email || !fileName) {
      return res.status(400).json({ message: "arbitrationId, email and fileName are required" });
    }

    // 1️⃣ Check arbitration
    const arbitration = await arbitrationCollection.findOne({ arbitrationId });
    if (!arbitration) {
      return res.status(404).json({ message: "Arbitration not found" });
    }

    // 2️⃣ Detect role & partyId
    let role, partyId;

    const plaintiff = arbitration.plaintiffs?.find(p => p.email === email);
    if (plaintiff) {
      role = "plaintiff";
      partyId = plaintiff.id;
    } else {
      const defendant = arbitration.defendants?.find(d => d.email === email);
      if (defendant) {
        role = "defendant";
        partyId = defendant.id;
      }
    }

    if (!role) {
      return res.status(403).json({ message: "User not authorized" });
    }

    // 3️⃣ Check DB file record
    const filesDoc = await arbitration_filesCollection.findOne({ arbitrationId });
    if (!filesDoc) {
      return res.status(404).json({ message: "File record not found" });
    }

    let party;

    if (role === "plaintiff") {
      party = filesDoc.plaintiffDocuments?.find(p => p.partyId === partyId);
    } else {
      party = filesDoc.defendantDocuments?.find(d => d.partyId === partyId);
    }

    if (!party) {
      return res.status(404).json({ message: "Party not found" });
    }

    const fileExistsInDB = party.files.find(f => f.fileName === fileName);
    if (!fileExistsInDB) {
      return res.status(404).json({ message: "File not found in database" });
    }

    // 🔥 Build correct nested path
    const filePath = path.join(
      process.cwd(),
      "uploads",
      arbitrationId,
      role,
      partyId,
      fileName
    );

    console.log("View file path:", filePath);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File not found in local storage" });
    }

    // Send file to browser (view)
    return res.sendFile(filePath);

  } catch (error) {
    console.error("View error:", error);
    return res.status(500).json({ message: error.message });
  }
});


//User View own arbitraion file 
router.get("/downloadFile", async (req, res) => {
  try {
    const { arbitrationId, email, fileName } = req.query;

    if (!arbitrationId || !email || !fileName) {
      return res.status(400).json({ message: "arbitrationId, email and fileName are required" });
    }

    // 1️⃣ Check arbitration
    const arbitration = await arbitrationCollection.findOne({ arbitrationId });
    if (!arbitration) {
      return res.status(404).json({ message: "Arbitration not found" });
    }

    // 2️⃣ Detect role & partyId
    let role, partyId;

    const plaintiff = arbitration.plaintiffs?.find(p => p.email === email);
    if (plaintiff) {
      role = "plaintiff";
      partyId = plaintiff.id;
    } else {
      const defendant = arbitration.defendants?.find(d => d.email === email);
      if (defendant) {
        role = "defendant";
        partyId = defendant.id;
      }
    }

    if (!role) {
      return res.status(403).json({ message: "User not authorized" });
    }

    // 3️⃣ Check DB file record
    const filesDoc = await arbitration_filesCollection.findOne({ arbitrationId });
    if (!filesDoc) {
      return res.status(404).json({ message: "File record not found" });
    }

    let party;

    if (role === "plaintiff") {
      party = filesDoc.plaintiffDocuments?.find(p => p.partyId === partyId);
    } else {
      party = filesDoc.defendantDocuments?.find(d => d.partyId === partyId);
    }

    if (!party) {
      return res.status(404).json({ message: "Party not found" });
    }

    const fileExistsInDB = party.files.find(f => f.fileName === fileName);
    if (!fileExistsInDB) {
      return res.status(404).json({ message: "File not found in database" });
    }

    // 🔥 Build correct nested path
    const filePath = path.join(
      process.cwd(),
      "uploads",
      arbitrationId,
      role,
      partyId,
      fileName
    );

    console.log("Download file path:", filePath);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File not found in local storage" });
    }

    // Download file
    return res.download(filePath);

  } catch (error) {
    console.error("Download error:", error);
    return res.status(500).json({ message: error.message });
  }
});



module.exports = router;
