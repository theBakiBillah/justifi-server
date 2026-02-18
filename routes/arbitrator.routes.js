const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { client } = require("../config/db");
const verifyToken = require("../middleware/verifyToken");
const verifyAdmin = require("../middleware/verifyAdmin");

const arbitratorCollection = client.db("justiFi").collection("arbitrators");
const userCollection = client.db("justiFi").collection("users");
const arbitrationCollection = client.db("justiFi").collection("arbitrations");

const hearingsCollection=client.db("justiFi").collection("hearings");

router.get("/arbitrators", async (req, res) => {
    const cursor = arbitratorCollection.find();
    const result = await cursor.toArray();
    res.send(result);
});

const Hearing = client.db("justiFi").collection("Hearing");


router.get("/hearings", async (req, res) => {
    const cursor = hearingsCollection.find();
    const result = await cursor.toArray();
    res.send(result);
});

// Get All Arbitrators from admin panel
router.get("/all-arbitrators", verifyToken, async (req, res) => {
  const cursor = arbitratorCollection.find();
  const result = await cursor.toArray();
  res.send(result);
});

// Get arbitrator by email (for public or internal use)
router.get("/email/:email", async (req, res) => {
  try {
    const { email } = req.params;
    if (!email) {
      return res
        .status(400)
        .json({ success: false, error: "Email is required" });
    }

    const arbitrator = await arbitratorCollection.findOne({
      email: email.toLowerCase().trim(),
    });

    if (!arbitrator) {
      return res
        .status(404)
        .json({ success: false, error: "Arbitrator not found" });
    }

    res.json({ success: true, arbitrator });
  } catch (error) {
    console.error("Error in /email/:email:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get arbitrator profile (requires token verification)
router.get("/ArbitratorProfile", verifyToken, async (req, res) => {
  const { email } = req.query;
  const arbitrator = await arbitratorCollection.findOne({ email });
  res.send(arbitrator);
});

// Update arbitrator profile
router.patch("/ArbitratorProfile/:email", verifyToken, async (req, res) => {
  try {
    const { email } = req.params;
    const data = req.body;

    // Remove _id to prevent immutable field modification
    const { _id, ...updateData } = data;

    if (Object.keys(updateData).length === 0) {
      return res
        .status(400)
        .send({ success: false, error: "No valid fields to update" });
    }

    // Update arbitrator collection
    const arbitratorResult = await arbitratorCollection.updateOne(
      { email },
      { $set: updateData }
    );

    if (arbitratorResult.matchedCount === 0) {
      return res
        .status(404)
        .send({ success: false, error: "Arbitrator not found" });
    }

    // Update user collection (only name and image)
    const userUpdateData = {};
    if (data.name) userUpdateData.name = data.name;
    if (data.image) userUpdateData.image = data.image;

    if (Object.keys(userUpdateData).length > 0) {
      await userCollection.updateOne({ email }, { $set: userUpdateData });
    }

    res.send({
      success: true,
      message: "Arbitrator profile updated successfully",
    });
  } catch (error) {
    console.error("Error updating arbitrator profile:", error);
    res.status(500).send({ success: false, error: "Internal server error" });
  }
});

// Get arbitrations where the user is the presiding arbitrator
router.get("/arbitrations/presiding", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: "Email parameter is required" });
    }

    const arbitrations = await arbitrationCollection
      .find({
        presidingArbitratorEmail: email,
      })
      .sort({ submissionDate: -1 })
      .toArray();

    if (!arbitrations || arbitrations.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No arbitration cases found for this presiding arbitrator",
        data: [],
      });
    }

    res.status(200).json({
      success: true,
      message: "Arbitration cases retrieved successfully",
      data: arbitrations,
      count: arbitrations.length,
    });
  } catch (error) {
    console.error("Error fetching presiding arbitrations:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Get arbitration details by ID with arbitrator information
router.get("/arbitrations/details/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const arbitration = await arbitrationCollection.findOne({
      $or: [{ _id: new ObjectId(id) }, { arbitrationId: id }],
    });

    if (!arbitration) {
      return res
        .status(404)
        .json({ success: false, message: "Arbitration case not found" });
    }

    const arbitratorEmails = [
      arbitration.presidingArbitratorEmail,
      arbitration.arbitrator1Email,
      arbitration.arbitrator2Email,
    ].filter((email) => email);

    let arbitratorsInfo = [];
    if (arbitratorEmails.length > 0) {
      arbitratorsInfo = await arbitratorCollection
        .find({
          email: { $in: arbitratorEmails },
        })
        .toArray();
    }

    const arbitratorMap = {};
    arbitratorsInfo.forEach((arbitrator) => {
      arbitratorMap[arbitrator.email] = arbitrator;
    });

    const formattedArbitration = {
      ...arbitration,
      arbitrators: arbitratorEmails.map((email) => ({
        ...arbitratorMap[email],
        designation:
          email === arbitration.presidingArbitratorEmail
            ? "Presiding Arbitrator"
            : "Arbitrator",
        picture: arbitratorMap[email]?.image || "https://default-image-url.com",
        specialization: arbitratorMap[email]?.specialization || ["Arbitrator"],
        experience: arbitratorMap[email]?.experience || "Panel Member",
        phone: arbitratorMap[email]?.phone || "",
        address: arbitratorMap[email]?.address || "",
        description: arbitratorMap[email]?.description || "",
        qualification: arbitratorMap[email]?.qualification || "",
        languages: arbitratorMap[email]?.languages || [],
        gender: arbitratorMap[email]?.gender || "",
      })),
    };

    res.status(200).json({
      success: true,
      message: "Arbitration details retrieved successfully",
      data: formattedArbitration,
    });
  } catch (error) {
    console.error("Error fetching arbitration details:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
  }
});



