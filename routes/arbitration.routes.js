const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { client } = require("../config/db");
const verifyToken = require("../middleware/verifyToken");

const SSLCommerzPayment = require("sslcommerz-lts");

const store_id = process.env.STORE_ID;
const store_passwd = process.env.STORE_PASS;
const is_live = false;

const arbitrationCollection = client.db("justiFi").collection("arbitrations");

function createUniqueArbitrationId() {
    const prefix = "ARB";
    const objectId = new ObjectId().toString();

    const part1 = objectId.slice(0, 5).toUpperCase();
    const part2 = parseInt(objectId.slice(5, 13), 16)
        .toString()
        .padStart(8, "0")
        .slice(0, 8);

    return `${prefix}-${part1}-${part2}`;
}

// Create arbitration case request from frontend arbitrationDetails (arbitration.jsx)
router.post("/arbitration-requests", verifyToken, async (req, res) => {
    try {
        const arbitrationDetails = req.body;
        const arbitrationId = createUniqueArbitrationId();

        const data = {
            total_amount: arbitrationDetails.processingFee,
            currency: "BDT",
            tran_id: arbitrationId,
            success_url: `http://localhost:5000/payment/success/${arbitrationId}`,
            fail_url: `http://localhost:5000/payment/fail/${arbitrationId}`,
            cancel_url: `http://localhost:5000/payment/fail/${arbitrationId}`,
            ipn_url: "http://localhost:3030/ipn",
            shipping_method: "Courier",
            product_name: "Computer.",
            product_category: "Electronic",
            product_profile: "general",
            cus_name: "Customer Name",
            cus_email: "mHmZV@example.com",
            cus_add1: "Dhaka",
            cus_add2: "Dhaka",
            cus_city: "Dhaka",
            cus_state: "Dhaka",
            cus_postcode: "1000",
            cus_country: "Bangladesh",
            cus_phone: "01711111111",
            cus_fax: "01711111111",
            ship_name: "Customer Name",
            ship_add1: "Dhaka",
            ship_add2: "Dhaka",
            ship_city: "Dhaka",
            ship_state: "Dhaka",
            ship_postcode: 1000,
            ship_country: "Bangladesh",
        };
        const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
        sslcz.init(data).then(async (apiResponse) => {
            // Redirect the user to payment gateway
            let GatewayPageURL = apiResponse.GatewayPageURL;
            res.send({ url: GatewayPageURL });

            arbitrationDetails.arbitrationId = arbitrationId;
            arbitrationDetails.payment_status = false;
            arbitrationDetails.arbitration_status = "Pending";
            const arbitrationResult = await arbitrationCollection.insertOne(
                arbitrationDetails
            );
        });
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({
            success: false,
            message: "Something went wrong!",
        });
    }
});

router.post("/payment/success/:arbitrationId", async (req, res) => {
    const { arbitrationId } = req.params;
    console.log(arbitrationId);
    const result = await arbitrationCollection.updateOne(
        { arbitrationId: arbitrationId },
        {
            $set: {
                payment_status: true,
                paidAt: new Date(),
            },
        }
    );
});

router.post("/payment/fail/:arbitrationId", async (req, res) => {
    const { arbitrationId } = req.params;
    const result = await arbitrationCollection.updateOne(
        { arbitrationId: arbitrationId },
        {
            $set: {
                payment_status: "failed",
                paidAt: new Date(),
            },
        }
    );
});

router.post("/payment/cancel/:arbitrationId", async (req, res) => {
    const { arbitrationId } = req.params;
    const result = await arbitrationCollection.updateOne(
        { arbitrationId: arbitrationId },
        {
            $set: {
                payment_status: "canceled",
                paidAt: new Date(),
            },
        }
    );
});

//user get korbo
router.get("/currentArbitrations", async (req, res) => {
    const { email } = req.query;
    const user = await userCollection.findOne({ email });
    res.send(user);
});

// Get All arbitration cases
router.get("/all-arbitrations", async (req, res) => {
    const allArbitration = await arbitrationCollection.find();
    const result = await allArbitration.sort({ submissionDate: -1 }).toArray();
    res.send(result);
});

// // Get All arbitration cases from admin panel
// router.get("/all-arbitrations-admin", verifyToken, async (req, res) => {
//     const allArbitration = await arbitrationCollection.find();
//     const result = await allArbitration.sort({ submissionDate: -1 }).toArray();
//     res.send(result);
// });

