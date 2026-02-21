const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { client } = require("../config/db");
const verifyToken = require("../middleware/verifyToken");
const verifyAdmin = require("../middleware/verifyAdmin");

const arbitratorCollection = client.db("justiFi").collection("arbitrators");
const userCollection = client.db("justiFi").collection("users");
const arbitrationCollection = client.db("justiFi").collection("arbitrations");
const Hearing = client.db("justiFi").collection("Hearing");

// Get All Arbitrators from admin panel
router.get("/all-arbitrators", verifyToken, async (req, res) => {
    const cursor = arbitratorCollection.find();
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
            return res
                .status(400)
                .json({
                    success: false,
                    message: "Email parameter is required",
                });
        }

        const arbitrations = await arbitrationCollection
            .find({ presidingArbitratorEmail: email })
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

module.exports = router;