//All Hearing code Here 
// POST /api/hearings/create - CREATE NEW HEARING (FIXED)
router.post('/hearings/create',verifyToken, async (req, res) => {
    
    // Check if req.body exists
    if (!req.body) {
        return res.status(400).json({
            success: false,
            message: 'Request body is missing or invalid'
        });
    }

    try {
        const {
            arbitrationId,
            date,
            meetLink,
            hearingAgenda,
            duration = 120,
            createdBy
        } = req.body;

        // Validate required fields
        if (!arbitrationId || !date || !meetLink || !hearingAgenda || !createdBy) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: arbitrationId, date, meetLink, hearingAgenda, createdBy'
            });
        }

        // Check if arbitration exists using native MongoDB driver
        const arbitration = await arbitrationCollection.findOne({ 
            arbitrationId: arbitrationId 
        });
        
        if (!arbitration) {
            return res.status(404).json({
                success: false,
                message: 'Arbitration not found'
            });
        }

        // Get the next hearing number using native MongoDB driver
        const lastHearing = await hearingsCollection
            .find({ arbitrationId: arbitrationId })
            .sort({ hearingNumber: -1 })
            .limit(1)
            .toArray();
        
        const hearingNumber = lastHearing.length > 0 ? lastHearing[0].hearingNumber + 1 : 1;

        // Generate hearing ID
        const hearingId = `ARB-HER-${Date.now()}`;

        // Create new hearing object
        const newHearing = {
            arbitrationId,
            hearingId,
            hearingNumber,
            date: new Date(date),
            duration: parseInt(duration),
            meetLink,
            hearingAgenda,
            status: 'scheduled',
            cancellationReason: '',
            createdBy,
            createdAt: new Date(),
            updatedAt: new Date(),
            arbitrator1Comment: '',
            arbitrator2Comment: '',
            presidingArbitratorComment: '',
            privateNotes: '',
            attendance: {
                arbitrator1: false,
                arbitrator2: false,
                presidingArbitrator: false,
                plaintiffs: [],
                defendants: []
            },
            recording: {
                recorded: false,
                recordingUrl: '',
                duration: '',
                fileSize: ''
            },
            documents: []
        };

        // Save hearing to database using native MongoDB driver
        const result = await hearingsCollection.insertOne(newHearing);
        const savedHearing = {
            _id: result.insertedId,
            ...newHearing
        };

        console.log("Hearing saved successfully:", savedHearing);

        res.status(201).json({
            success: true,
            message: 'Hearing created successfully',
            data: savedHearing
        });

    } catch (error) {
        console.error('Error creating hearing:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/hearings/arbitration/:arbitrationId - Get all hearings for an arbitration (FIXED)
router.get('/hearings/arbitration/:arbitrationId', verifyToken,async (req, res) => {
    try {
        const { arbitrationId } = req.params;

        // Validate arbitrationId
        if (!arbitrationId) {
            return res.status(400).json({
                success: false,
                message: 'Arbitration ID is required'
            });
        }

        // Find all hearings for this arbitration using native MongoDB driver
        const hearings = await hearingsCollection
            .find({ arbitrationId: arbitrationId })
            .sort({ date: 1 }) // Sort by date ascending
            .toArray();

        // If no hearings found, return empty array
        if (!hearings || hearings.length === 0) {
            return res.json({
                success: true,
                message: 'No hearings found for this arbitration',
                data: []
            });
        }

        res.json({
            success: true,
            message: 'Hearings fetched successfully',
            data: hearings
        });

    } catch (error) {
        console.error('Error fetching hearings:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/hearings/:hearingId - Get single hearing by ID (FIXED)
router.get('/hearings/:hearingId',verifyToken, async (req, res) => {
    try {
        const { hearingId } = req.params;

        const hearing = await hearingsCollection.findOne({ hearingId: hearingId });

        if (!hearing) {
            return res.status(404).json({
                success: false,
                message: 'Hearing not found'
            });
        }

        res.json({
            success: true,
            message: 'Hearing fetched successfully',
            data: hearing
        });

    } catch (error) {
        console.error('Error fetching hearing:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// PUT /api/hearings/:hearingId - Update hearing (FIXED)
router.put('/hearings/:hearingId',verifyToken, async (req, res) => {
    try {
        const { hearingId } = req.params;
        const updateData = req.body;

        // Remove immutable fields
        delete updateData._id;
        delete updateData.hearingId;
        delete updateData.arbitrationId;
        delete updateData.hearingNumber;
        delete updateData.createdBy;
        delete updateData.createdAt;

        // Add updatedAt timestamp
        updateData.updatedAt = new Date();

        const result = await hearingsCollection.findOneAndUpdate(
            { hearingId: hearingId },
            { $set: updateData },
            { returnDocument: 'after' } // equivalent to {new: true} in Mongoose
        );

        if (!result.value) {
            return res.status(404).json({
                success: false,
                message: 'Hearing not found'
            });
        }

        res.json({
            success: true,
            message: 'Hearing updated successfully',
            data: result.value
        });

    } catch (error) {
        console.error('Error updating hearing:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// DELETE /api/hearings/:hearingId - Delete hearing (FIXED)
router.delete('/hearings/:hearingId',verifyToken, async (req, res) => {
    try {
        const { hearingId } = req.params;

        const result = await hearingsCollection.findOneAndDelete({ hearingId: hearingId });

        if (!result.value) {
            return res.status(404).json({
                success: false,
                message: 'Hearing not found'
            });
        }

        res.json({
            success: true,
            message: 'Hearing deleted successfully',
            data: result.value
        });

    } catch (error) {
        console.error('Error deleting hearing:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});


module.exports = router;