// Get my arbitrations - FIXED VERSION
router.get("/myArbitrations", verifyToken, async (req, res) => {
    try {
        const { email } = req.query;

        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }

        // Get all arbitrations where user is plaintiff or defendant
        const allArbitrations = await arbitrationCollection
            .find({})
            .sort({ submissionDate: -1 })
            .toArray();

        //console.log("Total arbitrations found:", allArbitrations.length);

        // Filter arbitrations where user is involved
        const userArbitrations = allArbitrations.filter((arbitration) => {
            // Check plaintiffs
            if (arbitration.plaintiffs) {
                if (Array.isArray(arbitration.plaintiffs)) {
                    const isPlaintiff = arbitration.plaintiffs.some(
                        (plaintiff) => plaintiff && plaintiff.email === email
                    );
                    if (isPlaintiff) return true;
                } else {
                    // Handle object format {1: {...}, 2: {...}}
                    const plaintiffEntries = Object.values(
                        arbitration.plaintiffs
                    );
                    const isPlaintiff = plaintiffEntries.some(
                        (plaintiff) => plaintiff && plaintiff.email === email
                    );
                    if (isPlaintiff) return true;
                }
            }

            // Check defendants
            if (arbitration.defendants) {
                if (Array.isArray(arbitration.defendants)) {
                    const isDefendant = arbitration.defendants.some(
                        (defendant) => defendant && defendant.email === email
                    );
                    if (isDefendant) return true;
                } else {
                    // Handle object format {1: {...}, 2: {...}}
                    const defendantEntries = Object.values(
                        arbitration.defendants
                    );
                    const isDefendant = defendantEntries.some(
                        (defendant) => defendant && defendant.email === email
                    );
                    if (isDefendant) return true;
                }
            }

            return false;
        });

        res.json(userArbitrations);
    } catch (error) {
        console.error("Error in /myArbitrations:", error);
        res.status(500).json({ error: error.message });
    }
});

// routes/arbitrations.js - Add this route
router.get("/my-arbitrations/:id", verifyToken, async (req, res) => {
    console.log("arbitration id : ", req.query);
    try {
        const caseId = req.params.id;
        const { email } = req.query;

        console.log("Fetching arbitration:", caseId, "for email:", email);

        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }

        let query;
        if (ObjectId.isValid(caseId)) {
            query = { _id: new ObjectId(caseId) };
        } else {
            query = { arbitrationId: caseId };
        }

        const arbitration = await arbitrationCollection.findOne(query);

        if (!arbitration) {
            return res.status(404).json({ error: "Arbitration not found" });
        }

        // Check if user has access to this arbitration
        let hasAccess = false;

        // Check plaintiffs
        if (arbitration.plaintiffs) {
            if (Array.isArray(arbitration.plaintiffs)) {
                hasAccess = arbitration.plaintiffs.some(
                    (plaintiff) => plaintiff && plaintiff.email === email
                );
            } else {
                const plaintiffEntries = Object.values(arbitration.plaintiffs);
                hasAccess = plaintiffEntries.some(
                    (plaintiff) => plaintiff && plaintiff.email === email
                );
            }
        }

        // Check defendants if not already found
        if (!hasAccess && arbitration.defendants) {
            if (Array.isArray(arbitration.defendants)) {
                hasAccess = arbitration.defendants.some(
                    (defendant) => defendant && defendant.email === email
                );
            } else {
                const defendantEntries = Object.values(arbitration.defendants);
                hasAccess = defendantEntries.some(
                    (defendant) => defendant && defendant.email === email
                );
            }
        }

        if (!hasAccess) {
            return res
                .status(403)
                .json({ error: "Access denied to this arbitration" });
        }

        res.json(arbitration);
    } catch (error) {
        console.error("Error in /my-arbitrations/:id:", error);
        res.status(500).json({ error: error.message });
    }
});

// Create session link from admin panel
router.patch("/create-session/:_id", verifyToken, async (req, res) => {
    const { _id } = req.params;
    const sessionData = req.body;
    const result = await arbitrationCollection.updateOne(
        { _id: new ObjectId(_id) },
        { $set: { sessionData } }
    );
    res.json(result);
});

// Submitting agreement from both parties from admin
router.patch("/arbitration-agreement", verifyToken, async (req, res) => {
    const { data } = req.body;
    const caseId = data.caseId;
    data.arbitration_status = "Ongoing";

    try {
        const result = await arbitrationCollection.updateOne(
            { _id: new ObjectId(caseId) },
            { $set: data }
        );

        if (result.modifiedCount === 1) {
            res.json({ message: "Agreement submitted successfully" });
        } else {
            res.status(404).json({ error: "Arbitration not found" });
        }
    } catch (error) {
        console.error("Error in /arbitration-agreement:", error);
        res.status(500).json({ error: error.message });
    }
});

