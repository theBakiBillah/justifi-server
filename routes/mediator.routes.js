const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { client } = require("../config/db");
const verifyToken = require("../middleware/verifyToken");
const verifyAdmin = require("../middleware/verifyAdmin");

const mediatorCollection = client.db("justiFi").collection("mediators");

router.get("/mediators", async (req, res) => {
    const cursor = mediatorCollection.find();
    const result = await cursor.toArray();
    res.send(result);
});

// Get All Mediators from admin panel
router.get("/all-mediators", verifyToken, async (req, res) => {
    const cursor = mediatorCollection.find();
    const result = await cursor.toArray();
    res.send(result);
});

// Get mediator profile
router.get("/MediatorProfile", verifyToken, async (req, res) => {
    const { email } = req.query;
    const mediator = await mediatorCollection.findOne({ email });
    res.send(mediator);
});

// Update mediator profile
router.patch("/MediatorProfile/:email", verifyToken, async (req, res) => {
    try {
        const { email } = req.params;
        const data = req.body;

        const { _id, ...updateData } = data;

        if (Object.keys(updateData).length === 0) {
            return res
                .status(400)
                .send({ success: false, error: "No valid fields to update" });
        }

        const mediatorResult = await mediatorCollection.updateOne(
            { email },
            { $set: updateData }
        );

        if (mediatorResult.matchedCount === 0) {
            return res
                .status(404)
                .send({ success: false, error: "Mediator not found" });
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

module.exports = router;
