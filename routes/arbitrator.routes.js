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
const arbitration_filesCollection = client.db("justiFi").collection("arbitration_files");

router.get("/arbitrators", async (req, res) => {
    const cursor = await arbitratorCollection.find();
    const result = await cursor.toArray();
    res.send(result);
});


router.get("/hearings", async (req, res) => {
    const cursor =await hearingsCollection.find();
    const result = await cursor.toArray();
    res.send(result);
});

// Get All Arbitrators from admin panel
router.get("/all-arbitrators", verifyToken, async (req, res) => {
    const cursor =await arbitratorCollection.find();
    const result = await cursor.toArray();
    res.send(result);
});

// Get arbitrator by email (public)
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
        res.status(500).json({
            success: false,
            error: "Internal server error",
        });
    }
});

// Get arbitrator profile
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

        const { _id, ...updateData } = data;

        if (Object.keys(updateData).length === 0) {
            return res
                .status(400)
                .send({ success: false, error: "No valid fields to update" });
        }

        const arbitratorResult = await arbitratorCollection.updateOne(
            { email },
            { $set: updateData }
        );

        if (arbitratorResult.matchedCount === 0) {
            return res
                .status(404)
                .send({ success: false, error: "Arbitrator not found" });
        }

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
        res.status(500).send({
            success: false,
            error: "Internal server error",
        });
    }
});



