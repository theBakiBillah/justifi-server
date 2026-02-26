// ─────────────────────────────────────────────────────────────────────────────
// verdict.routes.js
//
// app.js / index.js এ add করুন:
//   const verdictRouter = require('./routes/verdict.routes');
//   app.use('/verdict', verdictRouter);
// ─────────────────────────────────────────────────────────────────────────────

const express    = require('express');
const router     = express.Router();
const { client } = require('../config/db');

// ── Collections (আপনার exact pattern অনুযায়ী) ───────────────────────────────
const verdictCollection     = client.db('justiFi').collection('Verdicts');
const arbitrationCollection = client.db('justiFi').collection('arbitrations');
const hearingCollection     = client.db('justiFi').collection('hearings');

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

const genVerdictId = (arbitrationId) => {
  const mid = arbitrationId?.split('-')[1] || 'XXXXX';
  const ts  = Date.now().toString().slice(-9);
  return `VER-${mid}-${ts}`;
};

function processIssues(issues = []) {
  return issues.map((iss, idx) => ({
    issueId:     `ISS_${String(idx + 1).padStart(3, '0')}`,
    issueNumber: idx + 1,
    title:       iss.title    || '',
    finding:     iss.finding  || '',
    decision:    iss.decision || '',
  }));
}

const buildSnapshot = (arb, hearings = []) => ({
  caseTitle:      arb.caseTitle,
  caseCategory:   arb.caseCategory,
  disputeNature:  arb.disputeNature,
  suitValue:      arb.suitValue,
  submissionDate: arb.submissionDate,
  agreementDate:  arb.agreementDate,
  sittings:       arb.sittings,
  complianceDays: arb.complianceDays,
  processingFee:  arb.processingFee,
  totalCost:      arb.totalCost,

  plaintiffs: (arb.plaintiffs || []).map(p => ({
    id: p.id, name: p.name, email: p.email, phone: p.phone,
    address: p.address, occupation: p.occupation, parentsName: p.parentsName,
    representatives: (p.representatives || []).map(r => ({
      name: r.name, email: r.email, designation: r.designation, phone: r.phone,
    })),
  })),

  defendants: (arb.defendants || []).map(d => ({
    id: d.id, name: d.name, email: d.email, phone: d.phone,
    address: d.address, occupation: d.occupation, parentsName: d.parentsName,
  })),

  presidingArbitrator:   arb.presidingArbitrator,
  arbitrator1:           arb.arbitrator1,
  arbitrator2:           arb.arbitrator2,
  justifiRepresentative: arb.justifiRepresentative,

  hearings: hearings.map(h => ({
    hearingId:     h.hearingId,
    hearingNumber: h.hearingNumber,
    date:          h.date,
    duration:      h.duration,
    agenda:        h.hearingAgenda,
    status:        h.status,
    attendance:    h.attendance,
  })),
});


