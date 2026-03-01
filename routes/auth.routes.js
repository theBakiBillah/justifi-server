const express = require("express");
const jwt = require("jsonwebtoken");
const router = express.Router();
const { client } = require("../config/db");

// jwt authentication
router.post("/jwt", (req, res) => {
    const { email, name, picture } = req.body;
    const token = jwt.sign({ email, name, picture }, process.env.ACCESS_TOKEN, {
        expiresIn: "30d",
    });

    res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
    }).send({ success: true, token });
});

router.post("/logout", (req, res) => {
    res.clearCookie("token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
    }).send({ success: true });
});

module.exports = router;