// =============================
// GET Arbitrations (Presiding)
// =============================
router.get("/arbitrations/presiding", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email parameter is required",
      });
    }

    // ✅ Use nested email field (consistent with other routes)
    const arbitrations = await arbitrationCollection
      .find({
        "presidingArbitrator.email": email,
      })
      .sort({ submissionDate: -1 })
      .toArray();

    if (!arbitrations || arbitrations.length === 0) {
      return res.status(200).json({
        success: true,
        message:
          "No arbitration cases found for this presiding arbitrator",
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



// =============================
// GET Arbitration Details
// =============================
router.get("/arbitrations/details/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const arbitration = await arbitrationCollection.findOne({
            $or: [{ _id: new ObjectId(id) }, { arbitrationId: id }],
        });

        if (!arbitration) {
            return res
                .status(404)
                .json({
                    success: false,
                    message: "Arbitration case not found",
                });
        }

        const arbitratorEmails = [
            arbitration.presidingArbitratorEmail,
            arbitration.arbitrator1Email,
            arbitration.arbitrator2Email,
        ].filter(Boolean);

        let arbitratorsInfo = [];
        if (arbitratorEmails.length > 0) {
            arbitratorsInfo = await arbitratorCollection
                .find({ email: { $in: arbitratorEmails } })
                .toArray();
        }

        const arbitratorMap = {};
        arbitratorsInfo.forEach((arb) => {
            arbitratorMap[arb.email] = arb;
        });

        const formattedArbitration = {
            ...arbitration,
            arbitrators: arbitratorEmails.map((email) => ({
                ...arbitratorMap[email],
                designation:
                    email === arbitration.presidingArbitratorEmail
                        ? "Presiding Arbitrator"
                        : "Arbitrator",
                picture: arbitratorMap[email]?.image || "",
                specialization: arbitratorMap[email]?.specialization || [],
                experience: arbitratorMap[email]?.experience || "",
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
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message,
        });
    }
});




//All Hearing code Here 

// POST /api/hearings/create - CREATE NEW HEARING (FIXED)
router.post('/hearings/create', async (req, res) => {
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
            duration = 120
        } = req.body;

        // Validate required fields
        if (!arbitrationId || !date || !meetLink || !hearingAgenda ) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: arbitrationId, date, meetLink, hearingAgenda'
            });
        }

        // Check if arbitration exists and get arbitration details
        const arbitration = await arbitrationCollection.findOne({ 
            arbitrationId: arbitrationId 
        });
        
        if (!arbitration) {
            return res.status(404).json({
                success: false,
                message: 'Arbitration not found'
            });
        }

        // Get the next hearing number
        const lastHearing = await hearingsCollection
            .find({ arbitrationId: arbitrationId })
            .sort({ hearingNumber: -1 })
            .limit(1)
            .toArray();
        
        const hearingNumber = lastHearing.length > 0 ? lastHearing[0].hearingNumber + 1 : 1;

        // Generate hearing ID
        const hearingId = `ARB-HER-${Date.now()}`;

        // Extract plaintiffs with email and present status (default false)
        const plaintiffsAttendance = arbitration.plaintiffs?.map(p => ({
            email: p.email,
            present: false
        })) || [];
        
        // Extract defendants with email and present status (default false)
        const defendantsAttendance = arbitration.defendants?.map(d => ({
            email: d.email,
            present: false
        })) || [];

        // Create new hearing object with updated structure
        const newHearing = {
            arbitrationId,
            hearingId,
            hearingNumber,
            date: new Date(date),
            duration: parseInt(duration),
            meetLink,
            hearingAgenda,
            recordingSummary: "",
            status: 'scheduled',
            cancellationReason: '',
            createdAt: new Date(),
            updatedAt: new Date(),
            
            // Attendance with proper structure
            attendance: {
                arbitrator1: false,
                arbitrator2: false,
                presidingArbitrator: false,
                plaintiffs: plaintiffsAttendance,  // array of objects with email and present
                defendants: defendantsAttendance   // array of objects with email and present
            },
            
            // Arbitrator Comments structure with roles as keys
            arbitratorComments: {
                presidingarbitrator: [],
                arbitrator1: [],
                arbitrator2: []
            },
            
            // Private Notes array (empty initially)
            privateNotes: [],
            
            // Recording structure
            recording: {
                recorded: false,
                recordingUrl: '',
                duration: '',
                fileSize: ''
            }
        };

        // Save hearing to database
        const result = await hearingsCollection.insertOne(newHearing);
        const savedHearing = {
            _id: result.insertedId,
            ...newHearing
        };

        console.log("Hearing saved successfully with attendance structure:", {
            hearingId: savedHearing.hearingId,
            plaintiffs: savedHearing.attendance.plaintiffs,
            defendants: savedHearing.attendance.defendants
        });

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
router.get('/hearings/arbitration/:arbitrationId',async (req, res) => {
    try {
        const { arbitrationId } = req.params;
      //console.log(arbitrationId); 
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
router.get('/hearings/:hearingId', async (req, res) => {
    try {
        const { hearingId } = req.params;
      console.log(req.params); 
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

router.get('/users/hearings/:hearingId', async (req, res) => {
    try {
        const { hearingId } = req.params;
       // console.log(req.params);

        const hearing = await hearingsCollection.findOne({
            _id: new ObjectId(hearingId)
        });

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
router.delete('/hearingsDelete/:hearingId', async (req, res) => {
    try {
        const { hearingId } = req.params;

        console.log("Param received:", hearingId);

        // First check if exists
        const existing = await hearingsCollection.findOne({
            hearingId: hearingId.trim()
        });

       // console.log("Found in DB:", existing);

        if (!existing) {
            return res.status(404).json({
                success: false,
                message: "Hearing not found"
            });
        }

        await hearingsCollection.deleteOne({
            hearingId: hearingId.trim()
        });

        res.json({
            success: true,
            message: "Hearing deleted successfully"
        });

    } catch (error) {
        console.error("Delete error:", error);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});


//add comment for particular hearing
router.post('/hearings/:hearingId/comments', verifyToken, async (req, res) => {
    try {
        const { hearingId } = req.params;
        const { comment } = req.body;  // Only comment from frontend
        const userEmail = req.body.currentUserEmail; 

        // Validate input
        if (!comment) {
            return res.status(400).json({
                success: false,
                message: 'Comment is required'
            });
        }

        if (!userEmail) {
            return res.status(400).json({
                success: false,
                message: 'User email not found in token'
            });
        }

        // Find hearing
        const hearing = await hearingsCollection.findOne({ hearingId: hearingId });
        
        if (!hearing) {
            return res.status(404).json({
                success: false,
                message: 'Hearing not found'
            });
        }

        // Get arbitrationId from hearing
        const arbitrationId = hearing.arbitrationId;
        
        if (!arbitrationId) {
            return res.status(404).json({
                success: false,
                message: 'Arbitration ID not found in hearing'
            });
        }

        // Find arbitration to check arbitrator roles
        const arbitration = await arbitrationCollection.findOne({ 
            arbitrationId: arbitrationId 
        });
        
        if (!arbitration) {
            return res.status(404).json({
                success: false,
                message: 'Arbitration not found'
            });
        }

        // Determine arbitrator role based on email
        let arbitratorRole = null;
        
        // Check presiding arbitrator (lowercase for comments)
        if (arbitration.presidingArbitrator?.email === userEmail) {
            arbitratorRole = 'presidingarbitrator';
        }
        // Check arbitrator1
        else if (arbitration.arbitrator1?.email === userEmail) {
            arbitratorRole = 'arbitrator1';
        }
        // Check arbitrator2
        else if (arbitration.arbitrator2?.email === userEmail) {
            arbitratorRole = 'arbitrator2';
        }
        // Check if user is Justifi representative (optional)
        else if (arbitration.justifiRepresentative?.email === userEmail) {
            // Justifi rep can add comments as admin or you can set a default
            // For now, we'll use 'presidingarbitrator' or you can create a new role
            arbitratorRole = 'presidingarbitrator'; // or return 403 if you want to restrict
        }
        else {
            return res.status(403).json({
                success: false,
                message: 'User is not authorized as an arbitrator for this case'
            });
        }

        // Create new comment object
        const newComment = {
            commentId: `CMT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            comment: comment,
            timestamp: new Date(),
            edited: false,
            editedAt: null,
            createdBy: userEmail,
            arbitratorRole: arbitratorRole // Store role for reference
        };

        // Initialize arbitratorComments if it doesn't exist
        if (!hearing.arbitratorComments) {
            hearing.arbitratorComments = {
                presidingarbitrator: [],
                arbitrator1: [],
                arbitrator2: []
            };
        }

        // Initialize array for this arbitrator if it doesn't exist
        if (!hearing.arbitratorComments[arbitratorRole]) {
            hearing.arbitratorComments[arbitratorRole] = [];
        }

        // Add comment to the array
        hearing.arbitratorComments[arbitratorRole].push(newComment);
        hearing.updatedAt = new Date();

        // Update in database
        const result = await hearingsCollection.updateOne(
            { hearingId: hearingId },
            { 
                $set: { 
                    arbitratorComments: hearing.arbitratorComments,
                    updatedAt: new Date()
                } 
            }
        );

        if (result.modifiedCount === 0) {
            return res.status(400).json({
                success: false,
                message: 'Failed to add comment'
            });
        }

        res.json({
            success: true,
            message: 'Comment added successfully',
            data: newComment
        });

    } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

//show all comments
router.get('/hearings/:hearingId/comments', async (req, res) => {
    try {
        const { hearingId } = req.params;
        
        const hearing = await hearingsCollection.findOne(
            { hearingId: hearingId },
            { projection: { arbitratorComments: 1 } }
        );

        if (!hearing) {
            return res.status(404).json({
                success: false,
                message: 'Hearing not found'
            });
        }

        res.json({
            success: true,
            message: 'Comments fetched successfully',
            data: hearing.arbitratorComments || {
                presidingarbitrator: [],
                arbitrator1: [],
                arbitrator2: []
            }
        });

    } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

//add private note
router.post('/hearings/:hearingId/notes', verifyToken, async (req, res) => {
    try {
        const { hearingId } = req.params;  // URL থেকে
        const { note } = req.body;          // Body থেকে
        const userEmail = req.body.currentUserEmail;   // Token থেকে (verifyToken middleware set করে)

        //console.log('Received:', {hearingId,note, userEmail  });

        // Validate input
        if (!note) {
            return res.status(400).json({
                success: false,
                message: 'Note is required'
            });
        }

        if (!userEmail) {
            return res.status(400).json({
                success: false,
                message: 'User email not found in token'
            });
        }

        // Find hearing
        const hearing = await hearingsCollection.findOne({ hearingId: hearingId });
        
        if (!hearing) {
            return res.status(404).json({
                success: false,
                message: 'Hearing not found'
            });
        }

        // Get arbitrationId from hearing
        const arbitrationId = hearing.arbitrationId;
        
        if (!arbitrationId) {
            return res.status(404).json({
                success: false,
                message: 'Arbitration ID not found in hearing'
            });
        }

        // Find arbitration to check arbitrator roles
        const arbitration = await arbitrationCollection.findOne({ 
            arbitrationId: arbitrationId 
        });
        
        if (!arbitration) {
            return res.status(404).json({
                success: false,
                message: 'Arbitration not found'
            });
        }

        // Determine arbitrator role based on email
        let arbitratorRole = null;
        
        if (arbitration.presidingArbitrator?.email === userEmail) {
            arbitratorRole = 'presidingArbitrator';
        }
        else if (arbitration.arbitrator1?.email === userEmail) {
            arbitratorRole = 'arbitrator1';
        }
        else if (arbitration.arbitrator2?.email === userEmail) {
            arbitratorRole = 'arbitrator2';
        }
        else {
            return res.status(403).json({
                success: false,
                message: 'User is not authorized as an arbitrator for this case'
            });
        }

        // Create new note object
        const newNote = {
            noteId: `NOTE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            arbitratorRole: arbitratorRole,
            arbitratorEmail: userEmail,
            note: note,
            timestamp: new Date(),
            edited: false,
            editedAt: null,
        };

        // Initialize privateNotes if it doesn't exist
        if (!hearing.privateNotes) {
            hearing.privateNotes = [];
        }

        // Add note to array
        hearing.privateNotes.push(newNote);
        hearing.updatedAt = new Date();

        // Update in database
        const result = await hearingsCollection.updateOne(
            { hearingId: hearingId },
            { 
                $set: { 
                    privateNotes: hearing.privateNotes,
                    updatedAt: new Date()
                } 
            }
        );

        if (result.modifiedCount === 0) {
            return res.status(400).json({
                success: false,
                message: 'Failed to add note'
            });
        }

        res.json({
            success: true,
            message: 'Note added successfully',
            data: newNote
        });

    } catch (error) {
        console.error('Error adding note:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});


//show all private note
router.get('/hearings/:hearingId/notes', verifyToken, async (req, res) => {
    try {
        const { hearingId } = req.params;
        
        const hearing = await hearingsCollection.findOne(
            { hearingId: hearingId },
            { projection: { privateNotes: 1 } }
        );

        if (!hearing) {
            return res.status(404).json({
                success: false,
                message: 'Hearing not found'
            });
        }

        res.json({
            success: true,
            message: 'Notes fetched successfully',
            data: hearing.privateNotes || []
        });

    } catch (error) {
        console.error('Error fetching notes:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

//update attendance 
router.patch('/hearings/:hearingId/attendance', verifyToken, async (req, res) => {
    try {
        const { hearingId } = req.params;
        const { attendance } = req.body;

        if (!attendance) {
            return res.status(400).json({
                success: false,
                message: 'Attendance data is required'
            });
        }

        // Validate attendance structure
        if (attendance.presidingArbitrator === undefined || 
            attendance.arbitrator1 === undefined || 
            attendance.arbitrator2 === undefined ||
            !Array.isArray(attendance.plaintiffs) ||
            !Array.isArray(attendance.defendants)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid attendance structure'
            });
        }

        // Update hearing with attendance and set status to "completed"
        const result = await hearingsCollection.updateOne(
            { hearingId: hearingId },
            { 
                $set: { 
                    attendance: attendance,
                    status: 'completed', // Auto-set status to completed
                    updatedAt: new Date()
                } 
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Hearing not found'
            });
        }

        if (result.modifiedCount === 0) {
            return res.status(400).json({
                success: false,
                message: 'No changes made'
            });
        }

        // Fetch updated hearing to return
        const updatedHearing = await hearingsCollection.findOne(
            { hearingId: hearingId },
            { projection: { attendance: 1, status: 1 } }
        );

        res.json({
            success: true,
            message: 'Attendance updated successfully. Hearing status set to completed.',
            data: {
                attendance: updatedHearing.attendance,
                status: updatedHearing.status
            }
        });

    } catch (error) {
        console.error('Error updating attendance:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});


//get all attendance 
router.get('/hearings/:hearingId/attendance', async (req, res) => {
    try {
        const { hearingId } = req.params;
        
        const hearing = await hearingsCollection.findOne(
            { hearingId: hearingId },
            { projection: { attendance: 1 } }
        );

        if (!hearing) {
            return res.status(404).json({
                success: false,
                message: 'Hearing not found'
            });
        }

        res.json({
            success: true,
            message: 'Attendance fetched successfully',
            data: hearing.attendance || {
                presidingArbitrator: false,
                arbitrator1: false,
                arbitrator2: false,
                plaintiffs: [],
                defendants: []
            }
        });

    } catch (error) {
        console.error('Error fetching attendance:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Get all scheduled hearings for a specific arbitrator
router.get('/hearings/status/scheduled', verifyToken, async (req, res) => {
    try {
        // Email টা query parameter থেকে নিচ্ছি, token থেকে না
        const { email } = req.query;
        
        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Email is required in query parameter'
            });
        }

        // Step 1: Find all arbitrations where this email exists in any arbitrator field
        const arbitrations = await arbitrationCollection.find({
            $or: [
                { 'presidingArbitrator.email': email },
                { 'arbitrator1.email': email },
                { 'arbitrator2.email': email }
            ]
        }).toArray();

       // console.log(`2. Found ${arbitrations.length} arbitrations for email:`, email);

        if (!arbitrations || arbitrations.length === 0) {
            return res.json({
                success: true,
                message: 'No arbitrations found for this arbitrator',
                data: []
            });
        }

        // Step 2: Extract arbitration IDs
        const arbitrationIds = arbitrations.map(a => a.arbitrationId);
        //console.log('3. Arbitration IDs:', arbitrationIds);

        // Step 3: Find all scheduled hearings for these arbitrations
        const scheduledHearings = await hearingsCollection.find({
            arbitrationId: { $in: arbitrationIds },
            status: 'scheduled'
        }).sort({ date: 1 }).toArray();

        //console.log(`4. Found ${scheduledHearings.length} scheduled hearings`);

        // Step 4: Enrich hearing data with arbitration details
        const enrichedHearings = scheduledHearings.map(hearing => {
            const arbitration = arbitrations.find(a => a.arbitrationId === hearing.arbitrationId);
            return {
                ...hearing,
                arbitrationDetails: {
                    caseTitle: arbitration?.caseTitle || 'Unknown Case',
                    caseCategory: arbitration?.caseCategory || 'Unknown',
                    arbitration_status: arbitration?.arbitration_status || 'Unknown',
                    presidingArbitrator: arbitration?.presidingArbitrator,
                    arbitrator1: arbitration?.arbitrator1,
                    arbitrator2: arbitration?.arbitrator2
                },
                userRole: arbitration?.presidingArbitrator?.email === email ? 'presidingArbitrator' :
                          arbitration?.arbitrator1?.email === email ? 'arbitrator1' :
                          arbitration?.arbitrator2?.email === email ? 'arbitrator2' : 'unknown'
            };
        });

        //console.log(`5. Success! Returning ${enrichedHearings.length} hearings`);

        res.json({
            success: true,
            message: 'Scheduled hearings fetched successfully',
            count: enrichedHearings.length,
            data: enrichedHearings
        });

    } catch (error) {
        console.error('=== ERROR DEBUG ===');
        console.error('Error:', error);
        
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});





//show both parties file 
// Get ALL plaintiff and defendant files for an arbitration (by arbitrationId only)
router.get("/allPartyFiles", async (req, res) => {
  try {
    const { arbitrationId } = req.query;
    console.log(req.query); 
    if (!arbitrationId) {
      return res.status(400).json({ message: "arbitrationId is required" });
    }

    // 1️⃣ Check arbitration exists
    const arbitration = await arbitrationCollection.findOne({ arbitrationId });
    if (!arbitration) {
      return res.status(404).json({ message: "Arbitration not found" });
    }

    // 2️⃣ Fetch the file document for this arbitration
    const filesDoc = await arbitration_filesCollection.findOne({ arbitrationId });

    // If no file document exists yet, return empty arrays (not an error)
    if (!filesDoc) {
      return res.status(200).json({
        arbitrationId,
        plaintiffs: arbitration.plaintiffs.map((p) => ({
          partyId: p.id,
          name: p.name,
          email: p.email,
          files: [],
        })),
        defendants: arbitration.defendants.map((d) => ({
          partyId: d.id,
          name: d.name,
          email: d.email,
          files: [],
        })),
      });
    }

    // 3️⃣ Build plaintiff results
    // Merge arbitrationCollection party info with filesDoc party files
    const plaintiffs = arbitration.plaintiffs.map((p) => {
      const partyFilesDoc = filesDoc.plaintiffDocuments?.find(
        (pd) => pd.partyId === p.id
      );
      return {
        partyId: p.id,
        name: p.name,
        email: p.email,
        files: partyFilesDoc?.files || [],
      };
    });

    // 4️⃣ Build defendant results
    const defendants = arbitration.defendants.map((d) => {
      const partyFilesDoc = filesDoc.defendantDocuments?.find(
        (dd) => dd.partyId === d.id
      );
      return {
        partyId: d.id,
        name: d.name,
        email: d.email,
        files: partyFilesDoc?.files || [],
      };
    });

    // 5️⃣ Summary counts
    const totalPlaintiffFiles = plaintiffs.reduce(
      (sum, p) => sum + p.files.length,
      0
    );
    const totalDefendantFiles = defendants.reduce(
      (sum, d) => sum + d.files.length,
      0
    );

    res.status(200).json({
      arbitrationId,
      totalPlaintiffFiles,
      totalDefendantFiles,
      plaintiffs,
      defendants,
    });

  } catch (error) {
    console.error("Error fetching all party files:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