router.get("/allVerdicts", async (req, res) => {
  try {
    const cursor = verdictCollection.find();
    const result = await cursor.toArray();
    res.send(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/deleteVerdict/:verdictId', async (req, res) => {
    try {
        const { verdictId } = req.params;

        console.log("Param received:", verdictId);

        // First check if exists
        const existing = await verdictCollection.findOne({
            verdictId: verdictId.trim()
        });

       // console.log("Found in DB:", existing);

        if (!existing) {
            return res.status(404).json({
                success: false,
                message: "verdictId not found"
            });
        }

        await verdictCollection.deleteOne({
            verdictId: verdictId.trim()
        });

        res.json({
            success: true,
            message: "verdict deleted successfully"
        });

    } catch (error) {
        console.error("Delete error:", error);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// GET /verdict/draft/:arbitrationId
// Existing draft আনবে — form pre-fill এর জন্য
// ─────────────────────────────────────────────────────────────────────────────
router.get('/draft/:arbitrationId', async (req, res) => {
  try {
    const { arbitrationId } = req.params;

    const verdict = await verdictCollection.findOne(
      { arbitrationId, status: 'draft' },
      { sort: { updatedAt: -1 } }
    );

    return res.json({ success: true, data: verdict || null });

  } catch (err) {
    console.error('[GET /verdict/draft]', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /verdict/save-draft
// Draft create বা update
//
// Body: { arbitrationId, caseId, createdBy, proceedings, claimsSummary, issues, finalOrder }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/save-draft', async (req, res) => {
  try {
    const {
      arbitrationId, caseId, createdBy,
      proceedings, claimsSummary, issues, finalOrder,
    } = req.body;

    if (!arbitrationId) {
      return res.status(400).json({ success: false, message: 'arbitrationId is required' });
    }

    const now = new Date();

    // Existing draft আছে কিনা check
    const existing = await verdictCollection.findOne({ arbitrationId, status: 'draft' });

    if (existing) {
      // Update existing draft
      await verdictCollection.updateOne(
        { _id: existing._id },
        {
          $set: {
            proceedings,
            claimsSummary,
            issues:    processIssues(issues),
            finalOrder,
            updatedAt: now,
          },
        }
      );
      return res.json({ success: true, message: 'Draft updated', verdictId: existing.verdictId });
    }

    // Fresh draft — snapshot বানাই
    const [arb, hearings] = await Promise.all([
      arbitrationCollection.findOne({ arbitrationId }),
      hearingCollection.find({ arbitrationId }).toArray(),
    ]);

    const verdictId = genVerdictId(arbitrationId);

    await verdictCollection.insertOne({
      verdictId,
      arbitrationId,
      caseId,
      status:      'draft',
      createdBy,
      createdAt:   now,
      updatedAt:   now,
      publishedAt: null,
      proceedings,
      claimsSummary,
      issues:   processIssues(issues),
      finalOrder,
      snapshot: buildSnapshot(arb || {}, hearings),
    });

    return res.json({ success: true, message: 'Draft saved', verdictId });

  } catch (err) {
    console.error('[POST /verdict/save-draft]', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /verdict/publish
// Publish + arbitration_status → "Completed"
//
// Body: same as save-draft
// ─────────────────────────────────────────────────────────────────────────────
router.post('/publish', async (req, res) => {
  try {
    const {
      arbitrationId, caseId, createdBy,
      proceedings, claimsSummary, issues, finalOrder,
    } = req.body;

    if (!arbitrationId) {
      return res.status(400).json({ success: false, message: 'arbitrationId is required' });
    }

    const now = new Date();

    const [arb, hearings] = await Promise.all([
      arbitrationCollection.findOne({ arbitrationId }),
      hearingCollection.find({ arbitrationId }).toArray(),
    ]);

    if (!arb) {
      return res.status(404).json({ success: false, message: 'Arbitration not found' });
    }

    const processedIssues = processIssues(issues);
    const snapshot        = buildSnapshot(arb, hearings);

    // Draft আছে কিনা check
    const existing = await verdictCollection.findOne({ arbitrationId, status: 'draft' });

    let verdictId;

    if (existing) {
      // Draft → Published
      verdictId = existing.verdictId;
      await verdictCollection.updateOne(
        { _id: existing._id },
        {
          $set: {
            status:      'published',
            proceedings,
            claimsSummary,
            issues:      processedIssues,
            finalOrder,
            snapshot,
            updatedAt:   now,
            publishedAt: now,
          },
        }
      );
    } else {
      // Draft ছাড়াই সরাসরি publish
      verdictId = genVerdictId(arbitrationId);
      await verdictCollection.insertOne({
        verdictId,
        arbitrationId,
        caseId,
        status:      'published',
        createdBy,
        createdAt:   now,
        updatedAt:   now,
        publishedAt: now,
        proceedings,
        claimsSummary,
        issues: processedIssues,
        finalOrder,
        snapshot,
      });
    }

    // Arbitration status update
    await arbitrationCollection.updateOne(
      { arbitrationId },
      { $set: { arbitration_status: 'Completed', verdictId, updatedAt: now } }
    );

    return res.json({ success: true, message: 'Verdict published', verdictId });

  } catch (err) {
    console.error('[POST /verdict/publish]', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /verdict/arbitration/:arbitrationId
// Case এর সব verdicts list
// NOTE: /:verdictId এর আগে রাখতে হবে — নইলে "arbitration" কে verdictId ভাববে
// ─────────────────────────────────────────────────────────────────────────────
router.get('/arbitration/:arbitrationId', async (req, res) => {
  try {
    const verdicts = await verdictCollection
      .find({ arbitrationId: req.params.arbitrationId })
      .sort({ createdAt: -1 })
      .toArray();

    return res.json({ success: true, data: verdicts });

  } catch (err) {
    console.error('[GET /verdict/arbitration/:id]', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /verdict/:verdictId
// Verdict detail — verdict detail page এর জন্য
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:verdictId', async (req, res) => {
  try {
    const verdict = await verdictCollection.findOne({ verdictId: req.params.verdictId });

    if (!verdict) {
      return res.status(404).json({ success: false, message: 'Verdict not found' });
    }

    return res.json({ success: true, data: verdict });

  } catch (err) {
    console.error('[GET /verdict/:verdictId]', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /verdict/:verdictId
// Draft delete — published verdict delete হবে না
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:verdictId', async (req, res) => {
  try {
    const verdict = await verdictCollection.findOne({ verdictId: req.params.verdictId });

    if (!verdict) {
      return res.status(404).json({ success: false, message: 'Verdict not found' });
    }
    if (verdict.status === 'published') {
      return res.status(403).json({ success: false, message: 'Published verdict cannot be deleted' });
    }

    await verdictCollection.deleteOne({ verdictId: req.params.verdictId });
    return res.json({ success: true, message: 'Draft deleted' });

  } catch (err) {
    console.error('[DELETE /verdict/:verdictId]', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// verdictRoutes.js এ যোগ করুন
const PDFDocument = require('pdfkit');

router.get('/pdf/:verdictId', async (req, res) => {
    try {
        const verdict = await verdictCollection.findOne({ verdictId: req.params.verdictId });
        if (!verdict) {
            return res.status(404).json({ success: false, message: 'Verdict not found' });
        }
        
        // Create PDF
        const doc = new PDFDocument();
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Verdict_${verdict.verdictId}.pdf`);
        
        doc.pipe(res);
        
        // Add content to PDF
        doc.fontSize(20).text('JUSTIFI', { align: 'center' });
        doc.fontSize(16).text('ARBITRATION AWARD', { align: 'center' });
        doc.moveDown();
        
        doc.fontSize(12).text(`Award No: ${verdict.verdictId}`);
        doc.text(`Date: ${new Date(verdict.finalOrder?.awardDate).toLocaleDateString()}`);
        doc.text(`Case No: ${verdict.arbitrationId}`);
        doc.moveDown();
        
        doc.text(`Award Amount: BDT ${verdict.finalOrder?.awardAmount?.toLocaleString() || 0}`);
        doc.text(`Amount in Words: ${verdict.finalOrder?.awardAmountWords || ''}`);
        doc.moveDown();
        
        doc.text(`Payable By: ${verdict.finalOrder?.payableBy?.join(', ') || 'N/A'}`);
        doc.text(`Payable To: ${verdict.finalOrder?.payableTo?.join(', ') || 'N/A'}`);
        doc.text(`Payment Deadline: ${verdict.finalOrder?.paymentDeadlineDays || 0} days`);
        
        if (verdict.finalOrder?.finalOrders) {
            doc.moveDown();
            doc.text('Final Orders:');
            doc.text(verdict.finalOrder.finalOrders);
        }
        
        doc.end();
        
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Install pdfkit
// npm install pdfkit
module.exports = router;