// Add representative for a user in arbitration case
router.patch("/add-representative/:caseId", verifyToken, async (req, res) => {
    try {
        const { caseId } = req.params;
        const { email, representative } = req.body;

        console.log("Adding representative for case:", caseId, "user:", email);

        if (!email || !caseId || !representative) {
            return res.status(400).json({ error: "Email, case ID and representative data are required" });
        }

        let query;
        if (ObjectId.isValid(caseId)) {
            query = { _id: new ObjectId(caseId) };
        } else {
            query = { arbitrationId: caseId };
        }

        const arbitration = await arbitrationCollection.findOne(query);
        
        if (!arbitration) {
            return res.status(404).json({ error: "Arbitration case not found" });
        }

        // Check if user has access to this arbitration
        let userFound = false;
        let updateField = '';
        let userIndex = -1;

        // Check plaintiffs
        if (arbitration.plaintiffs && Array.isArray(arbitration.plaintiffs)) {
            const plaintiffIndex = arbitration.plaintiffs.findIndex(
                plaintiff => plaintiff && plaintiff.email === email
            );
            if (plaintiffIndex !== -1) {
                userFound = true;
                updateField = 'plaintiffs';
                userIndex = plaintiffIndex;
            }
        }

        // Check defendants if not found in plaintiffs
        if (!userFound && arbitration.defendants && Array.isArray(arbitration.defendants)) {
            const defendantIndex = arbitration.defendants.findIndex(
                defendant => defendant && defendant.email === email
            );
            if (defendantIndex !== -1) {
                userFound = true;
                updateField = 'defendants';
                userIndex = defendantIndex;
            }
        }

        if (!userFound) {
            return res.status(403).json({ error: "User not found in this arbitration case" });
        }

        // Check if representative email/phone already exists in ANY party in this case
        const isRepresentativeAlreadyAssigned = await checkRepresentativeExists(arbitration, representative.email, representative.phone);
        if (isRepresentativeAlreadyAssigned) {
            return res.status(400).json({ 
                error: "A representative with this email or phone number is already assigned to another party in this case" 
            });
        }

        // Initialize representatives array if it doesn't exist
        const currentUser = arbitration[updateField][userIndex];
        const currentRepresentatives = currentUser.representatives || [];

        // Create new representative with unique ID and running status
        const newRepresentative = {
            _id: new ObjectId().toString(),
            ...representative,
            case_status: 'running',
            addedAt: new Date(),
            addedBy: email
        };

        // Add to representatives array
        const updatedRepresentatives = [...currentRepresentatives, newRepresentative];

        const updateOperation = {
            $set: {
                [`${updateField}.${userIndex}.representatives`]: updatedRepresentatives
            }
        };

        const result = await arbitrationCollection.updateOne(query, updateOperation);

        if (result.modifiedCount === 1) {
            const updatedArbitration = await arbitrationCollection.findOne(query);
            res.json({
                success: true,
                message: "Representative added successfully",
                arbitration: updatedArbitration
            });
        } else {
            res.status(400).json({ error: "Failed to add representative" });
        }

    } catch (error) {
        console.error("Error in /add-representative:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Remove representative for a user in arbitration case
router.patch("/remove-representative/:caseId", verifyToken, async (req, res) => {
    try {
        const { caseId } = req.params;
        const { email, representativeId } = req.body;

        console.log("Removing representative for case:", caseId, "user:", email, "representativeId:", representativeId);

        if (!email || !caseId || !representativeId) {
            return res.status(400).json({ error: "Email, case ID and representative ID are required" });
        }

        let query;
        if (ObjectId.isValid(caseId)) {
            query = { _id: new ObjectId(caseId) };
        } else {
            query = { arbitrationId: caseId };
        }

        const arbitration = await arbitrationCollection.findOne(query);
        
        if (!arbitration) {
            return res.status(404).json({ error: "Arbitration case not found" });
        }

        // Check if user has access to this arbitration
        let userFound = false;
        let updateField = '';
        let userIndex = -1;

        // Check plaintiffs
        if (arbitration.plaintiffs && Array.isArray(arbitration.plaintiffs)) {
            const plaintiffIndex = arbitration.plaintiffs.findIndex(
                plaintiff => plaintiff && plaintiff.email === email
            );
            if (plaintiffIndex !== -1) {
                userFound = true;
                updateField = 'plaintiffs';
                userIndex = plaintiffIndex;
            }
        }

        // Check defendants if not found in plaintiffs
        if (!userFound && arbitration.defendants && Array.isArray(arbitration.defendants)) {
            const defendantIndex = arbitration.defendants.findIndex(
                defendant => defendant && defendant.email === email
            );
            if (defendantIndex !== -1) {
                userFound = true;
                updateField = 'defendants';
                userIndex = defendantIndex;
            }
        }

        if (!userFound) {
            return res.status(403).json({ error: "User not found in this arbitration case" });
        }

        const currentUser = arbitration[updateField][userIndex];
        const currentRepresentatives = currentUser.representatives || [];

        // Find the representative to remove
        const representativeIndex = currentRepresentatives.findIndex(
            rep => rep._id === representativeId
        );

        if (representativeIndex === -1) {
            return res.status(404).json({ error: "Representative not found" });
        }

        // Update the representative status to cancelled instead of removing
        const updatedRepresentatives = [...currentRepresentatives];
        updatedRepresentatives[representativeIndex] = {
            ...updatedRepresentatives[representativeIndex],
            case_status: 'cancelled',
            removedAt: new Date()
        };

        const updateOperation = {
            $set: {
                [`${updateField}.${userIndex}.representatives`]: updatedRepresentatives
            }
        };

        const result = await arbitrationCollection.updateOne(query, updateOperation);

        if (result.modifiedCount === 1) {
            const updatedArbitration = await arbitrationCollection.findOne(query);
            res.json({
                success: true,
                message: "Representative removed successfully",
                arbitration: updatedArbitration
            });
        } else {
            res.status(400).json({ error: "Failed to remove representative" });
        }

    } catch (error) {
        console.error("Error in /remove-representative:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Get all representatives for a user in arbitration case
router.get("/get-representatives/:caseId", verifyToken, async (req, res) => {
    try {
        const { caseId } = req.params;
        const { email } = req.query;

        console.log("Getting representatives for case:", caseId, "user:", email);

        if (!email || !caseId) {
            return res.status(400).json({ error: "Email and case ID are required" });
        }

        let query;
        if (ObjectId.isValid(caseId)) {
            query = { _id: new ObjectId(caseId) };
        } else {
            query = { arbitrationId: caseId };
        }

        const arbitration = await arbitrationCollection.findOne(query);
        
        if (!arbitration) {
            return res.status(404).json({ error: "Arbitration case not found" });
        }

        // Find user in plaintiffs or defendants
        let userRepresentatives = [];

        // Check plaintiffs
        if (arbitration.plaintiffs && Array.isArray(arbitration.plaintiffs)) {
            const plaintiff = arbitration.plaintiffs.find(p => p && p.email === email);
            if (plaintiff && plaintiff.representatives) {
                userRepresentatives = plaintiff.representatives;
            }
        }

        // Check defendants if not found in plaintiffs
        if (userRepresentatives.length === 0 && arbitration.defendants && Array.isArray(arbitration.defendants)) {
            const defendant = arbitration.defendants.find(d => d && d.email === email);
            if (defendant && defendant.representatives) {
                userRepresentatives = defendant.representatives;
            }
        }

        res.json({
            success: true,
            representatives: userRepresentatives
        });

    } catch (error) {
        console.error("Error in /get-representatives:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Helper function to check if representative email/phone already exists in any party
async function checkRepresentativeExists(arbitration, repEmail, repPhone) {
    // Check all plaintiffs
    if (arbitration.plaintiffs && Array.isArray(arbitration.plaintiffs)) {
        for (const plaintiff of arbitration.plaintiffs) {
            if (plaintiff && plaintiff.representatives) {
                const existingRep = plaintiff.representatives.find(rep => 
                    rep && rep.case_status === 'running' && 
                    (rep.email === repEmail || rep.phone === repPhone)
                );
                if (existingRep) return true;
            }
        }
    }

    // Check all defendants
    if (arbitration.defendants && Array.isArray(arbitration.defendants)) {
        for (const defendant of arbitration.defendants) {
            if (defendant && defendant.representatives) {
                const existingRep = defendant.representatives.find(rep => 
                    rep && rep.case_status === 'running' && 
                    (rep.email === repEmail || rep.phone === repPhone)
                );
                if (existingRep) return true;
            }
        }
    }

    return false;
}

// Get arbitrator by email
router.get("/email/:email", async (req, res) => {
    try {
        const { email } = req.params;
        
        console.log("Fetching arbitrator by email:", email);

        if (!email) {
            return res.status(400).json({ 
                success: false,
                error: "Email is required" 
            });
        }

        const arbitrator = await arbitratorCollection.findOne({ email: email.toLowerCase().trim() });
        
        if (!arbitrator) {
            return res.status(404).json({ 
                success: false,
                error: "Arbitrator not found" 
            });
        }

        res.json({
            success: true,
            arbitrator: arbitrator
        });

    } catch (error) {
        console.error("Error in /email/:email:", error);
        res.status(500).json({ 
            success: false,
            error: "Internal server error" 
        });
    }
});
module.exports = router;
