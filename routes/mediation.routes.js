const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { client } = require("../config/db");
const verifyToken = require("../middleware/verifyToken");

const SSLCommerzPayment = require("sslcommerz-lts");

const store_id = process.env.STORE_ID;
const store_passwd = process.env.STORE_PASS;
const is_live = false;

const mediationCollection = client.db("justiFi").collection("mediations");
const mediatorCollection = client.db("justiFi").collection("mediators");

function createUniqueMediationId() {
    const prefix = "MED";
    const objectId = new ObjectId().toString();

    const part1 = objectId.slice(0, 5).toUpperCase();
    const part2 = parseInt(objectId.slice(5, 13), 16)
        .toString()
        .padStart(8, "0")
        .slice(0, 8);

    return `${prefix}-${part1}-${part2}`;
}

// Create mediation case request from frontend mediationDetails (mediation.jsx)
router.post("/mediation-requests", verifyToken, async (req, res) => {
    try {
        const mediationDetails = req.body;
        const mediationId = createUniqueMediationId();

        const data = {
            total_amount: mediationDetails.processingFee,
            currency: "BDT",
            tran_id: mediationId,
            success_url: `http://localhost:5000/payment/success/${mediationId}`,
            fail_url: `http://localhost:5000/payment/fail/${mediationId}`,
            cancel_url: `http://localhost:5000/payment/cancel/${mediationId}`,
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
            let GatewayPageURL = apiResponse.GatewayPageURL;
            res.send({ url: GatewayPageURL });

            mediationDetails.payment_status = false;
            mediationDetails.mediation_status = "pending";

            const mediationResult = await mediationCollection.insertOne(
                mediationDetails
            );
        });
    } catch (error) {
        console.error("Error saving mediation mediationDetails:", error);
        res.status(500).json({
            success: false,
            message: "Failed to create mediation case",
        });
    }
});

router.post("/payment/success/:mediationId", async (req, res) => {
    const { mediationId } = req.params;
    const result = await mediationCollection.updateOne(
        { mediationId: mediationId },
        { $set: { payment_status: "success", paidAt: new Date() } }
    );
    res.redirect(`http://localhost:5173/payment-success/${mediationId}`);
});

router.post("/payment/fail/:mediationId", async (req, res) => {
    const { mediationId } = req.params;
    const result = await mediationCollection.updateOne(
        { mediationId: mediationId },
        { $set: { payment_status: "failed", paidAt: new Date() } }
    );
    res.redirect(`http://localhost:5173/payment-failed/${mediationId}`);
});

router.post("/payment/cancel/:mediationId", async (req, res) => {
    const { mediationId } = req.params;
    const result = await mediationCollection.updateOne(
        { mediationId: mediationId },
        { $set: { payment_status: "canceled", paidAt: new Date() } }
    );
    res.redirect(`http://localhost:5173/payment-cancelled/${mediationId}`);
});

// Get All mediation cases
router.get("/all-mediations", async (req, res) => {
    const allMediation = await mediationCollection.find();
    const result = await allMediation.sort({ submissionDate: -1 }).toArray();
    res.send(result);
});


function isEmailInGroup(group, email) {
    if (!group || typeof group !== "object") return false;
    return Object.values(group).some((p) => p && p.email === email);
}

function parseId(id) {
    try {
        return new ObjectId(id);
    } catch {
        return id;
    }
}


function arrayToIndexedObject(arr) {
    if (!Array.isArray(arr)) return arr; // already an object, leave it
    return arr.reduce((acc, item, index) => {
        acc[String(index + 1)] = item;
        return acc;
    }, {});
}

router.get("/myMediations", verifyToken, async (req, res) => {
    try {
        const { email } = req.query;

        if (!email) {
            return res.status(400).json({ success: false, error: "Email is required" });
        }

        const allMediations = await mediationCollection
            .find({})
            .sort({ submissionDate: -1 })
            .toArray();

        const userMediations = allMediations.filter((mediation) =>
            isEmailInGroup(mediation.plaintiffs, email) ||
            isEmailInGroup(mediation.defendants, email)
        );

        return res.status(200).json({
            success: true,
            count: userMediations.length,
            data: userMediations,
        });
    } catch (error) {
        console.error("Error in GET /myMediations:", error);
        return res.status(500).json({ success: false, error: "Failed to fetch mediations", message: error.message });
    }
});


router.get("/my-mediations/:id", verifyToken, async (req, res) => {
    try {
        const caseId = req.params.id;
        const { email } = req.query;

        if (!email) {
            return res.status(400).json({ success: false, error: "Email is required" });
        }

        const mediation = await mediationCollection.findOne({ _id: parseId(caseId) });

        if (!mediation) {
            return res.status(404).json({ success: false, error: "Mediation not found" });
        }

        const hasAccess =
            isEmailInGroup(mediation.plaintiffs, email) ||
            isEmailInGroup(mediation.defendants, email);

        if (!hasAccess) {
            return res.status(403).json({ success: false, error: "Access denied. You are not a party to this mediation." });
        }

        return res.status(200).json({ success: true, data: mediation });
    } catch (error) {
        console.error("Error in GET /my-mediations/:id:", error);
        return res.status(500).json({ success: false, error: "Failed to fetch mediation", message: error.message });
    }
});


router.patch("/mediation-agreement", verifyToken, async (req, res) => {
    try {
        const { data } = req.body;

        if (!data || !data.caseId) {
            return res.status(400).json({
                success: false,
                error: "caseId is required in the request body",
            });
        }

        const caseId = data.caseId;


        const plaintiffsAsObject = arrayToIndexedObject(data.plaintiffs);
        const defendantsAsObject = arrayToIndexedObject(data.defendants);

        const updatePayload = {
            mediation_status: "ongoing",
            agreementDate: data.agreementDate,
            mediator: data.mediator,                        
            justifiRepresentative: data.justifiRepresentative, 
            plaintiffs: plaintiffsAsObject,
            defendants: defendantsAsObject,
            disputeCategory: data.disputeCategory,
            disputeNature: data.disputeNature,
            suitValue: data.suitValue,
            sessionsAgreed: data.sessionsAgreed,
            totalCost: data.totalCost,
            costPerParty: data.costPerParty,
            agreementSubmittedAt: new Date(),
        };

        // Remove undefined keys so we don't store nulls for optional fields
        Object.keys(updatePayload).forEach(
            (key) => updatePayload[key] === undefined && delete updatePayload[key]
        );

        const result = await mediationCollection.updateOne(
            { _id: new ObjectId(caseId) },
            { $set: updatePayload }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                error: "Mediation case not found",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Agreement submitted successfully",
        });
    } catch (error) {
        console.error("Error in PATCH /mediation-agreement:", error);
        return res.status(500).json({
            success: false,
            error: "Failed to submit agreement",
            message: error.message,
        });
    }
});

module.exports = router;